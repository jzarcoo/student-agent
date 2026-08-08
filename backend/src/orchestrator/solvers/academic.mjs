import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../db.mjs";

// Load the full prerequisite graph from DynamoDB
async function loadPrereqGraph() {
  const resp = await ddb.send(new ScanCommand({
    TableName: process.env.PREREQS_TABLE,
  }));
  return resp.Items ?? [];
}

// Load all courses
async function loadCourses() {
  const resp = await ddb.send(new ScanCommand({
    TableName: process.env.COURSES_TABLE,
  }));
  return resp.Items ?? [];
}

// Load student's academic progress
async function loadProgress(studentId) {
  const resp = await ddb.send(new QueryCommand({
    TableName: process.env.PROGRESS_TABLE,
    KeyConditionExpression: "studentId = :sid",
    ExpressionAttributeValues: { ":sid": studentId },
  }));
  return resp.Items ?? [];
}

// Given student history, determine status of each course
// Returns: { clave -> { status, blockers, warnings, distanceToGrad } }
export async function checkPrerequisites(studentId) {
  const [edges, courses, progress] = await Promise.all([
    loadPrereqGraph(),
    loadCourses(),
    loadProgress(studentId),
  ]);

  const aprobadas = new Set(
    progress.filter(p => p.estado === "aprobada").map(p => p.clave)
  );
  const enCurso = new Set(
    progress.filter(p => p.estado === "en_curso" || p.estado === "recursando").map(p => p.clave)
  );
  const reprobadas = new Set(
    progress.filter(p => p.estado === "reprobada").map(p => p.clave)
  );

  const result = {};

  for (const course of courses) {
    const { clave } = course;

    if (aprobadas.has(clave)) {
      result[clave] = { status: "aprobada", blockers: [], warnings: [] };
      continue;
    }
    if (enCurso.has(clave)) {
      result[clave] = { status: "en_curso", blockers: [], warnings: [] };
      continue;
    }

    const prereqs = edges.filter(e => e.clave === clave);
    const obligatorios = prereqs.filter(e => e.tipo === "obligatorio");
    const sugeridos = prereqs.filter(e => e.tipo === "sugerido");

    const blockers = obligatorios
      .filter(e => !aprobadas.has(e.prereqClave))
      .map(e => e.prereqClave);

    const warnings = sugeridos
      .filter(e => !aprobadas.has(e.prereqClave))
      .map(e => `Se sugiere haber cursado ${e.prereqClave} antes`);

    let status;
    if (reprobadas.has(clave)) {
      status = blockers.length === 0 ? "recursable" : "bloqueada";
    } else if (blockers.length === 0) {
      status = warnings.length > 0 ? "disponible_con_advertencia" : "disponible";
    } else {
      status = "bloqueada";
    }

    result[clave] = { status, blockers, warnings };
  }

  return result;
}

// Returns courses the student CAN enroll in this semester
export async function getAvailableCourses(studentId) {
  const prereqStatus = await checkPrerequisites(studentId);
  return Object.entries(prereqStatus)
    .filter(([, v]) => v.status === "disponible" || v.status === "disponible_con_advertencia" || v.status === "recursable")
    .map(([clave, info]) => ({ clave, ...info }));
}

// Calculate total credits obtained
export async function calculateCredits(studentId) {
  const [progress, courses] = await Promise.all([
    loadProgress(studentId),
    loadCourses(),
  ]);

  const courseMap = Object.fromEntries(courses.map(c => [c.clave, c]));
  const aprobadas = progress.filter(p => p.estado === "aprobada");

  const total = aprobadas.reduce((sum, p) => {
    const course = courseMap[p.clave];
    return sum + (course?.creditos ?? 0);
  }, 0);

  return {
    obtenidos: total,
    requeridos: 384, // CC total credits at UNAM Ciencias
    porcentaje: Math.round((total / 384) * 100),
    materiasFaltantes: Object.keys(courseMap).length - aprobadas.length,
  };
}

// Estimate graduation semester
export async function estimateGraduation(studentId, creditosPorSemestre = 30) {
  const { obtenidos, requeridos } = await calculateCredits(studentId);
  const restantes = requeridos - obtenidos;
  const semestresRestantes = Math.ceil(restantes / creditosPorSemestre);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentSemester = now.getMonth() < 6 ? 1 : 2;

  let year = currentYear;
  let semester = currentSemester;

  for (let i = 0; i < semestresRestantes; i++) {
    semester++;
    if (semester > 2) {
      semester = 1;
      year++;
    }
  }

  return {
    semestresRestantes,
    graduacionEstimada: `${year}-${semester}`,
    creditosRestantes: restantes,
  };
}

// Suggest titulación modality based on student profile
export function suggestTitulacion(profile, credits) {
  const suggestions = [];

  if (credits.porcentaje >= 100) {
    if (profile.promedio >= 9.0) {
      suggestions.push({
        modalidad: "Titulación por promedio",
        descripcion: "Tu promedio >= 9.0 te califica para titulación automática. Es la ruta más rápida.",
        prioridad: 1,
      });
    }
    if (profile.intereses?.includes("investigación") || profile.metaProfesional === "researcher") {
      suggestions.push({
        modalidad: "Tesis",
        descripcion: "Dado tu interés en investigación, una tesis te abrirá puertas al posgrado.",
        prioridad: 2,
      });
    }
    suggestions.push({
      modalidad: "Examen general de conocimientos",
      descripcion: "Opción sólida si no quieres hacer tesis. Requiere preparación pero es directa.",
      prioridad: 3,
    });
  }

  return suggestions.sort((a, b) => a.prioridad - b.prioridad);
}

// Rank study priority for current courses
export function rankStudyPriority(materias, calificaciones, agenda) {
  return materias.map(materia => {
    const cal = calificaciones[materia.clave] ?? {};
    const proximoEvento = agenda
      .filter(a => a.clave === materia.clave)
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];

    const diasHastaEvento = proximoEvento
      ? Math.max(1, Math.ceil((new Date(proximoEvento.deadline) - Date.now()) / 86400000))
      : 30;

    const notaActual = cal.promedioParcial ?? 7;
    const notaNecesaria = Math.max(0, 6 - notaActual * 0.6) / 0.4; // needed in final to pass
    const pesoFinal = materia.evaluacion?.final ?? 0.4;

    const urgencia =
      (1 / diasHastaEvento) * 40 +
      Math.max(0, notaNecesaria - notaActual) * 30 +
      pesoFinal * 20 +
      (materia.dificultad ?? 5) * 10;

    return {
      clave: materia.clave,
      nombre: materia.nombre,
      urgencia: Math.round(urgencia),
      razon: buildReason(diasHastaEvento, notaActual, proximoEvento),
    };
  }).sort((a, b) => b.urgencia - a.urgencia);
}

function buildReason(dias, nota, evento) {
  const parts = [];
  if (evento && dias <= 3) parts.push(`${evento.titulo} en ${dias} día(s)`);
  if (nota < 7) parts.push(`promedio actual ${nota.toFixed(1)}`);
  return parts.join(", ") || "prioridad normal";
}

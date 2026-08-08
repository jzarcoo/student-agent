import { ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, CATALOG_TABLE } from "../db.mjs";
import { loadStudentProgress, loadStudentProfile } from "../session.mjs";

// ── Catalog loaders (product-catalog, read-only) ──────────────────────────────

async function loadCatalogItems(type) {
  // Items in product-catalog have id = "unam#<type>#<key>"
  const resp = await ddb.send(new ScanCommand({
    TableName: CATALOG_TABLE,
    FilterExpression: "begins_with(id, :prefix)",
    ExpressionAttributeValues: { ":prefix": `unam#${type}#` },
  }));
  return resp.Items ?? [];
}

async function getCatalogItem(type, key) {
  const resp = await ddb.send(new GetCommand({
    TableName: CATALOG_TABLE,
    Key: { id: `unam#${type}#${key}` },
  }));
  return resp.Item ?? null;
}

// ── Prerequisite check ────────────────────────────────────────────────────────

export async function checkPrerequisites(studentId) {
  const [edges, courses, courseProgress] = await Promise.all([
    loadCatalogItems("prereq"),
    loadCatalogItems("course"),
    loadStudentProgress(studentId),
  ]);

  const aprobadas = new Set(
    Object.values(courseProgress).filter(p => p.estado === "aprobada").map(p => p.clave)
  );
  const enCurso = new Set(
    Object.values(courseProgress).filter(p => p.estado === "en_curso" || p.estado === "recursando").map(p => p.clave)
  );
  const reprobadas = new Set(
    Object.values(courseProgress).filter(p => p.estado === "reprobada").map(p => p.clave)
  );

  const result = {};

  for (const course of courses) {
    const clave = course.clave ?? course.id.split("#")[2];

    if (aprobadas.has(clave)) {
      result[clave] = { status: "aprobada", nombre: course.nombre, blockers: [], warnings: [] };
      continue;
    }
    if (enCurso.has(clave)) {
      result[clave] = { status: "en_curso", nombre: course.nombre, blockers: [], warnings: [] };
      continue;
    }

    const prereqs = edges.filter(e => (e.clave ?? e.id.split("#")[2]) === clave);
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

    result[clave] = { status, nombre: course.nombre, creditos: course.creditos, blockers, warnings };
  }

  return result;
}

export async function getAvailableCourses(studentId) {
  const prereqStatus = await checkPrerequisites(studentId);
  return Object.entries(prereqStatus)
    .filter(([, v]) => ["disponible", "disponible_con_advertencia", "recursable"].includes(v.status))
    .map(([clave, info]) => ({ clave, ...info }));
}

// ── Credit calculator ─────────────────────────────────────────────────────────

export async function calculateCredits(studentId) {
  const [courses, courseProgress] = await Promise.all([
    loadCatalogItems("course"),
    loadStudentProgress(studentId),
  ]);

  const courseMap = Object.fromEntries(
    courses.map(c => [c.clave ?? c.id.split("#")[2], c])
  );
  const aprobadas = Object.values(courseProgress).filter(p => p.estado === "aprobada");

  const total = aprobadas.reduce((sum, p) => {
    const course = courseMap[p.clave];
    return sum + (course?.creditos ?? 0);
  }, 0);

  const TOTAL_REQUIRED = 384;
  return {
    obtenidos: total,
    requeridos: TOTAL_REQUIRED,
    porcentaje: Math.round((total / TOTAL_REQUIRED) * 100),
    materiasAprobadas: aprobadas.length,
    materiasTotales: courses.length,
  };
}

// ── Graduation estimate ───────────────────────────────────────────────────────

export async function estimateGraduation(studentId, creditosPorSemestre = 30) {
  const { obtenidos, requeridos } = await calculateCredits(studentId);
  const restantes = Math.max(0, requeridos - obtenidos);
  const semestresRestantes = Math.ceil(restantes / creditosPorSemestre);

  const now = new Date();
  let year = now.getFullYear();
  let semester = now.getMonth() < 6 ? 1 : 2;

  for (let i = 0; i < semestresRestantes; i++) {
    semester++;
    if (semester > 2) { semester = 1; year++; }
  }

  return {
    semestresRestantes,
    graduacionEstimada: `${year}-${semester}`,
    creditosRestantes: restantes,
  };
}

// ── Titulación suggestion ─────────────────────────────────────────────────────

export function suggestTitulacion(profile, credits) {
  const suggestions = [];
  if (credits.porcentaje >= 100) {
    if ((profile.promedio ?? 0) >= 9.0) {
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

// ── Study priority ranker ─────────────────────────────────────────────────────

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
    const pesoFinal = materia.evaluacion?.final ?? 0.4;
    const urgencia =
      (1 / diasHastaEvento) * 40 +
      Math.max(0, 6 - notaActual) * 30 +
      pesoFinal * 20 +
      (materia.dificultad ?? 5) * 10;

    const parts = [];
    if (proximoEvento && diasHastaEvento <= 3) parts.push(`${proximoEvento.titulo} en ${diasHastaEvento} día(s)`);
    if (notaActual < 7) parts.push(`promedio actual ${notaActual.toFixed(1)}`);

    return {
      clave: materia.clave,
      nombre: materia.nombre,
      urgencia: Math.round(urgencia),
      razon: parts.join(", ") || "prioridad normal",
    };
  }).sort((a, b) => b.urgencia - a.urgencia);
}

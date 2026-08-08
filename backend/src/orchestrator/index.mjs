import { CHAT_HTML } from "./chat-page.mjs";
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { z } from "zod";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { generateSchedules } from "./schedule.mjs";
import { calculateProgress } from "./credits.mjs";
import {
  checkPrerequisites, getAvailableCourses,
  calculateCredits, estimateGraduation,
  suggestTitulacion, rankStudyPriority,
} from "./solvers/academic.mjs";
import {
  getProfile, updateProfile, saveProfessorMemory,
  updateAcademicProgress, updateCourseGrades,
} from "./tools/student.mjs";
import { loadHistory, saveHistory, loadStudentProgress } from "./session.mjs";
import { ddb, CATALOG_TABLE } from "./db.mjs";

const model = new BedrockModel({
  modelId: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
});

// ── Catalog helpers ───────────────────────────────────────────────────────────

async function getCatalogCourseGroups(courseKey, semester) {
  const resp = await ddb.send(new ScanCommand({
    TableName: CATALOG_TABLE,
    FilterExpression: "id = :id",
    ExpressionAttributeValues: { ":id": `unam#group#${courseKey}#${semester}` },
  }));
  // groups are stored as a list inside a single item
  const item = resp.Items?.[0];
  return item?.groups ?? [];
}

async function getProfessorFromCatalog(professorId) {
  const resp = await ddb.send(new ScanCommand({
    TableName: CATALOG_TABLE,
    FilterExpression: "id = :id",
    ExpressionAttributeValues: { ":id": `unam#professor#${professorId}` },
  }));
  return resp.Items?.[0] ?? null;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const planSchedule = tool({
  name: "plan_schedule",
  description:
    "Generate ranked, conflict-free schedule options for a student. " +
    "Requires course keys and semester. Never check overlaps yourself.",
  inputSchema: z.object({
    student_id: z.string(),
    course_keys: z.array(z.string()).describe("e.g. ['1310','1311']"),
    semester: z.string().describe("e.g. '2026-1'"),
    preferences: z.object({
      morning_preferred: z.boolean().optional(),
      afternoon_preferred: z.boolean().optional(),
      max_days_on_campus: z.number().optional(),
      free_days: z.array(z.string()).optional(),
      max_gap_minutes: z.number().optional(),
    }).optional(),
  }),
  callback: async ({ student_id, course_keys, semester, preferences = {} }) => {
    const groupsByCourse = await Promise.all(
      course_keys.map(key => getCatalogCourseGroups(key, semester))
    );
    const missing = course_keys.filter((_, i) => groupsByCourse[i].length === 0);
    if (missing.length > 0) {
      return `No se encontraron grupos para: ${missing.join(", ")} en ${semester}.`;
    }
    const schedules = generateSchedules(groupsByCourse, {
      morningPreferred: preferences.morning_preferred,
      afternoonPreferred: preferences.afternoon_preferred,
      maxDaysOnCampus: preferences.max_days_on_campus,
      freeDays: preferences.free_days,
      maxGapMinutes: preferences.max_gap_minutes,
    }, 5);
    if (schedules.length === 0) {
      return "No se encontró ninguna combinación sin traslapes. Intenta con otras materias o menos restricciones.";
    }
    return JSON.stringify({ semester, schedules_found: schedules.length, schedules });
  },
});

const researchProfessor = tool({
  name: "research_professor",
  description:
    "Retrieve official profile and student reviews for a professor from the catalog.",
  inputSchema: z.object({
    professor_id: z.string().describe("e.g. 'martinez-gomez-jose'"),
  }),
  callback: async ({ professor_id }) => {
    const item = await getProfessorFromCatalog(professor_id);
    if (!item) {
      return `No se encontró perfil para el profesor '${professor_id}'. Prueba con otro identificador.`;
    }
    return JSON.stringify({
      source_label: "OFFICIAL",
      profile: item.profile ?? item,
      reviews: (item.reviews ?? []).map(r => ({ ...r, source_label: "STUDENT_REVIEW" })),
    });
  },
});

const checkAcademicProgress = tool({
  name: "check_academic_progress",
  description:
    "Calculate a student's current credits, projected credits, and remaining credits. Never calculate credits yourself.",
  inputSchema: z.object({
    student_id: z.string(),
    selected_courses: z.array(z.object({
      course_name: z.string(),
      credits: z.number(),
    })).describe("Courses the student plans to take this semester"),
  }),
  callback: async ({ student_id, selected_courses }) => {
    const courseProgress = await loadStudentProgress(student_id);
    const completed = Object.values(courseProgress).filter(p => p.estado === "aprobada");
    const result = calculateProgress(
      completed,
      selected_courses.map(c => ({ courseName: c.course_name, credits: c.credits })),
    );
    return JSON.stringify(result);
  },
});

const getStudentGoals = tool({
  name: "get_student_goals",
  description: "Retrieve a student's profile, interests, and career goals.",
  inputSchema: z.object({ student_id: z.string() }),
  callback: async ({ student_id }) => {
    const { loadStudentProfile } = await import("./session.mjs");
    const profile = await loadStudentProfile(student_id);
    if (!profile) return `No se encontró perfil para estudiante '${student_id}'.`;
    return JSON.stringify(profile);
  },
});

const checkPrerequisitesTool = tool({
  name: "check_prerequisites",
  description:
    "Check which courses a student can enroll in based on their academic history. Returns status per course.",
  inputSchema: z.object({ student_id: z.string() }),
  callback: async ({ student_id }) => {
    const [prereqStatus, available] = await Promise.all([
      checkPrerequisites(student_id),
      getAvailableCourses(student_id),
    ]);
    return JSON.stringify({ prereqStatus, availableNow: available });
  },
});

const estimateGraduationTool = tool({
  name: "estimate_graduation",
  description: "Estimate graduation semester and suggest titulación modality.",
  inputSchema: z.object({
    student_id: z.string(),
    credits_per_semester: z.number().optional(),
  }),
  callback: async ({ student_id, credits_per_semester = 30 }) => {
    const { loadStudentProfile } = await import("./session.mjs");
    const [creditInfo, profile, graduation] = await Promise.all([
      calculateCredits(student_id),
      loadStudentProfile(student_id),
      estimateGraduation(student_id, credits_per_semester),
    ]);
    const titulacion = profile ? suggestTitulacion(profile, creditInfo) : [];
    return JSON.stringify({ credits: creditInfo, graduation, titulacionOptions: titulacion });
  },
});

const rankStudyTool = tool({
  name: "rank_study_priority",
  description:
    "Rank which courses need the most study attention this week based on grades, deadlines, and exam weights.",
  inputSchema: z.object({
    materias: z.array(z.object({
      clave: z.string(),
      nombre: z.string(),
      dificultad: z.number().optional(),
      evaluacion: z.object({ final: z.number().optional() }).optional(),
    })),
    calificaciones: z.record(z.object({ promedioParcial: z.number().optional() })).optional(),
    agenda: z.array(z.object({ clave: z.string(), titulo: z.string(), deadline: z.string() })).optional(),
  }),
  callback: async ({ materias, calificaciones = {}, agenda = [] }) => {
    return JSON.stringify(rankStudyPriority(materias, calificaciones, agenda));
  },
});

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente académico personal para estudiantes de la UNAM Facultad de Ciencias (Ciencias de la Computación).
Ayudas a los estudiantes a planear su semestre, investigar profesores, monitorear su avance académico, revisar prerrequisitos y construir roadmaps profesionales.

REGLAS IMPORTANTES:
1. Nunca inventes datos de materias UNAM, información de profesores o reseñas de estudiantes.
2. Siempre indica la fuente de información:
   - OFICIAL: fuentes oficiales de UNAM / Facultad de Ciencias
   - RESEÑA_ESTUDIANTE: de misprofes.com o plataformas similares
   - GENERADO: tus propias recomendaciones de IA (no son hechos)
3. Nunca detectes conflictos de horario tú mismo — siempre usa la herramienta plan_schedule.
4. Nunca calcules créditos tú mismo — siempre usa check_academic_progress.
5. Nunca evalúes prerrequisitos tú mismo — siempre usa check_prerequisites.
6. Si no tienes datos reales (herramienta sin resultados), dilo claramente.
7. Sé cálido, útil y conciso. Los estudiantes están ocupados.
8. Responde en español a menos que el estudiante escriba en inglés.
9. Para identificar al estudiante puedes pedirle su número de cuenta UNAM.`;

// ── Lambda handler ─────────────────────────────────────────────────────────────

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  if (event.httpMethod === "GET") {
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    responseStream.write(CHAT_HTML);
    responseStream.end();
    return;
  }

  const body = JSON.parse(event.body ?? "{}");
  const message = body.message ?? "";
  const sessionId = body.sessionId ?? "default";

  const history = await loadHistory(sessionId);

  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    messages: history,
    tools: [
      planSchedule,
      researchProfessor,
      checkAcademicProgress,
      getStudentGoals,
      checkPrerequisitesTool,
      estimateGraduationTool,
      rankStudyTool,
      getProfile,
      updateProfile,
      saveProfessorMemory,
      updateAcademicProgress,
      updateCourseGrades,
    ],
    printer: false,
  });

  const metadata = { statusCode: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } };
  responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);

  for await (const ev of agent.stream(message)) {
    if (
      ev.type === "modelStreamUpdateEvent" &&
      ev.event?.type === "modelContentBlockDeltaEvent" &&
      ev.event.delta?.type === "textDelta"
    ) {
      responseStream.write(JSON.stringify({ type: "token", text: ev.event.delta.text }) + "\n");
    } else if (ev.type === "beforeToolCallEvent") {
      responseStream.write(JSON.stringify({ type: "tool", name: ev.toolUse?.name ?? "tool" }) + "\n");
    }
  }

  await saveHistory(sessionId, agent.messages);
  responseStream.end();
});

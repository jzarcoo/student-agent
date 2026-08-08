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
import { loadHistory, saveHistory, loadStudentProgress, loadStudentProfile } from "./session.mjs";
import { searchDocs } from "./rag/search.mjs";
import { ddb, CATALOG_TABLE, SESSIONS_TABLE } from "./db.mjs";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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
    })).optional().describe("Courses the student plans to take this semester"),
  }),
  callback: async ({ student_id, selected_courses = [] }) => {
    const [courseProgress, catalogItems] = await Promise.all([
      loadStudentProgress(student_id),
      ddb.send(new ScanCommand({
        TableName: CATALOG_TABLE,
        FilterExpression: "begins_with(id, :prefix)",
        ExpressionAttributeValues: { ":prefix": "unam#course#" },
      })).then(r => r.Items ?? []),
    ]);
    const creditMap = Object.fromEntries(catalogItems.map(c => [c.clave, c.creditos ?? 0]));
    const completed = Object.values(courseProgress)
      .filter(p => p.estado === "aprobada")
      .map(p => ({ credits: creditMap[p.clave] ?? p.creditos ?? 0, courseName: p.clave }));
    const inProgress = Object.values(courseProgress)
      .filter(p => p.estado === "en_curso" || p.estado === "recursando")
      .map(p => ({ credits: creditMap[p.clave] ?? 0, courseName: p.clave }));
    const planned = selected_courses.map(c => ({ courseName: c.course_name, credits: c.credits }));
    const result = calculateProgress(completed, [...inProgress, ...planned]);
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

const listLanguages = tool({
  name: "list_languages",
  description:
    "List all language courses offered by ENALLT (UNAM) this semester, including available levels.",
  inputSchema: z.object({
    semester: z.string().describe("e.g. '2026-2'").optional(),
  }),
  callback: async ({ semester = "2026-2" }) => {
    const resp = await ddb.send(new ScanCommand({
      TableName: CATALOG_TABLE,
      FilterExpression: "begins_with(id, :prefix)",
      ExpressionAttributeValues: { ":prefix": `unam#lang#meta#` },
    }));
    if (!resp.Items?.length) return "No hay datos de idiomas ENALLT en el catálogo.";
    return JSON.stringify(resp.Items.map(l => ({
      language: l.nombre,
      key: l.langKey,
      levels: l.levels,
      institution: "ENALLT-UNAM",
    })));
  },
});

const findLanguageGaps = tool({
  name: "find_language_gaps",
  description:
    "Given a student's occupied schedule slots, find ENALLT language groups that fit without overlap. " +
    "Never check overlaps yourself — use this tool.",
  inputSchema: z.object({
    occupied_slots: z.array(z.object({
      day: z.string().describe("e.g. 'Lunes'"),
      start: z.string().describe("HH:MM"),
      end: z.string().describe("HH:MM"),
    })),
    semester: z.string().describe("e.g. '2026-2'"),
    language_key: z.string().optional().describe("Filter by language, e.g. 'ingles'"),
    level: z.string().optional().describe("Filter by level, e.g. 'A1'"),
  }),
  callback: async ({ occupied_slots, semester, language_key, level }) => {
    const toMins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const overlaps = (a, b) =>
      a.day === b.day &&
      toMins(a.start) < toMins(b.end) &&
      toMins(b.start) < toMins(a.end);
    const groupFits = g => !g.schedule.some(ls => occupied_slots.some(bs => overlaps(ls, bs)));

    const resp = await ddb.send(new ScanCommand({
      TableName: CATALOG_TABLE,
      FilterExpression: "begins_with(id, :prefix)",
      ExpressionAttributeValues: { ":prefix": `unam#lang#group#${semester}` },
    }));
    let items = resp.Items ?? [];
    if (language_key) items = items.filter(i => i.langKey === language_key);
    if (level) items = items.filter(i => i.level === level);

    const fitting = items.filter(groupFits);
    if (!fitting.length) {
      return "Ningún grupo de idiomas ENALLT cabe en los huecos libres. Considera grupos sabatinos o vespertinos.";
    }

    const grouped = {};
    for (const g of fitting) {
      const key = `${g.langKey}-${g.level}`;
      (grouped[key] ??= { language: g.langKey, level: g.level, groups: [] }).groups.push({
        groupId: g.groupId,
        schedule: g.schedule,
        spotsLeft: (g.quota ?? 30) - (g.enrolled ?? 0),
      });
    }
    return JSON.stringify({ semester, fitting_groups_found: fitting.length, by_language: Object.values(grouped) });
  },
});

const scaffoldAssignment = tool({
  name: "scaffold_assignment",
  description:
    "Generate a structured scaffold for a school assignment: section titles, a checklist, " +
    "estimated hours, and suggested resources. ONLY generates structure — never writes content, " +
    "solves problems, or implements code. Use when a student asks how to start or organize a task.",
  inputSchema: z.object({
    titulo: z.string().describe("Assignment title"),
    tipo: z.enum(["ensayo", "demostracion", "programa", "reporte_lab", "ejercicios", "presentacion"])
      .describe("Assignment type"),
    materia: z.string().describe("Course name or key"),
    descripcion: z.string().optional().describe("Brief description of what the assignment asks for"),
    fecha_entrega: z.string().optional().describe("Due date ISO or natural language"),
  }),
  callback: async ({ titulo, tipo, materia, descripcion = "", fecha_entrega }) => {
    const templates = {
      ensayo: {
        secciones: ["Introducción (planteamiento + tesis)", "Marco teórico / antecedentes", "Desarrollo (2-3 argumentos con evidencia)", "Conclusión (responde la tesis)", "Referencias (formato APA/IEEE)"],
        checklist: ["¿Tesis clara en la introducción?", "¿Cada párrafo tiene idea principal + apoyo?", "¿Citas y referencias completas?", "¿Revisión de ortografía y estilo?", "¿Cumple con extensión solicitada?"],
        horas: 6,
      },
      demostracion: {
        secciones: ["Enunciado formal del resultado a demostrar", "Definiciones y lemas previos necesarios", "Cuerpo de la demostración (paso a paso justificado)", "Casos especiales o contraejemplos si aplica", "Conclusión QED"],
        checklist: ["¿Cada paso tiene justificación lógica?", "¿Se usan solo definiciones ya establecidas?", "¿Se consideraron todos los casos?", "¿La notación es consistente?"],
        horas: 4,
      },
      programa: {
        secciones: ["Especificación del problema (entradas, salidas, restricciones)", "Diseño de alto nivel (diagrama o pseudocódigo)", "Implementación modular (divide en funciones)", "Pruebas unitarias y casos borde", "Documentación mínima (README + comentarios clave)"],
        checklist: ["¿Compila / corre sin errores?", "¿Pasa los casos de prueba del enunciado?", "¿Maneja casos borde (vacío, negativo, overflow)?", "¿Código legible y sin código muerto?", "¿README con instrucciones de ejecución?"],
        horas: 8,
      },
      reporte_lab: {
        secciones: ["Objetivos del experimento", "Marco teórico relevante", "Metodología y procedimiento", "Resultados (tablas, gráficas)", "Análisis y discusión", "Conclusiones", "Referencias"],
        checklist: ["¿Resultados incluyen unidades y errores?", "¿Gráficas tienen ejes etiquetados?", "¿Análisis responde los objetivos?", "¿Conclusiones conectan con la teoría?"],
        horas: 5,
      },
      ejercicios: {
        secciones: ["Leer todo antes de empezar (detectar patrones)", "Identificar qué concepto prueba cada ejercicio", "Resolver de menor a mayor dificultad", "Verificar con casos simples", "Documentar el razonamiento, no solo la respuesta"],
        checklist: ["¿Se respondió lo que se pedía (no algo parecido)?", "¿Se muestran pasos intermedios?", "¿Se revisó con un ejemplo concreto?"],
        horas: 3,
      },
      presentacion: {
        secciones: ["Portada (título, materia, autores, fecha)", "Agenda (qué van a ver)", "Contexto / motivación (1-2 diapositivas)", "Desarrollo del tema (5-8 diapositivas)", "Demo o ejemplo práctico si aplica", "Conclusiones y trabajo futuro", "Preguntas y referencias"],
        checklist: ["¿Máximo 6 líneas por diapositiva?", "¿Hay hilo conductor entre diapositivas?", "¿Se ensayó en voz alta?", "¿Tiempo dentro del límite?", "¿Preparadas respuestas a preguntas obvias?"],
        horas: 4,
      },
    };

    const tmpl = templates[tipo];
    return JSON.stringify({
      titulo,
      tipo,
      materia,
      descripcion: descripcion || "(sin descripción)",
      fecha_entrega: fecha_entrega || "No especificada",
      horas_estimadas: tmpl.horas,
      secciones: tmpl.secciones,
      checklist_calidad: tmpl.checklist,
      recursos_sugeridos: [
        "Notas de clase y diapositivas del profesor",
        "Bibliografía del programa de la materia",
        "Google Scholar para papers",
        "Biblioteca UNAM: https://www.dgb.unam.mx/",
      ],
      nota: "Este scaffold es una guía estructural (GENERADO). El contenido lo desarrollas tú.",
    }, null, 2);
  },
});

// ── Agenda tools ──────────────────────────────────────────────────────────────

async function loadAgenda(studentId) {
  const resp = await ddb.send(new GetCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId: `student#${studentId}#agenda` },
  }));
  if (!resp.Item) return [];
  const raw = resp.Item.tasks;
  return typeof raw === "string" ? JSON.parse(raw) : raw ?? [];
}

async function saveAgenda(studentId, tasks) {
  await ddb.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: {
      sessionId: `student#${studentId}#agenda`,
      tasks: JSON.stringify(tasks),
      updatedAt: new Date().toISOString(),
    },
  }));
}

const addAgendaTask = tool({
  name: "add_agenda_task",
  description: "Add a task or deadline to the student's personal agenda.",
  inputSchema: z.object({
    studentId: z.string(),
    titulo: z.string().describe("Task title, e.g. 'Entregar tarea 3 de Algoritmos'"),
    materia: z.string().optional().describe("Course this task belongs to"),
    deadline: z.string().describe("Due date or datetime, e.g. '2026-08-15' or '2026-08-15T18:00'"),
    tipo: z.enum(["tarea", "examen", "proyecto", "laboratorio", "lectura", "otro"]).optional(),
    notas: z.string().optional(),
  }),
  callback: async ({ studentId, titulo, materia, deadline, tipo = "tarea", notas }) => {
    const tasks = await loadAgenda(studentId);
    const id = `task-${Date.now()}`;
    tasks.push({ id, titulo, materia, deadline, tipo, notas, completada: false, creadaEn: new Date().toISOString() });
    tasks.sort((a, b) => a.deadline.localeCompare(b.deadline));
    await saveAgenda(studentId, tasks);
    return `Tarea "${titulo}" agregada con deadline ${deadline}.`;
  },
});

const listAgendaTasks = tool({
  name: "list_agenda_tasks",
  description: "List all pending tasks and deadlines for a student, sorted by due date.",
  inputSchema: z.object({
    studentId: z.string(),
    solo_pendientes: z.boolean().optional().describe("Only show incomplete tasks (default true)"),
  }),
  callback: async ({ studentId, solo_pendientes = true }) => {
    const tasks = await loadAgenda(studentId);
    const filtered = solo_pendientes ? tasks.filter(t => !t.completada) : tasks;
    if (!filtered.length) return "No hay tareas en la agenda.";
    return JSON.stringify(filtered, null, 2);
  },
});

const completeAgendaTask = tool({
  name: "complete_agenda_task",
  description: "Mark a task as completed in the student's agenda.",
  inputSchema: z.object({
    studentId: z.string(),
    task_id: z.string().optional().describe("Task ID (from list_agenda_tasks)"),
    titulo_partial: z.string().optional().describe("Partial title to fuzzy-match if ID unknown"),
  }),
  callback: async ({ studentId, task_id, titulo_partial }) => {
    const tasks = await loadAgenda(studentId);
    const task = task_id
      ? tasks.find(t => t.id === task_id)
      : tasks.find(t => !t.completada && t.titulo.toLowerCase().includes((titulo_partial ?? "").toLowerCase()));
    if (!task) return "No se encontró la tarea.";
    task.completada = true;
    task.completadaEn = new Date().toISOString();
    await saveAgenda(studentId, tasks);
    return `Tarea "${task.titulo}" marcada como completada.`;
  },
});

// ── Library search ────────────────────────────────────────────────────────────

const searchLibrary = tool({
  name: "search_library",
  description:
    "Search the UNAM digital library catalog for books, articles, and academic resources. " +
    "Use when a student asks for bibliography, references, or where to find material for a course.",
  inputSchema: z.object({
    query: z.string().describe("Search terms, e.g. 'sistemas operativos Tanenbaum' or 'inteligencia artificial Russell'"),
    tipo: z.enum(["libro", "articulo", "tesis", "todos"]).optional(),
  }),
  callback: async ({ query, tipo = "todos" }) => {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://opac.dgb.unam.mx/F/?func=find-b&request=${encoded}&find_code=WRD&local_base=ALEPH`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "UNAM-Student-Agent/1.0 (academic assistant; contact: soporte@ciencias.unam.mx)" },
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) {
        return JSON.stringify({
          nota: "La biblioteca UNAM no respondió. Intenta directamente en https://www.dgb.unam.mx/",
          query,
          recursos_alternativos: [
            "Google Scholar: https://scholar.google.com/",
            "JSTOR: https://www.jstor.org/",
            "arXiv (CS): https://arxiv.org/list/cs/recent",
            "Biblioteca Digital UNAM: https://bibliotecadigital.unam.mx/",
          ],
        });
      }

      const html = await resp.text();
      const results = [];
      const rowRe = /<td[^>]*class="briefcite"[^>]*>([\s\S]*?)<\/td>/gi;
      let m;
      while ((m = rowRe.exec(html)) !== null && results.length < 8) {
        const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text.length > 20) results.push(text);
      }

      if (!results.length) {
        return JSON.stringify({
          query,
          mensaje: "No se encontraron resultados en el catálogo. Prueba términos más simples.",
          recursos_alternativos: [
            "Google Scholar: https://scholar.google.com/",
            "Biblioteca Digital UNAM: https://bibliotecadigital.unam.mx/",
          ],
        });
      }

      return JSON.stringify({
        fuente: "OFICIAL — Catálogo OPAC DGBUNAM",
        query,
        resultados: results,
        url_busqueda: `https://opac.dgb.unam.mx/F/?func=find-b&request=${encoded}&find_code=WRD&local_base=ALEPH`,
      });
    } catch (err) {
      return JSON.stringify({
        nota: "No se pudo consultar la biblioteca en este momento.",
        recursos_alternativos: [
          "Biblioteca Digital UNAM: https://bibliotecadigital.unam.mx/",
          "Google Scholar: https://scholar.google.com/",
          "arXiv CS: https://arxiv.org/list/cs/recent",
        ],
      });
    }
  },
});

const askUnamDocs = tool({
  name: "ask_unam_docs",
  description:
    "Search official UNAM documents (reglamentos, plan de estudios, becas, servicios) " +
    "using semantic similarity. Use when a student asks about regulations, graduation requirements, " +
    "service social, scholarships, enrollment, ENALLT info, CAAD, or research opportunities. " +
    "Always cite the source returned.",
  inputSchema: z.object({
    pregunta: z.string().describe("The student's question in natural language"),
  }),
  callback: async ({ pregunta }) => {
    const results = await searchDocs(pregunta, 3);
    if (!results.length) {
      return "No encontré información relevante en los documentos oficiales UNAM para esta pregunta.";
    }
    return JSON.stringify(results.map(r => ({
      fuente: `OFICIAL — ${r.source}`,
      texto: r.text,
      relevancia: r.score,
    })));
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
9. Para identificar al estudiante puedes pedirle su número de cuenta UNAM.
10. Cuando el estudiante pregunte sobre cursos de idiomas o ENALLT, primero usa list_languages para mostrar opciones, luego find_language_gaps con sus slots ocupados para ver cuáles caben en su horario.
11. Cuando el estudiante pida ayuda para organizar una tarea, ensayo o proyecto, usa scaffold_assignment para generar la estructura. NUNCA escribas el contenido ni resuelvas el problema — solo la estructura.
12. Para agregar tareas o deadlines a la agenda del estudiante usa add_agenda_task. Para ver sus pendientes usa list_agenda_tasks. Para marcar completada usa complete_agenda_task.
13. Cuando el estudiante pida bibliografía, libros o referencias académicas, usa search_library para consultar el catálogo UNAM.
14. Cuando el estudiante pregunte sobre reglamentos, titulación, servicio social, becas, inscripciones, ENALLT, CAAD o investigación, usa ask_unam_docs primero para obtener información oficial. Cita siempre la fuente.`;

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
      listLanguages,
      findLanguageGaps,
      askUnamDocs,
      scaffoldAssignment,
      addAgendaTask,
      listAgendaTasks,
      completeAgendaTask,
      searchLibrary,
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

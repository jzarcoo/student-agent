/**
 * Seed script — fills UNAM tables with realistic fake data.
 * Run: node scripts/seed.mjs
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const SEMESTER = "2026-2";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function batchWrite(tableName, items) {
  // DynamoDB batch writes max 25 items at a time
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    await ddb.send(new BatchWriteCommand({ RequestItems: { [tableName]: chunk } }));
  }
  console.log(`  ✓ ${items.length} items → ${tableName}`);
}

// ── Professors ────────────────────────────────────────────────────────────────

const professors = [
  {
    id: "prof-herrera",
    name: "Dra. Laura Herrera",
    department: "Ciencias de la Computación",
    researchAreas: ["algorithms", "combinatorics", "graph-theory"],
    bio: "Doctora en Matemáticas por la UNAM. 15 años de experiencia docente en algoritmos y estructuras de datos. Reconocida por su claridad en clase y enfoque teórico riguroso.",
  },
  {
    id: "prof-mendoza",
    name: "Dr. Alejandro Mendoza",
    department: "Ciencias de la Computación",
    researchAreas: ["databases", "distributed-systems", "cloud-computing"],
    bio: "Doctor en Ciencias de la Computación por el CINVESTAV. Especialista en bases de datos distribuidas. Consultor externo para empresas de tecnología.",
  },
  {
    id: "prof-rios",
    name: "Dr. Jorge Ríos",
    department: "Ciencias de la Computación",
    researchAreas: ["operating-systems", "embedded-systems", "linux-kernel"],
    bio: "Maestro y Doctor por la Facultad de Ciencias. Colaborador activo del proyecto Linux. Cursos conocidos por su profundidad práctica.",
  },
  {
    id: "prof-castillo",
    name: "Dra. Sofía Castillo",
    department: "Matemáticas",
    researchAreas: ["machine-learning", "statistics", "optimization"],
    bio: "Investigadora del Instituto de Matemáticas. Línea de investigación en aprendizaje estadístico. Publicaciones en NeurIPS y ICML.",
  },
  {
    id: "prof-vega",
    name: "Dr. Ernesto Vega",
    department: "Ciencias de la Computación",
    researchAreas: ["computer-networks", "security", "protocols"],
    bio: "Especialista en seguridad de redes. Fundador del grupo de investigación en ciberseguridad de la Facultad. Certificación CISSP.",
  },
  {
    id: "prof-luna",
    name: "Dra. Patricia Luna",
    department: "Ciencias de la Computación",
    researchAreas: ["programming-languages", "compilers", "type-theory"],
    bio: "Doctora por la UNAM, postdoctorado en INRIA París. Apasionada de los lenguajes funcionales. Sus clases de Compiladores son las mejor evaluadas del área.",
  },
  {
    id: "prof-ibarra",
    name: "Dr. Miguel Ibarra",
    department: "Matemáticas",
    researchAreas: ["linear-algebra", "numerical-methods", "scientific-computing"],
    bio: "Matemático aplicado con énfasis en métodos numéricos. Colabora con el Instituto de Geofísica en modelos computacionales.",
  },
  {
    id: "prof-santos",
    name: "Dra. Carmen Santos",
    department: "Ciencias de la Computación",
    researchAreas: ["artificial-intelligence", "natural-language-processing", "knowledge-representation"],
    bio: "Doctora por la UNAM. Investigadora en IA con enfoque en procesamiento de lenguaje natural. Coordinadora del laboratorio de IA de la Facultad.",
  },
];

const professorItems = professors.map((p) => ({
  PK: `PROFESSOR#${p.id}`,
  SK: "PROFILE",
  ...p,
  unamProfileUrl: `https://www.fciencias.unam.mx/directorio/${p.id}`,
  updatedAt: "2026-08-08T00:00:00Z",
}));

const reviewItems = [
  {
    PK: "PROFESSOR#prof-herrera",
    SK: "REVIEWS#algoritmos",
    source: "misprofes.com",
    sourceLabel: "STUDENT_REVIEW",
    reviewCount: 41,
    avgRating: 4.6,
    themes: { difficulty: "high", workload: "heavy", examWeight: "50%", projectWeight: "50%", attendanceRequired: false, teachingStyle: "theoretical" },
    summary: "Exigente pero muy justa. Las clases son densas pero aprende uno muchísimo. Los exámenes son difíciles; hay que estudiar a fondo. Recomienda muchos recursos extra.",
    ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  {
    PK: "PROFESSOR#prof-mendoza",
    SK: "REVIEWS#bases-datos",
    source: "misprofes.com",
    sourceLabel: "STUDENT_REVIEW",
    reviewCount: 33,
    avgRating: 4.2,
    themes: { difficulty: "medium", workload: "medium", examWeight: "40%", projectWeight: "60%", attendanceRequired: true, teachingStyle: "practical" },
    summary: "Muy práctico, el proyecto final es grande pero se aprende mucho. Toma lista. Explica bien SQL y temas de normalización.",
    ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  {
    PK: "PROFESSOR#prof-rios",
    SK: "REVIEWS#sistemas-operativos",
    source: "misprofes.com",
    sourceLabel: "STUDENT_REVIEW",
    reviewCount: 28,
    avgRating: 4.0,
    themes: { difficulty: "high", workload: "heavy", examWeight: "60%", projectWeight: "40%", attendanceRequired: false, teachingStyle: "practical" },
    summary: "Las tareas de programación en C son brutales pero te hacen mejor programador. Los exámenes tienen preguntas muy específicas sobre el kernel.",
    ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  {
    PK: "PROFESSOR#prof-castillo",
    SK: "REVIEWS#aprendizaje-computacional",
    source: "misprofes.com",
    sourceLabel: "STUDENT_REVIEW",
    reviewCount: 19,
    avgRating: 4.8,
    themes: { difficulty: "high", workload: "heavy", examWeight: "30%", projectWeight: "70%", attendanceRequired: false, teachingStyle: "research-oriented" },
    summary: "La mejor profesora para ML. Sus proyectos son de nivel investigación. Necesitas base sólida de probabilidad y álgebra lineal. Vale mucho la pena.",
    ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
  {
    PK: "PROFESSOR#prof-luna",
    SK: "REVIEWS#compiladores",
    source: "misprofes.com",
    sourceLabel: "STUDENT_REVIEW",
    reviewCount: 22,
    avgRating: 4.9,
    themes: { difficulty: "high", workload: "medium", examWeight: "30%", projectWeight: "70%", attendanceRequired: false, teachingStyle: "project-based" },
    summary: "La mejor clase de la carrera para muchos. El proyecto del compilador es increíble. Explica con mucha pasión y claridad.",
    ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  },
];

// ── Courses (metadata) ────────────────────────────────────────────────────────

const courseMeta = [
  { key: "algoritmos",           name: "Algoritmos y Complejidad",       credits: 10, area: "CS Core",       prerequisites: ["estructuras-datos"] },
  { key: "bases-datos",          name: "Bases de Datos",                  credits: 8,  area: "CS Core",       prerequisites: ["estructuras-datos"] },
  { key: "sistemas-operativos",  name: "Sistemas Operativos",             credits: 10, area: "CS Core",       prerequisites: ["arquitectura-computadoras"] },
  { key: "redes",                name: "Redes de Computadoras",           credits: 8,  area: "CS Core",       prerequisites: ["sistemas-operativos"] },
  { key: "compiladores",         name: "Compiladores",                    credits: 10, area: "CS Advanced",   prerequisites: ["algoritmos", "lenguajes-formales"] },
  { key: "aprendizaje-computacional", name: "Aprendizaje Computacional",  credits: 10, area: "AI/ML",         prerequisites: ["probabilidad", "algebra-lineal"] },
  { key: "algebra-lineal",       name: "Álgebra Lineal",                  credits: 10, area: "Math",          prerequisites: [] },
  { key: "probabilidad",         name: "Probabilidad y Estadística",      credits: 8,  area: "Math",          prerequisites: ["calculo-diferencial"] },
  { key: "estructuras-datos",    name: "Estructuras de Datos",            credits: 10, area: "CS Core",       prerequisites: ["programacion-1"] },
  { key: "arquitectura-computadoras", name: "Arquitectura de Computadoras", credits: 8, area: "CS Core",     prerequisites: ["organizacion-computadoras"] },
];

const courseMetaItems = courseMeta.map((c) => ({
  PK: `COURSE#${c.key}`,
  SK: "META",
  courseKey: c.key,
  courseName: c.name,
  credits: c.credits,
  area: c.area,
  prerequisites: c.prerequisites,
}));

// ── Course groups (sections for 2026-2) ──────────────────────────────────────

const courseGroups = [
  // Algoritmos y Complejidad
  { key: "algoritmos", groupId: "4001", professorId: "prof-herrera", quota: 35,
    schedule: [{ day: "MON", start: "08:00", end: "10:00" }, { day: "WED", start: "08:00", end: "10:00" }, { day: "FRI", start: "08:00", end: "09:00" }] },
  { key: "algoritmos", groupId: "4002", professorId: "prof-herrera", quota: 35,
    schedule: [{ day: "TUE", start: "10:00", end: "12:00" }, { day: "THU", start: "10:00", end: "12:00" }] },
  { key: "algoritmos", groupId: "4003", professorId: "prof-santos", quota: 30,
    schedule: [{ day: "MON", start: "16:00", end: "18:00" }, { day: "WED", start: "16:00", end: "18:00" }, { day: "FRI", start: "16:00", end: "17:00" }] },

  // Bases de Datos
  { key: "bases-datos", groupId: "5001", professorId: "prof-mendoza", quota: 40,
    schedule: [{ day: "MON", start: "10:00", end: "12:00" }, { day: "WED", start: "10:00", end: "12:00" }] },
  { key: "bases-datos", groupId: "5002", professorId: "prof-mendoza", quota: 40,
    schedule: [{ day: "TUE", start: "08:00", end: "10:00" }, { day: "THU", start: "08:00", end: "10:00" }] },
  { key: "bases-datos", groupId: "5003", professorId: "prof-vega", quota: 35,
    schedule: [{ day: "MON", start: "18:00", end: "20:00" }, { day: "WED", start: "18:00", end: "20:00" }] },

  // Sistemas Operativos
  { key: "sistemas-operativos", groupId: "6001", professorId: "prof-rios", quota: 35,
    schedule: [{ day: "TUE", start: "08:00", end: "10:00" }, { day: "THU", start: "08:00", end: "10:00" }, { day: "FRI", start: "08:00", end: "09:00" }] },
  { key: "sistemas-operativos", groupId: "6002", professorId: "prof-rios", quota: 35,
    schedule: [{ day: "MON", start: "12:00", end: "14:00" }, { day: "WED", start: "12:00", end: "14:00" }, { day: "FRI", start: "12:00", end: "13:00" }] },

  // Redes
  { key: "redes", groupId: "7001", professorId: "prof-vega", quota: 40,
    schedule: [{ day: "TUE", start: "12:00", end: "14:00" }, { day: "THU", start: "12:00", end: "14:00" }] },
  { key: "redes", groupId: "7002", professorId: "prof-vega", quota: 40,
    schedule: [{ day: "MON", start: "14:00", end: "16:00" }, { day: "WED", start: "14:00", end: "16:00" }] },

  // Compiladores
  { key: "compiladores", groupId: "8001", professorId: "prof-luna", quota: 30,
    schedule: [{ day: "TUE", start: "10:00", end: "12:00" }, { day: "THU", start: "10:00", end: "12:00" }, { day: "FRI", start: "10:00", end: "11:00" }] },

  // Aprendizaje Computacional
  { key: "aprendizaje-computacional", groupId: "9001", professorId: "prof-castillo", quota: 25,
    schedule: [{ day: "TUE", start: "14:00", end: "16:00" }, { day: "THU", start: "14:00", end: "16:00" }, { day: "FRI", start: "14:00", end: "15:00" }] },
  { key: "aprendizaje-computacional", groupId: "9002", professorId: "prof-santos", quota: 25,
    schedule: [{ day: "MON", start: "10:00", end: "12:00" }, { day: "WED", start: "10:00", end: "12:00" }, { day: "FRI", start: "10:00", end: "11:00" }] },

  // Álgebra Lineal
  { key: "algebra-lineal", groupId: "1001", professorId: "prof-ibarra", quota: 50,
    schedule: [{ day: "MON", start: "08:00", end: "10:00" }, { day: "WED", start: "08:00", end: "10:00" }, { day: "FRI", start: "08:00", end: "09:00" }] },
  { key: "algebra-lineal", groupId: "1002", professorId: "prof-ibarra", quota: 50,
    schedule: [{ day: "TUE", start: "16:00", end: "18:00" }, { day: "THU", start: "16:00", end: "18:00" }] },

  // Probabilidad
  { key: "probabilidad", groupId: "2001", professorId: "prof-castillo", quota: 45,
    schedule: [{ day: "MON", start: "12:00", end: "14:00" }, { day: "WED", start: "12:00", end: "14:00" }] },
  { key: "probabilidad", groupId: "2002", professorId: "prof-ibarra", quota: 45,
    schedule: [{ day: "TUE", start: "08:00", end: "10:00" }, { day: "THU", start: "08:00", end: "10:00" }, { day: "FRI", start: "08:00", end: "09:00" }] },
];

const courseGroupItems = courseGroups.map((g) => ({
  PK: `COURSE#${g.key}`,
  SK: `GROUP#${SEMESTER}#${g.groupId}`,
  courseKey: g.key,
  groupId: g.groupId,
  semester: SEMESTER,
  professorId: g.professorId,
  schedule: g.schedule,
  quota: g.quota,
  enrolled: Math.floor(g.quota * 0.7),
}));

// ── Sample student ────────────────────────────────────────────────────────────

const studentItems = [
  {
    PK: "STUDENT#u-00001",
    SK: "PROFILE",
    studentId: "u-00001",
    name: "Ana García López",
    career: "Ciencias de la Computación",
    plan: "2013",
    enrolledYear: 2023,
    interests: ["machine-learning", "computer-vision", "algorithms"],
    careerGoal: "ML Engineer",
    schedulePrefs: { morningPreferred: true, maxDaysOnCampus: 4, maxGapMinutes: 60, freeDays: ["friday"] },
    updatedAt: "2026-08-08T00:00:00Z",
  },
  // Completed courses for demo student
  { PK: "STUDENT#u-00001", SK: "COURSE#algebra-lineal",       courseName: "Álgebra Lineal",       credits: 10, grade: 9, period: "2023-2" },
  { PK: "STUDENT#u-00001", SK: "COURSE#probabilidad",         courseName: "Probabilidad",          credits: 8,  grade: 8, period: "2024-1" },
  { PK: "STUDENT#u-00001", SK: "COURSE#estructuras-datos",    courseName: "Estructuras de Datos",  credits: 10, grade: 9, period: "2024-2" },
  { PK: "STUDENT#u-00001", SK: "COURSE#arquitectura-computadoras", courseName: "Arquitectura", credits: 8, grade: 8, period: "2025-1" },
  { PK: "STUDENT#u-00001", SK: "COURSE#programacion-1",       courseName: "Programación 1",        credits: 8,  grade: 10, period: "2023-1" },
];

// ── Roadmap nodes ─────────────────────────────────────────────────────────────

const roadmapItems = [
  { PK: "ROADMAP#ml-engineer", SK: "META", title: "ML Engineer", description: "Roadmap hacia Ingeniería en Machine Learning", totalNodes: 8 },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#01-math", order: 1, title: "Fundamentos Matemáticos", unamCourses: ["algebra-lineal", "probabilidad"], prerequisites: [], description: "Álgebra lineal y probabilidad son la base de todo ML." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#02-programming", order: 2, title: "Programación Avanzada", unamCourses: ["estructuras-datos", "algoritmos"], prerequisites: ["NODE#01-math"], description: "Estructuras de datos y análisis de algoritmos." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#03-systems", order: 3, title: "Sistemas", unamCourses: ["sistemas-operativos", "redes"], prerequisites: ["NODE#02-programming"], description: "Bases de sistemas para entrenar y servir modelos a escala." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#04-ml-core", order: 4, title: "Machine Learning", unamCourses: ["aprendizaje-computacional"], prerequisites: ["NODE#01-math", "NODE#02-programming"], description: "Curso central de ML de la Facultad." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#05-databases", order: 5, title: "Datos y Bases de Datos", unamCourses: ["bases-datos"], prerequisites: ["NODE#02-programming"], description: "Gestión de datos estructurados para pipelines de ML." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#06-projects", order: 6, title: "Proyectos y Competencias", unamCourses: [], prerequisites: ["NODE#04-ml-core"], description: "Kaggle, proyectos de investigación, GitHub portfolio." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#07-research", order: 7, title: "Investigación / Servicio Social", unamCourses: [], prerequisites: ["NODE#04-ml-core"], description: "Laboratorio de IA de la Facultad, grupos de investigación con Dra. Castillo o Dra. Santos." },
  { PK: "ROADMAP#ml-engineer", SK: "NODE#08-professional", order: 8, title: "Perfil Profesional", unamCourses: [], prerequisites: ["NODE#06-projects", "NODE#07-research"], description: "LinkedIn, portafolio, prácticas profesionales, titulación." },

  { PK: "ROADMAP#software-engineer", SK: "META", title: "Software Engineer", description: "Roadmap hacia Ingeniería de Software", totalNodes: 6 },
  { PK: "ROADMAP#software-engineer", SK: "NODE#01-core", order: 1, title: "CS Core", unamCourses: ["estructuras-datos", "algoritmos"], prerequisites: [], description: "Fundamentos indispensables de cualquier SWE." },
  { PK: "ROADMAP#software-engineer", SK: "NODE#02-systems", order: 2, title: "Sistemas y Redes", unamCourses: ["sistemas-operativos", "redes"], prerequisites: ["NODE#01-core"], description: "Cómo funciona la infraestructura bajo el código." },
  { PK: "ROADMAP#software-engineer", SK: "NODE#03-data", order: 3, title: "Bases de Datos", unamCourses: ["bases-datos"], prerequisites: ["NODE#01-core"], description: "SQL, modelado relacional, NoSQL." },
  { PK: "ROADMAP#software-engineer", SK: "NODE#04-compilers", order: 4, title: "Lenguajes y Compiladores", unamCourses: ["compiladores"], prerequisites: ["NODE#01-core"], description: "Comprensión profunda de lenguajes de programación." },
  { PK: "ROADMAP#software-engineer", SK: "NODE#05-projects", order: 5, title: "Proyectos Open Source", unamCourses: [], prerequisites: ["NODE#02-systems", "NODE#03-data"], description: "Contribuciones a OSS, proyectos propios, GitHub." },
  { PK: "ROADMAP#software-engineer", SK: "NODE#06-professional", order: 6, title: "Perfil Profesional", unamCourses: [], prerequisites: ["NODE#05-projects"], description: "Prácticas, portafolio, entrevistas técnicas (LeetCode)." },
];

// ── Run ───────────────────────────────────────────────────────────────────────

console.log("Seeding UNAM Student Agent tables...\n");

await batchWrite("unam-professors", [...professorItems, ...reviewItems]);
await batchWrite("unam-courses", [...courseMetaItems, ...courseGroupItems]);
await batchWrite("unam-students", studentItems);
await batchWrite("unam-roadmaps", roadmapItems);

console.log("\nDone. Tables seeded:");
console.log(`  ${professors.length} professors + ${reviewItems.length} review summaries`);
console.log(`  ${courseMeta.length} courses + ${courseGroups.length} groups for ${SEMESTER}`);
console.log(`  1 demo student (u-00001) with 5 completed courses`);
console.log(`  2 roadmaps (ml-engineer, software-engineer)`);

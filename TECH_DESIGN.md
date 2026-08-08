# UNAM Student Agent — Technical Design Document

**Version**: 0.1 (MVP)
**Authors**: TBD
**Date**: 2026-08-08
**Status**: Draft

---

## 1. Overview

A conversational AI agent that acts as a personal academic assistant for Computer Science students at UNAM Facultad de Ciencias. The agent maintains a persistent model of the student's academic life and uses it to answer questions, generate schedules, plan study sessions, and surface relevant opportunities.

The core insight: every recommendation the agent makes is only as good as the context it has about the student. The agent accumulates context over time and uses it to make increasingly personalized decisions.

---

## 2. Functional Requirements

### FR-1 — Academic Profile
- The system MUST maintain a persistent profile per student including: completed courses, failed courses, courses in progress, credits obtained, interests, and career goal.
- The system MUST track partial grades per course (midterms, assignments, labs) and the professor's evaluation breakdown (% exams, % projects, % attendance).
- The system MUST calculate current credits and project remaining credits after the current semester.

### FR-2 — Prerequisite Engine
- The system MUST model the CC degree plan as a directed graph of prerequisites.
- Each prerequisite edge MUST carry a type: `obligatorio` (hard block), `sugerido` (soft warning), `preferente` (recommendation only).
- The system MUST determine which courses a student CAN enroll in given their academic history.
- The system MUST warn when a student wants to enroll in a course with an unsatisfied `sugerido` prerequisite.
- The system MUST block enrollment in courses with unsatisfied `obligatorio` prerequisites.

### FR-3 — Schedule Generation
- The system MUST retrieve available course groups (section, professor, days, time, classroom) from UNAM's course catalog.
- The system MUST generate all valid schedule combinations for a given set of courses.
- The system MUST eliminate combinations with time conflicts (overlap).
- The system MUST apply student constraints: max days per week, preferred days off, lunch break, work hours, commute time, extracurricular activities.
- The system MUST rank valid schedules by preference score and return the top 3.
- The system MUST explain the ranking of each schedule option.
- The system MUST warn when a schedule implies high academic workload.
- The schedule solver MUST be deterministic — no LLM involvement in overlap detection or ranking math.

### FR-4 — Professor Research
- The system MUST retrieve professor profiles from Facultad de Ciencias official pages.
- The system MUST retrieve and summarize student reviews from misprofes.com.
- The system MUST clearly distinguish official information from student-generated opinions.
- The system MUST store and recall personal notes the student adds about a professor ("a friend told me...").
- The system MUST present the professor's evaluation breakdown when available.

### FR-5 — Study Support
- The system MUST retrieve the official bibliography for each course from the course program (syllabus).
- The system MUST query Facultad de Ciencias library (Koha system) for each bibliography item and report availability and location.
- The system MUST generate a study plan given current grades and the professor's evaluation weights.
- The system MUST prioritize which course needs the most attention this week based on upcoming deadlines and current standing.
- The system MUST generate an assignment scaffold when a student registers a new task: a structured skeleton (intro, sections, conclusion or problem list) tailored to the assignment type (essay, proof, program, lab report, problem set, presentation).
- The scaffold MUST include suggestions for relevant resources (books from the course bibliography, library availability, ayudantes).
- The scaffold MUST NOT solve or complete the assignment — it only provides structure and starting hints.
- The system MUST detect assignment type automatically from the student's description and adapt the skeleton accordingly.

### FR-6 — Agenda and Weekly Planning
- The system MUST allow the student to register tasks with: title, type (exam/assignment/lab/personal/work), deadline, estimated hours, and priority.
- The system MUST generate a weekly plan that fits tasks into available time slots respecting all constraints.
- The weekly planner MUST be deterministic — no LLM involvement in slot assignment.
- The system MUST set reminders via SNS for upcoming deadlines.
- The system MUST warn when the week is overloaded.

### FR-7 — Academic Roadmap
- The system MUST generate a personalized academic roadmap given a career goal (ML Engineer, SWE, Researcher, etc.).
- The roadmap MUST connect skills to specific UNAM courses, books, papers, platforms, and projects.
- The roadmap MUST adapt to the student's current academic progress.

### FR-8 — Graduation Planning
- The system MUST track degree requirements and compute how many credits remain.
- The system MUST suggest a titulación modality based on the student's profile (GPA, interests, timeline).
- The system MUST estimate graduation semester given current enrollment pace.

### FR-9 — Student Life
- The system MUST surface relevant extracurricular events at Facultad de Ciencias.
- The system MUST find ENALLT language course options compatible with the student's schedule.
- The system MUST find UNAM sports and recreation options (gym, pool, etc.) compatible with the schedule.
- The system MUST provide information about UNAM mental health services (CAAD).
- The system MUST provide information about servicio social options related to the student's interests.

### FR-10 — RAG over Official Documents
- The system MUST maintain a knowledge base of official UNAM documents: degree plan, regulations, course programs, titulación rules.
- The system MUST retrieve relevant document chunks before answering factual questions about official policies.
- The system MUST cite its sources and distinguish official information from recommendations.
- The system MUST never hallucinate official UNAM information.

---

## 3. Non-Functional Requirements

### NFR-1 — Latency
- First token of a response MUST appear within 3 seconds of the user sending a message.
- Schedule generation for 4 courses (typical case) MUST complete within 5 seconds.
- Library availability lookup for a single book MUST complete within 2 seconds.

### NFR-2 — Correctness
- Schedule overlap detection MUST be 100% accurate (deterministic algorithm, not LLM).
- Credit calculations MUST be 100% accurate (deterministic, not LLM).
- Prerequisite checking MUST be 100% accurate (graph traversal, not LLM).
- The system MUST never present student opinions as official facts.

### NFR-3 — Persistence
- All student profile data MUST survive Lambda cold starts and restarts (stored in DynamoDB).
- Conversation history MUST be available across sessions via sessionId.
- Agenda items MUST persist until explicitly deleted or past their TTL.

### NFR-4 — Cost
- The system MUST use Claude Haiku 4.5 for subagents (cheap, fast).
- The system MUST use Claude Sonnet 5 only for the orchestrator.
- RAG embeddings MUST use Titan Embed v2 (cheapest option).
- Schedule solver and week planner MUST run as pure JS (zero LLM cost).

### NFR-5 — Security
- No AWS credentials or API keys MUST appear in source code.
- All secrets MUST be managed via IAM roles and environment variables.
- Student data MUST be scoped by studentId — no cross-student data access.
- Google OAuth tokens MUST be stored client-side only (never sent to Lambda).

### NFR-6 — Extensibility
- The agent architecture MUST allow adding new subagents without modifying the orchestrator.
- The degree plan data MUST be stored in DynamoDB (not hardcoded) to support other careers and faculties later.
- Scrapers MUST be independent Lambdas so they can be updated without touching the agent.

### NFR-7 — Honesty
- When the system lacks information, it MUST say so explicitly rather than guessing.
- All recommendations MUST include the reasoning behind them.
- The system MUST always indicate the source of information (official / student review / AI recommendation).

---

## 4. Architecture

### 4.1 System Context

```
┌─────────────────────────────────────────────────────────┐
│                      Student Browser                     │
│                                                         │
│   Chat UI (HTML + JS)          Google Calendar          │
│   PromptInput / ChatBubbles    OAuth + Events API       │
└──────────────┬──────────────────────────┬───────────────┘
               │ HTTPS (NDJSON stream)    │ OAuth token
               ▼                          │
┌─────────────────────────┐               │
│      API Gateway        │               │
│   GET /  → chat page    │               │
│   POST /chat → agent    │               │
└──────────┬──────────────┘               │
           │                              │
           ▼                              │
┌─────────────────────────────────────────────────────────┐
│                     AWS Lambda                          │
│                                                         │
│   index.mjs          ← HTTP handler + streaming        │
│   orchestrator.mjs   ← Claude Sonnet 5                 │
│                                                         │
│   agents/                                               │
│   ├── academic-agent.mjs    ← Claude Haiku 4.5         │
│   ├── schedule-agent.mjs    ← Claude Haiku 4.5         │
│   ├── professor-agent.mjs   ← Claude Haiku 4.5         │
│   ├── study-agent.mjs       ← Claude Haiku 4.5         │
│   ├── agenda-agent.mjs      ← Claude Haiku 4.5         │
│   └── life-agent.mjs        ← Claude Haiku 4.5         │
│                                                         │
│   solvers/                                              │
│   ├── schedule-solver.mjs   ← pure JS, no LLM          │
│   ├── week-planner.mjs      ← pure JS, no LLM          │
│   └── academic.mjs          ← pure JS, no LLM          │
└──────┬──────────────────────────────────────────────────┘
       │
       ├── Amazon Bedrock ──────────────────────────────────
       │   ├── anthropic.claude-sonnet-5    (orchestrator)
       │   ├── anthropic.claude-haiku-4-5  (subagents)
       │   └── amazon.titan-embed-text-v2  (RAG embeddings)
       │
       ├── Amazon DynamoDB ──────────────────────────────────
       │   ├── unam-students
       │   ├── unam-courses
       │   ├── unam-prerequisites
       │   ├── unam-course-groups
       │   ├── unam-professors
       │   ├── unam-professor-reviews
       │   ├── unam-student-progress
       │   ├── unam-agenda
       │   ├── unam-rag-chunks
       │   └── unam-agent-sessions
       │
       ├── Amazon S3 ────────────────────────────────────────
       │   └── unam-agent-docs
       │       ├── rag/          (PDFs para indexar)
       │       └── scraped/      (caché de scraping)
       │
       ├── Amazon SNS ───────────────────────────────────────
       │   └── unam-reminders    (notificaciones)
       │
       └── Amazon EventBridge ───────────────────────────────
           └── daily reminder check (cron 20:00 MX)
```

### 4.2 Scraper Architecture

```
EventBridge (weekly cron)
        │
        ├──▶ scrape-groups Lambda
        │        └── UNAM DGAE website
        │            └── CourseGroups table
        │
        ├──▶ scrape-professors Lambda
        │        └── Facultad de Ciencias pages
        │            └── Professors table
        │
        ├──▶ scrape-reviews Lambda
        │        └── misprofes.com
        │            └── ProfessorReviews table
        │
        ├──▶ scrape-enallt Lambda
        │        └── enallt.unam.mx
        │            └── CourseGroups table (type: idioma)
        │
        └──▶ scrape-sports Lambda
                 └── deportes.unam.mx
                     └── CourseGroups table (type: deporte)


On-demand (tool call from agent):
        └──▶ search-library Lambda
                 └── fciencias.bibliotecas.unam.mx (Koha)
                     └── returns availability inline
```

### 4.3 RAG Pipeline

```
INDEXING (one-time + on new docs)

PDF in S3
    │
    ▼
rag-indexer Lambda
    ├── extract text (Claude reads PDF natively)
    ├── split into chunks (~500 tokens, 50 token overlap)
    ├── for each chunk:
    │   ├── embed with Titan Embed v2 (256 dimensions)
    │   └── save to unam-rag-chunks:
    │       { docId, chunkId, text, vector[], source, page }
    └── done


RETRIEVAL (every agent query that needs official info)

User question
    │
    ▼
embed question with Titan Embed v2
    │
    ▼
scan unam-rag-chunks (all vectors in memory)
    │
    ▼
cosine similarity for each chunk
    │
    ▼
top 3 chunks by score
    │
    ▼
inject into agent context:
"According to [source]: [chunk text]"
```

### 4.4 Agent Loop

```
User message
      │
      ▼
Orchestrator (Claude Sonnet 5)
reads: system prompt + student profile + conversation history
      │
      ├── simple question? ──▶ answer directly
      │
      ├── academic question? ──▶ ask_academic_agent
      │       └── AcademicoAgent (Haiku)
      │           ├── check_prerequisites (solver)
      │           ├── rag_search (official docs)
      │           └── returns structured answer
      │
      ├── schedule question? ──▶ ask_schedule_agent
      │       └── HorariosAgent (Haiku)
      │           ├── get_available_groups (DynamoDB)
      │           ├── solve_schedule (pure JS solver)
      │           └── returns top 3 schedules as text grid
      │
      ├── professor question? ──▶ ask_professor_agent
      │       └── ProfesoresAgent (Haiku)
      │           ├── get_professor_profile (DynamoDB)
      │           ├── get_reviews (DynamoDB)
      │           └── returns profile + reviews with sources
      │
      ├── study question? ──▶ ask_study_agent
      │       └── EstudioAgent (Haiku)
      │           ├── get_bibliography (RAG)
      │           ├── search_library (Koha scraper)
      │           ├── generate_study_plan (solver)
      │           └── scaffold_assignment (LLM — structure only)
      │
      ├── agenda/planning? ──▶ ask_agenda_agent
      │       └── AgendaAgent (Haiku)
      │           ├── add_task (DynamoDB)
      │           ├── plan_week (pure JS solver)
      │           └── set_reminder (SNS)
      │
      └── life/events? ──▶ ask_life_agent
              └── VidaAgent (Haiku)
                  ├── search_web (DuckDuckGo)
                  └── returns relevant info
```

---

## 5. Data Models

### 5.1 DynamoDB Tables

**unam-students**
```
PK: studentId (String)

{
  studentId,
  nombre,
  numeroCuenta,
  semestre,
  carrera: "CC",
  facultad: "Ciencias",

  horarioPreferencias: {
    turno,           // "mañana" | "tarde" | "mixto"
    diasMax,         // 1-5
    diasLibres,      // ["viernes"]
    horaComida,      // { inicio: "14:00", fin: "15:00" }
    maxHorasSeguidas,
    trabaja: { dias, horaInicio, horaFin }
  },

  commuting: {
    origen,
    transporte,      // "metro" | "bici" | "camion" | "auto"
    tiempoMinutos
  },

  actividades: {
    deporte: { disciplina, diasSemana },
    idioma:  { idioma, nivel },
    servicioSocial: { lugar, horario }
  },

  intereses,         // ["IA", "sistemas", "competitive programming"]
  metaProfesional,   // "ML Engineer"
  
  googleCalendarConnected,  // bool

  profesoresMemoria: {
    [professorId]: "string con notas personales"
  },

  createdAt,
  updatedAt
}
```

**unam-courses**
```
PK: clave (String)

{
  clave,          // "1310"
  nombre,         // "Algoritmos"
  creditos,
  semestre,       // semestre sugerido del plan de estudios
  tipo,           // "obligatoria" | "optativa"
  area,           // "Ciencias de la Computación"
  descripcion,
  bibliografia,   // ["CLRS", "Kleinberg", ...]
  updatedAt
}
```

**unam-prerequisites**
```
PK: clave (String)       ← la materia que REQUIERE
SK: prereqClave (String) ← la materia REQUERIDA

{
  clave,
  prereqClave,
  tipo   // "obligatorio" | "sugerido" | "preferente"
}
```

**unam-course-groups**
```
PK: clave (String)
SK: semestre#grupo (String)   // "2026-2#4"

{
  clave,
  grupo,
  semestre,
  profesor,
  profesorId,
  dias,          // ["lunes", "miercoles"]
  horaInicio,    // "08:00"
  horaFin,       // "10:00"
  salon,
  tipo,          // "clase" | "laboratorio" | "idioma" | "deporte"
  cupo,
  disponibles,
  updatedAt
}
```

**unam-professors**
```
PK: professorId (String)

{
  professorId,
  nombre,
  departamento,
  snI,           // nivel SNI si aplica
  areasInvestigacion,
  materias,      // [clave, ...]
  bio,
  urlPerfil,
  evaluacion: {
    parciales,   // 0.40
    tareas,      // 0.20
    laboratorio, // 0.10
    final,       // 0.30
    asistencia   // bool
  },
  updatedAt
}
```

**unam-professor-reviews**
```
PK: professorId (String)
SK: source#id (String)    // "misprofes#abc123" | "personal#uuid"

{
  professorId,
  source,        // "misprofes" | "personal"
  rating,        // 1-5
  texto,
  tags,          // ["estricto", "buen maestro", "muchas tareas"]
  clave,         // materia a la que aplica (si se sabe)
  fecha,
  addedBy        // studentId (solo para personal)
}
```

**unam-student-progress**
```
PK: studentId (String)
SK: clave (String)

{
  studentId,
  clave,
  estado,        // "aprobada" | "reprobada" | "en_curso" | "recursando"
  calificacion,  // final (si aprobada/reprobada)
  semestre,      // cuándo la cursó/está cursando
  calificaciones: {   // parciales actuales (si en_curso)
    parcial1,
    parcial2,
    tareas,
    laboratorio
  }
}
```

**unam-agenda**
```
PK: studentId (String)
SK: deadline#tipo#id (String)   // "2026-08-14T10:00#examen#uuid"

{
  studentId,
  id,
  titulo,
  tipo,          // "examen" | "tarea" | "lab" | "trabajo" | "personal"
  clave,         // materia relacionada (opcional)
  deadline,      // ISO timestamp
  estimadoHoras,
  prioridad,     // "alta" | "media" | "baja"
  completado,
  recordatorioEnviado,
  expiresAt      // TTL: deadline + 7 días
}
```

**unam-rag-chunks**
```
PK: docId (String)
SK: chunkId (String)

{
  docId,
  chunkId,
  texto,
  vector,        // number[] — 256 dimensiones Titan Embed
  source,        // "plan-estudios-cc" | "reglamento-titulacion" | ...
  pagina,
  updatedAt
}
```

**unam-agent-sessions**
```
PK: sessionId (String)

{
  sessionId,
  studentId,
  messages,      // JSON stringified conversation history
  expiresAt      // TTL: 24 horas
}
```

---

## 6. Algorithmic Tools — Deterministic Solvers

These tools run pure JS logic with zero LLM involvement. They are correctness-critical — wrong output here breaks the student's academic plan.

### 6.1 Schedule Solver — CSP with Backtracking

```
Algorithm: Constraint Satisfaction Problem (CSP)
           with Arc Consistency (AC-3) + Backtracking

Input:
  materias[]     course keys to enroll
  grupos{}       available groups per course (from DynamoDB)
  restricciones  student constraints

Steps:
  1. BUILD variable domains
     each materia → list of available grupos

  2. ARC CONSISTENCY (AC-3)
     for each pair (materiaA, materiaB):
       remove grupos from A's domain that conflict with ALL of B's grupos
       → prunes search space before backtracking

  3. BACKTRACKING with forward checking
     assign one grupo per materia
     after each assignment, propagate constraints forward
     prune domains of unassigned materias
     backtrack if any domain becomes empty

  4. HARD FILTER on surviving combinations
     a. time overlap: !(a.end <= b.start || b.end <= a.start) on same day
     b. work hours conflict
     c. commute: firstClass.start - commuteMinutes >= 07:00
     d. lunch: gap exists in [horaComida.inicio, horaComida.fin]

  5. SOFT FILTER (warn, don't eliminate)
     a. days > diasMax
     b. preferred day not free
     c. consecutive hours > maxHorasSeguidas
     d. workload score > threshold

  6. SCORE each valid combination
     score = 0
     + (diasMax - actualDays) * 10
     + (diasLibres satisfied) * 20
     + (turno match) * 15
     - (gapHours * 5)
     - (workloadScore * 3)

  7. RETURN top 3 sorted by score, each with:
     { schedule, score, warnings[], reasoning }
```

Library: `graphology` for graph structure (optional — can be plain adjacency list)

---

### 6.2 Prerequisite Graph — DAG Traversal

```
Data structure: Directed Acyclic Graph (DAG)
  Nodes: course claves
  Edges: prerequisite relationships with type
         { from: prereqClave, to: clave, tipo: "obligatorio"|"sugerido"|"preferente" }

Algorithm: DFS topological traversal

Given student's aprobadas set:

  for each course in degree plan:
    obligatorios = edges.filter(e => e.to == course && e.tipo == "obligatorio")
    sugeridos    = edges.filter(e => e.to == course && e.tipo == "sugerido")

    if all obligatorios ∈ aprobadas:
      status = "AVAILABLE"
      if any sugeridos ∉ aprobadas: status = "AVAILABLE_WITH_WARNING"
    else:
      status = "BLOCKED"
      blockers = obligatorios.filter(e => e.from ∉ aprobadas)

  Also compute:
    distance = shortest path from any available course to graduation
    → helps rank which courses to take next

Cycle detection: run DFS, flag back-edges (should never occur in valid degree plan)
```

---

### 6.3 Graduation Path Optimizer — Modified Dijkstra

```
Goal: find minimum-semester path to cover all required courses
      respecting prerequisites and max credits per semester

Model as shortest path:
  Nodes: (semester, courses_taken_set) — state space
  Edges: enrolling in a valid set of courses for one semester
  Cost:  1 semester per edge
  Constraint: sum(creditos) <= cargaMaxPorSemestre per edge

Algorithm:
  1. Start state: current aprobadas set
  2. At each state, generate all valid course combinations
     (prerequisitos satisfied + carga <= max)
  3. Pick combination that maximizes progress toward required courses
     (greedy layer: sort by "unlocks the most future courses")
  4. Advance state, repeat until all required courses covered

Output:
  [
    { semestre: 7, materias: ["Algoritmos", "SO", "Compiladores"], creditos: 30 },
    { semestre: 8, materias: ["Bases de Datos", "Redes"], creditos: 20 },
    ...
  ]
  graduacionEstimada: "semestre 10 (2028-1)"
```

---

### 6.4 Workload Estimator — Weighted Scoring

```
score(materia) =
  creditos * 10
  + (tieneLaboratorio ? 15 : 0)
  + (ratioReprobacion * 20)          // historical fail rate for this course
  + (estudianteFalloAntes ? 25 : 0)  // personal history
  + (nExamenes * 5)                  // more exams = more stress
  - (optativa ? 10 : 0)              // electives tend to be lighter

totalScore = sum(score(m) for m in semestre)

thresholds:
  < 60  → "ligera"
  60-80 → "media"
  80-100 → "alta" — warn student
  > 100  → "muy alta" — strongly warn, suggest dropping one course
```

---

### 6.5 Study Priority Ranker — Multi-Criteria

```
urgencia(materia) =
  (1 / max(diasHastaProximoExamen, 1)) * 40
  + max(notaNecesariaParaAprobar - notaActual, 0) * 30
  + pesoProximoExamenEnCalificacionFinal * 20
  + dificultadHistoricaEstudiante * 10

Sort materias descending by urgencia.
Output ranked list with explanation per materia:
  "Algoritmos — urgencia alta: examen en 2 días, llevas 6.5 y necesitas 7+"
```

---

### 6.6 Conflict Detector — O(n²) Overlap Check

```
For schedule validation (used by drag & drop UI in v2):

conflicts = []

for i in 0..n:
  for j in i+1..n:
    if schedule[i].dia == schedule[j].dia:
      if !(schedule[i].fin <= schedule[j].inicio ||
           schedule[j].fin <= schedule[i].inicio):
        conflicts.push({ type: "overlap", a: schedule[i], b: schedule[j] })

Also check:
  - commute buffer after last class on each day
  - lunch break missing
  - consecutive hours > maxHorasSeguidas
  - total days > diasMax

Return: { valid: bool, conflicts[], warnings[] }
```

---

### 6.7 Prerequisite Graph Visualization (v2 — UI)

```
Library: cytoscape.js

Node colors:
  green  (#4caf50) → aprobada
  blue   (#2196f3) → available to take
  yellow (#ff9800) → available with sugerido warning
  gray   (#9e9e9e) → blocked (obligatorio not met)
  red    (#f44336) → reprobada (needs to retake)

Edge styles:
  solid arrow  → obligatorio
  dashed arrow → sugerido
  dotted arrow → preferente

Interaction:
  click node   → show course details + groups available
  hover edge   → show prerequisite type
  filter panel → show only "available" or "blocked" subgraph
```

---

## 7. Assignment Scaffold — Logic

The `scaffold_assignment` tool generates a structured skeleton for a task. It uses an LLM (Haiku) to generate the structure, but is constrained by a strict system prompt that forbids solving or completing the work.

### Input
```
{
  titulo:      "Tarea 3 — Scheduling Algorithms",
  materia:     "Sistemas Operativos",
  descripcion: "Ensayo de 3 páginas sobre scheduling algorithms",
  deadline:    "2026-08-15",
  tipo:        auto-detected | "ensayo" | "demostracion" | "programa" |
               "reporte_lab" | "ejercicios" | "presentacion"
}
```

### Type detection
The tool infers `tipo` from the student's description:
- Keywords like "ensayo", "analiza", "compara" → `ensayo`
- Keywords like "demuestra", "prueba", "demostración" → `demostracion`
- Keywords like "implementa", "programa", "código" → `programa`
- Keywords like "reporte", "laboratorio", "lab" → `reporte_lab`
- Keywords like "ejercicios", "problemas", "resuelve" → `ejercicios`
- Keywords like "presentación", "slides", "expón" → `presentacion`

### Skeleton templates by type

**ensayo**
```
# [Título]
Materia: [X] | Deadline: [fecha] | ~3 páginas

## Introducción
- [ ] Contexto del tema
- [ ] Por qué es relevante
- [ ] Tesis / argumento central

## [Tema 1]
- [ ] Definición / cómo funciona
- [ ] Ventajas y desventajas
- [ ] Ejemplo concreto

## [Tema 2]
...

## Conclusión
- [ ] Síntesis de los puntos principales
- [ ] Tu postura / argumento final
- [ ] Preguntas abiertas o trabajo futuro

## Referencias
- [ ] Fuentes utilizadas
```

**demostracion**
```
# [Nombre del teorema / proposición]
Materia: [X] | Deadline: [fecha]

## Enunciado
[Copiar el enunciado exacto]

## Definiciones necesarias
- [ ] Definir términos clave

## Caso base
- [ ] Verificar para n = [valor inicial]

## Hipótesis inductiva
- [ ] Asumir que se cumple para n = k

## Paso inductivo
- [ ] Demostrar que se cumple para n = k+1

## Conclusión
- [ ] Por lo tanto, por inducción...
```

**programa**
```
# [Nombre del programa]
Materia: [X] | Deadline: [fecha]

## Descripción del problema
[Qué debe hacer el programa]

## Casos de prueba
| Entrada | Salida esperada |
|---------|-----------------|
| ...     | ...             |

## Esqueleto
```[lenguaje]
// TODO: implementar
function nombreFuncion(params) {
  // Paso 1: ...
  // Paso 2: ...
  // Paso 3: ...
}
```

## Consideraciones
- [ ] Casos borde a manejar
- [ ] Complejidad esperada
```

**reporte_lab**
```
# Reporte: [Nombre del laboratorio]
Materia: [X] | Deadline: [fecha]

## Objetivo
- [ ] ¿Qué se busca demostrar o aprender?

## Hipótesis
- [ ] ¿Qué esperas que pase?

## Metodología
- [ ] Pasos seguidos
- [ ] Herramientas utilizadas

## Resultados
- [ ] Datos obtenidos (tablas, gráficas)

## Análisis
- [ ] ¿Qué significan los resultados?
- [ ] ¿Coinciden con la hipótesis?

## Conclusión
- [ ] Qué aprendiste
- [ ] Fuentes de error
```

### Resource suggestions appended to every scaffold
```
📚 Recursos sugeridos para [materia]:
- [Libro 1] — [disponibilidad en biblioteca Ciencias]
- [Libro 2] — [disponibilidad]

👨‍🏫 Ayudantes de [materia]:
- [Nombre] — horario de asesorías: [días y horas]

⏱ Tiempo estimado: [X horas]
📅 En tu agenda: deadline registrado para [fecha]
```

### Strict constraints on the LLM generating the scaffold
The system prompt for `scaffold_assignment` includes:
```
You generate STRUCTURE ONLY. You must:
- Never write the introduction, body, or conclusion text
- Never solve problems, write proofs, or implement code
- Never fill in content beyond placeholder instructions
- Only provide section titles, checkbox items, and resource pointers
If asked to solve or complete the work, respond: 
"Solo puedo darte la estructura — el contenido es tuyo."
```

---

## 7. Schedule Solver — Algorithm

The schedule solver is pure JavaScript with zero LLM involvement.

```
Input:
  courses[]          // list of course keys to enroll
  groups{}           // available groups per course from DynamoDB
  constraints: {
    diasMax,
    diasLibres,
    horaComida,
    trabajo,
    actividadesExtras,
    commuteMinutes
  }

Algorithm:

1. GENERATE
   Cartesian product of groups across all courses
   e.g. Algoritmos has 3 groups × Bases has 4 groups × SO has 2 groups
   = 24 candidate combinations

2. FILTER — hard constraints (eliminate)
   For each combination:
   a. Check time overlap between any two blocks
      overlap = !(a.end <= b.start || b.end <= a.start) on same day
   b. Check work hours conflict
   c. Check commute feasibility
      first class start - commuteMinutes >= 07:00
   d. Check lunch break
      at least 1 slot between [horaComida.inicio, horaComida.fin]

3. FILTER — soft constraints (warn, don't eliminate)
   a. Days exceed diasMax → warn
   b. Preferred day not free → warn
   c. High consecutive hours → warn
   d. Workload score > threshold → warn

4. SCORE each surviving combination
   score = 0
   + (diasMax - actualDays) * 10        // fewer days is better
   + (diasLibres satisfied) * 20        // bonus for free preferred day
   + (turno match) * 15                 // bonus if all classes in preferred shift
   - (gapHours * 5)                     // penalize dead time between classes
   - (workloadScore * 3)                // penalize heavy semesters

5. SORT by score descending

6. RETURN top 3 with:
   - schedule grid (text)
   - score
   - satisfied constraints list
   - warnings list
   - reasoning string
```

---

## 7. Sprint Plan

### Sprint 1 — Foundation (Dev 1 + Dev 2 in parallel)

**Dev 1**
- SAM template with all DynamoDB tables and S3 bucket
- Seed script: CC degree plan → courses + prerequisites tables
- IAM role with correct permissions + boundary

**Dev 2**
- Project scaffold + package.json
- Orchestrator base with session management
- Onboarding flow (agent builds student profile via conversation)
- AcademicoAgent v1: answers "what can I take this semester?"

**Done when**: Student can chat with the agent, register their academic history, and ask what courses they can take.

---

### Sprint 2 — Schedules

**Dev 1**
- Scraper: UNAM course groups → CourseGroups table
- Schedule solver (pure JS)
- Week planner solver (pure JS)

**Dev 2**
- HorariosAgent: wraps solver, formats output as text grid
- AgendaAgent v1: add tasks, list upcoming

**Done when**: Student can say "arma mi horario para este semestre" and get 3 valid options.

---

### Sprint 3 — Professors + Study

**Dev 1**
- Scraper: professor profiles → Professors table
- Scraper: misprofes.com → ProfessorReviews table
- Scraper: Koha library → inline search function

**Dev 2**
- ProfesoresAgent: profile + reviews + personal memory
- EstudioAgent: bibliography + library availability + study plan
- EstudioAgent: `scaffold_assignment` tool — detects assignment type, generates skeleton, adds resource suggestions, does NOT solve
- RAG: indexer + search over degree plan and course programs

**Done when**: Student can ask about a professor and get profile + reviews with sources, ask what books are available in the library, and register a new assignment to receive a structured skeleton with resource suggestions.

---

### Sprint 4 — Notifications + Life

**Dev 1**
- EventBridge cron + SNS reminders
- Scraper: ENALLT + sports schedules

**Dev 2**
- AgendaAgent v2: weekly planner with visual output
- VidaAgent: events, health, bikes, servicio social
- ENALLT and sports integrated into schedule generation

**Done when**: Student gets a reminder the night before an exam with context about their current grade.

---

## 8. What is TBD / Out of Scope for MVP

- Google Calendar integration (v2)
- React + Cloudscape + FullCalendar UI (v2)
- Other faculties and careers beyond CC at Ciencias (v2)
- UNAM official API (if it ever exists — scraping for now)
- Mobile app (v3)
- Peer tutoring matching (v3)
- Integration with UNAM's SIAE enrollment system (requires official access)
- Automated servicio social tracking (v3)

---

## 9. Open Questions

1. **UNAM schedule data**: Does DGAE expose a parseable endpoint or is it pure HTML scraping? Needs investigation before Sprint 2 starts.
2. **misprofes.com ToS**: Is scraping allowed? Consider rate limiting and caching aggressively.
3. **Google OAuth**: Requires a Google Cloud project and OAuth consent screen. Who owns this? Needs setup before v2.
4. **Student identity**: For MVP, studentId is self-reported. No UNAM authentication. Is this acceptable?
5. **Data freshness**: How often does the UNAM course catalog change? Weekly scraping may not be enough during enrollment periods.
6. **RAG chunk size**: 500 tokens chosen as default. May need tuning based on actual document structure.

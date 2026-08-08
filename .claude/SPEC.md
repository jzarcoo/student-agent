# UNAM Student Agent — Spec-Driven Development Reference

This file drives spec-first development. Before implementing any feature, check the relevant FR here. Every tool, solver, and data model must satisfy the requirement it was built for.

## Functional Requirements Summary

| ID | Feature | Status |
|---|---|---|
| FR-1 | Academic Profile (credits, grades, history) | Phase 1 ✓ |
| FR-2 | Prerequisite Engine (DAG, obligatorio/sugerido/preferente) | Phase 1 ✓ |
| FR-3 | Schedule Generation (CSP solver, conflict-free, ranked) | Phase 1 ✓ |
| FR-4 | Professor Research (profile + reviews + personal notes) | Phase 1 ✓ |
| FR-5 | Study Support (bibliography, library, study plan, scaffold) | Phase 3 |
| FR-6 | Agenda + Weekly Planning (tasks, deadlines, reminders) | Phase 4 |
| FR-7 | Academic Roadmap (goal → courses → skills) | Phase 2 |
| FR-8 | Graduation Planning (credits remaining, titulación modality) | Phase 1 ✓ |
| FR-9 | Student Life (events, ENALLT, sports, CAAD, servicio social) | Phase 5 |
| FR-10 | RAG over Official Documents (PDFs, regulations, catalog) | Phase 2 |

## Non-Functional Requirements Checklist

- [ ] **NFR-1 Latency**: First token < 3s; schedule solver < 5s for 4 courses
- [ ] **NFR-2 Correctness**: Schedule overlap = 100% deterministic; credits = 100% deterministic; prereqs = 100% deterministic
- [ ] **NFR-3 Persistence**: All student data in DynamoDB; sessions TTL 7 days; agenda TTL = deadline + 7 days
- [ ] **NFR-4 Cost**: Orchestrator uses Claude Sonnet 5; subagents use Haiku 4.5; RAG uses Titan Embed v2
- [ ] **NFR-5 Security**: No credentials in source; studentId scoping enforced; OAuth tokens client-side only
- [ ] **NFR-6 Extensibility**: New tools added without modifying handler; degree plan in DB not hardcoded
- [ ] **NFR-7 Honesty**: Missing data → explicit "no tengo esta información"; all responses source-labelled

## Solver Contracts

### schedule.mjs — `generateSchedules(groupsByCourse, prefs, limit)`
- Input: array-of-arrays of DynamoDB group items (each with `schedule: [{day, start, end}]`)
- Hard guarantee: zero overlapping slots in any returned combination
- Ranking: lower `score` = better (penalty-based)
- Returns: `[{rank, score, groups, daysOnCampus, gapMinutes, reasons}]`

### credits.mjs — `calculateProgress(completedCourses, selectedCourses, totalRequired)`
- Input: DynamoDB items with `.credits` field; selected courses with `.credits`
- Returns: `{earnedCredits, inProgressCredits, projectedCredits, remainingCredits, totalRequired, percentComplete, breakdown}`
- Default `totalRequired` = 400 credits

### solvers/academic.mjs
- `checkPrerequisites(studentId)` → status map `{clave: {status, blockers, warnings}}`
  - statuses: `aprobada | en_curso | disponible | disponible_con_advertencia | bloqueada | recursable`
- `getAvailableCourses(studentId)` → array of enrollable courses
- `calculateCredits(studentId)` → `{obtenidos, requeridos: 384, porcentaje, materiasFaltantes}`
- `estimateGraduation(studentId, creditosPorSemestre)` → `{semestresRestantes, graduacionEstimada, creditosRestantes}`
- `suggestTitulacion(profile, credits)` → ranked array of titulación modalities
- `rankStudyPriority(materias, calificaciones, agenda)` → ranked by urgency score

## Tool Contracts (Strands tools in index.mjs)

| Tool name | When to call | Never do manually |
|---|---|---|
| `plan_schedule` | When student wants a schedule | Check for time overlaps |
| `check_academic_progress` | When student asks about credits/progress | Calculate credits |
| `check_prerequisites` | When student asks what they can take | Evaluate prereqs |
| `estimate_graduation` | When student asks about graduation | Estimate semesters |
| `rank_study_priority` | When student asks what to study | Judge urgency |
| `research_professor` | When student asks about a professor | Invent reviews |
| `get_student_goals` | To load student profile/career goal | Assume interests |
| `get_student_profile` | Full profile read with all fields | - |
| `update_student_profile` | When student updates preferences/interests | - |
| `save_professor_memory` | When student adds personal note about professor | - |
| `update_academic_progress` | When student reports grade/enrollment status | - |
| `update_course_grades` | When student reports partial grades | - |

## DynamoDB Table Ownership

Each table is owned by one Lambda. Others may read.

| Table | Owner | Readers |
|---|---|---|
| unam-students | Orchestrator | Orchestrator |
| unam-courses | Scraper | Orchestrator |
| unam-prerequisites | Seed/manual | Orchestrator solvers |
| unam-professors | Scraper | Orchestrator |
| unam-professor-reviews | Scraper | Orchestrator |
| unam-student-progress | Orchestrator | Orchestrator solvers |
| unam-roadmaps | Seed/manual | Orchestrator |
| unam-agenda | Orchestrator | Reminder Lambda |
| unam-rag-chunks | RAG Indexer | Orchestrator |
| unam-sessions | Orchestrator | Orchestrator |

## Phase 2 — RAG Integration (planned)

When implementing Phase 2:
1. RAG indexer Lambda triggered on S3 `rag/` prefix uploads
2. Chunk size: ~500 tokens, 50-token overlap
3. Embeddings: Titan Embed Text v2 (256 dimensions)
4. Similarity: cosine over in-memory scan of `unam-rag-chunks`
5. Inject top-3 chunks as: `"Según [source]: [texto]"` before answering
6. Never present RAG output as agent's own knowledge — always cite

## Phase 3 — Study Support (planned)

`scaffold_assignment` tool constraints:
- Detects type from keywords: ensayo/demostracion/programa/reporte_lab/ejercicios/presentacion
- Generates STRUCTURE ONLY — section titles, checkbox items, resource pointers
- NEVER writes content, solves problems, or implements code
- Always appends library availability + ayudante schedule + estimated hours

## Open Questions Blocking Work

1. Does DGAE expose a parseable URL for course groups, or is it pure HTML scraping?
2. Is misprofes.com scraping allowed? Rate-limit + cache aggressively.
3. For MVP, studentId is self-reported — is UNAM SSO required for the demo?

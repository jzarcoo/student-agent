# UNAM Student Agent — Project Guide for Claude

## What this project is

A serverless AI academic assistant for UNAM Facultad de Ciencias (Ciencias de la Computación) students. Helps them plan semesters, check prerequisites, research professors, track academic progress, and build professional roadmaps toward CS/AI careers.

## Directory layout

```
unam-student-agent/
├── backend/src/
│   ├── orchestrator/       ← Main Lambda: Strands agent + all tools
│   │   ├── index.mjs       ← Lambda handler, agent wiring
│   │   ├── schedule.mjs    ← Deterministic schedule CSP solver
│   │   ├── credits.mjs     ← Deterministic credit calculator
│   │   ├── db.mjs          ← DynamoDB client singleton
│   │   ├── session.mjs     ← Session load/save with history compression
│   │   ├── chat-page.mjs   ← Inline HTML for GET /
│   │   ├── solvers/
│   │   │   └── academic.mjs  ← Prereq graph, credits, graduation, study ranker
│   │   └── tools/
│   │       └── student.mjs   ← Strands tools: profile CRUD, progress, notes
│   ├── scraper/            ← SQS-triggered Lambda for web scraping
│   └── refresh/            ← EventBridge Lambda that enqueues scraping jobs
├── infrastructure/
│   └── template.yaml       ← SAM template (all resources)
├── scripts/
│   └── seed.mjs            ← Seeds DynamoDB with realistic fake UNAM data
├── tests/unit/             ← Node.js native test runner tests
├── docs/                   ← Architecture docs and diagrams
├── database/               ← DynamoDB schema reference
└── TECH_DESIGN.md          ← Full functional + non-functional requirements + algorithms
```

## Core design rules — NEVER violate these

1. **LLM reasons, code calculates.** Schedule overlap detection, credit arithmetic, and prerequisite checking are deterministic JS. The agent NEVER does this math itself — it always calls the tool.
2. **Source transparency.** Every fact is labelled `OFFICIAL`, `STUDENT_REVIEW`, or `GENERATED`.
3. **No hallucinated UNAM data.** If the DB doesn't have it, the agent says so.
4. **No credentials in code.** IAM roles + env vars only. Never hardcode AWS keys.
5. **Student data scoped by studentId.** No cross-student data access ever.

## Tech stack

- Runtime: Node.js 22, ES modules (`"type": "module"`)
- Agent framework: `@strands-agents/sdk` (Strands)
- LLM: Amazon Bedrock — Claude Sonnet 5 for orchestrator
- DB: DynamoDB with `@aws-sdk/lib-dynamodb` (DocumentClient)
- IaC: AWS SAM (`infrastructure/template.yaml`)
- Tests: Node.js built-in `node:test` runner

## How to run tests

```bash
node --test tests/unit/schedule.test.mjs tests/unit/credits.test.mjs
```

## How to deploy

```bash
cd infrastructure
sam build
sam deploy  # uses samconfig.toml
```

## DynamoDB key patterns

All tables use `PK` (hash) + `SK` (sort) composite keys:
- Student profile: `PK=STUDENT#<id>`, `SK=PROFILE`
- Completed course: `PK=STUDENT#<id>`, `SK=COURSE#<clave>`
- Course group: `PK=COURSE#<key>`, `SK=GROUP#<semester>#<groupId>`
- Professor profile: `PK=PROFESSOR#<id>`, `SK=PROFILE`
- Professor review: `PK=PROFESSOR#<id>`, `SK=REVIEWS#<courseKey>`
- Session: `PK=SESSION#<id>`, `SK=MESSAGES`
- Roadmap node: `PK=ROADMAP#<goal>`, `SK=NODE#<id>`

Exception: `unam-prerequisites` and `unam-student-progress` use simple `clave`/`studentId` hash keys (see database/schema.md).

## Environment variables (set by SAM from template.yaml)

| Variable | Table/Resource |
|---|---|
| `STUDENTS_TABLE` | unam-students |
| `COURSES_TABLE` | unam-courses |
| `PREREQS_TABLE` | unam-prerequisites |
| `PROFESSORS_TABLE` | unam-professors |
| `ROADMAPS_TABLE` | unam-roadmaps |
| `REVIEWS_TABLE` | unam-professor-reviews |
| `PROGRESS_TABLE` | unam-student-progress |
| `AGENDA_TABLE` | unam-agenda |
| `RAG_TABLE` | unam-rag-chunks |
| `SESSIONS_TABLE` | unam-sessions |
| `DOCS_BUCKET` | S3 bucket for RAG documents |

## Build phases

| Phase | Status | What ships |
|---|---|---|
| 1 | In progress | Schedule planner + professor research + academic progress + prerequisites |
| 2 | Planned | RAG over UNAM docs + roadmap builder |
| 3 | Planned | Study support + assignment scaffolding + library search |
| 4 | Planned | SNS reminders + EventBridge refresh + weekly planner |
| 5 | Planned | Full student profile + extracurriculars + servicio social |

## Seed data

Run `node scripts/seed.mjs` to populate tables with:
- 8 professors with reviews (realistic CC faculty)
- 10 courses with prerequisite chains
- Groups for semester 2026-2
- 1 demo student (`u-00001`, Ana García) with 5 completed courses
- Roadmaps for ML Engineer and Software Engineer goals

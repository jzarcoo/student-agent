# UNAM Student Agent

A serverless AI academic assistant for UNAM Facultad de Ciencias students.

Helps students plan their semester, research professors, track academic progress,
and build professional roadmaps toward careers in CS and AI.

## Project layout

```
unam-student-agent/
├── backend/src/
│   ├── orchestrator/     ← Main agent Lambda (tools, schedule solver, credits)
│   ├── scraper/          ← SQS-triggered Lambda for UNAM data ingestion
│   └── refresh/          ← EventBridge nightly job that enqueues scraping work
├── infrastructure/
│   └── template.yaml     ← SAM template for all AWS resources
├── database/
│   └── schema.md         ← DynamoDB table design and access patterns
├── docs/
│   └── architecture.md   ← Architecture overview and phased build plan
├── tests/
│   └── unit/             ← Tests for deterministic logic (solver, credits)
└── frontend/             ← (Phase 3) Browser chat interface
```

## Architecture at a glance

```
Browser → API Gateway → Lambda (Agent Orchestrator)
                              │
              ┌───────────────┼───────────────────┐
              │               │                   │
         DynamoDB           Bedrock          SQS → Scraper Lambda
    (5 tables: students,   (Claude)          (course data, professor
     courses, professors,                     profiles, reviews)
     roadmaps, sessions)
              │
             S3 (RAG corpus, PDFs)
              │
    EventBridge (nightly refresh)
```

## Agent tools (MVP)

| Tool | What it does |
|---|---|
| `plan_schedule` | Deterministic constraint solver — generates ranked, conflict-free semester schedules |
| `research_professor` | Returns official profile + cached student reviews (source-labelled) |
| `check_academic_progress` | Calculates credits earned / projected / remaining deterministically |
| `get_student_goals` | Retrieves student profile, interests, and career goals |

## Design principles

- **LLM reasons, code calculates.** Schedule overlap detection and credit arithmetic
  are handled by deterministic JS — never by Claude.
- **Source transparency.** Every fact is labelled `OFFICIAL`, `STUDENT_REVIEW`, or `GENERATED`.
- **No hallucinated UNAM data.** If the database doesn't have it, the agent says so.
- **Secrets in Secrets Manager.** No credentials in source code or env vars.

## Running tests

```bash
node --test tests/unit/schedule.test.mjs tests/unit/credits.test.mjs
```

## Deploying (Phase 1)

```bash
cd infrastructure
sam build
sam deploy --guided
```

## Connecting to GitHub

```bash
# Install GitHub CLI, then authenticate via the device flow (no token in terminal):
gh auth login
# Choose: GitHub.com → HTTPS → Login with a web browser
# Follow the one-time code shown in your terminal
```

## Build phases

| Phase | Status | Scope |
|---|---|---|
| 1 | In progress | Schedule planner + professor research + academic progress |
| 2 | Planned | RAG over UNAM docs + roadmap builder |
| 3 | Planned | Extracurricular discovery + weekly planner |
| 4 | Planned | SNS notifications + EventBridge refresh |
| 5 | Planned | Full student profile + long-term memory |

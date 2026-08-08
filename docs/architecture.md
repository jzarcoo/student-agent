# UNAM Student Agent — Architecture

## Overview

A serverless, agentic system that helps UNAM Facultad de Ciencias students plan
their semester, research professors, track academic progress, and build
professional roadmaps.

---

## Request Flow

```
Browser / CLI
    │
    ▼
API Gateway (REST, streaming)
    │
    ▼
Lambda — Agent Orchestrator
    │
    ├── Schedule Agent         ──► UNAM Schedule API / scraper
    ├── Professor Research Agent──► Web search, misprofes.com, UNAM pages
    ├── Academic Progress Agent ──► DynamoDB (StudentProgress table)
    ├── Roadmap Agent          ──► DynamoDB + S3 (curated roadmap docs)
    └── RAG Agent              ──► OpenSearch / Bedrock Knowledge Base
    │
    ├── DynamoDB  (students, schedules, progress, goals, reviews cache)
    ├── S3        (PDFs, crawled docs, RAG source corpus)
    ├── SQS       (async scraping jobs, notification queue)
    ├── SNS       (student notification topics)
    ├── EventBridge (scheduled refresh of course data)
    └── Bedrock   (Claude — orchestration + generation)
```

---

## AWS Services and Why Each One

| Service | Role | Why |
|---|---|---|
| API Gateway | HTTP + streaming front door | Supports response streaming needed for agent tokens |
| Lambda | All compute | Stateless, scales to zero, no servers |
| DynamoDB | Primary persistence | Sub-ms reads for student/schedule data |
| S3 | Document corpus | Cheap, durable store for PDFs and crawled HTML |
| Bedrock | LLM (Claude) | Managed inference, no GPU ops |
| Bedrock Knowledge Base | RAG vector search | Managed embeddings + retrieval over S3 corpus |
| SQS | Async scraping queue | Decouple slow web scraping from the real-time request path |
| SNS | Push notifications | Fan-out to email/SMS for deadline alerts |
| EventBridge | Cron refresh | Rebuild schedule data cache nightly |
| Secrets Manager | API keys | Never in source code or env vars |
| CloudWatch | Observability | Logs, metrics, alarms |
| IAM (roles + boundary) | Authz | Least-privilege per Lambda function |

---

## Agent Sub-Agents

Each capability is a separate `tool` registered with the orchestrator agent.
The orchestrator (Claude via Bedrock) decides which tools to invoke per request.

### schedule_planner
- Input: desired courses, constraints, preferences
- Logic: deterministic constraint solver (no LLM math)
- Output: ranked list of valid, non-overlapping schedule options

### professor_research
- Input: professor name, course
- Logic: fetch UNAM profile + web search + cached reviews
- Output: structured profile + review summary with source labels

### academic_progress
- Input: student_id
- Logic: DynamoDB read + deterministic credit calculator
- Output: completed/remaining credits, degree progress

### roadmap_builder
- Input: career goal, current progress
- Logic: curated graph + UNAM course mapping
- Output: step-by-step roadmap with UNAM courses, books, projects

### rag_search
- Input: question about UNAM regulations, courses, etc.
- Logic: Bedrock Knowledge Base retrieval
- Output: grounded answer with source citations

---

## Source Labeling

Every agent response tags its information with one of:

- `OFFICIAL` — from UNAM / Facultad de Ciencias official sources
- `STUDENT_REVIEW` — from misprofes.com or similar
- `EXTERNAL` — web search results
- `GENERATED` — AI recommendation (not a fact claim)

---

## Security Model

- Each Lambda has its own IAM role with minimal permissions
- All roles carry the account permissions boundary
- Secrets (API keys, etc.) stored in AWS Secrets Manager
- No credentials in source code or environment variables
- Student data encrypted at rest (DynamoDB default encryption)
- HTTPS enforced by API Gateway

---

## Phased Build Plan

| Phase | What ships |
|---|---|
| 1 (MVP) | Schedule planner + professor research + academic progress tracking |
| 2 | RAG over UNAM docs + roadmap builder |
| 3 | Extracurricular discovery + weekly planner |
| 4 | Notifications (SNS) + EventBridge refresh jobs |
| 5 | Full student profile + cross-session memory |

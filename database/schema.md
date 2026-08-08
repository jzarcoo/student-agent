# DynamoDB Schema

All tables use on-demand (PAY_PER_REQUEST) billing.
Partition key = PK, sort key = SK unless noted.
GSI = Global Secondary Index.

---

## Table: unam-students

Stores student profiles, academic progress, preferences, and goals.
One table holds multiple entity types via composite key design.

### Key patterns

| Entity | PK | SK |
|---|---|---|
| Student profile | `STUDENT#<studentId>` | `PROFILE` |
| Completed course | `STUDENT#<studentId>` | `COURSE#<courseKey>` |
| Current semester | `STUDENT#<studentId>` | `SEMESTER#<year>-<period>` |
| Student goal | `STUDENT#<studentId>` | `GOAL#<goalId>` |
| Schedule selection | `STUDENT#<studentId>` | `SCHEDULE#<year>-<period>` |

### Student profile item example
```json
{
  "PK": "STUDENT#u-12345",
  "SK": "PROFILE",
  "name": "Ana García",
  "career": "Ciencias de la Computación",
  "plan": "2013",
  "enrolledYear": 2022,
  "interests": ["machine-learning", "computer-vision"],
  "careerGoal": "ML Engineer",
  "schedulePrefs": {
    "morningPreferred": true,
    "maxDaysOnCampus": 4,
    "maxGapMinutes": 60,
    "freeDays": ["friday"]
  },
  "updatedAt": "2026-08-08T00:00:00Z"
}
```

### Completed course item example
```json
{
  "PK": "STUDENT#u-12345",
  "SK": "COURSE#algebra-lineal",
  "courseName": "Álgebra Lineal",
  "credits": 10,
  "grade": 9,
  "period": "2023-1",
  "professor": "Dr. López"
}
```

### GSIs

**GSI1**: `careerGoal-PK-index`
- PK: `careerGoal` (for aggregating roadmap data by goal)
- SK: `PK`

---

## Table: unam-courses

Stores course catalog, group offerings, and schedules per semester.
Populated by the EventBridge nightly refresh job.

### Key patterns

| Entity | PK | SK |
|---|---|---|
| Course definition | `COURSE#<courseKey>` | `META` |
| Course group/section | `COURSE#<courseKey>` | `GROUP#<semester>#<groupId>` |
| Professor–course link | `PROFESSOR#<professorId>` | `COURSE#<courseKey>#<semester>` |

### Course group item example
```json
{
  "PK": "COURSE#algoritmos",
  "SK": "GROUP#2026-1#4001",
  "courseName": "Algoritmos y Complejidad",
  "credits": 10,
  "professor": "Dr. Martínez",
  "professorId": "prof-martinez",
  "classroom": "P-106",
  "schedule": [
    { "day": "MON", "start": "08:00", "end": "10:00" },
    { "day": "WED", "start": "08:00", "end": "10:00" },
    { "day": "FRI", "start": "08:00", "end": "09:00" }
  ],
  "semester": "2026-1",
  "quota": 35,
  "enrolled": 28,
  "prerequisites": ["estructuras-datos"]
}
```

### GSIs

**GSI1**: `professor-courses-index`
- PK: `professorId`
- SK: `SK` (queries all courses a professor teaches)

**GSI2**: `semester-index`
- PK: `semester`
- SK: `PK` (queries all courses offered in a semester)

---

## Table: unam-professors

Professor profiles and review summaries.

### Key patterns

| Entity | PK | SK |
|---|---|---|
| Professor profile | `PROFESSOR#<professorId>` | `PROFILE` |
| Review summary | `PROFESSOR#<professorId>` | `REVIEWS#<courseKey>` |

### Professor profile item example
```json
{
  "PK": "PROFESSOR#prof-martinez",
  "SK": "PROFILE",
  "name": "Dr. Carlos Martínez",
  "department": "Ciencias de la Computación",
  "researchAreas": ["algorithms", "combinatorics"],
  "bio": "...",
  "unamProfileUrl": "https://...",
  "updatedAt": "2026-08-08T00:00:00Z"
}
```

### Review summary item example
```json
{
  "PK": "PROFESSOR#prof-martinez",
  "SK": "REVIEWS#algoritmos",
  "source": "misprofes.com",
  "sourceLabel": "STUDENT_REVIEW",
  "reviewCount": 23,
  "avgRating": 4.1,
  "themes": {
    "difficulty": "high",
    "workload": "heavy",
    "examWeight": "60%",
    "projectWeight": "40%",
    "attendanceRequired": false,
    "teachingStyle": "theoretical"
  },
  "summary": "Exigente pero muy claro. Los exámenes son difíciles.",
  "cachedAt": "2026-08-08T00:00:00Z",
  "ttl": 604800
}
```

Note: `ttl` is a Unix timestamp used by DynamoDB TTL to auto-expire stale review caches.

---

## Table: unam-roadmaps

Curated roadmap graph nodes and edges, keyed by career goal.

### Key patterns

| Entity | PK | SK |
|---|---|---|
| Roadmap definition | `ROADMAP#<goalSlug>` | `META` |
| Roadmap node | `ROADMAP#<goalSlug>` | `NODE#<nodeId>` |
| Resource for node | `ROADMAP#<goalSlug>` | `RESOURCE#<nodeId>#<resourceId>` |

### Roadmap node item example
```json
{
  "PK": "ROADMAP#ml-engineer",
  "SK": "NODE#machine-learning",
  "title": "Machine Learning",
  "description": "Core ML theory and practice",
  "unamCourses": ["aprendizaje-computacional"],
  "prerequisites": ["NODE#linear-algebra", "NODE#probability"],
  "order": 5
}
```

---

## Table: unam-sessions

Conversation history per session. Same pattern as the existing nube-agent table.

| Entity | PK | SK | TTL |
|---|---|---|---|
| Session messages | `SESSION#<sessionId>` | `MESSAGES` | 7 days |
| Student session link | `STUDENT#<studentId>` | `SESSION#<sessionId>` | 7 days |

---

## S3 Bucket: unam-rag-corpus

```
unam-rag-corpus/
├── official/
│   ├── planes-de-estudio/     ← PDF study plans
│   ├── reglamentos/           ← Academic regulations
│   └── catalogos/             ← Course catalogs
├── professor-profiles/        ← Scraped/cached professor pages
├── reviews-cache/             ← Raw scraped review data
└── roadmaps/                  ← Curated roadmap JSON files
```

Objects in `reviews-cache/` carry an S3 lifecycle rule to expire after 7 days.

---

## Access Pattern Summary

| Query | Table + Index |
|---|---|
| Load student profile | unam-students, PK+SK direct |
| All completed courses for student | unam-students, PK query (SK begins_with COURSE#) |
| All groups for a course this semester | unam-courses, PK=COURSE#x, SK begins_with GROUP#2026-1 |
| All courses taught by a professor | unam-courses, GSI1 PK=professorId |
| Professor profile + reviews | unam-professors, PK=PROFESSOR#x |
| Roadmap for a goal | unam-roadmaps, PK=ROADMAP#goal, SK begins_with NODE# |
| Session messages | unam-sessions, PK=SESSION#x, SK=MESSAGES |

import { CHAT_HTML } from "./chat-page.mjs";
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { generateSchedules } from "./schedule.mjs";
import { calculateProgress } from "./credits.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const model = new BedrockModel({
  modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function loadSession(sessionId) {
  const resp = await ddb.send(new GetCommand({
    TableName: process.env.SESSIONS_TABLE,
    Key: { PK: `SESSION#${sessionId}`, SK: "MESSAGES" },
  }));
  return resp.Item ? JSON.parse(resp.Item.messages) : [];
}

async function saveSession(sessionId, messages) {
  await ddb.send(new PutCommand({
    TableName: process.env.SESSIONS_TABLE,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: "MESSAGES",
      messages: JSON.stringify(messages),
      ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
  }));
}

async function getStudentProfile(studentId) {
  const resp = await ddb.send(new GetCommand({
    TableName: process.env.STUDENTS_TABLE,
    Key: { PK: `STUDENT#${studentId}`, SK: "PROFILE" },
  }));
  return resp.Item ?? null;
}

async function getCompletedCourses(studentId) {
  const resp = await ddb.send(new QueryCommand({
    TableName: process.env.STUDENTS_TABLE,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: {
      ":pk": `STUDENT#${studentId}`,
      ":prefix": "COURSE#",
    },
  }));
  return resp.Items ?? [];
}

async function getCourseGroups(courseKey, semester) {
  const resp = await ddb.send(new QueryCommand({
    TableName: process.env.COURSES_TABLE,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: {
      ":pk": `COURSE#${courseKey}`,
      ":prefix": `GROUP#${semester}`,
    },
  }));
  return resp.Items ?? [];
}

async function getProfessor(professorId) {
  const [profile, reviews] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: process.env.PROFESSORS_TABLE,
      Key: { PK: `PROFESSOR#${professorId}`, SK: "PROFILE" },
    })),
    ddb.send(new QueryCommand({
      TableName: process.env.PROFESSORS_TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `PROFESSOR#${professorId}`,
        ":prefix": "REVIEWS#",
      },
    })),
  ]);
  return {
    profile: profile.Item ?? null,
    reviews: reviews.Items ?? [],
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

const planSchedule = tool({
  name: "plan_schedule",
  description:
    "Generate ranked, conflict-free schedule options for a student. " +
    "Requires course keys and semester. Uses deterministic constraint solving — " +
    "never asks the LLM to check for time overlaps.",
  inputSchema: z.object({
    student_id: z.string().describe("The student's ID"),
    course_keys: z.array(z.string()).describe("Course identifiers, e.g. ['algoritmos','bases-datos']"),
    semester: z.string().describe("Semester code, e.g. '2026-1'"),
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
      course_keys.map((key) => getCourseGroups(key, semester))
    );

    const missing = course_keys.filter((_, i) => groupsByCourse[i].length === 0);
    if (missing.length > 0) {
      return `No groups found in DynamoDB for: ${missing.join(", ")} in ${semester}. ` +
        "The course data may not have been loaded yet — run the schedule refresh job first.";
    }

    const prefs = {
      morningPreferred: preferences.morning_preferred,
      afternoonPreferred: preferences.afternoon_preferred,
      maxDaysOnCampus: preferences.max_days_on_campus,
      freeDays: preferences.free_days,
      maxGapMinutes: preferences.max_gap_minutes,
    };

    const schedules = generateSchedules(groupsByCourse, prefs, 5);
    if (schedules.length === 0) {
      return "No valid non-overlapping schedule combination was found for these courses. " +
        "Consider choosing different groups or removing a constraint.";
    }

    return JSON.stringify({ semester, schedules_found: schedules.length, schedules });
  },
});

const researchProfessor = tool({
  name: "research_professor",
  description:
    "Retrieve official profile and cached student reviews for a professor. " +
    "Source labels distinguish OFFICIAL information from STUDENT_REVIEW content.",
  inputSchema: z.object({
    professor_id: z.string().describe("Professor identifier, e.g. 'prof-martinez'"),
  }),
  callback: async ({ professor_id }) => {
    const { profile, reviews } = await getProfessor(professor_id);
    if (!profile) {
      return `No profile found for professor '${professor_id}'. ` +
        "The professor data may not have been scraped yet.";
    }
    return JSON.stringify({
      source_label: "OFFICIAL",
      profile,
      reviews: reviews.map((r) => ({ ...r, source_label: "STUDENT_REVIEW" })),
    });
  },
});

const checkAcademicProgress = tool({
  name: "check_academic_progress",
  description:
    "Calculate a student's current credits, projected credits after the selected " +
    "semester, and remaining credits toward graduation. Uses deterministic arithmetic.",
  inputSchema: z.object({
    student_id: z.string().describe("The student's ID"),
    selected_courses: z.array(z.object({
      course_name: z.string(),
      credits: z.number(),
    })).describe("Courses the student plans to take this semester"),
  }),
  callback: async ({ student_id, selected_courses }) => {
    const completed = await getCompletedCourses(student_id);
    const result = calculateProgress(
      completed,
      selected_courses.map((c) => ({ courseName: c.course_name, credits: c.credits })),
    );
    return JSON.stringify(result);
  },
});

const getStudentGoals = tool({
  name: "get_student_goals",
  description: "Retrieve a student's profile, interests, and career goals.",
  inputSchema: z.object({
    student_id: z.string().describe("The student's ID"),
  }),
  callback: async ({ student_id }) => {
    const profile = await getStudentProfile(student_id);
    if (!profile) return `No profile found for student '${student_id}'.`;
    return JSON.stringify(profile);
  },
});

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal academic assistant for students at UNAM Facultad de Ciencias.
You help students plan their semester, research professors, track their academic progress, and build professional roadmaps.

IMPORTANT RULES:
1. Never fabricate UNAM course data, professor information, or student reviews.
2. Always label information by source:
   - OFFICIAL: from UNAM / Facultad de Ciencias official sources
   - STUDENT_REVIEW: from misprofes.com or similar student platforms
   - GENERATED: your own AI recommendations (not fact claims)
3. Never perform schedule conflict detection yourself — always use the plan_schedule tool.
4. Never calculate credits yourself — always use the check_academic_progress tool.
5. When you don't have real data (tool returns no results), say so clearly.
6. Be warm, helpful, and concise. Students are busy.`;

// ── Lambda handler ───────────────────────────────────────────────────────────

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  // GET / → serve the chat UI
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

  const history = await loadSession(sessionId);

  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    messages: history,
    tools: [planSchedule, researchProfessor, checkAcademicProgress, getStudentGoals],
    printer: false,
  });

  const metadata = { statusCode: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } };
  responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);

  for await (const ev of agent.stream(message)) {
    if (
      ev.type === "modelStreamUpdateEvent" &&
      ev.event.type === "modelContentBlockDeltaEvent" &&
      ev.event.delta?.type === "textDelta"
    ) {
      responseStream.write(JSON.stringify({ type: "token", text: ev.event.delta.text }) + "\n");
    } else if (ev.type === "beforeToolCallEvent") {
      responseStream.write(JSON.stringify({ type: "tool", name: ev.toolUse?.name ?? "tool" }) + "\n");
    }
  }

  await saveSession(sessionId, agent.messages);
  responseStream.end();
});

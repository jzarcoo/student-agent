import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, SESSIONS_TABLE } from "./db.mjs";

export async function loadHistory(sessionId) {
  const resp = await ddb.send(new GetCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId: `session#${sessionId}` },
  }));
  if (!resp.Item) return [];
  const raw = resp.Item.messages;
  return typeof raw === "string" ? JSON.parse(raw) : raw ?? [];
}

export async function saveHistory(sessionId, messages) {
  const toSave = messages.length > 40 ? compressHistory(messages) : messages;
  await ddb.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: {
      sessionId: `session#${sessionId}`,
      messages: JSON.stringify(toSave),
      ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
  }));
}

function compressHistory(messages) {
  const old = messages.slice(0, -10);
  const recent = messages.slice(-10);
  const summary = old
    .filter(m => m.role === "user")
    .map(m => typeof m.content === "string" ? m.content : m.content?.[0]?.text ?? "")
    .join(" | ");
  return [
    { role: "user", content: `[Resumen de conversación anterior: ${summary}]` },
    { role: "assistant", content: "Entendido, tengo contexto de nuestra conversación anterior." },
    ...recent,
  ];
}

// ── Student profile (stored in agent-sessions as JSON string) ─────────────────

export async function loadStudentProfile(studentId) {
  const resp = await ddb.send(new GetCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId: `student#${studentId}#profile` },
  }));
  if (!resp.Item) return null;
  const raw = resp.Item.data;
  return typeof raw === "string" ? JSON.parse(raw) : raw ?? null;
}

export async function saveStudentProfile(profile) {
  const { studentId } = profile;
  await ddb.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: {
      sessionId: `student#${studentId}#profile`,
      data: JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }),
    },
  }));
}

export async function loadStudentProgress(studentId) {
  const resp = await ddb.send(new GetCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId: `student#${studentId}#progress` },
  }));
  if (!resp.Item) return {};
  const raw = resp.Item.courses;
  return typeof raw === "string" ? JSON.parse(raw) : raw ?? {};
}

export async function saveStudentProgress(studentId, courses) {
  await ddb.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: {
      sessionId: `student#${studentId}#progress`,
      courses: JSON.stringify(courses),
      updatedAt: new Date().toISOString(),
    },
  }));
}

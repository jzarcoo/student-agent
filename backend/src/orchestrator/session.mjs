import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./db.mjs";

export async function loadHistory(sessionId) {
  const resp = await ddb.send(new GetCommand({
    TableName: process.env.SESSIONS_TABLE,
    Key: { PK: `SESSION#${sessionId}`, SK: "MESSAGES" },
  }));
  return resp.Item ? JSON.parse(resp.Item.messages) : [];
}

export async function saveHistory(sessionId, messages) {
  const toSave = messages.length > 40
    ? compressHistory(messages)
    : messages;

  await ddb.send(new PutCommand({
    TableName: process.env.SESSIONS_TABLE,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: "MESSAGES",
      messages: JSON.stringify(toSave),
      ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
  }));
}

// Keep last 10 messages + inject a summary of the older ones
async function compressHistory(messages) {
  const old = messages.slice(0, -10);
  const recent = messages.slice(-10);
  const summary = old
    .filter(m => m.role === "user")
    .map(m => typeof m.content === "string" ? m.content : m.content?.[0]?.text ?? "")
    .join(" | ");

  return [
    { role: "user", content: `[Conversation summary: ${summary}]` },
    { role: "assistant", content: "Understood, I have context from our previous conversation." },
    ...recent,
  ];
}

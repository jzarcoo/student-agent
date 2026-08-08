import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, CATALOG_TABLE } from "../db.mjs";

const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

async function embed(text) {
  const resp = await bedrock.send(new InvokeModelCommand({
    modelId: "amazon.titan-embed-text-v2:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text.slice(0, 8000), dimensions: 256, normalize: true }),
  }));
  const { embedding } = JSON.parse(new TextDecoder().decode(resp.body));
  return embedding;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

export async function searchDocs(query, topK = 3) {
  const [qVec, resp] = await Promise.all([
    embed(query),
    ddb.send(new ScanCommand({
      TableName: CATALOG_TABLE,
      FilterExpression: "begins_with(id, :prefix)",
      ExpressionAttributeValues: { ":prefix": "unam#rag#" },
    })),
  ]);

  const chunks = resp.Items ?? [];
  if (!chunks.length) return [];

  return chunks
    .map(c => {
      const vec = typeof c.embedding === "string" ? JSON.parse(c.embedding) : c.embedding;
      return { ...c, score: cosine(qVec, vec) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(c => c.score > 0.5)
    .map(c => ({ source: c.source, text: c.text, score: Math.round(c.score * 100) / 100 }));
}

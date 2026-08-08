import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Lambda role (nube-agent-execution-role) can only access:
//   agent-sessions  → GetItem, PutItem   (all mutable student + session state)
//   product-catalog → GetItem, Query, Scan  (read-only catalog seeded by us)
export const SESSIONS_TABLE = "agent-sessions";
export const CATALOG_TABLE  = "product-catalog";

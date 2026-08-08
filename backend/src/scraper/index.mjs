/**
 * Scraper Lambda — triggered by SQS messages from the scraping queue.
 *
 * Each message describes one scraping job:
 *   { type: "COURSE_SCHEDULE", semester: "2026-1" }
 *   { type: "PROFESSOR_PROFILE", professorId: "prof-martinez", url: "https://..." }
 *   { type: "REVIEWS", professorId: "prof-martinez", courseKey: "algoritmos" }
 *
 * Phase 1 (MVP): stubs that log the job type.
 * Phase 2: real HTTP fetching + DynamoDB writes.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  for (const record of event.Records) {
    const job = JSON.parse(record.body);
    console.log("Scraping job received:", JSON.stringify(job));

    switch (job.type) {
      case "COURSE_SCHEDULE":
        await handleCourseSchedule(job);
        break;
      case "PROFESSOR_PROFILE":
        await handleProfessorProfile(job);
        break;
      case "REVIEWS":
        await handleReviews(job);
        break;
      default:
        console.warn("Unknown job type:", job.type);
    }
  }
};

async function handleCourseSchedule(job) {
  // TODO Phase 2: fetch from UNAM DGAE schedule service and write to unam-courses table
  console.log(`[STUB] Would scrape course schedule for semester ${job.semester}`);
}

async function handleProfessorProfile(job) {
  // TODO Phase 2: fetch professor page and write to unam-professors table
  console.log(`[STUB] Would scrape professor profile: ${job.professorId}`);
}

async function handleReviews(job) {
  // TODO Phase 2: fetch misprofes.com, summarise, write to unam-professors table with TTL
  console.log(`[STUB] Would scrape reviews: ${job.professorId} / ${job.courseKey}`);
}

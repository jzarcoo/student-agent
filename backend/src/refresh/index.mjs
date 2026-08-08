/**
 * Refresh Lambda — runs nightly via EventBridge.
 * Enqueues scraping jobs for the current semester's course schedule.
 */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

export const handler = async () => {
  const semester = currentSemester();
  console.log(`Enqueueing schedule refresh for ${semester}`);

  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.SCRAPING_QUEUE_URL,
    MessageBody: JSON.stringify({ type: "COURSE_SCHEDULE", semester }),
  }));

  console.log("Refresh job enqueued.");
};

function currentSemester() {
  const now = new Date();
  const year = now.getFullYear();
  // UNAM semesters: period 1 = Feb–Jun, period 2 = Aug–Jan
  const period = now.getMonth() >= 7 ? 2 : 1;
  return `${year}-${period}`;
}

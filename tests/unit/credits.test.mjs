import { strict as assert } from "assert";
import { test } from "node:test";
import { calculateProgress } from "../../backend/src/orchestrator/credits.mjs";

test("credits add correctly", () => {
  const result = calculateProgress(
    [{ credits: 10 }, { credits: 8 }, { credits: 10 }],    // 28 completed
    [{ courseName: "Algoritmos", credits: 10 }, { courseName: "Bases de Datos", credits: 8 }], // 18 in progress
    400
  );
  assert.equal(result.earnedCredits, 28);
  assert.equal(result.inProgressCredits, 18);
  assert.equal(result.projectedCredits, 46);
  assert.equal(result.remainingCredits, 354);
});

test("handles zero completed courses", () => {
  const result = calculateProgress([], [{ courseName: "A", credits: 10 }], 400);
  assert.equal(result.earnedCredits, 0);
  assert.equal(result.projectedCredits, 10);
});

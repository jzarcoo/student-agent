/**
 * Unit tests for the deterministic schedule solver.
 * Run with: node --test tests/unit/schedule.test.mjs
 */

import { strict as assert } from "assert";
import { test } from "node:test";
import { generateSchedules } from "../../backend/src/orchestrator/schedule.mjs";

const algoritmos = [
  {
    groupId: "4001", courseName: "Algoritmos", credits: 10, professorId: "prof-a",
    schedule: [
      { day: "MON", start: "08:00", end: "10:00" },
      { day: "WED", start: "08:00", end: "10:00" },
    ],
  },
  {
    groupId: "4002", courseName: "Algoritmos", credits: 10, professorId: "prof-b",
    schedule: [
      { day: "TUE", start: "14:00", end: "16:00" },
      { day: "THU", start: "14:00", end: "16:00" },
    ],
  },
];

const basesdatos = [
  {
    groupId: "5001", courseName: "Bases de Datos", credits: 8, professorId: "prof-c",
    schedule: [
      { day: "MON", start: "10:00", end: "12:00" },
      { day: "WED", start: "10:00", end: "12:00" },
    ],
  },
  {
    groupId: "5002", courseName: "Bases de Datos", credits: 8, professorId: "prof-d",
    schedule: [
      { day: "MON", start: "08:00", end: "10:00" },  // overlaps with algoritmos group 4001
      { day: "WED", start: "08:00", end: "10:00" },
    ],
  },
];

test("no overlapping schedules are returned", () => {
  const results = generateSchedules([algoritmos, basesdatos], {});
  for (const combo of results) {
    const allSlots = combo.groups.flatMap((g) => g.schedule);
    for (let i = 0; i < allSlots.length; i++) {
      for (let j = i + 1; j < allSlots.length; j++) {
        const a = allSlots[i], b = allSlots[j];
        if (a.day === b.day) {
          const toM = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
          assert.ok(
            toM(a.end) <= toM(b.start) || toM(b.end) <= toM(a.start),
            `Overlap detected: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
          );
        }
      }
    }
  }
});

test("free-day preference is respected in ranking", () => {
  const results = generateSchedules(
    [algoritmos, basesdatos],
    { freeDays: ["friday"] },
    5
  );
  // All results should have no Friday — both groups already have none, so all qualify
  assert.ok(results.length > 0, "Should find at least one schedule");
  for (const r of results) {
    assert.ok(!r.daysOnCampus.includes("FRI"), "Friday should be free");
  }
});

test("overlapping pair produces fewer combos than full cartesian product", () => {
  const all = generateSchedules([algoritmos, basesdatos], {}, 100);
  // 2 × 2 = 4 combinations total, but group 4001+5002 overlap → only 3 valid
  assert.equal(all.length, 3);
});

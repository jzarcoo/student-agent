/**
 * Deterministic schedule constraint solver.
 *
 * Generates all valid, non-overlapping schedule combinations from a list of
 * course groups, then ranks them according to student preferences.
 *
 * The LLM never touches this logic — overlap detection and ranking are pure JS.
 */

/** Returns true when two time blocks overlap (inclusive start, exclusive end). */
function overlaps(a, b) {
  if (a.day !== b.day) return false;
  const toMins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  return toMins(a.start) < toMins(b.end) && toMins(b.start) < toMins(a.end);
}

/** Returns true when any two groups in the combination have overlapping slots. */
function hasConflict(groups) {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      for (const slotA of groups[i].schedule) {
        for (const slotB of groups[j].schedule) {
          if (overlaps(slotA, slotB)) return true;
        }
      }
    }
  }
  return false;
}

/** All days that appear in a combination. */
function activeDays(groups) {
  return new Set(groups.flatMap((g) => g.schedule.map((s) => s.day)));
}

/** Total gap minutes between consecutive classes on any single day. */
function totalGapMinutes(groups) {
  const toMins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const byDay = {};
  for (const g of groups) {
    for (const s of g.schedule) {
      (byDay[s.day] ||= []).push({ start: toMins(s.start), end: toMins(s.end) });
    }
  }
  let total = 0;
  for (const slots of Object.values(byDay)) {
    slots.sort((a, b) => a.start - b.start);
    for (let i = 1; i < slots.length; i++) {
      total += Math.max(0, slots[i].start - slots[i - 1].end);
    }
  }
  return total;
}

/** Earliest start time across all slots (minutes since midnight). */
function earliestStart(groups) {
  const toMins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  return Math.min(...groups.flatMap((g) => g.schedule.map((s) => toMins(s.start))));
}

/**
 * Score a combination against student preferences.
 * Lower score = better (penalty-based).
 */
function score(groups, prefs) {
  let penalty = 0;

  // Penalise each campus day beyond the max
  const days = activeDays(groups);
  if (prefs.maxDaysOnCampus && days.size > prefs.maxDaysOnCampus) {
    penalty += (days.size - prefs.maxDaysOnCampus) * 100;
  }

  // Penalise free-day violations
  for (const freeDay of (prefs.freeDays || [])) {
    if (days.has(freeDay.toUpperCase().slice(0, 3))) penalty += 200;
  }

  // Penalise gaps beyond threshold
  const gap = totalGapMinutes(groups);
  if (prefs.maxGapMinutes != null && gap > prefs.maxGapMinutes * days.size) {
    penalty += Math.floor((gap - prefs.maxGapMinutes * days.size) / 10);
  }

  // Penalise mismatched morning/afternoon preference
  const start = earliestStart(groups);
  if (prefs.morningPreferred && start >= 13 * 60) penalty += 80;
  if (prefs.afternoonPreferred && start < 12 * 60) penalty += 80;

  return penalty;
}

/**
 * Generate up to `limit` valid, ranked schedule combinations.
 *
 * @param {Array<Array<object>>} groupsByCourse  - For each course, its list of available groups.
 * @param {object} prefs                         - Student schedule preferences.
 * @param {number} limit                         - Max combinations to return (default 5).
 * @returns {Array<{groups, score, days, gapMinutes, reasons}>}
 */
export function generateSchedules(groupsByCourse, prefs = {}, limit = 5) {
  const valid = [];

  function backtrack(courseIdx, chosen) {
    if (courseIdx === groupsByCourse.length) {
      if (!hasConflict(chosen)) {
        const s = score(chosen, prefs);
        const days = [...activeDays(chosen)];
        const gap = totalGapMinutes(chosen);
        valid.push({ groups: chosen.slice(), score: s, days, gapMinutes: gap });
      }
      return;
    }
    for (const group of groupsByCourse[courseIdx]) {
      chosen.push(group);
      backtrack(courseIdx + 1, chosen);
      chosen.pop();
    }
  }

  backtrack(0, []);
  valid.sort((a, b) => a.score - b.score);

  return valid.slice(0, limit).map((v, i) => ({
    rank: i + 1,
    score: v.score,
    groups: v.groups,
    daysOnCampus: v.days,
    gapMinutes: v.gapMinutes,
    reasons: buildReasons(v, prefs),
  }));
}

function buildReasons(combo, prefs) {
  const reasons = [];
  if (prefs.freeDays?.length) {
    const free = prefs.freeDays.filter(
      (d) => !combo.days.includes(d.toUpperCase().slice(0, 3))
    );
    if (free.length) reasons.push(`Free day(s) achieved: ${free.join(", ")}`);
  }
  if (combo.gapMinutes === 0) reasons.push("No gaps between classes");
  else if (combo.gapMinutes < 60) reasons.push(`Short gaps (${combo.gapMinutes} min total)`);
  if (prefs.morningPreferred && combo.days.length > 0) {
    const start = earliestStart(combo.groups);
    if (start < 10 * 60) reasons.push("Early morning schedule");
  }
  if (combo.score === 0) reasons.push("Perfectly matches all your preferences");
  return reasons;
}

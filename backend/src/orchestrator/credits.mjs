/**
 * Deterministic credit calculator.
 * Never delegate arithmetic to the LLM.
 */

/**
 * @param {Array<{credits: number}>} completedCourses
 * @param {Array<{credits: number, courseName: string}>} selectedCourses
 * @param {number} totalRequired - Credits required for degree completion
 */
export function calculateProgress(completedCourses, selectedCourses, totalRequired = 400) {
  const earned = completedCourses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
  const inProgress = selectedCourses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
  const projected = earned + inProgress;
  const remaining = Math.max(0, totalRequired - projected);
  const percentComplete = Math.round((projected / totalRequired) * 100);

  return {
    earnedCredits: earned,
    inProgressCredits: inProgress,
    projectedCredits: projected,
    remainingCredits: remaining,
    totalRequired,
    percentComplete,
    breakdown: selectedCourses.map((c) => ({
      courseName: c.courseName,
      credits: c.credits,
    })),
  };
}

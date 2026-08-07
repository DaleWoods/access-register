/**
 * Challenge prompts surfaced to a reviewer against a specific account.
 *
 * The point of a review is not to click "keep" 200 times. These prompts put
 * the awkward question in front of the reviewer at the moment they decide.
 */
export function challengesFor(record: {
  flags: string[];
  justification: string;
  role: string;
  permissionLevel: string;
  lastReviewedAt: Date | null;
  lastConfirmed: Date | null;
}): string[] {
  const challenges: string[] = [];

  if (record.flags.includes("dormant")) {
    challenges.push("Dormant — no recorded login inside the dormancy window. Is this still needed?");
  }
  if (record.flags.includes("unverifiable")) {
    challenges.push(
      "Dormancy cannot be checked: this vendor does not expose last login. Confirm the need directly with the account holder.",
    );
  }
  if (!record.justification.trim()) {
    challenges.push("No justification recorded. Why does this person have this access?");
  }
  if (
    record.permissionLevel.trim() &&
    record.role.trim() &&
    record.permissionLevel.trim().toLowerCase() !== record.role.trim().toLowerCase()
  ) {
    challenges.push(
      `Permission level ("${record.permissionLevel}") differs from the named role ("${record.role}"). Is the extra permission warranted?`,
    );
  }
  if (!record.lastReviewedAt && !record.lastConfirmed) {
    challenges.push("This account has never been reviewed or confirmed by a human.");
  }
  if (record.flags.includes("leaver_with_access")) {
    challenges.push("The linked person is marked as having left. This should almost certainly be removed.");
  }
  return challenges;
}

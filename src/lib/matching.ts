import { prisma } from "@/lib/db";

/**
 * Identity matching and dedup.
 *
 * Policy, straight from the requirements: email is authoritative and matches
 * automatically; a fuzzy name match is only ever a *suggestion* a human
 * confirms. The pipeline never silently guesses who an account belongs to.
 */

export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * The stable identity of an account within a vendor+instance.
 * Username wins when present, because vendors rename email addresses more
 * often than they reissue usernames.
 */
export function buildMatchKey(rawUsername: string, rawEmail: string): string {
  const username = rawUsername.trim().toLowerCase();
  if (username) return `u:${username}`;
  const email = normaliseEmail(rawEmail);
  if (email) return `e:${email}`;
  return "";
}

export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

function editSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Similarity of two human names, 0-1.
 * Token-set aware so "Dale Woods" and "Woods, Dale" score as the same person,
 * while still tolerating a typo inside a token.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);

  // Greedy best-pair matching between token sets.
  const unused = [...rightTokens];
  let total = 0;
  for (const token of leftTokens) {
    let bestScore = 0;
    let bestIndex = -1;
    unused.forEach((candidate, index) => {
      const score = editSimilarity(token, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) unused.splice(bestIndex, 1);
    total += bestScore;
  }

  const matched = total / Math.max(leftTokens.length, rightTokens.length);
  // A straight edit-distance comparison catches "dalewoods" vs "dale woods".
  return Math.max(matched, editSimilarity(left.replace(/ /g, ""), right.replace(/ /g, "")));
}

/** Derive a display name from an email when the export gives us nothing else. */
export function nameFromEmail(email: string): string {
  const local = normaliseEmail(email).split("@")[0] ?? "";
  if (!local) return "";
  return local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type PersonMatch = {
  personId: string;
  fullName: string;
  score: number;
  reason: "primary_email" | "alternate_email" | "fuzzy_name";
};

/** Exact email match against primary or alternate addresses. Authoritative. */
export async function matchPersonByEmail(email: string): Promise<PersonMatch | null> {
  const normalised = normaliseEmail(email);
  if (!normalised) return null;

  const primary = await prisma.person.findFirst({
    where: { primaryEmail: normalised, mergedIntoId: null },
    select: { id: true, fullName: true },
  });
  if (primary) {
    return {
      personId: primary.id,
      fullName: primary.fullName,
      score: 1,
      reason: "primary_email",
    };
  }

  const alternate = await prisma.person.findFirst({
    where: { alternateEmails: { has: normalised }, mergedIntoId: null },
    select: { id: true, fullName: true },
  });
  if (alternate) {
    return {
      personId: alternate.id,
      fullName: alternate.fullName,
      score: 1,
      reason: "alternate_email",
    };
  }
  return null;
}

/**
 * Best fuzzy name candidate above the threshold. Returned as a suggestion for
 * a human to accept — callers must not apply this automatically.
 */
export async function suggestPersonByName(
  fullName: string,
  threshold: number,
  candidates?: { id: string; fullName: string }[],
): Promise<PersonMatch | null> {
  const name = fullName.trim();
  if (!name) return null;

  const people =
    candidates ??
    (await prisma.person.findMany({
      where: { mergedIntoId: null },
      select: { id: true, fullName: true },
    }));

  let best: PersonMatch | null = null;
  for (const person of people) {
    const score = nameSimilarity(name, person.fullName);
    if (score >= threshold && (!best || score > best.score)) {
      best = { personId: person.id, fullName: person.fullName, score, reason: "fuzzy_name" };
    }
  }
  return best;
}

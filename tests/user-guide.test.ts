import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, GUIDE_UPDATED } from "@/content/user-guide";
import { FLAG_DESCRIPTIONS, FLAG_LABELS } from "@/lib/flags";
import { ROLE_LABELS } from "@/lib/auth/policy";

/**
 * The guide is documentation, so nothing can prove it is *correct*. What these
 * tests can do is stop it going silently out of date: if a screen is added and
 * the guide is not, the suite fails and says which screen.
 *
 * See CONTRIBUTING.md.
 */

const ROOT = path.resolve(__dirname, "..");

/** The navigation the app actually renders, parsed from the layout. */
function navHrefsFromLayout(): string[] {
  const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  const navBlock = /const NAV = \[([\s\S]*?)\];/.exec(layout);
  if (!navBlock) throw new Error("Could not find the NAV array in src/app/layout.tsx");

  return [...navBlock[1].matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const covered = new Set(GUIDE_SECTIONS.flatMap((s) => s.covers));

describe("the user guide keeps up with the app", () => {
  it("documents every screen in the main navigation", () => {
    const missing = navHrefsFromLayout().filter((href) => !covered.has(href));
    expect(
      missing,
      `These navigation entries have no user-guide section covering them: ${missing.join(", ")}. ` +
        `Add the href to a section's "covers" in src/content/user-guide.ts.`,
    ).toEqual([]);
  });

  it("documents the admin screen, which is not in the main navigation", () => {
    expect(covered.has("/admin")).toBe(true);
  });

  it("explains every flag the rule engine can set", () => {
    // The page renders the glossary from these constants directly, so the only
    // way to add a flag without documenting it is to leave its description out.
    for (const [key, label] of Object.entries(FLAG_LABELS)) {
      expect(label.length, `Flag ${key} has no label`).toBeGreaterThan(0);
      expect(
        FLAG_DESCRIPTIONS[key as keyof typeof FLAG_DESCRIPTIONS]?.length ?? 0,
        `Flag ${key} has no description, so it would appear in the guide with a blank meaning`,
      ).toBeGreaterThan(10);
    }
  });

  it("covers every role", () => {
    const roles = GUIDE_SECTIONS.find((s) => s.id === "roles");
    expect(roles).toBeDefined();
    const text = JSON.stringify(roles);
    for (const label of Object.values(ROLE_LABELS)) {
      // "Auditor (read-only)" is described as "Auditor" in prose.
      const word = label.split(" (")[0];
      expect(text, `The roles section does not mention ${word}`).toContain(word);
    }
  });

  it("keeps the two load-bearing rules in the guide", () => {
    const text = JSON.stringify(GUIDE_SECTIONS).toLowerCase();
    expect(text).toContain("n/a – not exposed");
    expect(text).toContain("unverifiable");
    expect(text).toContain("dormant");
    // Disappeared accounts are never removed without confirmation.
    expect(text).toContain("disappeared");
    // Login lockout, and that an admin can clear it without a password reset.
    expect(text).toContain("locks the account");
    expect(text).toContain("unlock");
    // Trend history starts empty and cannot be reconstructed. A reader who does
    // not know that will misread an empty chart as "no problems".
    expect(text).toContain("cannot be backfilled");
  });

  it("is structurally sound", () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size, "Section ids must be unique — they are anchor links").toBe(ids.length);

    for (const section of GUIDE_SECTIONS) {
      expect(section.title.length, `${section.id} has no title`).toBeGreaterThan(0);
      expect(section.summary.length, `${section.id} has no summary`).toBeGreaterThan(0);
      expect(section.paragraphs.length, `${section.id} has no body text`).toBeGreaterThan(0);
    }
  });

  it("records when it was last updated, in a readable date format", () => {
    expect(GUIDE_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(GUIDE_UPDATED))).toBe(false);
  });
});

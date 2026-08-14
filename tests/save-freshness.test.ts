import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server action that mutates and then falls through to a re-render leaves the
 * form showing the values it was submitted with. A saved change redisplays its
 * old value, so it looks rejected — and saving again writes the stale value
 * back. That shipped, and cost real confusion.
 *
 * The fix is redirect-after-save. This makes it structural: every mutating
 * action must end in a redirect, so the page is rendered fresh from the
 * database.
 */

const ACTIONS_DIR = path.resolve(__dirname, "../src/app/actions");

/**
 * Actions that legitimately return to the caller instead of redirecting,
 * because they render their own feedback rather than redisplaying a form.
 */
const ALLOWED_WITHOUT_REDIRECT = new Set(["saveView", "deleteView", "signIn"]);

type Action = { file: string; name: string; body: string };

function serverActions(): Action[] {
  const found: Action[] = [];

  for (const file of readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(path.join(ACTIONS_DIR, file), "utf8");
    // Actions are top-level exports, so a closing brace in column zero ends one.
    const pattern = /^export async function (\w+)\([\s\S]*?^\}/gm;
    for (const match of source.matchAll(pattern)) {
      found.push({ file, name: match[1], body: match[0] });
    }
  }
  return found;
}

describe("saving re-renders from the database, not from the submitted tree", () => {
  const actions = serverActions();

  it("finds the server actions to check", () => {
    expect(actions.length).toBeGreaterThan(15);
  });

  it("every mutating action redirects instead of falling through", () => {
    const offenders = actions
      .filter((a) => a.body.includes("revalidatePath"))
      .filter((a) => !a.body.includes("redirect("))
      .filter((a) => !ALLOWED_WITHOUT_REDIRECT.has(a.name))
      .map((a) => `${a.file}: ${a.name}`);

    expect(
      offenders,
      "These actions mutate and then fall through to a re-render, which redisplays " +
        "stale form values. End them with redirect(), or add the name to " +
        "ALLOWED_WITHOUT_REDIRECT with a reason.",
    ).toEqual([]);
  });

  it("keeps the allow-list honest", () => {
    const names = new Set(actions.map((a) => a.name));
    for (const allowed of ALLOWED_WITHOUT_REDIRECT) {
      if (allowed === "signIn") continue; // lives in actions/auth.ts, returns state
      expect(names.has(allowed), `${allowed} is allow-listed but no longer exists`).toBe(true);
    }
  });
});

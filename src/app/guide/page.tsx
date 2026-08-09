import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/auth/policy";
import { FLAG_DESCRIPTIONS, FLAG_LABELS, type FlagKey } from "@/lib/flags";
import { getSettings } from "@/lib/settings";
import { Alert, Card, FlagBadge, PageHeader } from "@/components/ui";
import { GUIDE_SECTIONS, GUIDE_UPDATED, type GuideSection } from "@/content/user-guide";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * The user guide.
 *
 * The prose comes from src/content/user-guide.ts, but the flag glossary, the
 * role list and the configured thresholds are read from the same sources the
 * rest of the app uses. Add a flag or rename a role and this page follows
 * automatically — there is no second copy to forget.
 */
export default async function GuidePage() {
  const user = await requireUser();
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="User guide"
        subtitle={`How the register works and how to use it. Last updated ${GUIDE_UPDATED}.`}
        actions={<PrintButton />}
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <nav className="print:hidden lg:sticky lg:top-4 lg:self-start">
          <Card title="Contents">
            <ol className="card-body space-y-1.5 text-sm">
              {GUIDE_SECTIONS.map((section, index) => (
                <li key={section.id} className="flex gap-2">
                  <span className="tabular-nums text-slate-400">{index + 1}.</span>
                  <a href={`#${section.id}`} className="link">
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </Card>

          <p className="mt-3 px-1 text-xs text-slate-500">
            You are signed in as <strong>{user.fullName}</strong> with the{" "}
            {ROLE_LABELS[user.role].toLowerCase()} role. Sections marked with roles apply only
            to those roles.
          </p>
        </nav>

        <div className="space-y-4">
          {GUIDE_SECTIONS.map((section) => (
            <GuideSectionCard key={section.id} section={section} settings={settings} />
          ))}
        </div>
      </div>
    </>
  );
}

function GuideSectionCard({
  section,
  settings,
}: {
  section: GuideSection;
  settings: { dormantMonths: number; expiryWindowDays: number };
}) {
  return (
    <section id={section.id} className="card scroll-mt-4">
      <div className="card-header">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{section.summary}</p>
        </div>
        {section.roles ? (
          <div className="flex flex-wrap gap-1">
            {section.roles.map((role) => (
              <span key={role} className="badge bg-slate-100 text-slate-600">
                {role}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card-body space-y-4">
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 40)} className="text-sm leading-relaxed text-slate-700">
            {paragraph}
          </p>
        ))}

        {section.steps ? (
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {section.steps.map((step) => (
              <li key={step.title}>
                <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{step.body}</p>
              </li>
            ))}
          </ol>
        ) : null}

        {section.points ? (
          <dl className="space-y-2.5">
            {section.points.map((point) => (
              <div key={point.term}>
                <dt className="text-sm font-semibold text-slate-900">{point.term}</dt>
                <dd className="text-sm leading-relaxed text-slate-700">{point.body}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {/* Live glossaries, rendered from the app's own constants. */}
        {section.id === "flags" ? <FlagGlossary settings={settings} /> : null}
        {section.id === "roles" ? <RoleList /> : null}

        {section.callouts?.map((callout) => (
          <Alert
            key={callout.body.slice(0, 40)}
            tone={callout.tone === "tip" ? "success" : callout.tone === "warn" ? "warn" : "info"}
            title={callout.title}
          >
            {callout.body}
          </Alert>
        ))}
      </div>
    </section>
  );
}

/** Every flag the rule engine can set, straight from src/lib/flags.ts. */
function FlagGlossary({ settings }: { settings: { dormantMonths: number; expiryWindowDays: number } }) {
  const keys = Object.keys(FLAG_LABELS) as FlagKey[];
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-56">Flag</th>
              <th>What it means</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <td>
                  <FlagBadge flag={key} />
                </td>
                <td className="text-sm text-slate-700">{FLAG_DESCRIPTIONS[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Currently configured: dormant after {settings.dormantMonths} months without a login;
        expiries surfaced {settings.expiryWindowDays} days ahead. An admin can change both under{" "}
        <Link href="/admin" className="link">
          Admin
        </Link>
        .
      </p>
    </div>
  );
}

/** The roles the app actually defines, straight from src/lib/auth/policy.ts. */
function RoleList() {
  return (
    <p className="text-xs text-slate-500">
      Roles in this system:{" "}
      {Object.values(ROLE_LABELS).map((label, index, all) => (
        <span key={label}>
          <strong>{label}</strong>
          {index < all.length - 1 ? ", " : "."}
        </span>
      ))}
    </p>
  );
}

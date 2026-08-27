import { FRESHNESS_LABELS, uploadFreshness, type Freshness } from "@/lib/freshness";
import { formatDate } from "@/components/ui";

/**
 * Shared rendering of upload freshness, so the Vendors list and the dashboard
 * always say the same thing about the same vendor.
 */

const TONES: Record<Freshness["state"], string> = {
  manual: "text-slate-400",
  never: "text-slate-400",
  fresh: "text-slate-400",
  due: "text-amber-600",
  stale: "text-red-600",
};

export function LastUpload({
  captureMethod,
  reviewFrequencyMonths,
  batch,
}: {
  captureMethod: string;
  reviewFrequencyMonths: number;
  batch?: { importedAt: Date | null; sourceFilename: string; rowCount: number };
}) {
  const freshness = uploadFreshness({
    captureMethod,
    lastUploadAt: batch?.importedAt ?? null,
    reviewFrequencyMonths,
  });

  if (freshness.state === "manual") {
    return <span className="text-slate-400">{FRESHNESS_LABELS.manual}</span>;
  }
  if (freshness.state === "never" || !batch?.importedAt) {
    return <span className="blank-cell">{FRESHNESS_LABELS.never}</span>;
  }

  return (
    <span
      title={`${batch.sourceFilename} — ${batch.rowCount} rows. Reviewed every ${reviewFrequencyMonths} month(s), so a refresh is expected within ${freshness.expectedWithinDays} days.`}
    >
      {formatDate(batch.importedAt)}
      <span className={`ml-1 ${TONES[freshness.state]}`}>
        ({freshness.days === 0 ? "today" : `${freshness.days}d ago`}
        {freshness.state === "fresh" ? "" : ` — ${FRESHNESS_LABELS[freshness.state].toLowerCase()}`})
      </span>
    </span>
  );
}

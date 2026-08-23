import { Alert } from "@/components/ui";

/**
 * Confirmation after a save.
 *
 * Edit actions redirect back to the page they came from so the form is
 * re-rendered from the database rather than from the tree it was submitted
 * with — otherwise a saved change redisplays its old value, and saving again
 * writes that stale value back. The redirect costs the user their only signal
 * that anything happened, so it carries ?saved=1 and this puts it back.
 */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function SavedNotice({
  searchParams,
  children = "Saved.",
}: {
  searchParams: Record<string, string | string[] | undefined>;
  children?: React.ReactNode;
}) {
  const bulk = one(searchParams.bulk);
  if (bulk) {
    const count = one(searchParams.count) ?? "0";
    if (bulk === "none") {
      return (
        <div className="mb-4">
          <Alert tone="warn">Nothing in your selection could be acted on.</Alert>
        </div>
      );
    }
    const verb = bulk === "removed" ? "Marked as removed" : "Confirmed";
    return (
      <div className="mb-4">
        <Alert tone="success">
          {verb} {count} account{count === "1" ? "" : "s"}.
        </Alert>
      </div>
    );
  }

  const value = searchParams.saved ?? searchParams.flags;
  if (!value) return null;

  return (
    <div className="mb-4">
      <Alert tone="success">{children}</Alert>
    </div>
  );
}

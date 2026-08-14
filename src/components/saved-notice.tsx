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
export function SavedNotice({
  searchParams,
  children = "Saved.",
}: {
  searchParams: Record<string, string | string[] | undefined>;
  children?: React.ReactNode;
}) {
  const value = searchParams.saved ?? searchParams.flags;
  if (!value) return null;

  return (
    <div className="mb-4">
      <Alert tone="success">{children}</Alert>
    </div>
  );
}

"use client";

import { useState } from "react";
import { saveView } from "@/app/actions/views";

export function SaveViewButton({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Save this view
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      action={async (formData) => {
        const result = await saveView(formData);
        setMessage(result.error ?? "Saved");
        if (!result.error) setOpen(false);
      }}
    >
      <input type="hidden" name="query" value={query} />
      <input name="name" placeholder="View name" className="input w-48" required />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" name="shared" value="1" />
        Share
      </label>
      <button type="submit" className="btn-primary btn-sm">
        Save
      </button>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {message ? <span className="text-xs text-slate-500">{message}</span> : null}
    </form>
  );
}

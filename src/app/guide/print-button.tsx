"use client";

/** Lets someone hand the guide to a colleague or attach it to an audit pack. */
export function PrintButton() {
  return (
    <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}

import "server-only";

/**
 * Thin wrapper over Resend's REST API — no SDK dependency, since it is one
 * POST with a bearer token. See README.md → Email notifications for the
 * environment variables this needs.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY and NOTIFICATIONS_FROM_EMAIL must both be set to send email");
    this.name = "EmailNotConfiguredError";
  }
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATIONS_FROM_EMAIL);
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATIONS_FROM_EMAIL;
  if (!apiKey || !from) throw new EmailNotConfiguredError();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }
}

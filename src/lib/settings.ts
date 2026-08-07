import { prisma } from "@/lib/db";

/** Configurable rule-engine and access settings, with safe defaults. */
export type AppSettings = {
  /** last_login older than this many months flags an account dormant. */
  dormantMonths: number;
  /** Account/password expiries inside this window are surfaced. */
  expiryWindowDays: number;
  /** Let vendor owners see whole-estate aggregate reports read-only. */
  vendorOwnerAggregateAccess: boolean;
  /** 0-1. Fuzzy name matches below this are not even suggested. */
  fuzzyMatchThreshold: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  dormantMonths: 12,
  expiryWindowDays: 30,
  vendorOwnerAggregateAccess: true,
  fuzzyMatchThreshold: 0.86,
};

const SETTINGS_KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<AppSettings>) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch };
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next },
    update: { value: next },
  });
  return next;
}

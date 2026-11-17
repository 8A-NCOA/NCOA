export const KTA_EVENING_PATROL_REMINDER_MESSAGE = "KTA 기수 중 저녁순찰 리마인드 드립니다.";

export interface KtaScheduleLike {
  type?: string;
  startDate?: string;
  endDate?: string;
  memo?: string;
  batch?: string;
}

export function normalizeIsoDateStr(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const parts = value.trim().split(/[-./]/);
  if (parts.length < 3) return null;
  const y = parts[0];
  const m = parts[1].padStart(2, "0");
  const d = parts[2].substring(0, 2).padStart(2, "0");
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split("T")[0];
}

export function isDateDuringKtaPeriod(
  dateStr: string,
  schedules: KtaScheduleLike[]
): boolean {
  const targetDate = normalizeIsoDateStr(dateStr);
  if (!targetDate) return false;

  const ktaEvents = schedules
    .filter((s) => s.type === "kta")
    .map((s) => ({
      ...s,
      startDate: normalizeIsoDateStr(s.startDate),
      endDate: normalizeIsoDateStr(s.endDate || s.startDate),
    }))
    .filter((s): s is typeof s & { startDate: string; endDate: string } => Boolean(s.startDate && s.endDate));

  const ktaDay0s = ktaEvents.filter((e) => e.memo?.includes("Day 0"));
  const ktaGrads = ktaEvents.filter(
    (e) =>
      e.memo?.includes("Graduation") ||
      e.memo?.includes("수료") ||
      e.memo?.includes("🎓")
  );

  const inPairedRange = ktaDay0s.some((day0) => {
    const grad = ktaGrads.find((g) => {
      if (day0.batch && g.batch) {
        return g.batch === day0.batch && g.startDate >= day0.startDate;
      }
      const d0Time = Date.parse(`${day0.startDate}T00:00:00Z`);
      const gTime = Date.parse(`${g.startDate}T00:00:00Z`);
      return gTime >= d0Time && gTime - d0Time <= 30 * 24 * 60 * 60 * 1000;
    });

    const periodEnd = grad ? grad.startDate : addDaysToIsoDate(day0.startDate, 20);
    return targetDate >= day0.startDate && targetDate <= periodEnd;
  });

  if (inPairedRange) return true;

  return ktaEvents.some(
    (e) => e.endDate > e.startDate && targetDate >= e.startDate && targetDate <= e.endDate
  );
}
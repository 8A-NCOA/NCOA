/**
 * 엑셀 업로드(반영 요청)의 Firestore 기록 계산. 순수 함수 — tests/movement.import.test.ts에서 바로 쓴다.
 */
export interface ImportMovement {
    name: string;
    type: string;
    /** 외박 항목: 'M.D', 'M.D~M.D', 'M.D (원데이)' */
    period?: string;
    reason?: string;
    /** 잔류 항목: 토요일~일요일 'M.D' */
    stayStart?: string;
    stayEnd?: string;
    detail?: string;
    vacation?: { depart: string; return: string; reason?: string };
    date?: string;
}

export interface ExistingDoc {
    id: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
    reason?: string;
}

export interface ImportPlan {
    deleteIds: string[];
    adds: Record<string, unknown>[];
}

const cleanName = (name: string) => name.replace(/^(병장|상병|일병|이병)\s*/, "");

/** 연도 기준: 숫자면 그 연도, 'YYYY-MM-DD'면 그 날짜에서 가장 가까운 연도 (엑셀 댓글에는 연도가 없다) */
export type YearRef = number | string;

const pad = (n: number) => String(n).padStart(2, "0");

/** 'M.D' → 'YYYY-MM-DD'. '(원데이)' 표기는 무시한다. */
export function mdToIso(md: string, ref: YearRef): string {
    const parts = md.replace(/\(원데이\)/, "").trim().split(/[./~-]/).map((p) => p.trim());
    if (parts.length < 2) return "";
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(d)) return "";
    if (typeof ref === "number") return `${ref}-${pad(m)}-${pad(d)}`;
    const [ay, am, ad] = ref.split("-").map(Number);
    const anchor = Date.UTC(ay, am - 1, ad);
    let best = ay;
    for (const y of [ay - 1, ay + 1]) {
        if (Math.abs(Date.UTC(y, m - 1, d) - anchor) < Math.abs(Date.UTC(best, m - 1, d) - anchor)) best = y;
    }
    return `${best}-${pad(m)}-${pad(d)}`;
}

/** 시작~끝 구간. 끝이 시작보다 앞서면(연말을 넘는 기간) 끝을 다음 해로 */
function rangeIso(startMd: string, endMd: string, ref: YearRef): { start: string; end: string } | null {
    const start = mdToIso(startMd, ref);
    let end = mdToIso(endMd, ref);
    if (!start || !end) return null;
    if (end < start) end = `${Number(end.slice(0, 4)) + 1}${end.slice(4)}`;
    return { start, end };
}

function periodIso(period: string, ref: YearRef): { start: string; end: string } | null {
    const [s, e] = period.split(/[~-]/).map((x) => x.trim());
    return rangeIso(s, e || s, ref);
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

type Entry = { kind: "pass" | "stay" | "vacation"; start: string; end: string };

/** 항목 하나가 가진 기록 구간 (종류별) */
function entriesOf(m: ImportMovement, year: YearRef): Entry[] {
    const out: Entry[] = [];
    if (m.type === "외박" && m.period) {
        const p = periodIso(m.period, year);
        if (p) out.push({ kind: "pass", ...p });
    }
    if (m.type === "잔류" && m.stayStart && m.stayEnd) {
        const r = rangeIso(m.stayStart, m.stayEnd, year);
        if (r) out.push({ kind: "stay", ...r });
    }
    if (m.vacation) {
        const r = rangeIso(m.vacation.depart, m.vacation.return, year);
        if (r) out.push({ kind: "vacation", ...r });
    }
    return out;
}

export function planImportFirestore(movements: ImportMovement[], existing: ExistingDoc[], year: YearRef): ImportPlan {
    const deleteIds = new Set<string>();
    const hasRange = movements.some((m) => entriesOf(m, year).length > 0);

    if (hasRange) {
        existing.forEach((doc) => {
            const name = cleanName(doc.name);
            const sameName = movements.filter((m) => cleanName(m.name) === name);
            if (sameName.length === 0) return;
            const isVacationDoc = doc.type === "vacation";
            const all = sameName.flatMap((m) => entriesOf(m, year));

            // 1) 같은 종류끼리 겹치면 지운다 (휴가는 휴가끼리, 외박·잔류는 외박·잔류끼리)
            const sameKind = all.some((e) => (e.kind === "vacation") === isVacationDoc && overlaps(doc.startDate, doc.endDate, e.start, e.end));
            if (sameKind) {
                deleteIds.add(doc.id);
                return;
            }
            // 2) 외박·잔류 기록은 이 대원의 어떤 구간(휴가 포함)과 겹쳐도 지운다 (예전 동작과 같음)
            if (!isVacationDoc && all.some((e) => overlaps(doc.startDate, doc.endDate, e.start, e.end))) {
                deleteIds.add(doc.id);
            }
        });
    }

    const adds: Record<string, unknown>[] = [];
    movements.forEach((m) => {
        const name = cleanName(m.name);
        entriesOf(m, year).forEach((e) => {
            if (e.kind === "pass") adds.push({ name, type: "pass", startDate: e.start, endDate: e.end, reason: m.reason || "" });
            else if (e.kind === "stay") adds.push({ name, type: "stay", startDate: e.start, endDate: e.end, reason: m.detail || "잔류" });
            else adds.push({ name, type: "vacation", startDate: e.start, endDate: e.end, reason: m.vacation?.reason || "" });
        });
    });

    return { deleteIds: [...deleteIds], adds };
}

/** 그 날짜가 들어 있는 주기(수~화)의 수요일 'YYYY-MM-DD' */
export function periodStartOf(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const back = (date.getUTCDay() - 3 + 7) % 7;
    date.setUTCDate(date.getUTCDate() - back);
    return date.toISOString().slice(0, 10);
}

/**
 * 반영 뒤 한 주기에 사유가 다른 외박이 둘 이상 남는 인원 (허용하지 않는다).
 * 외박은 첫 외박일(시작일)이 들어 있는 주기 것이다. 당직을 피해 나눠 나간 외박은 사유가 같으므로 괜찮다.
 */
export function findPassReasonConflicts(existing: ExistingDoc[], plan: ImportPlan): { name: string; message: string }[] {
    const deleted = new Set(plan.deleteIds);
    const passes = [
        ...existing.filter((d) => d.type === "pass" && !deleted.has(d.id)).map((d) => ({ name: cleanName(d.name), startDate: d.startDate, reason: d.reason || "" })),
        ...plan.adds.filter((a) => a.type === "pass").map((a) => ({ name: String(a.name), startDate: String(a.startDate), reason: String(a.reason || "") })),
    ];
    const groups = new Map<string, { name: string; period: string; reasons: Set<string> }>();
    passes.forEach((p) => {
        const period = periodStartOf(p.startDate);
        const key = `${p.name}|${period}`;
        const g = groups.get(key) || { name: p.name, period, reasons: new Set<string>() };
        g.reasons.add(p.reason.trim());
        groups.set(key, g);
    });
    return [...groups.values()]
        .filter((g) => g.reasons.size > 1)
        .map((g) => {
            const [, m, d] = g.period.split("-").map(Number);
            return {
                name: g.name,
                message: `${m}/${d}(수) 주기에 사유가 다른 외박이 있습니다 (${[...g.reasons].map((r) => r || "사유 없음").join(" / ")}). 한 주기에는 외박을 한 번만 저장할 수 있습니다.`,
            };
        });
}

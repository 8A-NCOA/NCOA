/**
 * 유동병력 시트(NEW 탭) 월간 연장 계산. 순수 함수 — tests/sheet.rollover.test.ts에서 바로 쓴다.
 *
 * 시트는 한 달 남짓의 날짜를 열로 가진다 (1행 날짜, 2행 요일, 3~22행 대원, 23행부터 열마다 집계 수식).
 * 실제 날짜가 시트의 마지막 주에 들어오면(다음 주 출타를 받을 칸이 없으면) 다음처럼 연장한다.
 *  1. 오늘 진행 중인 외박·휴가 블록은 시작일부터 남긴다 (점호 보고가 블록 전체 기간을 시트에서 읽는다).
 *  2. 그 블록들의 가장 이른 시작일(없으면 오늘)을 B열로 해서 왼쪽으로 민다.
 *     남기는 범위 중 오늘 이전 칸은 그 블록에 속한 칸만 남기고 나머지는 지운다.
 *  3. 오늘 포함 이후 날짜의 값은 그대로 옮긴다.
 *  4. 뒤로 날짜를 이어 채워 다음 달 말일까지 늘린다 (열이 모자라면 열을 늘린다).
 * 열을 지우거나 끼워 넣지 않고 값만 다시 쓴다 — 다른 탭(유동골뱅이)이 NEW!$B$1:$AK$42를 날짜로 찾기 때문.
 */

export const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

/** 시트 날짜 시리얼(1899-12-30 기준 일수) ↔ 'YYYY-MM-DD' */
export function serialToIso(serial: number): string {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);
}
export function isoToSerial(iso: string): number {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}
export function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
    return isoToSerial(toIso) - isoToSerial(fromIso);
}
/** 다음 달 말일 */
export function endOfNextMonth(iso: string): string {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}
export function weekdayName(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * 1행 값(B열부터)에서 B열부터 하루씩 이어지는 날짜들. 이어지지 않는 칸(빈 칸, 엉뚱한 날짜)부터는 버린다.
 */
export function contiguousDates(row1: unknown[]): string[] {
    const out: string[] = [];
    for (const v of row1) {
        if (typeof v !== "number") break;
        const iso = serialToIso(v);
        if (out.length > 0 && iso !== addDays(out[out.length - 1], 1)) break;
        out.push(iso);
    }
    return out;
}

/** 오늘이 시트의 마지막 7일 안이면(다음 주 출타를 받을 칸이 부족하면) 연장한다 */
export function needsRollover(lastDateIso: string, todayIso: string): boolean {
    return daysBetween(todayIso, lastDateIso) <= 6;
}

const tokensOf = (cell: string) =>
    (cell || "").split(/[/\s]+/).map((t) => t.replace(/\(연계\)/g, "").trim()).filter(Boolean);

/**
 * 오늘(todayIdx) 진행 중인 외박·휴가 블록이 시작하는 칸. 진행 중인 블록이 없으면 todayIdx.
 * - 오늘 칸에 '휴가'/'휴가복귀'가 있고 '휴가출발'이 없으면: 휴가 블록이 이전에 시작했다 → '휴가출발' 칸까지 거슬러 간다.
 * - 오늘 칸에 '외박'/'외박복귀'가 있고 '외박출발'이 없으면: 외박 블록이 이전에 시작했다 → '외박출발' 칸까지 거슬러 간다.
 * - 거슬러 가다 그 종류의 칸이 끊기면 끊긴 바로 다음 칸을 시작으로 본다 (시트 첫 칸이면 첫 칸).
 * 예) 11/22 '외박복귀/휴가출발', 11/23~24 '휴가', 11/25(오늘) '휴가복귀' → 11/22 (앞의 외박은 이미 끝났으므로 남기지 않는다)
 */
export function ongoingBlockStart(row: string[], todayIdx: number): number {
    const today = tokensOf(row[todayIdx] || "");
    const pending: ("pass" | "vacation")[] = [];
    if (today.some((t) => t === "휴가" || t === "휴가복귀") && !today.includes("휴가출발")) pending.push("vacation");
    if (today.some((t) => t === "외박" || t === "외박복귀") && !today.includes("외박출발")) pending.push("pass");

    let start = todayIdx;
    for (const kind of pending) {
        const departWord = kind === "vacation" ? "휴가출발" : "외박출발";
        const dayWord = kind === "vacation" ? "휴가" : "외박";
        let k = todayIdx - 1;
        let found = 0;
        for (; k >= 0; k--) {
            const t = tokensOf(row[k] || "");
            if (t.includes(departWord)) { found = k; break; }
            if (!t.includes(dayWord)) { found = k + 1; break; }
        }
        if (k < 0) found = 0;
        start = Math.min(start, found);
    }
    return start;
}

export interface RolloverPlan {
    /** 연장할 필요가 없으면 false (reason에 이유) */
    apply: boolean;
    reason: string;
    todayIso: string;
    /** 새 B열 날짜 */
    startIso: string;
    /** 왼쪽으로 민 칸 수 */
    shift: number;
    /** 새 1행 날짜 (B열부터), 2행 요일 */
    dates: string[];
    weekdays: string[];
    /** 새 대원 칸 (3행부터, 각 행은 B열부터 dates.length칸) */
    cells: string[][];
    /** 지금 시트 열 수(A열 포함)보다 늘려야 하는 열 수 */
    addColumns: number;
    /** 남기는 범위 중 오늘 이전이라 지운 칸 수 (값이 있던 칸만) */
    clearedCount: number;
}

/**
 * row1: 1행 값 (B열부터), memberRows: 3~22행 값 (각 행 B열부터), columnCount: 지금 열 수(A열 포함).
 */
export function planRollover(
    row1: unknown[],
    memberRows: string[][],
    columnCount: number,
    todayIso: string,
    options: { force?: boolean } = {},
): RolloverPlan {
    const dates = contiguousDates(row1);
    const empty: RolloverPlan = {
        apply: false, reason: "", todayIso, startIso: dates[0] || "", shift: 0,
        dates: [], weekdays: [], cells: [], addColumns: 0, clearedCount: 0,
    };
    if (dates.length === 0) return { ...empty, reason: "1행에 날짜가 없습니다." };
    const todayIdx = dates.indexOf(todayIso);
    if (todayIdx === -1) return { ...empty, reason: `오늘(${todayIso})이 시트 날짜(${dates[0]}~${dates[dates.length - 1]})에 없습니다.` };
    const lastIso = dates[dates.length - 1];
    if (!options.force && !needsRollover(lastIso, todayIso)) {
        return { ...empty, reason: `아직 연장할 때가 아닙니다 (마지막 날짜 ${lastIso}, 오늘 ${todayIso}).` };
    }

    // 1~2. 새 B열: 오늘 진행 중인 블록들의 가장 이른 시작 (없으면 오늘)
    const rows = memberRows.map((r) => dates.map((_, i) => (r[i] ?? "").toString()));
    const rowStarts = rows.map((r) => ongoingBlockStart(r, todayIdx));
    const startIdx = Math.min(todayIdx, ...rowStarts);

    // 4. 날짜: 지금 열을 모두 이어 채우고, 다음 달 말일까지 모자라면 열을 늘린다
    const startIso = dates[startIdx];
    const target = endOfNextMonth(todayIso);
    const existingSlots = Math.max(columnCount - 1, dates.length);
    const neededSlots = daysBetween(startIso, target) + 1;
    const slots = Math.max(existingSlots, neededSlots);
    const newDates = Array.from({ length: slots }, (_, i) => addDays(startIso, i));

    let clearedCount = 0;
    const cells = rows.map((r, rowIdx) =>
        newDates.map((_, j) => {
            const src = startIdx + j;
            if (src >= r.length) return "";
            // 3. 오늘 포함 이후는 그대로
            if (src >= todayIdx) return r[src];
            // 오늘 이전: 그 행에서 오늘 진행 중인 블록의 칸만 남긴다
            if (src >= rowStarts[rowIdx]) return r[src];
            if (r[src]) clearedCount++;
            return "";
        }),
    );

    return {
        apply: true,
        reason: "",
        todayIso,
        startIso,
        shift: startIdx,
        dates: newDates,
        weekdays: newDates.map(weekdayName),
        cells,
        addColumns: Math.max(0, slots + 1 - columnCount),
        clearedCount,
    };
}

/** 0부터 센 열 번호 → 'A', 'B', … 'AA' */
export function columnLetter(idx: number): string {
    let s = "";
    let n = idx;
    while (n >= 0) {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}

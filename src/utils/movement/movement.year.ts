/**
 * 엑셀 댓글에는 연도가 없다. 월.일마다 기준일에서 가장 가까운 연도를 고른다.
 * 예) 기준일 2026-12-20: 12/28 → 2026-12-28, 1/3 → 2027-01-03
 *     기준일 2027-01-05: 12/28 → 2026-12-28, 1/3 → 2027-01-03
 */
export function nearestYearDate(m: number, d: number, ref: Date): Date {
    const y = ref.getFullYear();
    const refNoon = new Date(y, ref.getMonth(), ref.getDate(), 12, 0, 0, 0).getTime();
    let best = new Date(y, m - 1, d, 12, 0, 0, 0);
    for (const cy of [y - 1, y + 1]) {
        const c = new Date(cy, m - 1, d, 12, 0, 0, 0);
        if (Math.abs(c.getTime() - refNoon) < Math.abs(best.getTime() - refNoon)) best = c;
    }
    return best;
}

/** 범위의 끝: 시작보다 앞서면(연말을 넘는 기간) 다음 해로 */
export function rangeEndDate(start: Date, m: number, d: number): Date {
    const end = nearestYearDate(m, d, start);
    if (end.getTime() < start.getTime()) end.setFullYear(end.getFullYear() + 1);
    return end;
}

/**
 * 외특 시트 타임라인('M.D' 목록)의 날짜마다 연도를 정해 주는 함수를 만든다.
 * - 타임라인 첫 날짜: 기준일(점호 기준일)에서 가장 가까운 연도
 * - 그 밖의 'M.D': 타임라인 첫 날짜에서 가장 가까운 연도 (12.30~1.5 처럼 해를 넘는 주차도 이어진다)
 * 기준일의 연도를 그대로 쓰면, 1월에 12월 주차를 보거나 12월에 1월 주차를 볼 때 1년이 어긋난다.
 */
export function createMdYearResolver(timeline: string[] | undefined, ref?: Date): (m: number, d: number) => number {
    const refDate = ref ?? new Date();
    const [fm, fd] = (timeline?.[0] || '').split('.').map(Number);
    if (!fm || !fd || isNaN(fm) || isNaN(fd)) return () => refDate.getFullYear();
    const start = nearestYearDate(fm, fd, refDate);
    return (m: number, d: number) => nearestYearDate(m, d, start).getFullYear();
}

/** 타임라인 첫 날짜의 연도 (getCoreWindow 등 '첫 날짜의 연도'를 받는 함수에 넘긴다) */
export function timelineStartYear(timeline: string[] | undefined, ref?: Date): number {
    const [fm, fd] = (timeline?.[0] || '').split('.').map(Number);
    return createMdYearResolver(timeline, ref)(fm, fd);
}

/** 'M.D' → 'YYYY-MM-DD' (연도는 resolver 로 정한다) */
export function mdToIso(md: string, yearOf: (m: number, d: number) => number): string {
    const [m, d] = md.split('.').map(Number);
    if (!m || !d || isNaN(m) || isNaN(d)) return '';
    return `${yearOf(m, d)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const toIsoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

import type { CalendarEvent } from '../../types/calendar/calendar.type';

// 당직 탭에서 "이 날짜가 BLC 몇째 날인가" / "이 기수의 수료일은 언제인가" 를 빠르게 계산한다.
//
// 이전에는 달력 칸·대원마다 Day 0부터 하루씩 세면서, 하루마다 전체 일정을 훑어 휴일인지 확인했다.
// 여기서는
//   1) 휴일 날짜를 처음에 한 번 Set 으로 정리하고,
//   2) 같은 (Day 0, 날짜) 조합은 한 번만 계산해 저장해 두며,
//   3) 수업일 수가 한도(22/30일)에 도달한 뒤로는 하루씩 세지 않고 남은 날 수를 한 번에 더한다.
// 계산 결과(숫자)는 이전 방식과 같다.

function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

const DAY_MS = 1000 * 60 * 60 * 24;
// 비정상 데이터(예: 끝 날짜가 몇 년 뒤)로 인한 무한 확장을 막기 위한 상한
const MAX_HOLIDAY_SPAN_DAYS = 1000;

export interface BlcDayCalculator {
    /** 일반 휴일(당직 전용 휴일 제외)인지 */
    isHolidayDate: (dateStr: string) => boolean;
    /**
     * Day 0 기준 target 날짜의 BLC Day 번호.
     * Day 0 이후: 일요일·휴일을 뺀 수업일 수(한도 limit 도달 후에는 달력 일수로 계속 증가).
     * Day 0 이전: 단순 달력 일수 차이(음수).
     */
    getBlcActiveDay: (day0DateStr: string, targetDateStr: string, limit: number) => number;
    /** Day 0 기준 수업일 수가 limit 에 도달하는 날짜(수료일) */
    getGraduationDate: (day0DateStr: string, limit: number) => string;
}

export function createBlcDayCalculator(events: CalendarEvent[]): BlcDayCalculator {
    const holidays = new Set<string>();
    for (const e of events) {
        if (e.type !== 'holiday' || e.holidayType === 'duty' || !e.startDate || !e.endDate) continue;
        if (e.startDate > e.endDate) continue;
        const cur = parseLocalDate(e.startDate);
        for (let i = 0; i <= MAX_HOLIDAY_SPAN_DAYS; i++) {
            const s = toDateStr(cur);
            if (s > e.endDate) break;
            holidays.add(s);
            cur.setDate(cur.getDate() + 1);
        }
    }
    const isHolidayDate = (dateStr: string) => holidays.has(dateStr);
    const isSchoolDay = (d: Date) => d.getDay() !== 0 && !holidays.has(toDateStr(d));

    const activeDayCache = new Map<string, number>();
    const getBlcActiveDay = (day0DateStr: string, targetDateStr: string, limit: number) => {
        const key = `${day0DateStr}|${targetDateStr}|${limit}`;
        const cached = activeDayCache.get(key);
        if (cached !== undefined) return cached;

        const start = parseLocalDate(day0DateStr);
        const target = parseLocalDate(targetDateStr);
        let result: number;
        if (start.getTime() === target.getTime()) {
            result = 0;
        } else if (target > start) {
            let dayCount = 0;
            const current = new Date(start);
            while (current < target && dayCount < limit) {
                current.setDate(current.getDate() + 1);
                if (isSchoolDay(current)) dayCount++;
            }
            // 한도 도달 이후에는 남은 날마다 1씩 더해진다 → 남은 달력 일수를 한 번에 더한다.
            if (current < target) {
                dayCount += Math.round((target.getTime() - current.getTime()) / DAY_MS);
            }
            result = dayCount;
        } else {
            result = Math.round((target.getTime() - start.getTime()) / DAY_MS);
        }
        activeDayCache.set(key, result);
        return result;
    };

    const graduationCache = new Map<string, string>();
    const getGraduationDate = (day0DateStr: string, limit: number) => {
        const key = `${day0DateStr}|${limit}`;
        const cached = graduationCache.get(key);
        if (cached !== undefined) return cached;
        const current = parseLocalDate(day0DateStr);
        let dayCount = 0;
        while (dayCount < limit) {
            current.setDate(current.getDate() + 1);
            if (isSchoolDay(current)) dayCount++;
        }
        const result = toDateStr(current);
        graduationCache.set(key, result);
        return result;
    };

    return { isHolidayDate, getBlcActiveDay, getGraduationDate };
}

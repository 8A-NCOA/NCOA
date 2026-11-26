// 당직 누적 횟수 계산에 쓰는 "연-월" 헬퍼.
// 월 숫자만 비교하면 연도가 바뀔 때(2026-12 → 2027-01) 누적이 끊기므로,
// 항상 'YYYY-MM' 문자열로 비교한다. (사전순 비교 = 시간순 비교)

/** 기준선(member.baseline*) 이후 실제 당직을 세기 시작하는 첫 달. 기준선은 이 달 직전까지의 누적이다. */
export const DUTY_COUNT_START_MONTH = '2026-04';

/** (연도, 1~12월) → 'YYYY-MM' */
export function toMonthKey(year: number, month1: number): string {
    return `${year}-${String(month1).padStart(2, '0')}`;
}

/** Date → 'YYYY-MM' */
export function monthKeyOfDate(date: Date): string {
    return toMonthKey(date.getFullYear(), date.getMonth() + 1);
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthKeyOfDateStr(dateStr: string): string {
    return dateStr.slice(0, 7);
}

/** 누적 대상 기간 [DUTY_COUNT_START_MONTH, untilMonthKey) 에 속하는 날짜인지 (untilMonthKey 미포함) */
export function isCountedBeforeMonth(dateStr: string, untilMonthKey: string): boolean {
    const key = monthKeyOfDateStr(dateStr);
    return key >= DUTY_COUNT_START_MONTH && key < untilMonthKey;
}

/** 누적 대상 기간 [DUTY_COUNT_START_MONTH, throughMonthKey] 에 속하는 날짜인지 (throughMonthKey 포함) */
export function isCountedThroughMonth(dateStr: string, throughMonthKey: string): boolean {
    const key = monthKeyOfDateStr(dateStr);
    return key >= DUTY_COUNT_START_MONTH && key <= throughMonthKey;
}

export interface DutyMonthOption {
    label: string;
    key: string;
    year: number;
    month: number;
}

/**
 * 트래커 월 선택 목록: 기준선 + DUTY_COUNT_START_MONTH 부터 lastMonthKey 까지 매달.
 * lastMonthKey 가 시작 달보다 이르면 시작 달까지만 만든다.
 */
export function buildDutyMonthOptions(lastMonthKey: string): DutyMonthOption[] {
    const [startYear, startMonth] = DUTY_COUNT_START_MONTH.split('-').map(Number);
    const baselineDate = new Date(startYear, startMonth - 2, 1);
    const options: DutyMonthOption[] = [{
        label: `${baselineDate.getFullYear()}년 ${baselineDate.getMonth() + 1}월까지 (누적 기준선)`,
        key: 'baseline',
        year: baselineDate.getFullYear(),
        month: baselineDate.getMonth() + 1
    }];
    let year = startYear;
    let month = startMonth;
    do {
        options.push({ label: `${year}년 ${month}월 (누적)`, key: toMonthKey(year, month), year, month });
        month++;
        if (month > 12) { month = 1; year++; }
    } while (toMonthKey(year, month) <= lastMonthKey);
    return options;
}

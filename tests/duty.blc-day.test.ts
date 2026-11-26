import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlcDayCalculator } from '../src/utils/duty/blcDayCalculator.ts';
import type { CalendarEvent } from '../src/types/calendar/calendar.type.ts';

// 이전 구현(하루씩 세며 매번 전체 일정을 훑음)을 그대로 옮긴 기준 구현
function naiveIsHoliday(events: CalendarEvent[], s: string) {
    return events.some(e => e.type === 'holiday' && e.holidayType !== 'duty' && s >= e.startDate && s <= e.endDate);
}
function toStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(s: string) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function naiveActiveDay(events: CalendarEvent[], day0: string, target: string, limit: number) {
    const start = parse(day0);
    const tgt = parse(target);
    if (start.getTime() === tgt.getTime()) return 0;
    if (tgt > start) {
        let c = 0;
        const cur = new Date(start);
        while (cur < tgt) {
            cur.setDate(cur.getDate() + 1);
            if (c < limit) {
                if (cur.getDay() !== 0 && !naiveIsHoliday(events, toStr(cur))) c++;
            } else c++;
        }
        return c;
    }
    return Math.round((tgt.getTime() - start.getTime()) / 86400000);
}
function naiveGraduation(events: CalendarEvent[], day0: string, limit: number) {
    const cur = parse(day0);
    let c = 0;
    while (c < limit) {
        cur.setDate(cur.getDate() + 1);
        if (cur.getDay() !== 0 && !naiveIsHoliday(events, toStr(cur))) c++;
    }
    return toStr(cur);
}

const ev = (p: Partial<CalendarEvent>) => p as CalendarEvent;
const events: CalendarEvent[] = [
    ev({ type: 'holiday', startDate: '2026-05-05', endDate: '2026-05-05' }),
    ev({ type: 'holiday', startDate: '2026-06-03', endDate: '2026-06-06' }),
    ev({ type: 'holiday', startDate: '2026-12-24', endDate: '2027-01-01' }),
    ev({ type: 'holiday', holidayType: 'duty', startDate: '2026-05-11', endDate: '2026-05-12' }), // 당직 휴일은 제외
];

test('BLC Day 번호가 이전 구현과 같다 (Day 0 전·후, 한도 이후 포함)', () => {
    const calc = createBlcDayCalculator(events);
    const day0s = ['2026-04-20', '2026-05-04', '2026-11-30'];
    for (const day0 of day0s) {
        for (const limit of [22, 30]) {
            const cur = parse('2026-03-01');
            while (toStr(cur) <= '2027-03-31') {
                const s = toStr(cur);
                assert.equal(calc.getBlcActiveDay(day0, s, limit), naiveActiveDay(events, day0, s, limit), `${day0} ${s} ${limit}`);
                cur.setDate(cur.getDate() + 1);
            }
        }
    }
});

test('BLC 수료일이 이전 구현과 같다', () => {
    const calc = createBlcDayCalculator(events);
    for (const day0 of ['2026-04-20', '2026-05-04', '2026-11-30', '2026-12-21']) {
        for (const limit of [22, 30]) {
            assert.equal(calc.getGraduationDate(day0, limit), naiveGraduation(events, day0, limit));
        }
    }
});

test('일반 휴일만 휴일로 본다', () => {
    const calc = createBlcDayCalculator(events);
    assert.equal(calc.isHolidayDate('2026-12-31'), true);
    assert.equal(calc.isHolidayDate('2026-05-11'), false);
    assert.equal(calc.isHolidayDate('2026-05-06'), false);
});

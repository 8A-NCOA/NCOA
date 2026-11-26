import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isCountedBeforeMonth,
    isCountedThroughMonth,
    buildDutyMonthOptions,
    monthKeyOfDate,
} from '../src/utils/duty/dutyMonths.ts';

test('2027년 1월 기준: 2026년 4~12월 당직이 누적에 포함된다', () => {
    assert.equal(isCountedBeforeMonth('2026-04-01', '2027-01'), true);
    assert.equal(isCountedBeforeMonth('2026-12-31', '2027-01'), true);
    assert.equal(isCountedBeforeMonth('2027-01-05', '2027-01'), false); // 이번 달은 제외
    assert.equal(isCountedBeforeMonth('2026-03-31', '2027-01'), false); // 기준선 이전은 제외
    assert.equal(isCountedBeforeMonth('2027-01-05', '2027-02'), true);
});

test('선택 월까지 포함 누적', () => {
    assert.equal(isCountedThroughMonth('2027-01-05', '2027-01'), true);
    assert.equal(isCountedThroughMonth('2027-02-01', '2027-01'), false);
    assert.equal(isCountedThroughMonth('2026-03-15', '2027-01'), false);
});

test('트래커 월 목록은 연도를 넘어 이어진다', () => {
    const opts = buildDutyMonthOptions('2027-02');
    assert.equal(opts[0].key, 'baseline');
    assert.equal(opts[0].label, '2026년 3월까지 (누적 기준선)');
    assert.equal(opts[1].key, '2026-04');
    assert.deepEqual(opts.slice(-3).map(o => o.key), ['2026-12', '2027-01', '2027-02']);
    assert.equal(opts.at(-1)?.label, '2027년 2월 (누적)');
});

test('월 키 생성', () => {
    assert.equal(monthKeyOfDate(new Date(2027, 0, 1)), '2027-01');
});

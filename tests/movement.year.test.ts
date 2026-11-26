import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestYearDate, rangeEndDate, toIsoDate } from '../src/utils/movement/movement.year.ts';

const ref = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

test('dates near New Year get the right year whether uploaded in December or January', () => {
    assert.equal(toIsoDate(nearestYearDate(12, 28, ref(2026, 12, 20))), '2026-12-28');
    assert.equal(toIsoDate(nearestYearDate(1, 3, ref(2026, 12, 20))), '2027-01-03');
    assert.equal(toIsoDate(nearestYearDate(12, 28, ref(2027, 1, 5))), '2026-12-28');
    assert.equal(toIsoDate(nearestYearDate(1, 3, ref(2027, 1, 5))), '2027-01-03');
    assert.equal(toIsoDate(nearestYearDate(9, 4, ref(2026, 9, 1))), '2026-09-04');
});

test('a range ending in January after a December start rolls into the next year', () => {
    const start = nearestYearDate(12, 28, ref(2026, 12, 20));
    assert.equal(toIsoDate(rangeEndDate(start, 1, 3)), '2027-01-03');
    assert.equal(toIsoDate(rangeEndDate(nearestYearDate(9, 4, ref(2026, 9, 1)), 9, 7)), '2026-09-07');
});

// ── 외특 타임라인 연도 결정 ──
import { createMdYearResolver, mdToIso } from '../src/utils/movement/movement.year.ts';

test('기준일 2026-12 에 1월 주차를 보면 2027년으로 계산한다', () => {
    const yearOf = createMdYearResolver(['1.6', '1.7', '1.12'], new Date(2026, 11, 20));
    assert.equal(mdToIso('1.6', yearOf), '2027-01-06');
    assert.equal(mdToIso('1.12', yearOf), '2027-01-12');
});

test('기준일 2027-01 에 해를 넘는 주차(12.30~1.5)를 보면 12월은 2026년, 1월은 2027년', () => {
    const yearOf = createMdYearResolver(['12.30', '12.31', '1.1', '1.5'], new Date(2027, 0, 3));
    assert.equal(mdToIso('12.30', yearOf), '2026-12-30');
    assert.equal(mdToIso('1.5', yearOf), '2027-01-05');
    // 타임라인 앞뒤 날짜(전날, 다음 주)도 이어진다
    assert.equal(mdToIso('12.29', yearOf), '2026-12-29');
    assert.equal(mdToIso('1.6', yearOf), '2027-01-06');
});

test('기준일 2027-01 에 12월 주차를 보면 2026년', () => {
    const yearOf = createMdYearResolver(['12.16', '12.22'], new Date(2027, 0, 5));
    assert.equal(mdToIso('12.16', yearOf), '2026-12-16');
});

test('평상시(같은 해)는 그대로', () => {
    const yearOf = createMdYearResolver(['11.18', '11.24'], new Date(2026, 10, 26));
    assert.equal(mdToIso('11.18', yearOf), '2026-11-18');
    assert.equal(createMdYearResolver([], new Date(2026, 10, 26))(1, 1), 2026);
});

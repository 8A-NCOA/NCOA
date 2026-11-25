import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    planRollover,
    ongoingBlockStart,
    contiguousDates,
    needsRollover,
    isoToSerial,
    serialToIso,
    endOfNextMonth,
    columnLetter,
} from '../functions/src/utils/sheetRollover.util.ts';

const row1Of = (startIso: string, n: number) => Array.from({ length: n }, (_, i) => isoToSerial(startIso) + i);

// 사용자 예시 (11/20~11/27, 오늘 11/25)
const DAYS = ['11.20', '11.21', '11.22', '11.23', '11.24', '11.25', '11.26', '11.27'];
const EXAMPLE: string[][] = [
    ['외박', '외박복귀', '당직', '', '', '', '', '외박출발'],
    ['외박복귀/휴가출발', '휴가', '휴가', '휴가', '휴가복귀', '', '', '외박출발'],
    ['외박출발', '외박', '외박', '외박', '외박복귀', '외박출발', '외박', '외박'],
    ['외박', '외박', '외박', '외박복귀', '', '외박출발', '외박', '외박'],
    ['외박', '외박', '외박복귀', '', '', '', '', '외박출발'],
    ['외박', '외박', '외박복귀', '', '', '', '', '외박출발'],
    ['당직', '외박출발', '외박', '외박', '외박복귀', '', '', ''],
    ['외박출발', '외박', '외박', '외박', '외박복귀', '', '', '외박출발'],
    ['외박출발', '외박', '외박', '외박복귀', '', '당직', '외박출발', '외박'],
    ['외박', '외박', '외박', '외박복귀', '', '외박출발', '외박', '외박'],
    ['외박', '외박', '외박복귀/휴가출발', '휴가', '휴가', '휴가복귀', '', ''],
    ['외박출발', '외박', '외박복귀', '', '', '외박출발', '외박', '외박'],
    ['휴가출발', '휴가', '휴가', '휴가', '휴가복귀', '외박출발', '외박', '외박'],
    ['', '당직', '외박출발', '외박', '외박복귀', '', '', ''],
    ['외박출발', '외박', '외박', '외박', '외박복귀', '외박출발', '외박복귀', '당직'],
    ['외박출발', '외박', '외박복귀', '', '', '외박출발', '외박', '외박'],
    ['외박출발', '외박', '외박복귀', '', '', '외박출발', '외박', '외박'],
];

test('date helpers', () => {
    assert.equal(serialToIso(46324), '2026-10-29');
    assert.equal(isoToSerial('2026-10-29'), 46324);
    assert.equal(endOfNextMonth('2026-11-25'), '2026-12-31');
    assert.equal(endOfNextMonth('2026-12-30'), '2027-01-31');
    assert.equal(columnLetter(0), 'A');
    assert.equal(columnLetter(36), 'AK');
    // 날짜가 끊기는 칸부터는 버린다 (테스트 시트 끝의 엉뚱한 날짜)
    assert.deepEqual(contiguousDates([...row1Of('2026-12-03', 2), 46230, 46231]), ['2026-12-03', '2026-12-04']);
});

test('rollover runs only when today is in the last 7 days of the sheet', () => {
    assert.equal(needsRollover('2026-11-30', '2026-11-23'), false);
    assert.equal(needsRollover('2026-11-30', '2026-11-24'), true);
    assert.equal(needsRollover('2026-11-30', '2026-11-30'), true);
});

test('ongoing block start: vacation returning today goes back to its 휴가출발, not the pass before it', () => {
    assert.equal(ongoingBlockStart(EXAMPLE[10], 5), 2);
    // 오늘 출발이나 빈 칸이면 오늘
    assert.equal(ongoingBlockStart(EXAMPLE[2], 5), 5);
    assert.equal(ongoingBlockStart(EXAMPLE[0], 5), 5);
    // 외박 중이면 외박출발 칸까지
    assert.equal(ongoingBlockStart(['', '외박출발', '외박', '외박복귀/휴가출발'], 3), 1);
    // 휴가 복귀일에 외박 출발: 휴가 블록 시작까지
    assert.equal(ongoingBlockStart(['휴가출발', '휴가', '휴가복귀/외박출발'], 2), 0);
    // 블록이 시트 첫 칸 앞에서 시작했으면 첫 칸
    assert.equal(ongoingBlockStart(['휴가', '휴가', '휴가복귀'], 2), 0);
});

test("the user's example: 11/22 becomes column B and only the 11/25 returnee's vacation is kept before today", () => {
    const row1 = row1Of('2026-11-20', 8);
    const plan = planRollover(row1, EXAMPLE, 9, '2026-11-25', { force: true });
    assert.equal(plan.apply, true);
    assert.equal(plan.startIso, '2026-11-22');
    assert.equal(plan.shift, 2);
    assert.equal(plan.dates[0], '2026-11-22');
    assert.equal(plan.dates[plan.dates.length - 1], '2026-12-31');
    assert.equal(plan.weekdays[0], '일요일');
    // 11/22~11/31: 40일 → 열 41개(A 포함) 필요, 지금 9개 → 32개 늘림
    assert.equal(plan.addColumns, 41 - 9);

    // 11/25 휴가 복귀자: 11/22부터 그대로
    assert.deepEqual(plan.cells[10].slice(0, 6), ['외박복귀/휴가출발', '휴가', '휴가', '휴가복귀', '', '']);
    // 다른 사람은 오늘 이전 칸이 모두 지워지고, 오늘 이후는 그대로
    assert.deepEqual(plan.cells[2].slice(0, 6), ['', '', '', '외박출발', '외박', '외박']);
    assert.deepEqual(plan.cells[8].slice(0, 6), ['', '', '', '당직', '외박출발', '외박']);
    assert.deepEqual(plan.cells[14].slice(0, 6), ['', '', '', '외박출발', '외박복귀', '당직']);
    // 원래 시트 뒤로 새로 생긴 날짜는 비어 있다
    assert.equal(plan.cells[2][6], '');
});

test('every value from today on is kept exactly, shifted left', () => {
    const row1 = row1Of('2026-11-20', 8);
    const plan = planRollover(row1, EXAMPLE, 9, '2026-11-25', { force: true });
    EXAMPLE.forEach((row, r) => {
        for (let src = 5; src < 8; src++) assert.equal(plan.cells[r][src - plan.shift], row[src]);
    });
});

test('nothing happens before the last week, or when today is not in the sheet', () => {
    const row1 = row1Of('2026-11-01', 30);
    assert.equal(planRollover(row1, [], 46, '2026-11-20').apply, false);
    assert.equal(planRollover(row1, [], 46, '2026-11-24').apply, true);
    assert.equal(planRollover(row1, [], 46, '2026-12-05').apply, false);
});

test('existing extra columns are filled with dates instead of being left empty', () => {
    // 11/01~11/30, 46열: 오늘 11/28, 진행 중인 블록 없음 → B열 11/28, 45칸 = 1/11까지
    const plan = planRollover(row1Of('2026-11-01', 30), [['외박']], 46, '2026-11-28');
    assert.equal(plan.startIso, '2026-11-28');
    assert.equal(plan.dates.length, 45);
    assert.equal(plan.dates[44], '2027-01-11');
    assert.equal(plan.addColumns, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSectionTableRows,
    formatMemoName,
    formatMemoRange,
    memberMatchesSectionFilter,
    renderSectionTable,
    toMemoLeaveReason,
    toMemoPassReason,
} from '../src/utils/movement/movement.section-table.ts';

const CORE_START = '2026-11-18';
const CORE_END = '2026-11-24';

test('section filters: BLC / KTA(+MEDIC) / HQ(+RSO)', () => {
    assert.equal(memberMatchesSectionFilter(['BLC'], 'BLC'), true);
    assert.equal(memberMatchesSectionFilter(['KTA'], 'KTA'), true);
    assert.equal(memberMatchesSectionFilter(['MEDIC'], 'KTA'), true);
    assert.equal(memberMatchesSectionFilter(['RSO'], 'HQ'), true);
    assert.equal(memberMatchesSectionFilter(['HQ', 'S3'], 'HQ'), true);
    assert.equal(memberMatchesSectionFilter(['S6'], 'HQ'), true);
    assert.equal(memberMatchesSectionFilter(['KTA'], 'HQ'), false);
    assert.equal(memberMatchesSectionFilter(['MEDIC'], 'BLC'), false);
});

test('memo name and date formats', () => {
    assert.equal(formatMemoName({ name: '강건', englishName: 'KANG GUNN', rankEnglish: 'SGT' }), 'Kang, Gunn');
    assert.equal(formatMemoName({ name: '박유찬', englishName: 'Park Yu Chan', rankEnglish: 'CPL' }), 'Park, Yu Chan');
    assert.equal(formatMemoName({ name: '신병', rankEnglish: 'PV2' }), '');
    assert.equal(formatMemoRange('2026-11-20', '2026-11-23'), '20 November ~ 23 November');
    assert.equal(formatMemoRange('2026-11-21', '2026-11-21'), '21 November');
});

test('pass reasons to memo wording', () => {
    assert.equal(toMemoPassReason('일반 투데이', 2), 'Weekend Pass');
    assert.equal(toMemoPassReason('토당으로 인한 일반 원데이', 1), 'Weekend Pass');
    assert.equal(toMemoPassReason("Veteran's Day 컴펜 포데이", 4), "Veteran's Day Compensation");
    assert.equal(toMemoPassReason('KTA/RSO 01-27기 수료 포데이', 4), 'RSO 01-27 Four Day Pass');
    assert.equal(toMemoPassReason('BLC 01-27기 수료 쓰리데이', 3), 'BLC 01-27 Three Day Pass');
    assert.equal(toMemoPassReason('생일 원데이', 1), 'Birthday Pass');
    assert.equal(toMemoPassReason("Veteran's Day 포데이", 4), "Veteran's Day Compensation");
    assert.equal(toMemoPassReason('Staff Duty 원데이', 1), 'Staff Duty Compensation');
    assert.equal(toMemoPassReason('01-27기 DBIDS 투데이', 2), '01-27 DBIDS Two Day Pass');
});

test('leave reasons to memo wording', () => {
    assert.equal(toMemoLeaveReason('연가 4일'), 'ROKA Leave');
    assert.equal(toMemoLeaveReason('교육유공 포상휴가 3일'), 'ROKA Leave');
});

test('builds pass and leave rows for one section, sorted by enlistment, rank, name', () => {
    const members = [
        { name: '최현민', englishName: 'CHOI HYEONMIN', rankEnglish: 'CPL', enlistmentDate: '2025-06-01', sections: ['RSO'] },
        { name: '강건', englishName: 'KANG GUNN', rankEnglish: 'SGT', enlistmentDate: '2025-01-01', sections: ['HQ', 'S1'] },
        { name: '김케이', englishName: 'KIM KAY', rankEnglish: 'SGT', enlistmentDate: '2025-01-01', sections: ['KTA'] },
        { name: '신병', rankEnglish: 'PV2', sections: ['S3'] },
    ];
    const movements = [
        { name: '최현민', type: 'pass', startDate: '2026-11-21', endDate: '2026-11-21', reason: '일반 투데이' },
        { name: '최현민', type: 'pass', startDate: '2026-11-23', endDate: '2026-11-23', reason: '일반 투데이' },
        { name: '강건', type: 'pass', startDate: '2026-11-20', endDate: '2026-11-23', reason: 'KTA/RSO 01-27기 수료 포데이' },
        { name: '강건', type: 'vacation', startDate: '2026-11-24', endDate: '2026-11-27', reason: '연가 4일' },
        { name: '김케이', type: 'pass', startDate: '2026-11-21', endDate: '2026-11-22', reason: '일반 투데이' },
        { name: '신병', type: 'pass', startDate: '2026-11-21', endDate: '2026-11-22', reason: '일반 투데이' },
        // 이번 기간 밖 (지난 기간에 시작)
        { name: '최현민', type: 'vacation', startDate: '2026-11-10', endDate: '2026-11-19', reason: '연가 10일' },
    ];
    const result = buildSectionTableRows(members, movements, 'HQ', CORE_START, CORE_END);
    assert.deepEqual(result.pass, [
        { rankName: 'SGT Kang, Gunn', dateApproved: '20 November ~ 23 November', reason: 'RSO 01-27 Four Day Pass' },
        { rankName: 'CPL Choi, Hyeonmin', dateApproved: '21 November, 23 November', reason: 'Weekend Pass' },
        { rankName: 'PV2', dateApproved: '21 November ~ 22 November', reason: 'Weekend Pass' },
    ]);
    assert.deepEqual(result.leave, [
        { rankName: 'SGT Kang, Gunn', dateApproved: '24 November ~ 27 November', reason: 'ROKA Leave' },
    ]);
});

test('linked leave starting the day after a pass ends (outside the core) is included', () => {
    const members = [{ name: '박', englishName: 'PARK SUBIN', rankEnglish: 'CPL', sections: ['BLC'] }];
    const movements = [
        { name: '박', type: 'pass', startDate: '2026-11-22', endDate: '2026-11-24', reason: '일반 쓰리데이' },
        { name: '박', type: 'vacation', startDate: '2026-11-25', endDate: '2026-11-28', reason: '연가 4일' },
    ];
    const result = buildSectionTableRows(members, movements, 'BLC', CORE_START, CORE_END);
    assert.equal(result.leave.length, 1);
});

test('render: separate PASS and LEAVE tables, empty message when nothing', () => {
    const rendered = renderSectionTable({
        pass: [{ rankName: 'SGT Kang, Gunn', dateApproved: '20 November', reason: 'Weekend Pass' }],
        leave: [],
    });
    assert.match(rendered.html, /PASS/);
    assert.doesNotMatch(rendered.html, /LEAVE/);
    assert.match(rendered.text, /SGT Kang, Gunn\t20 November\tWeekend Pass/);
    assert.match(renderSectionTable({ pass: [], leave: [] }).text, /No pass or leave/);
});

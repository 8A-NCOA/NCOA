/**
 * 섹션 패스지: 패스지 'Table'의 섹션별 보기 (BLC / KTA / HQ).
 * 메모 형식 표(Rank Name | Date approved | Reason)를 외박(PASS)과 휴가(LEAVE)로 나눠 만든다.
 *
 * 외부 의존성이 없는 순수 함수만 둔다 (tests/movement.section-table.test.ts).
 */
import { getTableSectionInfo } from './movement.table-order.ts';

export type SectionTableFilter = 'BLC' | 'KTA' | 'HQ';
export const SECTION_TABLE_FILTERS: SectionTableFilter[] = ['BLC', 'KTA', 'HQ'];

/** 보기별로 넣는 Table 주 섹션 (MEDIC은 KTA, RSO는 HQ와 함께) */
const FILTER_MAIN_SECTIONS: Record<SectionTableFilter, string[]> = {
    BLC: ['BLC'],
    KTA: ['KTA', 'MEDIC'],
    HQ: ['HQ', 'RSO'],
};

export function memberMatchesSectionFilter(sections: string[] | undefined | null, filter: SectionTableFilter): boolean {
    return FILTER_MAIN_SECTIONS[filter].includes(getTableSectionInfo(sections).mainSec);
}

export interface SectionTableMember {
    /** 출타 기록의 name과 같은 순수 이름 */
    name: string;
    englishName?: string;
    rankEnglish: string;
    enlistmentDate?: string;
    sections?: string[];
}

export interface SectionTableMovement {
    name: string;
    type: string;
    startDate: string;
    endDate: string;
    reason?: string;
}

export interface SectionTableRow {
    rankName: string;
    dateApproved: string;
    reason: string;
}

export interface SectionTableResult {
    pass: SectionTableRow[];
    leave: SectionTableRow[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const RANK_PRIORITY: Record<string, number> = { SGT: 1, CPL: 2, PFC: 3, PV2: 4, PVT: 5 };

/** '2026-11-20' → '20 November' */
export function formatMemoDate(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]}`;
}

/** 기간 하나: '20 November ~ 23 November', 하루면 '21 November' */
export function formatMemoRange(startIso: string, endIso: string): string {
    return startIso === endIso ? formatMemoDate(startIso) : `${formatMemoDate(startIso)} ~ ${formatMemoDate(endIso)}`;
}

function daysBetween(startIso: string, endIso: string): number {
    const s = Date.parse(`${startIso}T00:00:00Z`);
    const e = Date.parse(`${endIso}T00:00:00Z`);
    return Math.round((e - s) / 86400000) + 1;
}

/** 'KANG GUNN' → 'Kang, Gunn' / 'Park Yu Chan' → 'Park, Yu Chan'. 영문 이름이 없으면 한글 이름 (자리 이름 '신병'은 비움) */
export function formatMemoName(member: SectionTableMember): string {
    const english = (member.englishName || '').trim();
    if (english) {
        const title = english.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\s+/g, ' ');
        if (title.includes(',')) return title;
        const [last, ...rest] = title.split(' ');
        return rest.length ? `${last}, ${rest.join(' ')}` : last;
    }
    const name = (member.name || '').trim();
    return /(^|[\s/])신병$/.test(name) ? '' : name;
}

/** 이름 앞의 '~로 인한' 원인 부분과 끝의 일수 표현을 떼어 낸 사유 이름 */
function reasonBase(reason: string): string {
    let raw = (reason || '').trim().replace(/외휴연계\s*[OX]?/gi, '').trim();
    const idx = Math.max(raw.lastIndexOf('으로 인한'), raw.lastIndexOf('로 인한'));
    if (idx !== -1) raw = raw.slice(raw.indexOf('인한', idx) + 2).trim();
    return raw
        .replace(/\s*(?:\d+(?:\.\d+)?\s*(?:일|데이)|(?:원|투|쓰리|포|파이브|식스|세븐|에잇|나인|텐)\s*데이)\s*$/, '')
        .trim();
}

function dayPassWord(days: number): string {
    return `${NUMBER_WORDS[days] || days} Day Pass`;
}

/** 섹션 패스지에 쓰는 공식 당직 휴일 이름 */
export interface MemoHolidayNames {
    /** 이번 기간과 겹치는 공식 당직 휴일 */
    current: string[];
    /** 공식 당직 휴일 전체 (지난 휴일 포함) */
    all: string[];
}

const sameName = (a: string, b: string) =>
    a.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 외박 사유를 메모의 영문 Reason으로 바꾼다.
 * - '일반 투데이' → 'Weekend Pass'
 * - '생일 원데이' → 'Birthday Pass'
 * - 공식 당직 휴일:
 *   - 이번 기간 휴일 → 'Thanksgiving Day Four Day Pass'
 *   - 지난 휴일(또는 '컴펜'을 붙인 휴일) → "Veteran's Day Compensation"
 * - 그 밖의 사유(수료, DBIDS, Staff Duty 등)는 Compensation을 붙이지 않는다:
 *   'KTA/RSO 01-27기 수료 포데이' → 'RSO 01-27 Four Day Pass', 'Staff Duty 원데이' → 'Staff Duty One Day Pass'
 */
export function toMemoPassReason(reason: string | undefined, days: number, holidays: MemoHolidayNames = { current: [], all: [] }): string {
    const base = reasonBase(reason || '');
    if (!base || base === '일반') return 'Weekend Pass';
    if (base === '생일' || /^birthday$/i.test(base)) return 'Birthday Pass';

    const hasComp = /컴펜|compensation/i.test(base);
    const withoutComp = base.replace(/컴펜|compensation/gi, '').replace(/\s+/g, ' ').trim();
    const holiday = [...holidays.current, ...holidays.all].find(h => h && sameName(h, withoutComp));
    if (holiday) {
        const isCurrent = holidays.current.some(h => sameName(h, withoutComp));
        return isCurrent && !hasComp ? `${withoutComp} ${dayPassWord(days)}` : `${withoutComp} Compensation`;
    }

    const name = withoutComp
        .replace(/\s*수료\s*/g, ' ')
        .replace(/(\d{1,2}-\d{1,2})\s*기/g, '$1')
        .replace(/^KTA\/(RSO|PAO)\b/i, '$1')
        .replace(/^BLC\/S-?\d\b/i, 'BLC')
        .replace(/\s+/g, ' ')
        .trim();
    return name ? `${name} ${dayPassWord(days)}` : dayPassWord(days);
}

/** 휴가는 사유와 상관없이 모두 'ROKA Leave' */
export function toMemoLeaveReason(_reason?: string): string {
    return 'ROKA Leave';
}

function compareMembers(a: SectionTableMember, b: SectionTableMember): number {
    const ea = a.enlistmentDate || '';
    const eb = b.enlistmentDate || '';
    if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    const pa = RANK_PRIORITY[a.rankEnglish] || 99;
    const pb = RANK_PRIORITY[b.rankEnglish] || 99;
    if (pa !== pb) return pa - pb;
    return (a.englishName || a.name).localeCompare(b.englishName || b.name);
}

/**
 * 이번 기간(수~화)의 섹션별 외박/휴가 행.
 * - 외박: 시작일(첫 외박일)이 이번 기간 안인 기록. 같은 사유로 나눠 나간 외박은 한 줄에 '20 November, 23 November'로 묶는다.
 * - 휴가: 이번 주기 중 화면에 보이는 날짜(leaveStartIso~leaveEndIso, 없으면 주기 전체)와 하루라도 겹치는 기록.
 *   기간은 자르지 않고 전체를 쓴다 (긴 휴가는 여러 주기에 반복해서 나온다).
 * - 정렬: 입대일 → 계급 → 이름.
 */
export function buildSectionTableRows(
    members: SectionTableMember[],
    movements: SectionTableMovement[],
    filter: SectionTableFilter,
    coreStartIso: string,
    coreEndIso: string,
    leaveStartIso: string = coreStartIso,
    leaveEndIso: string = coreEndIso,
    /** 공식 당직 휴일 이름 (이번 기간 휴일은 'N Day Pass', 지난 휴일은 Compensation) */
    holidays: MemoHolidayNames = { current: [], all: [] }
): SectionTableResult {
    const inCore = (iso: string) => !!iso && iso >= coreStartIso && iso <= coreEndIso;
    const pass: SectionTableRow[] = [];
    const leave: SectionTableRow[] = [];

    members
        .filter(m => memberMatchesSectionFilter(m.sections, filter))
        .sort(compareMembers)
        .forEach(member => {
            const own = movements.filter(mov => mov.name === member.name);
            const passes = own
                .filter(mov => mov.type === 'pass' && inCore(mov.startDate))
                .sort((a, b) => a.startDate.localeCompare(b.startDate));
            const leaves = own
                .filter(mov => mov.type === 'vacation' && mov.startDate <= leaveEndIso && mov.endDate >= leaveStartIso)
                .sort((a, b) => a.startDate.localeCompare(b.startDate));

            const nameStr = formatMemoName(member);
            const rankName = nameStr ? `${member.rankEnglish} ${nameStr}` : member.rankEnglish;

            // 같은 사유로 나눠 나간 외박은 한 줄로
            const groups = new Map<string, SectionTableMovement[]>();
            passes.forEach(p => {
                const key = (p.reason || '').trim();
                groups.set(key, [...(groups.get(key) || []), p]);
            });
            groups.forEach(group => {
                const days = group.reduce((sum, p) => sum + daysBetween(p.startDate, p.endDate), 0);
                pass.push({
                    rankName,
                    dateApproved: group.map(p => formatMemoRange(p.startDate, p.endDate)).join(', '),
                    reason: toMemoPassReason(group[0].reason, days, holidays),
                });
            });

            leaves.forEach(v => {
                leave.push({
                    rankName,
                    dateApproved: formatMemoRange(v.startDate, v.endDate),
                    reason: toMemoLeaveReason(v.reason),
                });
            });
        });

    return { pass, leave };
}

const FONT = "font-family: Arial, 'Malgun Gothic', '맑은 고딕', sans-serif;";
const CELL = `border: 1px solid #000; padding: 0 0.05cm; text-align: center; white-space: nowrap; font-weight: normal; ${FONT}`;

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tableHtml(title: string, rows: SectionTableRow[]): string {
    let html = `<div style="${FONT} font-size: 12pt; font-weight: bold; margin: 0 0 0.1cm 0;">${title}</div>`;
    html += `<table style="border-collapse: collapse; ${FONT} font-size: 12pt; width: 16.5cm; min-width: 16.5cm; text-align: center;">`;
    html += `<thead><tr>`;
    html += `<td style="${CELL} width: 4.1cm;">Rank Name</td>`;
    html += `<td style="${CELL} width: 5.7cm;">Date approved</td>`;
    html += `<td style="${CELL} width: 6.7cm;">Reason</td>`;
    html += `</tr></thead><tbody>`;
    rows.forEach(r => {
        html += `<tr>`;
        html += `<td style="${CELL}">${escapeHtml(r.rankName)}</td>`;
        html += `<td style="${CELL}">${escapeHtml(r.dateApproved)}</td>`;
        html += `<td style="${CELL}">${escapeHtml(r.reason)}</td>`;
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    return html;
}

function tableText(title: string, rows: SectionTableRow[]): string {
    return [title, 'Rank Name\tDate approved\tReason', ...rows.map(r => `${r.rankName}\t${r.dateApproved}\t${r.reason}`)].join('\n');
}

/** 외박 표와 휴가 표를 위아래로. 없는 쪽은 뺀다. */
export function renderSectionTable(result: SectionTableResult): { html: string; text: string } {
    const parts: { title: string; rows: SectionTableRow[] }[] = [];
    if (result.pass.length) parts.push({ title: 'PASS', rows: result.pass });
    if (result.leave.length) parts.push({ title: 'LEAVE', rows: result.leave });
    if (parts.length === 0) {
        return {
            html: `<div style="${FONT} font-size: 12pt;">(No pass or leave this week)</div>`,
            text: '(No pass or leave this week)',
        };
    }
    return {
        html: parts.map(p => tableHtml(p.title, p.rows)).join('<br>'),
        text: parts.map(p => tableText(p.title, p.rows)).join('\n\n'),
    };
}

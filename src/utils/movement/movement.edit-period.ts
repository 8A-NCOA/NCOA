/**
 * 주간 출타 편집에서 "이번 기간이 가진 기록"을 정하고, 잔디 상태와 시트 셀 값을 계산하는 순수 함수.
 * (tests/movement.edit-period.test.ts)
 *
 * 주기 규칙 (외특 탭 카드, 편집 화면, 저장 서버, 패스지 섹션별 보기가 함께 쓴다)
 * - 외박(잔류): 첫 외박일(시작일)이 주기(수~화, 7일) 안에 있으면 그 주기 것. 휴가와 이어졌는지는 보지 않는다.
 * - 휴가: 주기 중 카드에 보이는 날짜와 하루라도 겹치면 그 주기에 휴가 전체를 보여 주고, 그 주기 편집 화면에서 고칠 수 있다.
 *   (긴 휴가는 여러 주기에 반복해서 보인다. 주기에 맞춰 자르지 않는다.)
 *
 * 날짜는 'YYYY-MM-DD', 시트/잔디 키는 'M.D'.
 */
import { addDaysIso } from './movement.edit-validation.ts';
import { composeSheetCell } from './movement.sheet-cell.ts';

export interface DateRange {
    start: string;
    end: string;
}

export interface PeriodWindow {
    /** 핵심 구간 시작 (수요일) */
    coreStart: string;
    /** 핵심 구간 끝 (다음 주 화요일) */
    coreEnd: string;
}

export function isoToMD(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}.${d}`;
}

/** start~end를 포함한 날짜 목록. 범위가 잘못되었거나 너무 길면(> maxDays) 빈 배열. */
export function eachIsoDate(start: string, end: string, maxDays = 120): string[] {
    if (!start || !end || start > end) return [];
    const out: string[] = [];
    let cur = start;
    while (cur && cur <= end && out.length < maxDays) {
        out.push(cur);
        cur = addDaysIso(cur, 1);
    }
    return out;
}

export function inRange(iso: string, range: DateRange | null | undefined): boolean {
    return !!range && iso >= range.start && iso <= range.end;
}

/** 외박이 차지하는 날: 출발일(시작 전날) ~ 복귀일 */
export function passOccupiedRange(pass: DateRange): DateRange {
    return { start: addDaysIso(pass.start, -1), end: pass.end };
}

/** 외휴연계: 외박 복귀일(또는 다음 날)에 휴가 출발 */
export function isPassToVacationLink(pass: DateRange, vac: DateRange): boolean {
    return vac.start === pass.end || vac.start === addDaysIso(pass.end, 1);
}

/** 외박(잔류)은 첫 외박일이 주기 안에 있으면 그 주기 것 */
export function passBelongsToPeriod(pass: DateRange, window: PeriodWindow): boolean {
    return pass.start >= window.coreStart && pass.start <= window.coreEnd;
}

/** 휴가는 주기와 하루라도 겹치면 그 주기에 보인다 */
export function vacationOverlapsPeriod(vac: DateRange, window: PeriodWindow): boolean {
    return vac.start <= window.coreEnd && vac.end >= window.coreStart;
}

export interface MovementDocLike {
    type: string;
    startDate: string;
    endDate: string;
}

/**
 * 대상자의 기록을 이번 주기 것(외박·잔류 + 겹치는 휴가)과 나머지(그대로 둠)로 나눈다.
 * 휴가는 겹치는 것이 여러 개일 수 있다 (편집 화면은 그중 하나를 골라 고친다).
 * vacationWindow: 휴가를 볼 범위 (주기 중 화면에 보이는 날짜). 없으면 주기 전체.
 */
export function splitMemberDocs<T extends MovementDocLike>(docs: T[], window: PeriodWindow, vacationWindow: PeriodWindow = window) {
    const ownPassDocs = docs
        .filter(d => (d.type === 'pass' || d.type === 'stay') && passBelongsToPeriod({ start: d.startDate, end: d.endDate }, window))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ownPass = ownPassDocs[0] || null;
    const ownVacDocs = docs
        .filter(d => d.type === 'vacation' && vacationOverlapsPeriod({ start: d.startDate, end: d.endDate }, vacationWindow))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const owned = new Set<T>([...ownPassDocs, ...ownVacDocs]);
    const retainedDocs = docs.filter(d => !owned.has(d));

    return { ownPass, ownPassDocs, ownVacDocs, retainedDocs };
}

/** 편집 화면이 처음 고를 휴가: 주기 안에서 시작하는 것, 없으면 가장 이른 것 */
export function defaultVacationDoc<T extends MovementDocLike>(vacDocs: T[], window: PeriodWindow): T | null {
    return vacDocs.find(v => v.startDate >= window.coreStart && v.startDate <= window.coreEnd) || vacDocs[0] || null;
}

/** 외박 기록이 둘 이상인데 사유가 서로 다르면 true (한 주기에 사유 다른 외박 두 번은 허용하지 않는다) */
export function hasConflictingPassReasons(passDocs: { type: string; reason?: string }[]): boolean {
    const reasons = new Set(passDocs.filter(d => d.type === 'pass').map(d => (d.reason || '').trim()));
    return reasons.size > 1;
}

/**
 * isMember(iso)가 참인 날이 이어진 구간 중 iso를 포함하는 것을 찾는다 (앞뒤로 최대 maxDays일).
 */
export function findRun(iso: string, isMember: (iso: string) => boolean, maxDays = 60): DateRange | null {
    if (!isMember(iso)) return null;
    let start = iso;
    let end = iso;
    for (let i = 0; i < maxDays; i++) {
        const prev = addDaysIso(start, -1);
        if (!isMember(prev)) break;
        start = prev;
    }
    for (let i = 0; i < maxDays; i++) {
        const next = addDaysIso(end, 1);
        if (!isMember(next)) break;
        end = next;
    }
    return { start, end };
}

/** 핵심 구간 안에서 시작하는 첫 번째 구간 (구간 시작이 핵심 구간 앞이면 이번 기간 것이 아님) */
export function findRunStartingInWindow(window: PeriodWindow, isMember: (iso: string) => boolean): DateRange | null {
    for (const iso of eachIsoDate(window.coreStart, window.coreEnd)) {
        if (!isMember(iso)) continue;
        const run = findRun(iso, isMember);
        if (run && run.start >= window.coreStart) return run;
    }
    return null;
}

export interface EditedState {
    hasPass: boolean;
    passStart: string;
    passEnd: string;
    hasVacation: boolean;
    vacationStart: string;
    vacationEnd: string;
    /** 당직을 피해 나눠 나가는 외박 구간들 (있으면 passStart~passEnd 대신 쓴다) */
    passSegments?: DateRange[];
}

function editedPass(s: EditedState): DateRange | null {
    return s.hasPass && s.passStart && s.passEnd && s.passStart <= s.passEnd ? { start: s.passStart, end: s.passEnd } : null;
}

/** 이번 기간 외박 구간들 (날짜순). 나누지 않으면 출발~복귀 하나. */
export function editedPasses(s: EditedState): DateRange[] {
    if (!s.hasPass) return [];
    if (s.passSegments && s.passSegments.length > 0) {
        return s.passSegments.filter(p => p.start && p.end && p.start <= p.end).sort((a, b) => a.start.localeCompare(b.start));
    }
    const one = editedPass(s);
    return one ? [one] : [];
}

function editedVacation(s: EditedState): DateRange | null {
    return s.hasVacation && s.vacationStart && s.vacationEnd && s.vacationStart <= s.vacationEnd
        ? { start: s.vacationStart, end: s.vacationEnd }
        : null;
}

export interface StatusContext extends EditedState {
    /** 편집 전 이번 기간 기록이 차지하던 날 (외박 출발일 포함). 새 값이 덮지 않으면 비운다. */
    ownedOriginalDates: string[];
    /** 다른 기간의 휴가 (그대로 둔다) */
    retainedVacations: DateRange[];
    /** 다른 기간의 외박 (그대로 둔다) */
    retainedPasses: DateRange[];
    isDutyOn: (iso: string) => boolean;
}

/**
 * 타임라인 각 날짜의 잔디 상태.
 * timeline: [{ md: '11.11', iso: '2026-11-11' }, ...], initial: 편집 전 상태 (키 'M.D')
 */
export function computeEditedDayStatuses(
    timeline: { md: string; iso: string }[],
    initial: Record<string, string>,
    ctx: StatusContext
): Record<string, string> {
    const out: Record<string, string> = { ...initial };
    const passes = editedPasses(ctx);
    const vac = editedVacation(ctx);
    const departDays = new Set(passes.map(p => addDaysIso(p.start, -1)));
    const isLinked = !!(vac && passes.some(p => p.end === vac.start));
    const owned = new Set(ctx.ownedOriginalDates);
    const vacationReturnDays = new Set<string>([
        ...(vac ? [vac.end] : []),
        ...ctx.retainedVacations.map(v => v.end)
    ]);

    for (const { md, iso } of timeline) {
        const initialStatus = initial[md] || 'none';
        const isPassDay = passes.some(p => inRange(iso, p));
        const isDepartDay = departDays.has(iso);
        const isVacDay = inRange(iso, vac);
        // 당직과 리커버리는 외박·휴가 입력과 상관없이 항상 잔디에 보인다 (당직과 겹치는 입력은 저장 시 검사로 막는다)
        const isDutyDay = initialStatus === 'duty' || ctx.isDutyOn(iso);
        const isRecoveryDay = !isDutyDay && (
            initialStatus === 'recovery' || initialStatus === 'recovery-pass-depart' || ctx.isDutyOn(addDaysIso(iso, -1))
        );

        if (isDutyDay) {
            out[md] = 'duty';
        } else if (isRecoveryDay) {
            // 리커버리 날이 외박 출발일이면 반반 잔디 (외특 탭 카드와 같은 규칙)
            out[md] = isDepartDay ? 'recovery-pass-depart' : 'recovery';
        } else if (isLinked && iso === vac!.start) {
            out[md] = 'linked';
        } else if (vacationReturnDays.has(iso) && (isDepartDay || passes.some(p => iso === p.start))) {
            out[md] = 'vacation-pass-depart';
        } else if (isVacDay) {
            out[md] = 'vacation';
        } else if (isPassDay) {
            out[md] = 'pass';
        } else if (isDepartDay) {
            out[md] = 'pass-depart';
        } else if (owned.has(iso)) {
            // 원래 이번 기간 기록이었는데 이제 덮이지 않는 날: 다른 기간 기록에 속하면 그 상태로, 아니면 비움
            if (ctx.retainedVacations.some(v => inRange(iso, v))) out[md] = 'vacation';
            else if (ctx.retainedPasses.some(p => inRange(iso, p))) out[md] = 'pass';
            else if (ctx.retainedPasses.some(p => iso === addDaysIso(p.start, -1))) out[md] = 'pass-depart';
            else out[md] = 'none';
        } else {
            out[md] = initialStatus;
        }
    }
    return out;
}

/**
 * 외박 일수 감소 사유로 고른 당직 날에 시트 '당직'을 채운다.
 * 그날 외박·휴가 값을 쓰는 칸은 그대로 두고, 비우는 칸이거나 쓰지 않던 칸만 '당직'으로 바꾼다.
 */
export function withDutyCells(cells: Record<string, string>, dutyIsoDates: string[]): Record<string, string> {
    const out = { ...cells };
    dutyIsoDates.forEach(iso => {
        const md = isoToMD(iso);
        if (!out[md]) out[md] = '당직';
    });
    return out;
}

export interface CellUpdateContext extends StatusContext {
    allowVacationPassLink: boolean;
}

function vacationCellValue(iso: string, v: DateRange, linkedStart: boolean): string {
    // 출발일: 외휴연계면 '외박복귀/휴가출발', 당일 휴가면 '휴가출발/휴가복귀' (둘 다면 '외박복귀/휴가출발/휴가복귀')
    if (iso === v.start) return composeSheetCell({ passReturn: linkedStart, vacationDepart: true, vacationReturn: v.start === v.end }, false);
    if (iso === v.end) return '휴가복귀';
    return '휴가';
}

/**
 * 시트에 쓸 셀 값 (키 'M.D'). 백엔드는 이 키에 해당하는 날짜 열만 고친다.
 * 원래 이번 기간 기록이 차지하던 날은 핵심 구간 밖(타임라인 뒤쪽, 다음 주)이라도 새 값이 없으면 비운다.
 */
export function buildCellUpdates(ctx: CellUpdateContext): Record<string, string> {
    const cells: Record<string, string> = {};
    const passes = editedPasses(ctx);
    const vac = editedVacation(ctx);
    const isLinked = !!(vac && passes.some(p => p.end === vac.start));

    // 1. 원래 차지하던 날 중 새 값이 덮지 않는 날 비우기 (다른 기간 기록에 속하면 그 값으로 되돌림)
    for (const iso of ctx.ownedOriginalDates) {
        const coveredByPass = passes.some(p => inRange(iso, passOccupiedRange(p)));
        const coveredByVac = inRange(iso, vac);
        if (coveredByPass || coveredByVac) continue;

        const md = isoToMD(iso);
        const retainedVac = ctx.retainedVacations.find(v => inRange(iso, v));
        const retainedPass = ctx.retainedPasses.find(p => inRange(iso, passOccupiedRange(p)));
        if (retainedVac) {
            cells[md] = vacationCellValue(iso, retainedVac, ctx.retainedPasses.some(p => p.end === retainedVac.start));
        } else if (retainedPass) {
            cells[md] = iso === addDaysIso(retainedPass.start, -1) ? '외박출발' : iso === retainedPass.end ? '외박복귀' : '외박';
        } else if (ctx.isDutyOn(iso)) {
            cells[md] = '당직';
        } else {
            cells[md] = '';
        }
    }

    // 2. 새 외박 (나눠 나가면 구간마다)
    const otherPasses = (self: DateRange) => [...ctx.retainedPasses, ...passes.filter(p => p !== self)];
    for (const pass of passes) {
        const passDepart = addDaysIso(pass.start, -1);
        const linkedHere = !!(vac && pass.end === vac.start);
        // 다른 외박(다른 기간 또는 앞 구간)이 출발일에 복귀하면 '외박복귀/외박출발'
        cells[isoToMD(passDepart)] = composeSheetCell({ passReturn: otherPasses(pass).some(p => p.end === passDepart), passDepart: true }, false);
        for (const iso of eachIsoDate(pass.start, pass.end)) {
            if (iso !== pass.end) {
                cells[isoToMD(iso)] = '외박';
                continue;
            }
            // 복귀일: 외휴연계면 휴가출발까지(당일 휴가면 휴가복귀까지), 다음 외박이 그날 출발하면 외박출발까지 함께 적는다
            cells[isoToMD(iso)] = composeSheetCell({
                passReturn: true,
                vacationDepart: linkedHere,
                vacationReturn: linkedHere && vac!.start === vac!.end,
                passDepart: !linkedHere && otherPasses(pass).some(p => addDaysIso(p.start, -1) === iso),
            }, false);
        }
    }

    // 3. 새 휴가
    if (vac) {
        for (const iso of eachIsoDate(vac.start, vac.end)) {
            if (iso === vac.start && isLinked) continue; // 외박 복귀일 칸('외박복귀/휴가출발')을 그대로 둔다
            cells[isoToMD(iso)] = vacationCellValue(iso, vac, false);
        }
    }

    // 4. 휴외연계: 휴가 복귀일에 외박 출발 (이번 기간 휴가 또는 다른 기간 휴가). 나눠 나가면 첫 구간 기준.
    const pass = passes[0];
    if (pass) {
        const passDepart = addDaysIso(pass.start, -1);
        const vacations = [...(vac ? [vac] : []), ...ctx.retainedVacations];
        const returning = vacations.find(v => v.end === pass.start) || vacations.find(v => v.end === passDepart);
        if (returning) {
            const departCell = returning.end;
            // 휴가복귀/외박출발 (허용이면 '휴가복귀(연계)/외박출발'), 당일 휴가면 '휴가출발/휴가복귀/외박출발'
            cells[isoToMD(departCell)] = composeSheetCell(
                { vacationDepart: returning.start === returning.end, vacationReturn: true, passDepart: true },
                ctx.allowVacationPassLink,
            );
        }
    }

    return cells;
}

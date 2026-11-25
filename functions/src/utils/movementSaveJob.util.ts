/**
 * 주간 출타 저장 요청(movement_save_jobs) 처리에 쓰는 순수 함수.
 * 외부 의존성이 없어 앱 쪽 단위 테스트(tests/movement.save-job.test.ts)에서 바로 불러 쓴다.
 *
 * 주기 규칙은 앱의 src/utils/movement/movement.edit-period.ts와 같다.
 * - 외박(잔류): 첫 외박일이 주기(수~화) 안에 있으면 그 주기 것.
 * - 휴가: 주기와 겹치면 그 주기에서 고칠 수 있다. 편집 화면은 그중 하나(vacationTargetId)만 고치고, 나머지 휴가는 건드리지 않는다.
 */

export interface PeriodWindow {
    coreStart: string;
    coreEnd: string;
}

export interface PassRecordInput {
    type: "pass" | "stay";
    startDate: string;
    endDate: string;
    reason: string;
}

export interface VacationRecordInput {
    startDate: string;
    endDate: string;
    reason: string;
}

/** 앱이 movement_save_jobs에 쓰는 요청 내용 */
export interface MovementSaveJobData {
    memberName: string;
    label?: string;
    periodWindow: PeriodWindow;
    /** null이면 이번 기간 외박(잔류) 기록을 지운다 */
    pass: PassRecordInput | null;
    /** 당직을 피해 나눠 나가는 외박 (구간마다 기록 하나, 사유는 같음). 있으면 pass 대신 쓴다 */
    passes?: PassRecordInput[];
    /** 고친 휴가. null이면 vacationTargetId 휴가를 지운다 */
    vacation: VacationRecordInput | null;
    /**
     * 편집 화면이 고른 휴가 기록 id (null이면 새 휴가).
     * 없으면(예전 앱) 예전 규칙대로 이번 기간 휴가를 하나로 맞춘다.
     */
    vacationTargetId?: string | null;
    sheet: {
        dayStatuses: Record<string, string>;
        cellUpdates: Record<string, string>;
    };
    /** 시트에 행이 아직 없는 신병의 인원 id (deferSheet와 함께) */
    memberId?: string;
    /** true면 시트에 쓰지 않고 인원 문서에 모아 둔다 (신병 정보가 채워지면 시트에 반영) */
    deferSheet?: boolean;
    status: "pending" | "running" | "done" | "failed";
    done?: { firestore?: boolean; sheet?: boolean };
    attempts?: number;
}

export interface MovementDoc {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
}

export function addDaysIso(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
}

function isPassToVacationLink(pass: { start: string; end: string }, vacStart: string): boolean {
    return vacStart === pass.end || vacStart === addDaysIso(pass.end, 1);
}


/** 대상자의 기록 중 이번 주기 외박(잔류)과 주기에 겹치는 휴가 (앱의 splitMemberDocs와 같은 규칙) */
export function splitPeriodDocs(docs: MovementDoc[], window: PeriodWindow) {
    const inCore = (iso: string) => iso >= window.coreStart && iso <= window.coreEnd;
    const ownPassDocs = docs
        .filter((d) => (d.type === "pass" || d.type === "stay") && inCore(d.startDate))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ownPass = ownPassDocs[0] || null;
    const ownVacDocs = docs
        .filter((d) => d.type === "vacation" && d.startDate <= window.coreEnd && d.endDate >= window.coreStart)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return { ownPass, ownPassDocs, ownVacDocs };
}

/** 예전 앱 요청(vacationTargetId 없음)용: 시작일이 주기 안이거나 이번 주기 외박에 이어지는 휴가 */
function legacyOwnVacDocs(docs: MovementDoc[], window: PeriodWindow, ownPassDocs: MovementDoc[]) {
    const inCore = (iso: string) => iso >= window.coreStart && iso <= window.coreEnd;
    const passRanges = ownPassDocs.map((d) => ({ start: d.startDate, end: d.endDate }));
    const linked = (vacStart: string) => passRanges.some((r) => isPassToVacationLink(r, vacStart));
    const vacs = docs
        .filter((d) => d.type === "vacation" && (linked(d.startDate) || inCore(d.startDate)))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return { vacs, main: vacs.find((v) => linked(v.startDate)) || vacs[0] || null };
}

export interface MovementWritePlan {
    updates: { id: string; data: Record<string, unknown> }[];
    creates: Record<string, unknown>[];
    deletes: string[];
}

/**
 * 요청대로 이번 주기 문서를 맞추려면 무엇을 고치고/만들고/지울지.
 * 같은 요청을 두 번 처리해도 결과가 같다 (처음에 만든 문서를 두 번째에는 고친다).
 */
export function planMovementWrites(
    existing: MovementDoc[],
    job: Pick<MovementSaveJobData, "memberName" | "periodWindow" | "pass" | "passes" | "vacation" | "vacationTargetId">,
): MovementWritePlan {
    const split = splitPeriodDocs(existing, job.periodWindow);
    const plan: MovementWritePlan = { updates: [], creates: [], deletes: [] };

    // 외박(잔류) 기록: 나눠 나가면 여러 개. 기존 문서를 날짜순으로 앞에서부터 고치고, 모자라면 만들고, 남으면 지운다.
    const passes = job.passes && job.passes.length > 0 ? [...job.passes].sort((a, b) => a.startDate.localeCompare(b.startDate)) : job.pass ? [job.pass] : [];
    passes.forEach((p, i) => {
        const data = { type: p.type, startDate: p.startDate, endDate: p.endDate, reason: p.reason };
        const doc = split.ownPassDocs[i];
        if (doc) plan.updates.push({ id: doc.id, data });
        else plan.creates.push({ name: job.memberName, ...data });
    });
    split.ownPassDocs.slice(passes.length).forEach((d) => plan.deletes.push(d.id));

    const vacData = job.vacation
        ? { startDate: job.vacation.startDate, endDate: job.vacation.endDate, reason: job.vacation.reason }
        : null;

    if (job.vacationTargetId !== undefined) {
        // 고른 휴가 하나만 고치거나 지운다. 같은 요청을 다시 처리할 때를 위해, 대상이 없으면 같은 날짜의 휴가를 찾는다.
        const target = (job.vacationTargetId && existing.find((d) => d.id === job.vacationTargetId && d.type === "vacation"))
            || (vacData && existing.find((d) => d.type === "vacation" && d.startDate === vacData.startDate && d.endDate === vacData.endDate))
            || null;
        if (vacData) {
            if (target) plan.updates.push({ id: target.id, data: vacData });
            else plan.creates.push({ name: job.memberName, type: "vacation", ...vacData });
        } else if (target) {
            plan.deletes.push(target.id);
        }
        return plan;
    }

    // 예전 앱 요청
    const legacy = legacyOwnVacDocs(existing, job.periodWindow, split.ownPassDocs);
    if (vacData) {
        if (legacy.main) plan.updates.push({ id: legacy.main.id, data: vacData });
        else plan.creates.push({ name: job.memberName, type: "vacation", ...vacData });
        legacy.vacs.forEach((d) => { if (!legacy.main || d.id !== legacy.main.id) plan.deletes.push(d.id); });
    } else {
        legacy.vacs.forEach((d) => plan.deletes.push(d.id));
    }
    return plan;
}

import { getRankDetails } from '../lib/rankUtils';
import type { MovementRecord } from '../types/movement/movement.type';

/**
 * Extracts the day count (number) from a given reason string.
 * Supports patterns like "쓰리데이", "3일", "포데이", "4.5일", "원데이" etc.
 */
export function extractDayCountFromText(reasonStr: string | undefined | null): number | null {
    if (!reasonStr) return null;
    const clean = reasonStr.trim().toLowerCase();
    
    // Match numeric days like "3일", "4.5일", "4 데이", "3.5데이"
    const numericMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:데이|일)/);
    if (numericMatch) {
        return parseFloat(numericMatch[1]);
    }
    
    // Match Korean day words
    const textDayMap: Record<string, number> = {
        '원': 1, 'one': 1,
        '투': 2, 'two': 2,
        '쓰리': 3, 'three': 3,
        '포': 4, 'four': 4,
        '파이브': 5, 'five': 5,
        '식스': 6, 'six': 6,
        '세븐': 7, 'seven': 7,
        '에잇': 8, 'eight': 8,
        '나인': 9, 'nine': 9,
        '텐': 10, 'ten': 10
    };
    
    for (const [key, val] of Object.entries(textDayMap)) {
        if (clean.includes(`${key}데이`) || clean.includes(`${key} 데이`)) {
            return val;
        }
    }
    
    return null;
}

/**
 * 다양한 형식으로 저장된 이름(예: '일병 2호봉 심규서', '일병 심규서', '심규서', '이병 3호봉 박세환')에서
 * 순수 부대원 이름('심규서', '박세환')을 정확하게 추출합니다.
 */
export function extractPureMemberName(rawStr: string | undefined | null): string {
    if (!rawStr) return '';
    let s = String(rawStr).trim();

    // 1. 괄호 내용 제거 (예: (금당), (토당), (원데이) 등)
    s = s.replace(/\([^\)]*\)/g, '').trim();

    // 2. 당직 키워드 제거
    s = s.replace(/당직.*/g, '').trim();

    // 3. 계급 접두사 제거
    s = s.replace(/^(병장|상병|일병|이병|SGT|CPL|PFC|PV2|PVT)\s*/i, '').trim();

    // 4. 호봉 접두사 제거 (예: 1호봉, 2호봉, 12호봉 등)
    s = s.replace(/^\d+호봉\s*/, '').trim();

    // 5. 호봉 뒤에 계급이 남거나 순서가 바뀐 경우 대비 재제거
    s = s.replace(/^(병장|상병|일병|이병|SGT|CPL|PFC|PV2|PVT)\s*/i, '').trim();

    // 6. 기타 특수기호 정리
    s = s.replace(/[^\w\s가-힣]/g, '').trim();

    // 7. 한글 이름 (2~5자) 매칭
    const match = s.match(/[가-힣]{2,5}$/);
    if (match) return match[0];

    return s.trim();
}

/**
 * 외특 탭의 특정 주차 타임라인에 맞추어, 캘린더 당직 일정(dutySchedules)을 실시간으로 읽어와
 * 스프레드시트는 변경하지 않고 외특 탭 화면 표시용 dataList에 당직('duty') 및 회복('recovery') 상태를 합성합니다.
 */
export function applyDutySchedulesToDataList(
    dataList: { name: string; dayStatuses: Record<string, string> }[],
    timeline: string[],
    dutySchedules: any[],
    dbMembers: any[],
    baseDate?: Date,
    sheetWeeks?: any[]
): { name: string; dayStatuses: Record<string, string> }[] {
    if (!timeline || timeline.length === 0 || !dutySchedules || dutySchedules.length === 0) {
        return dataList;
    }

    const currentYear = baseDate ? baseDate.getFullYear() : new Date().getFullYear();

    // 1. 타임라인의 각 날짜 문자열("M.D")을 ISO ("YYYY-MM-DD")로 매핑
    const timelineIsoMap = new Map<string, string>();
    timeline.forEach(dateStr => {
        const [m, d] = dateStr.split('.').map(Number);
        if (!isNaN(m) && !isNaN(d)) {
            const iso = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            timelineIsoMap.set(dateStr, iso);
        }
    });

    // 2. 기존 dataList를 깊은 복사하여 원본을 보존
    const resultList = dataList.map(item => ({
        name: item.name,
        dayStatuses: { ...item.dayStatuses }
    }));

    // 순수 이름 및 ID -> resultList 항목 매핑
    const memberEntryMap = new Map<string, { name: string; dayStatuses: Record<string, string> }>();
    resultList.forEach(item => {
        const pureName = extractPureMemberName(item.name);
        if (pureName) {
            memberEntryMap.set(pureName, item);
            const matchedDb = dbMembers.find((m: any) => m.name === pureName);
            if (matchedDb?.id) {
                memberEntryMap.set(matchedDb.id, item);
            }
        }
    });

    // 3. 현재 표시 중인 주(timeline)의 날짜들에 한해서 당직자 조회 및 반영
    timeline.forEach((dateStr, tIdx) => {
        const targetIso = timelineIsoMap.get(dateStr);
        if (!targetIso) return;

        const dutiesOnDate = dutySchedules.filter((s: any) =>
            (s.type === 'duty' || !s.type) && s.startDate === targetIso
        );

        dutiesOnDate.forEach((duty: any) => {
            if (!duty || !duty.memo) return;
            const pureName = extractPureMemberName(duty.memo);
            if (!pureName) return;

            // 당직 플래너의 데이터로부터 대응되는 부대원 객체 식별 (memberId 우선 매핑)
            const matchedDbMember = duty.memberId
                ? dbMembers.find((m: any) => m.id === duty.memberId)
                : dbMembers.find((m: any) => m.name === pureName);

            // 해당 부대원이 기존 목록에 있는지 확인 (ID 우선, 없으면 순수 이름)
            let entry = (duty.memberId ? memberEntryMap.get(duty.memberId) : null) || memberEntryMap.get(pureName);

            if (!entry) {
                // 이번 주 출타가 없어 시트 목록에 없던 당직자인 경우 새로운 행 생성
                // 시트와 동일한 형식("[순수 계급] [이름]", 예: "병장 최인성", "상병 강민")으로 표시
                let pureRank = '';
                if (matchedDbMember?.enlistmentDate) {
                    const dutyDate = new Date(`${targetIso}T12:00:00`);
                    const rankInfo = getRankDetails(
                        new Date(matchedDbMember.enlistmentDate),
                        dutyDate,
                        matchedDbMember.earlyPromotion || 0
                    );
                    pureRank = rankInfo.rank;
                } else if (matchedDbMember?.rank) {
                    pureRank = matchedDbMember.rank.replace(/\s*\d+호봉/, '').trim();
                }

                const displayName = pureRank ? `${pureRank} ${pureName}` : pureName;

                entry = {
                    name: displayName,
                    dayStatuses: {}
                };
                resultList.push(entry);
                if (matchedDbMember?.id) {
                    memberEntryMap.set(matchedDbMember.id, entry);
                }
                memberEntryMap.set(pureName, entry);
            }

            // 당직일 설정
            entry.dayStatuses[dateStr] = 'duty';

            // 익일 회복일 설정
            const nextIdx = tIdx + 1;
            if (nextIdx < timeline.length) {
                const nextDateStr = timeline[nextIdx];
                const currentNextStatus = entry.dayStatuses[nextDateStr] || 'none';
                if (currentNextStatus === 'pass-depart' || currentNextStatus === 'pass') {
                    entry.dayStatuses[nextDateStr] = 'recovery-pass-depart';
                } else if (currentNextStatus === 'none') {
                    entry.dayStatuses[nextDateStr] = 'recovery';
                }
            }
        });
    });

    // 4. 타임라인 시작일(timeline[0]) 바로 전날에 당직이었던 인원의 당일 회복일('recovery') 반영
    const firstDateStr = timeline[0];
    const [firstM, firstD] = firstDateStr.split('.').map(Number);
    if (!isNaN(firstM) && !isNaN(firstD)) {
        const prevDate = new Date(currentYear, firstM - 1, firstD - 1, 12, 0, 0, 0);
        const prevIso = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
        const prevDateMD = `${prevDate.getMonth() + 1}.${prevDate.getDate()}`;

        // 4-1) dutySchedules 에서 전날 당직자 확인
        const dutiesOnPrevDate = dutySchedules.filter((s: any) =>
            (s.type === 'duty' || !s.type) && s.startDate === prevIso
        );

        dutiesOnPrevDate.forEach((duty: any) => {
            if (!duty || !duty.memo) return;
            const pureName = extractPureMemberName(duty.memo);
            if (!pureName) return;

            const matchedDbMember = duty.memberId
                ? dbMembers.find((m: any) => m.id === duty.memberId)
                : dbMembers.find((m: any) => m.name === pureName);

            let entry = (duty.memberId ? memberEntryMap.get(duty.memberId) : null) || memberEntryMap.get(pureName);

            if (!entry) {
                let pureRank = '';
                if (matchedDbMember?.enlistmentDate) {
                    const dutyDate = new Date(`${prevIso}T12:00:00`);
                    const rankInfo = getRankDetails(
                        new Date(matchedDbMember.enlistmentDate),
                        dutyDate,
                        matchedDbMember.earlyPromotion || 0
                    );
                    pureRank = rankInfo.rank;
                } else if (matchedDbMember?.rank) {
                    pureRank = matchedDbMember.rank.replace(/\s*\d+호봉/, '').trim();
                }

                const displayName = pureRank ? `${pureRank} ${pureName}` : pureName;

                entry = {
                    name: displayName,
                    dayStatuses: {}
                };
                resultList.push(entry);
                if (matchedDbMember?.id) {
                    memberEntryMap.set(matchedDbMember.id, entry);
                }
                memberEntryMap.set(pureName, entry);
            }

            const currentStatus = entry.dayStatuses[firstDateStr] || 'none';
            if (currentStatus === 'pass-depart' || currentStatus === 'pass') {
                entry.dayStatuses[firstDateStr] = 'recovery-pass-depart';
            } else if (currentStatus === 'none') {
                entry.dayStatuses[firstDateStr] = 'recovery';
            }
        });

        // 4-2) sheetWeeks 가 전달된 경우 시트 상에서 전날 당직이었던 인원도 확인
        if (sheetWeeks && sheetWeeks.length > 0) {
            resultList.forEach(entry => {
                const pureName = extractPureMemberName(entry.name);
                if (!pureName) return;

                let wasDutyInSheet = false;
                for (const week of sheetWeeks) {
                    if (week.data && Array.isArray(week.data)) {
                        const row = week.data.find((r: any) => extractPureMemberName(r.name) === pureName);
                        if (row?.dayStatuses?.[prevDateMD] === 'duty') {
                            wasDutyInSheet = true;
                            break;
                        }
                    }
                }

                if (wasDutyInSheet) {
                    const currentStatus = entry.dayStatuses[firstDateStr] || 'none';
                    if (currentStatus === 'pass-depart' || currentStatus === 'pass') {
                        entry.dayStatuses[firstDateStr] = 'recovery-pass-depart';
                    } else if (currentStatus === 'none') {
                        entry.dayStatuses[firstDateStr] = 'recovery';
                    }
                }
            });
        }
    }

    return resultList;
}

/**
 * Converts "M.D" date string to "YYYY-MM-DD" based on baseYear,
 * handling year transitions if referenceMonth is provided.
 */
export function formatMDToISO(dateStr: string, baseYear: number, referenceMonth?: number): string {
    const parts = dateStr.split('.');
    if (parts.length < 2) return '';
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    let year = baseYear;
    if (referenceMonth !== undefined) {
        if (referenceMonth === 12 && m === 1) year += 1;
        else if (referenceMonth === 1 && m === 12) year -= 1;
    }
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 화면 타임라인(시트 주차)에서 주기(수~화, 7일)를 구한다.
 * 시트 주차가 수요일에 시작하지 않는 경우(예: 11.20(금)~11.27(금))가 있으므로 타임라인 앞 7일을 쓰지 않고,
 * 타임라인의 첫 토요일이 들어 있는 수~화를 주기로 본다. 토요일이 없으면 첫 날짜가 들어 있는 수~화.
 * coreMDs에는 타임라인에 없는 날짜도 들어 있다 (예: 11.18, 11.19).
 */
export function getCoreWindow(timeline: string[], currentYear: number): {
    coreStartIso: string;
    coreEndIso: string;
    coreMDs: string[];
    /** 주기 중 카드(타임라인)에 보이는 날짜 범위. 휴가는 이 범위와 겹칠 때만 보인다. */
    visibleStartIso: string;
    visibleEndIso: string;
} {
    if (!timeline || timeline.length === 0) return { coreStartIso: '', coreEndIso: '', coreMDs: [], visibleStartIso: '', visibleEndIso: '' };
    const refMonth = parseInt(timeline[0].split('.')[0], 10);
    const isoDates = timeline.map(md => formatMDToISO(md, currentYear, refMonth));
    const toDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
    const toIso = (date: Date) => date.toISOString().slice(0, 10);
    const saturday = isoDates.find(iso => toDate(iso).getUTCDay() === 6);
    const anchorDate = toDate(saturday || isoDates[0]);
    const start = new Date(anchorDate);
    start.setUTCDate(start.getUTCDate() - ((anchorDate.getUTCDay() - 3 + 7) % 7));
    const coreMDs: string[] = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + i);
        coreMDs.push(`${d.getUTCMonth() + 1}.${d.getUTCDate()}`);
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    const coreStartIso = toIso(start);
    const coreEndIso = toIso(end);
    const visibleStartIso = isoDates[0] > coreStartIso ? isoDates[0] : coreStartIso;
    const visibleEndIso = isoDates[isoDates.length - 1] < coreEndIso ? isoDates[isoDates.length - 1] : coreEndIso;
    return { coreStartIso, coreEndIso, coreMDs, visibleStartIso, visibleEndIso };
}

/**
 * Checks if a pass or stay movement falls within the period's core window:
 * "수요일부터 다음주 화요일 사이에 있는 외박"
 * Core window: timeline[0] (수요일) ~ timeline[6] (다음주 화요일)
 */
export function isPassInPeriod(mov: MovementRecord, coreStartIso: string, coreEndIso: string): boolean {
    if (mov.type !== 'pass' && mov.type !== 'stay') return false;
    // 첫 외박일(시작일)이 주기(수~화) 안에 있으면 그 주기 외박이다. 휴가와 이어졌는지는 보지 않는다.
    return mov.startDate >= coreStartIso && mov.startDate <= coreEndIso;
}

/**
 * 이번 주기(수~화)의 외박과 휴가 (외특 탭 카드·툴팁):
 * 1. 외박(잔류): 첫 외박일이 주기 안에 있는 것
 * 2. 휴가: 주기 중 카드에 보이는 날짜와 하루라도 겹치는 것 (긴 휴가는 여러 주기에 반복해서 보인다. 기간은 자르지 않는다)
 * 규칙은 편집 화면과 같다 (utils/movement/movement.edit-period.ts).
 */
export function getPeriodMovementsForMember(
    cleanName: string,
    timeline: string[],
    currentYear: number,
    allMovements: MovementRecord[],
    _dayStatuses?: Record<string, string>
): {
    thisPeriodPass: MovementRecord | null;
    thisPeriodVacation: MovementRecord | null;
    allPeriodMovements: MovementRecord[];
} {
    const memberMovements = allMovements.filter(m => m.name === cleanName);
    if (!timeline || timeline.length === 0) {
        return { thisPeriodPass: null, thisPeriodVacation: null, allPeriodMovements: [] };
    }

    const { coreStartIso, coreEndIso, visibleStartIso, visibleEndIso } = getCoreWindow(timeline, currentYear);

    const periodPasses = memberMovements
        .filter(m => isPassInPeriod(m, coreStartIso, coreEndIso))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const thisPeriodPass: MovementRecord | null = periodPasses[0] || null;

    const periodVacations = memberMovements
        // 카드에 보이는 이번 기간 날짜와 겹치는 휴가만 (시트에 칸이 없는 날짜에만 걸친 휴가는 보이지 않는다)
        .filter(m => m.type === 'vacation' && m.startDate <= visibleEndIso && m.endDate >= visibleStartIso)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const thisPeriodVacation = periodVacations.find(v => v.startDate >= coreStartIso) || periodVacations[0] || null;

    const allPeriodMovements: MovementRecord[] = [];
    if (thisPeriodPass) allPeriodMovements.push(thisPeriodPass);
    // 당직을 피해 나눠 나간 외박: 이번 기간 외박 기록을 모두 넣는다 (툴팁에 '11.26, 11.29'로 묶여 보인다)
    [...periodPasses]
        .filter(p => p.type === 'pass' && p !== thisPeriodPass)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .forEach(p => allPeriodMovements.push(p));
    periodVacations.forEach(v => {
        if (!allPeriodMovements.some(m => m.id === v.id || (m.startDate === v.startDate && m.endDate === v.endDate && m.type === v.type))) {
            allPeriodMovements.push(v);
        }
    });

    return {
        thisPeriodPass,
        thisPeriodVacation,
        allPeriodMovements
    };
}

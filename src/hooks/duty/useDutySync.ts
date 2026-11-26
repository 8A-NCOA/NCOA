import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, addDoc, deleteDoc, serverTimestamp, runTransaction, deleteField } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import type { CalendarEvent, CalendarMember } from '../../types/calendar/calendar.type';

export interface DutyHoliday {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
}

const INITIAL_SUBSCRIPTIONS = [
    'schedules', 'members', 'ktaTemplate', 'blcTemplate',
    'personalRestrictions', 'dutyDayLabels', 'monthlyDayLabels', 'dutyBrushSections'
] as const;

export function useDutySync(showToast: (message: string, type?: 'success' | 'error') => void) {
    // Firestore 원본 데이터
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [members, setMembers] = useState<CalendarMember[]>([]);
    const [ktaTemplate, setKtaTemplate] = useState<any>(null);
    const [blcTemplate, setBlcTemplate] = useState<any>(null);
    const [personalRestrictions, setPersonalRestrictions] = useState<Record<string, string[]>>({});

    // Derived dutyHolidays from events
    const dutyHolidays = events
        .filter(e => e.type === 'holiday' && e.holidayType === 'duty')
        .map(e => ({
            id: e.id,
            name: e.memo,
            startDate: e.startDate,
            endDate: e.endDate
        }));

    // KTA Template 연관 상태
    // Day 커스텀 배지 라벨은 당직 탭 전용이다. settings/dutyDayLabels 에만 저장하고
    // 다른 탭이 읽는 템플릿 문서(settings/ktaTemplate, blcTemplate)에는 쓰지 않는다.
    // 예전에 템플릿 문서 dayLabels 에 저장된 라벨은, 새 문서에 아직 값이 없을 때만 보여준다(첫 수정 시 이전).
    const [dutyDayLabels, setDutyDayLabels] = useState<{ kta?: Record<number, string>; blc?: Record<number, string> }>({});
    const [ktaLegacyDayLabels, setKtaLegacyDayLabels] = useState<Record<number, string>>({});
    const [restrictions, setRestrictions] = useState<Record<number, Record<string, boolean>>>({});
    const [ktaSections, setKtaSections] = useState<string[]>([]);

    // BLC Template 연관 상태
    const [blcLegacyDayLabels, setBlcLegacyDayLabels] = useState<Record<number, string>>({});
    const [blcRestrictions, setBlcRestrictions] = useState<Record<number, Record<string, boolean>>>({});
    const [blcSections, setBlcSections] = useState<string[]>([]);

    // 월간 날짜별 커스텀 레이블 상태
    const [monthlyDayLabels, setMonthlyDayLabels] = useState<Record<string, string>>({});

    // 브러시 적용 섹션 매핑 설정 상태
    const [dutyBrushSections, setDutyBrushSections] = useState<Record<string, string>>({
        kta: 'KTA',
        medic: 'MEDIC',
        paoKta: 'PAO',
        blc: 'BLC',
        s3: 'S3',
        paoBlc: 'PAO'
    });

    // 당직 탭이 처음 화면을 그리기 전에 받아야 하는 구독 목록.
    // 모두 첫 응답(성공 또는 실패)을 받은 뒤에만 달력을 그려, 데이터가 하나씩 도착할 때마다
    // 무거운 달력 계산을 반복하지 않게 한다.
    const [loadedKeys, setLoadedKeys] = useState<ReadonlySet<string>>(() => new Set());
    const loading = INITIAL_SUBSCRIPTIONS.some(key => !loadedKeys.has(key));

    useEffect(() => {
        const markLoaded = (key: string) => {
            setLoadedKeys(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
        };
        const qSchedules = query(collection(db, "schedules"));
        const unsubSchedules = onSnapshot(qSchedules, (snapshot) => {
            markLoaded('schedules');
            const data = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as CalendarEvent[];
            setEvents(data);
        }, (error) => {
            markLoaded('schedules');
            console.error("Schedules fetch error:", error);
            showToast("일정 데이터를 불러오는데 실패했습니다.", "error");
        });

        const qMembers = query(collection(db, 'members'));
        const unsubMembers = onSnapshot(qMembers, (snapshot) => {
            markLoaded('members');
            const data = (snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as CalendarMember[]).filter(m => m.role !== 'holdover');

            // 1차 정렬: 당직 완료 여부 (완료된 사람은 맨 아래로)
            data.sort((a, b) => {
                const compA = !!a.dutyCompleted;
                const compB = !!b.dutyCompleted;
                if (compA !== compB) {
                    return compA ? 1 : -1;
                }

                // 2차 정렬: 러너는 기수정렬 아래로
                if (a.role === 'runner' && b.role !== 'runner') return 1;
                if (a.role !== 'runner' && b.role === 'runner') return -1;

                // 3차 정렬: 기수(입대일) 및 이름순
                const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            setMembers(data);
        }, (error) => {
            markLoaded('members');
            console.error("Members fetch error:", error);
        });

        // KTA Template 실시간 구독 추가
        const unsubKtaTemplate = onSnapshot(doc(db, 'settings', 'ktaTemplate'), (snapshot) => {
            markLoaded('ktaTemplate');
            if (snapshot.exists()) {
                const data = snapshot.data();
                setKtaTemplate(data);

                setKtaLegacyDayLabels(data.dayLabels || {});
                
                if (Array.isArray(data.sections)) {
                    setKtaSections(data.sections);
                } else {
                    setKtaSections(['KTA', 'MEDIC', 'PAO']);
                }

                if (Array.isArray(data.restrictions)) {
                    const loadedRestrictions: Record<number, Record<string, boolean>> = {};
                    data.restrictions.forEach((r: any) => {
                        const dayRest: Record<string, boolean> = {};
                        if (r.restMap) {
                            Object.assign(dayRest, r.restMap);
                        } else {
                            // 하위 호환 (대소문자 둘 다 지원)
                            dayRest['KTA'] = !!r.ktaRestricted;
                            dayRest['kta'] = !!r.ktaRestricted;
                            dayRest['MEDIC'] = !!r.medicRestricted;
                            dayRest['medic'] = !!r.medicRestricted;
                            dayRest['PAO'] = !!r.paoRestricted;
                            dayRest['pao'] = !!r.paoRestricted;
                        }
                        loadedRestrictions[r.day] = dayRest;
                    });
                    setRestrictions(loadedRestrictions);
                }
            }
        }, (error) => {
            markLoaded('ktaTemplate');
            console.error("KTA template fetch error:", error);
        });

        // BLC Template 실시간 구독 추가
        const unsubBlcTemplate = onSnapshot(doc(db, 'settings', 'blcTemplate'), (snapshot) => {
            markLoaded('blcTemplate');
            if (snapshot.exists()) {
                const data = snapshot.data();
                setBlcTemplate(data);
                setBlcLegacyDayLabels(data.dayLabels || {});
                
                if (Array.isArray(data.sections)) {
                    setBlcSections(data.sections);
                } else {
                    setBlcSections(['BLC', 'S3', 'PAO']);
                }

                if (Array.isArray(data.restrictions)) {
                    const loadedRestrictions: Record<number, Record<string, boolean>> = {};
                    data.restrictions.forEach((r: any) => {
                        const dayRest: Record<string, boolean> = {};
                        if (r.restMap) {
                            Object.assign(dayRest, r.restMap);
                        } else {
                            // 하위 호환 (대소문자 둘 다 지원)
                            dayRest['BLC'] = !!r.blcRestricted;
                            dayRest['blc'] = !!r.blcRestricted;
                            dayRest['S3'] = !!r.s3Restricted;
                            dayRest['s3'] = !!r.s3Restricted;
                            dayRest['PAO'] = !!r.paoRestricted;
                            dayRest['pao'] = !!r.paoRestricted;
                        }
                        loadedRestrictions[r.day] = dayRest;
                    });
                    setBlcRestrictions(loadedRestrictions);
                }
            }
        }, (error) => {
            markLoaded('blcTemplate');
            console.error("BLC template fetch error:", error);
        });

        // 개인별 당직 제한 실시간 구독 추가
        const unsubPersonalRestrictions = onSnapshot(doc(db, 'settings', 'personalRestrictions'), (snapshot) => {
            markLoaded('personalRestrictions');
            if (snapshot.exists()) {
                setPersonalRestrictions(snapshot.data() as Record<string, string[]>);
            }
        }, (error) => {
            markLoaded('personalRestrictions');
            console.error("Personal restrictions fetch error:", error);
        });

        // 당직 탭 전용 Day 배지 라벨 구독
        const unsubDutyDayLabels = onSnapshot(doc(db, 'settings', 'dutyDayLabels'), (snapshot) => {
            markLoaded('dutyDayLabels');
            const data = snapshot.exists() ? snapshot.data() : {};
            setDutyDayLabels({
                kta: data.kta && typeof data.kta === 'object' ? data.kta : undefined,
                blc: data.blc && typeof data.blc === 'object' ? data.blc : undefined
            });
        }, (error) => {
            markLoaded('dutyDayLabels');
            console.error("Duty day labels fetch error:", error);
        });

        // 월간 날짜 레이블 실시간 구독 추가
        const unsubMonthlyDayLabels = onSnapshot(doc(db, 'settings', 'monthlyDayLabels'), (snapshot) => {
            markLoaded('monthlyDayLabels');
            if (snapshot.exists()) {
                setMonthlyDayLabels(snapshot.data() as Record<string, string>);
            } else {
                setMonthlyDayLabels({});
            }
        }, (error) => {
            markLoaded('monthlyDayLabels');
            console.error("Monthly day labels fetch error:", error);
        });

        // 브러시 적용 섹션 설정 실시간 구독 추가
        const unsubDutyBrushSections = onSnapshot(doc(db, 'settings', 'dutyBrushSections'), (snapshot) => {
            markLoaded('dutyBrushSections');
            if (snapshot.exists()) {
                setDutyBrushSections(prev => ({
                    ...prev,
                    ...snapshot.data()
                }));
            }
        }, (error) => {
            markLoaded('dutyBrushSections');
            console.error("Duty brush sections fetch error:", error);
        });

        return () => {
            unsubSchedules();
            unsubMembers();
            unsubKtaTemplate();
            unsubBlcTemplate();
            unsubPersonalRestrictions();
            unsubMonthlyDayLabels();
            unsubDutyDayLabels();
            unsubDutyBrushSections();
        };
    }, [showToast]);

    const handleAddDutyHoliday = async (name: string, startDate: string, endDate: string) => {
        try {
            const user = auth.currentUser;
            await addDoc(collection(db, "schedules"), {
                uid: user?.uid || "",
                type: 'holiday',
                holidayType: 'duty',
                startDate,
                endDate,
                memo: name.trim(),
                createdAt: serverTimestamp()
            });
            showToast(`'${name}' 휴일이 추가되었습니다.`);
        } catch (e) {
            console.error("Error adding duty holiday:", e);
            showToast("휴일 추가 중 오류가 발생했습니다.", "error");
        }
    };

    const handleDeleteDutyHoliday = async (id: string) => {
        try {
            await deleteDoc(doc(db, "schedules", id));
            showToast("휴일이 삭제되었습니다.");
        } catch (e) {
            console.error("Error deleting duty holiday:", e);
            showToast("휴일 삭제 중 오류가 발생했습니다.", "error");
        }
    };

    const ktaDayLabels = dutyDayLabels.kta ?? ktaLegacyDayLabels;
    const blcDayLabels = dutyDayLabels.blc ?? blcLegacyDayLabels;

    /** Day 배지 라벨 추가(text) 또는 삭제(null). 당직 탭 전용 문서에만 쓴다. */
    const handleSetDayLabel = async (mode: 'kta' | 'blc', day: number, text: string | null) => {
        const labelsRef = doc(db, 'settings', 'dutyDayLabels');
        const templateRef = doc(db, 'settings', mode === 'kta' ? 'ktaTemplate' : 'blcTemplate');
        try {
            await runTransaction(db, async (tx) => {
                const labelsSnap = await tx.get(labelsRef);
                const templateSnap = await tx.get(templateRef);
                const saved = labelsSnap.exists() ? labelsSnap.data()[mode] : undefined;
                const legacy = templateSnap.exists() ? templateSnap.data().dayLabels : undefined;
                // 새 문서에 값이 없으면 예전 템플릿 라벨을 이어받는다.
                const base: Record<string, string> = { ...((saved && typeof saved === 'object') ? saved : (legacy || {})) };
                if (text === null) delete base[String(day)];
                else base[String(day)] = text;
                // mergeFields: 이 모드의 라벨 맵 전체를 교체(삭제가 실제로 반영되도록)
                tx.set(labelsRef, { [mode]: base }, { mergeFields: [mode] });
                // 템플릿 문서에 남은 예전 라벨은 제거해 당직 탭 밖으로 노출되지 않게 한다.
                if (legacy !== undefined) tx.update(templateRef, { dayLabels: deleteField() });
            });
            const label = mode === 'kta' ? 'KTA' : 'BLC';
            showToast(text === null
                ? `${label} Day ${day} 라벨을 삭제했습니다.`
                : `${label} Day ${day}에 '${text}' 라벨을 등록했습니다.`);
        } catch (e) {
            console.error("Error saving duty day label:", e);
            showToast(navigator.onLine ? "라벨 저장 중 오류가 발생했습니다." : "네트워크에 연결되어 있지 않아 라벨을 저장하지 못했습니다.", "error");
        }
    };

    return {
        events, members, ktaTemplate, blcTemplate, personalRestrictions, loading,
        ktaDayLabels, blcDayLabels, handleSetDayLabel,
        restrictions, setRestrictions,
        blcRestrictions, setBlcRestrictions,
        monthlyDayLabels, setMonthlyDayLabels,
        dutyBrushSections, setDutyBrushSections,
        dutyHolidays, handleAddDutyHoliday, handleDeleteDutyHoliday,
        ktaSections, setKtaSections, blcSections, setBlcSections
    };
}

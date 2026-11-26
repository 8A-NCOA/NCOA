import { db } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

interface UseDutyTemplateProps {
    restrictions: Record<number, Record<string, boolean>>;
    blcRestrictions: Record<number, Record<string, boolean>>;
    setRestrictions: React.Dispatch<React.SetStateAction<Record<number, Record<string, boolean>>>>;
    setBlcRestrictions: React.Dispatch<React.SetStateAction<Record<number, Record<string, boolean>>>>;
    showToast: (message: string, type?: 'success' | 'error') => void;
    ktaSections: string[];
    blcSections: string[];
}

export function useDutyTemplate({
    restrictions, blcRestrictions,
    setRestrictions, setBlcRestrictions,
    showToast,
    ktaSections, blcSections
}: UseDutyTemplateProps) {
    // 특정 섹션 당직 불가 토글 핸들러 (KTA Day 기준)
    const handleToggleRestriction = (day: number, section: string) => {
        setRestrictions(prev => {
            const current = prev[day] || {};
            return {
                ...prev,
                [day]: {
                    ...current,
                    [section]: !current[section]
                }
            };
        });
    };

    // 특정 섹션 당직 불가 토글 핸들러 (BLC Day 기준)
    const handleToggleBlcRestriction = (day: number, section: string) => {
        setBlcRestrictions(prev => {
            const current = prev[day] || {};
            return {
                ...prev,
                [day]: {
                    ...current,
                    [section]: !current[section]
                }
            };
        });
    };

    // 주의: 템플릿 문서 전체(...ktaTemplate/...blcTemplate)를 펼쳐 쓰지 않는다.
    // 펼쳐 쓰면 이 기기가 마지막으로 받은 schedules까지 다시 쓰게 되어, 오프라인 기기에서
    // 저장한 쓰기가 나중에 도착할 때 캘린더 탭에서 수정·삭제한 일정이 되살아난다.
    // 이 버튼은 당직 불가 지정(브러시 섹션 + Day별 불가 표시)만 저장한다.
    // Day 배지 라벨은 useDutySync.handleSetDayLabel 이 당직 탭 전용 문서에 따로 저장한다.
    const handleSaveTemplateSettings = async () => {
        try {
            await setDoc(doc(db, 'settings', 'ktaTemplate'), {
                sections: ktaSections,
                restrictions: Object.entries(restrictions).map(([dayStr, val]) => ({
                    day: parseInt(dayStr, 10),
                    restMap: val,
                    ktaRestricted: !!val['KTA'],
                    medicRestricted: !!val['MEDIC'],
                    paoRestricted: !!val['PAO']
                }))
            }, { merge: true });
            showToast("KTA 당직 불가 제한 및 섹션 브러시 설정이 성공적으로 저장되었습니다! 💾");
        } catch (e) {
            console.error("Error saving restrictions:", e);
            showToast("설정 저장 중 오류가 발생했습니다.", "error");
        }
    };

    const handleSaveBlcTemplateSettings = async () => {
        try {
            await setDoc(doc(db, 'settings', 'blcTemplate'), {
                sections: blcSections,
                restrictions: Object.entries(blcRestrictions).map(([dayStr, val]) => ({
                    day: parseInt(dayStr, 10),
                    restMap: val,
                    blcRestricted: !!val['BLC'],
                    s3Restricted: !!val['S3'],
                    paoRestricted: !!val['PAO']
                }))
            }, { merge: true });
            showToast("BLC 당직 불가 제한 및 섹션 브러시 설정이 성공적으로 저장되었습니다! 💾");
        } catch (e) {
            console.error("Error saving BLC restrictions:", e);
            showToast("설정 저장 중 오류가 발생했습니다.", "error");
        }
    };

    return {
        handleToggleRestriction,
        handleToggleBlcRestriction,
        handleSaveTemplateSettings,
        handleSaveBlcTemplateSettings
    };
}

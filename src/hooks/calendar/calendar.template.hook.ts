import { useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { db } from '../../lib/firebase';
import type { DragEndEvent } from '@dnd-kit/core';
import type { ScheduleTemplateDay } from '../../types/calendar/calendar.type';

class TemplateConflictError extends Error {}

/**
 * 템플릿 schedules를 버전 확인 후 저장한다.
 *
 * - setDoc은 오프라인일 때 IndexedDB에 쌓였다가 몇 시간 뒤 서버에 도착할 수 있고,
 *   그 사이 다른 기기에서 수정·삭제한 일정을 옛 내용으로 덮어쓴다.
 *   트랜잭션은 오프라인에서 대기열에 쌓이지 않고 실패하므로 늦게 도착하는 쓰기가 생기지 않는다.
 * - 편집 기준 버전(baseVersion)이 서버의 schedulesVersion과 다르면, 이 기기가 오래된
 *   데이터를 보고 편집한 것이므로 저장하지 않는다.
 */
async function saveTemplateSchedules(
    docId: 'ktaTemplate' | 'blcTemplate',
    baseVersion: number,
    template: ScheduleTemplateDay[]
) {
    const ref = doc(db, 'settings', docId);
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? snap.data().schedulesVersion : undefined;
        const serverVersion = typeof current === 'number' ? current : 0;
        if (serverVersion !== baseVersion) throw new TemplateConflictError();
        tx.set(ref, {
            schedules: template.map(s => ({
                day: s.day,
                events: s.events.filter(e => e.trim() !== '')
            })),
            schedulesVersion: serverVersion + 1
        }, { merge: true });
    });
}

function templateSaveErrorMessage(error: unknown, label: string) {
    if (error instanceof TemplateConflictError) {
        return `다른 곳에서 ${label} 일정이 먼저 수정되었습니다. 최신 내용으로 갱신된 뒤 다시 수정·저장해주세요.`;
    }
    if (!navigator.onLine || (error instanceof FirebaseError && (error.code === 'unavailable' || error.code === 'failed-precondition'))) {
        return `네트워크에 연결되어 있지 않아 ${label} 일정을 저장하지 못했습니다. 연결 후 다시 저장해주세요.`;
    }
    return `${label} 일정 저장 중 오류가 발생했습니다.`;
}

export function useCalendarTemplate(
    ktaScheduleTemplate: ScheduleTemplateDay[],
    setKtaScheduleTemplate: React.Dispatch<React.SetStateAction<ScheduleTemplateDay[]>>,
    blcScheduleTemplate: ScheduleTemplateDay[],
    setBlcScheduleTemplate: React.Dispatch<React.SetStateAction<ScheduleTemplateDay[]>>,
    ktaTemplateVersion: number,
    blcTemplateVersion: number
) {
    const [isKTAScheduleAdding, setIsKTAScheduleAdding] = useState(false);
    const [isKTASaving, setIsKTASaving] = useState(false);

    const [isBLCScheduleAdding, setIsBLCScheduleAdding] = useState(false);
    const [isBLCSaving, setIsBLCSaving] = useState(false);

    // ── KTA Handlers ──
    const handleKtaDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const aParts = active.id.toString().split('-');
        const srcDay = parseInt(aParts[1], 10);
        const srcIdx = parseInt(aParts[2], 10);
        
        let tgtDay: number;
        const oId = over.id.toString();
        if (oId.startsWith('kta-day-')) tgtDay = parseInt(oId.replace('kta-day-', ''), 10);
        else tgtDay = parseInt(oId.split('-')[1], 10);
        
        if (srcDay === tgtDay || isNaN(tgtDay)) return;
        
        setKtaScheduleTemplate(prev => {
            const updated = prev.map(item => ({ ...item, events: [...item.events] }));
            const src = updated.find(i => i.day === srcDay);
            const tgt = updated.find(i => i.day === tgtDay);
            if (!src || !tgt || !src.events[srcIdx]) return prev;
            const [moved] = src.events.splice(srcIdx, 1);
            tgt.events.push(moved);
            tgt.events.sort((a, b) => (a.match(/^\d{4}/)?.[0] || '9999').localeCompare(b.match(/^\d{4}/)?.[0] || '9999'));
            return updated;
        });
    };

    const handleKtaTemplateChange = (day: number, eventIndex: number, value: string) => {
        setKtaScheduleTemplate(prev => prev.map(item => {
            if (item.day === day) {
                const newEvents = [...item.events];
                newEvents[eventIndex] = value;
                return { ...item, events: newEvents.filter((v, i) => v !== '' || i === eventIndex) };
            }
            return item;
        }));
    };

    const addEventToTemplate = (day: number) => {
        setKtaScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: [...item.events, ''] } : item
        ));
    };

    const removeEventFromTemplate = (day: number, index: number) => {
        setKtaScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: item.events.filter((_, i) => i !== index) } : item
        ));
    };

    const handleKtaSave = async () => {
        setIsKTASaving(true);
        try {
            await saveTemplateSchedules('ktaTemplate', ktaTemplateVersion, ktaScheduleTemplate);
            setIsKTAScheduleAdding(false);
        } catch (error) {
            console.error("Error saving KTA template:", error);
            alert(templateSaveErrorMessage(error, 'KTA'));
        } finally {
            setIsKTASaving(false);
        }
    };

    // ── BLC Handlers ──
    const handleBlcDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const aParts = active.id.toString().split('-');
        const srcDay = parseInt(aParts[1], 10);
        const srcIdx = parseInt(aParts[2], 10);
        
        let tgtDay: number;
        const oId = over.id.toString();
        if (oId.startsWith('blc-day-')) tgtDay = parseInt(oId.replace('blc-day-', ''), 10);
        else tgtDay = parseInt(oId.split('-')[1], 10);
        
        if (srcDay === tgtDay || isNaN(tgtDay)) return;
        
        setBlcScheduleTemplate(prev => {
            const updated = prev.map(item => ({ ...item, events: [...item.events] }));
            const src = updated.find(i => i.day === srcDay);
            const tgt = updated.find(i => i.day === tgtDay);
            if (!src || !tgt || !src.events[srcIdx]) return prev;
            const [moved] = src.events.splice(srcIdx, 1);
            tgt.events.push(moved);
            tgt.events.sort((a, b) => (a.match(/^\d{4}/)?.[0] || '9999').localeCompare(b.match(/^\d{4}/)?.[0] || '9999'));
            return updated;
        });
    };

    const handleBlcTemplateChange = (day: number, eventIndex: number, value: string) => {
        setBlcScheduleTemplate(prev => prev.map(item => {
            if (item.day === day) {
                const newEvents = [...item.events];
                newEvents[eventIndex] = value;
                return { ...item, events: newEvents.filter((v, i) => v !== '' || i === eventIndex) };
            }
            return item;
        }));
    };

    const addEventToBlcTemplate = (day: number) => {
        setBlcScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: [...item.events, ''] } : item
        ));
    };

    const removeEventFromBlcTemplate = (day: number, index: number) => {
        setBlcScheduleTemplate(prev => prev.map(item =>
            item.day === day ? { ...item, events: item.events.filter((_, i) => i !== index) } : item
        ));
    };

    const handleBlcSave = async () => {
        setIsBLCSaving(true);
        try {
            await saveTemplateSchedules('blcTemplate', blcTemplateVersion, blcScheduleTemplate);
            setIsBLCScheduleAdding(false);
        } catch (error) {
            console.error("Error saving BLC template:", error);
            alert(templateSaveErrorMessage(error, 'BLC'));
        } finally {
            setIsBLCSaving(false);
        }
    };

    return {
        isKTAScheduleAdding, setIsKTAScheduleAdding,
        isKTASaving,
        handleKtaDragEnd,
        handleKtaTemplateChange,
        addEventToTemplate,
        removeEventFromTemplate,
        handleKtaSave,

        isBLCScheduleAdding, setIsBLCScheduleAdding,
        isBLCSaving,
        handleBlcDragEnd,
        handleBlcTemplateChange,
        addEventToBlcTemplate,
        removeEventFromBlcTemplate,
        handleBlcSave
    };
}

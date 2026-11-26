import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import type { CalendarEvent, CalendarMember, ScheduleTemplateDay } from '../../types/calendar/calendar.type';

export function useCalendarSync() {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [members, setMembers] = useState<CalendarMember[]>([]);
    const [ktaScheduleTemplate, setKtaScheduleTemplate] = useState<ScheduleTemplateDay[]>(
        Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] }))
    );
    const [blcScheduleTemplate, setBlcScheduleTemplate] = useState<ScheduleTemplateDay[]>(
        Array.from({ length: 23 }, (_, i) => ({ day: i, events: [] }))
    );
    // 편집 중인 템플릿이 어느 버전을 기준으로 하는지. 저장 시 서버 버전과 비교해
    // 오래된 데이터로 덮어쓰는 것을 막는다. (calendar.template.hook.ts 참고)
    const [ktaTemplateVersion, setKtaTemplateVersion] = useState(0);
    const [blcTemplateVersion, setBlcTemplateVersion] = useState(0);

    useEffect(() => {
        let unsubscribeSchedules: () => void = () => { };
        let unsubscribeMembers: () => void = () => { };
        let unsubscribeKta: () => void = () => { };
        let unsubscribeBlc: () => void = () => { };

        const authUnsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                // 1. Schedules
                const qSchedules = query(collection(db, "schedules"));
                unsubscribeSchedules = onSnapshot(qSchedules, (snapshot) => {
                    const data = snapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() } as any))
                        .filter(e => ['duty', 'kta', 'blc', 'holiday'].includes(e.type)) as CalendarEvent[];
                    setEvents(data);
                });

                // 2. Members (유급생은 캘린더/당직 기능에서 제외)
                const qMembers = query(collection(db, 'members'));
                unsubscribeMembers = onSnapshot(qMembers, (snapshot) => {
                    const data = (snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    })) as CalendarMember[]).filter(m => m.role !== 'holdover');
                    data.sort((a, b) => {
                        if (a.role === 'runner' && b.role !== 'runner') return 1;
                        if (a.role !== 'runner' && b.role === 'runner') return -1;
                        const dateA = typeof a.enlistmentDate === 'string' ? a.enlistmentDate.trim() : '';
                        const dateB = typeof b.enlistmentDate === 'string' ? b.enlistmentDate.trim() : '';
                        if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                        const nameA = typeof a.name === 'string' ? a.name.trim() : '';
                        const nameB = typeof b.name === 'string' ? b.name.trim() : '';
                        if (nameA !== nameB) return nameA < nameB ? -1 : 1;
                        return 0;
                    });
                    setMembers(data);
                });

                // 3. KTA Template
                const qKta = doc(db, 'settings', 'ktaTemplate');
                unsubscribeKta = onSnapshot(qKta, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        const savedSchedules = data.schedules || [];
                        setKtaTemplateVersion(typeof data.schedulesVersion === 'number' ? data.schedulesVersion : 0);
                        setKtaScheduleTemplate(
                            Array.from({ length: 21 }, (_, i) => {
                                const found = savedSchedules.find((s: any) => s.day === i);
                                if (found) {
                                    const events = Array.isArray(found.events) ? found.events : (found.memo ? [found.memo] : []);
                                    return { day: i, events };
                                }
                                return { day: i, events: [] };
                            })
                        );
                    } else {
                        setKtaTemplateVersion(0);
                        setKtaScheduleTemplate(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
                    }
                });

                // 4. BLC Template
                const qBlc = doc(db, 'settings', 'blcTemplate');
                unsubscribeBlc = onSnapshot(qBlc, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        const savedSchedules = data.schedules || [];
                        setBlcTemplateVersion(typeof data.schedulesVersion === 'number' ? data.schedulesVersion : 0);
                        const daysList = [-1, ...Array.from({ length: 31 }, (_, i) => i)];
                        setBlcScheduleTemplate(
                            daysList.map((d) => {
                                const found = savedSchedules.find((s: any) => s.day === d);
                                if (found) {
                                    const events = Array.isArray(found.events) ? found.events : (found.memo ? [found.memo] : []);
                                    return { day: d, events };
                                }
                                return { day: d, events: [] };
                            })
                        );
                    } else {
                        setBlcTemplateVersion(0);
                        const daysList = [-1, ...Array.from({ length: 31 }, (_, i) => i)];
                        setBlcScheduleTemplate(daysList.map(d => ({ day: d, events: [] })));
                    }
                });
            } else {
                setEvents([]);
                setMembers([]);
                setKtaScheduleTemplate(Array.from({ length: 21 }, (_, i) => ({ day: i, events: [] })));
                const daysList = [-1, ...Array.from({ length: 31 }, (_, i) => i)];
                setBlcScheduleTemplate(daysList.map(d => ({ day: d, events: [] })));
            }
        });

        return () => {
            authUnsubscribe();
            unsubscribeSchedules();
            unsubscribeMembers();
            unsubscribeKta();
            unsubscribeBlc();
        };
    }, []);

    return {
        events,
        members,
        ktaScheduleTemplate,
        blcScheduleTemplate,
        setKtaScheduleTemplate, // Exposed for Template Hook DnD
        setBlcScheduleTemplate, // Exposed for Template Hook DnD
        ktaTemplateVersion,
        blcTemplateVersion,
    };
}

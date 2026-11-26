/* eslint-disable @typescript-eslint/no-explicit-any */
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase.config";
import { getGoogleSheetsInstance, getSpreadsheetIdForMode } from "../repositories/sheet.repository";
import { rolloverSheet } from "../repositories/sheetRollover.repository";
import { refreshSpreadsheetUpdatedAt } from "../repositories/setting.repository";
import { getKSTDateStr } from "../utils/date.util";

/**
 * 유동병력 시트 월간 연장: 매일 03:00(한국 시간)에 시트의 마지막 주인지 보고, 그렇다면 왼쪽으로 밀고 다음 달 말일까지 늘린다.
 * 시트마다 끌 수 있다: settings/sheetRollover { enabled: { test: boolean, prod: boolean } }.
 * 설정이 없거나 값이 없으면 켜져 있다 (테스트·운영 모두).
 */
export const rolloverMovementSheet = onSchedule(
    { schedule: "0 3 * * *", timeZone: "Asia/Seoul", timeoutSeconds: 120 },
    async () => {
        const settingSnap = await db.collection("settings").doc("sheetRollover").get();
        const saved = settingSnap.exists ? (settingSnap.data()?.enabled || {}) : {};
        const enabled = { test: saved.test !== false, prod: saved.prod !== false };
        const todayIso = getKSTDateStr();
        const sheets = await getGoogleSheetsInstance();

        for (const mode of ["test", "prod"] as const) {
            if (!enabled[mode]) continue;
            try {
                const spreadsheetId = await getSpreadsheetIdForMode(mode);
                const { plan, written } = await rolloverSheet(sheets, spreadsheetId, {
                    todayIso,
                    apply: true,
                    onBackup: async (backup) => {
                        await db.collection("sheet_rollover_backups").doc(`${mode}_${todayIso}`).set({
                            ...backup,
                            memberRows: backup.memberRows.map((r) => ({ cells: r })), // Firestore는 2차원 배열을 받지 않는다
                            mode,
                            createdAt: FieldValue.serverTimestamp(),
                        });
                    },
                });
                if (!written) {
                    // 마지막 주가 아니라서 넘어간 것은 평소 일이고, 그 밖의 이유(날짜가 끊김, 오늘이 시트에 없음)는 확인이 필요하다
                    const routine = plan.reason.startsWith("아직");
                    (routine ? logger.info : logger.warn)(`sheet rollover (${mode}): skipped`, { reason: plan.reason });
                    continue;
                }
                await refreshSpreadsheetUpdatedAt(mode);
                await db.collection("settings").doc("sheetRollover").set({
                    last: { [mode]: { todayIso, startIso: plan.startIso, endIso: plan.dates[plan.dates.length - 1], shift: plan.shift, addColumns: plan.addColumns, at: FieldValue.serverTimestamp() } },
                }, { merge: true });
                logger.info(`sheet rollover (${mode}): done`, {
                    startIso: plan.startIso, endIso: plan.dates[plan.dates.length - 1], shift: plan.shift, addColumns: plan.addColumns, cleared: plan.clearedCount,
                });
            } catch (e: any) {
                logger.error(`sheet rollover (${mode}) failed`, { error: e?.message });
            }
        }
    }
);

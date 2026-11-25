/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 유동병력 시트(NEW 탭) 월간 연장: 시트 읽기·쓰기. Firebase를 쓰지 않는다 (scripts/sheet-rollover.cjs에서도 쓴다).
 * 계산은 utils/sheetRollover.util.ts.
 */
import { planRollover, columnLetter, isoToSerial, type RolloverPlan } from "../utils/sheetRollover.util";

export const ROLLOVER_SHEET = "NEW";
/** 대원 행 (1-based). 23행부터는 집계 수식이다. */
export const MEMBER_FIRST_ROW = 3;
export const MEMBER_LAST_ROW = 22;
/** 23행 A열에 이 글자가 있어야 시트 구조가 예상과 같다고 본다 */
const SUMMARY_FIRST_LABEL = "병장 휴가";

export interface RolloverBackup {
    spreadsheetId: string;
    todayIso: string;
    columnCount: number;
    /** 1행(B열부터) 날짜 시리얼 */
    row1: unknown[];
    /** 3~22행(B열부터) 값 */
    memberRows: string[][];
}

export interface RolloverResult {
    plan: RolloverPlan;
    written: boolean;
}

/**
 * 시트를 읽어 연장 계획을 세우고, apply가 true이고 연장할 때면 시트에 쓴다.
 * onBackup: 쓰기 전에 원래 값을 남긴다 (실패하면 쓰지 않는다).
 */
export async function rolloverSheet(
    sheets: any,
    spreadsheetId: string,
    opts: { todayIso: string; apply: boolean; force?: boolean; onBackup?: (b: RolloverBackup) => Promise<void> },
): Promise<RolloverResult> {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
    });
    const tab = (meta.data.sheets || []).find((s: any) => s.properties?.title === ROLLOVER_SHEET);
    if (!tab) throw new Error(`'${ROLLOVER_SHEET}' 탭을 찾을 수 없습니다.`);
    const sheetId: number = tab.properties.sheetId;
    const columnCount: number = tab.properties.gridProperties.columnCount;
    const rowCount: number = tab.properties.gridProperties.rowCount;
    const lastCol = columnLetter(columnCount - 1);

    const [labels, row1Res, membersRes] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: `${ROLLOVER_SHEET}!A1:A${MEMBER_LAST_ROW + 1}` }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: `${ROLLOVER_SHEET}!B1:${lastCol}1`, valueRenderOption: "UNFORMATTED_VALUE" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: `${ROLLOVER_SHEET}!B${MEMBER_FIRST_ROW}:${lastCol}${MEMBER_LAST_ROW}` }),
    ]);
    const summaryLabel = ((labels.data.values || [])[MEMBER_LAST_ROW] || [])[0];
    if ((summaryLabel || "").trim() !== SUMMARY_FIRST_LABEL) {
        throw new Error(`시트 구조가 예상과 다릅니다 (A${MEMBER_LAST_ROW + 1}이 '${SUMMARY_FIRST_LABEL}'이 아님). 연장하지 않았습니다.`);
    }

    const row1: unknown[] = (row1Res.data.values || [])[0] || [];
    const memberCount = MEMBER_LAST_ROW - MEMBER_FIRST_ROW + 1;
    const memberRows: string[][] = Array.from({ length: memberCount }, (_, i) =>
        ((membersRes.data.values || [])[i] || []).map((v: any) => (v ?? "").toString()),
    );

    const plan = planRollover(row1, memberRows, columnCount, opts.todayIso, { force: opts.force });
    if (!plan.apply || !opts.apply) return { plan, written: false };

    if (opts.onBackup) {
        await opts.onBackup({ spreadsheetId, todayIso: opts.todayIso, columnCount, row1, memberRows });
    }

    // 열이 모자라면 늘리고, 마지막 열(서식·드롭다운·집계 수식)을 새 열에 복사한다
    if (plan.addColumns > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    { appendDimension: { sheetId, dimension: "COLUMNS", length: plan.addColumns } },
                    {
                        copyPaste: {
                            source: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: columnCount - 1, endColumnIndex: columnCount },
                            destination: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: columnCount, endColumnIndex: columnCount + plan.addColumns },
                            pasteType: "PASTE_NORMAL",
                        },
                    },
                ],
            },
        });
    }

    // 값만 다시 쓴다 (열을 지우거나 끼우지 않으므로 다른 탭의 참조와 드롭다운 색이 그대로다)
    const endCol = columnLetter(plan.dates.length);
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: "RAW",
            data: [
                { range: `${ROLLOVER_SHEET}!B1:${endCol}1`, values: [plan.dates.map(isoToSerial)] },
                { range: `${ROLLOVER_SHEET}!B2:${endCol}2`, values: [plan.weekdays] },
                { range: `${ROLLOVER_SHEET}!B${MEMBER_FIRST_ROW}:${endCol}${MEMBER_LAST_ROW}`, values: plan.cells },
            ],
        },
    });
    return { plan, written: true };
}

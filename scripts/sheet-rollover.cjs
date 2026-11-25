/**
 * 유동병력 시트(NEW 탭) 월간 연장을 손으로 실행한다. 매일 03:00 자동 실행(rolloverMovementSheet 함수)과 같은 계산.
 *
 * 사용법 (functions를 먼저 빌드: npm --prefix functions run build)
 *   node scripts/sheet-rollover.cjs test                         → 오늘 기준으로 바뀔 내용만 보여 준다 (쓰지 않음)
 *   node scripts/sheet-rollover.cjs test --today=2026-11-25      → 그 날짜를 오늘로 보고 계산
 *   node scripts/sheet-rollover.cjs test --force                 → 마지막 주가 아니어도 연장 계산
 *   node scripts/sheet-rollover.cjs test --apply                 → 실제로 쓴다 (쓰기 전 원래 값을 임시 폴더에 JSON으로 남긴다)
 *   운영 시트(prod)는 --allow-prod 를 함께 줘야 쓴다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const lib = (p) => require(path.join(__dirname, '../functions/lib', p));
const { getGoogleSheetsInstance, getSpreadsheetIdForMode } = lib('repositories/sheet.repository.js');
const { rolloverSheet } = lib('repositories/sheetRollover.repository.js');

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

(async () => {
    const args = process.argv.slice(2);
    const mode = args.find(a => !a.startsWith('--'));
    const flag = (name) => args.includes(`--${name}`);
    const todayArg = (args.find(a => a.startsWith('--today=')) || '').split('=')[1];
    if (mode !== 'test' && mode !== 'prod') {
        console.error('첫 인자로 test 또는 prod를 주세요.');
        process.exit(1);
    }
    const apply = flag('apply');
    if (apply && mode === 'prod' && !flag('allow-prod')) {
        console.error('운영 시트에 쓰려면 --allow-prod 를 함께 주세요.');
        process.exit(1);
    }
    const todayIso = todayArg || kstToday();
    const sheets = await getGoogleSheetsInstance();
    const spreadsheetId = await getSpreadsheetIdForMode(mode);

    const { plan, written } = await rolloverSheet(sheets, spreadsheetId, {
        todayIso,
        apply,
        force: flag('force'),
        onBackup: async (backup) => {
            const file = path.join(os.tmpdir(), `sheet-rollover-backup-${mode}-${todayIso}-${Date.now()}.json`);
            fs.writeFileSync(file, JSON.stringify(backup, null, 2));
            console.log('원래 값 백업:', file);
        },
    });

    console.log(`오늘: ${todayIso}`);
    if (!plan.apply) {
        console.log('연장하지 않음:', plan.reason);
        return;
    }
    console.log(`새 B열: ${plan.startIso} (왼쪽으로 ${plan.shift}칸), 마지막 날짜: ${plan.dates[plan.dates.length - 1]} (${plan.dates.length}일)`);
    console.log(`늘릴 열: ${plan.addColumns}개, 오늘 이전이라 지울 칸: ${plan.clearedCount}개`);
    const show = Math.min(plan.dates.length, 10);
    console.log('앞 10일:', plan.dates.slice(0, show).map(d => d.slice(5)).join(' '));
    plan.cells.forEach((r, i) => {
        if (r.slice(0, show).some(Boolean)) console.log(`  ${i + 3}행`, r.slice(0, show).map(c => c || '·').join(' | '));
    });
    console.log(written ? '시트에 썼습니다.' : '(미리보기만 했습니다. 쓰려면 --apply)');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

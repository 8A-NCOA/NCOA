import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateDuringKtaPeriod,
  KTA_EVENING_PATROL_REMINDER_MESSAGE,
} from '../functions/src/utils/kta.util.ts';

test('reminder message matches exact required text', () => {
  assert.equal(
    KTA_EVENING_PATROL_REMINDER_MESSAGE,
    'KTA 기수 중 저녁순찰 리마인드 드립니다.'
  );
});

test('isDateDuringKtaPeriod returns true from Day 0 through Graduation inclusive', () => {
  const schedules = [
    { type: 'kta', batch: '05-26', startDate: '2026-11-01', endDate: '2026-11-01', memo: 'Day 0 (05-26 A)' },
    { type: 'kta', batch: '05-26', startDate: '2026-11-21', endDate: '2026-11-21', memo: 'Graduation (05-26 A)' },
  ];

  assert.equal(isDateDuringKtaPeriod('2026-10-31', schedules), false);
  assert.equal(isDateDuringKtaPeriod('2026-11-01', schedules), true);
  assert.equal(isDateDuringKtaPeriod('2026-11-17', schedules), true);
  assert.equal(isDateDuringKtaPeriod('2026-11-21', schedules), true);
  assert.equal(isDateDuringKtaPeriod('2026-11-22', schedules), false);
});

test('isDateDuringKtaPeriod handles multiple batches and non-KTA events', () => {
  const schedules = [
    { type: 'blc', batch: '01-26', startDate: '2026-10-01', endDate: '2026-10-01', memo: 'Day 0 (01-26)' },
    { type: 'holiday', startDate: '2026-10-10', endDate: '2026-10-12', memo: 'Holiday' },
    { type: 'kta', batch: '04-26', startDate: '2026-09-01', endDate: '2026-09-01', memo: 'Day 0 (04-26 B)' },
    { type: 'kta', batch: '04-26', startDate: '2026-09-21', endDate: '2026-09-21', memo: 'Graduation (04-26 B)' },
    { type: 'kta', batch: '05-26', startDate: '2026-11-01', endDate: '2026-11-01', memo: 'Day 0 (05-26 A)' },
    { type: 'kta', batch: '05-26', startDate: '2026-11-21', endDate: '2026-11-21', memo: 'Graduation (05-26 A)' },
  ];

  assert.equal(isDateDuringKtaPeriod('2026-10-05', schedules), false);
  assert.equal(isDateDuringKtaPeriod('2026-10-11', schedules), false);
  assert.equal(isDateDuringKtaPeriod('2026-09-10', schedules), true);
  assert.equal(isDateDuringKtaPeriod('2026-11-10', schedules), true);
});

test('isDateDuringKtaPeriod falls back to 21-day window when Graduation doc is absent and normalizes date separators', () => {
  const schedules = [
    { type: 'kta', batch: '06-26', startDate: '2026.12.01', endDate: '2026.12.01', memo: 'Day 0 (06-26 B)' },
  ];

  assert.equal(isDateDuringKtaPeriod('2026-11-30', schedules), false);
  assert.equal(isDateDuringKtaPeriod('2026-12-01', schedules), true);
  assert.equal(isDateDuringKtaPeriod('2026-12-21', schedules), true);
  assert.equal(isDateDuringKtaPeriod('2026-12-22', schedules), false);
});

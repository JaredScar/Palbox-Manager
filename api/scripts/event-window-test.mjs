/**
 * Checks the scheduled-event window maths.
 *
 * The interesting cases are windows that run past midnight and past the end of
 * the week, and daylight saving: "Friday 18:00" has to keep meaning Friday
 * evening locally, which a fixed UTC offset would not.
 */
import { windowStart, nextStart } from '../dist/services/events.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)}${ok ? '' : ` got ${actual}, want ${expected}`}`);
}

const at = (iso) => new Date(iso).getTime();

const weekend = {
  id: 1, instance_id: 1, name: 'Double XP', description: '',
  overrides: '{"ExpRate":"2.0"}',
  mode: 'weekly', start_dow: 5, start_time: '18:00', start_at: null,
  duration_hours: 48, timezone: 'UTC', warn_minutes: 5,
  start_message: '', end_message: '', enabled: 1,
  active: 0, saved_settings: null, activated_at: null, ends_at: null,
  last_error: null, created_at: 0,
};

// Friday 18:00 UTC + 48h runs to Sunday 18:00.
check('before the window', windowStart(weekend, at('2026-08-07T17:59:00Z')), null);
check('at the boundary', windowStart(weekend, at('2026-08-07T18:00:00Z')), at('2026-08-07T18:00:00Z'));
check('overnight into Saturday', windowStart(weekend, at('2026-08-08T04:00:00Z')), at('2026-08-07T18:00:00Z'));
check('final minute', windowStart(weekend, at('2026-08-09T17:59:00Z')), at('2026-08-07T18:00:00Z'));
check('after the window', windowStart(weekend, at('2026-08-09T18:00:00Z')), null);
check('midweek', windowStart(weekend, at('2026-08-05T12:00:00Z')), null);

// A window longer than the gap between starts still resolves to the most
// recent start, which needs the search to look back further than one day.
const long = { ...weekend, duration_hours: 24 * 6 };
check('six-day window, five days in', windowStart(long, at('2026-08-12T12:00:00Z')), at('2026-08-07T18:00:00Z'));

// A zone that observes daylight saving: 18:00 local is 17:00 UTC in summer and
// 18:00 UTC in winter, and both have to land on the same local wall clock.
const london = { ...weekend, timezone: 'Europe/London' };
check('BST start is 17:00 UTC', windowStart(london, at('2026-08-07T17:00:00Z')), at('2026-08-07T17:00:00Z'));
check('BST: one minute early is outside', windowStart(london, at('2026-08-07T16:59:00Z')), null);
check('GMT start is 18:00 UTC', windowStart(london, at('2026-12-04T18:00:00Z')), at('2026-12-04T18:00:00Z'));

// A one-off runs from its instant and never repeats.
const once = { ...weekend, mode: 'once', start_at: Math.floor(at('2026-09-01T12:00:00Z') / 1000), duration_hours: 3 };
check('one-off inside', windowStart(once, at('2026-09-01T14:00:00Z')), at('2026-09-01T12:00:00Z'));
check('one-off after', windowStart(once, at('2026-09-01T15:00:00Z')), null);
check('one-off has no next once past', nextStart(once, at('2026-09-02T00:00:00Z')), null);

// A zero-length event would otherwise activate and never end.
check('zero duration never runs', windowStart({ ...weekend, duration_hours: 0 }, at('2026-08-07T18:00:00Z')), null);

check('next start from midweek', nextStart(weekend, at('2026-08-05T12:00:00Z')), at('2026-08-07T18:00:00Z'));
check('next start skips the live window', nextStart(weekend, at('2026-08-08T12:00:00Z')), at('2026-08-14T18:00:00Z'));
check('disabled events have no next start', nextStart({ ...weekend, enabled: 0 }, at('2026-08-05T12:00:00Z')), null);

if (failures > 0) {
  console.error(`\n${failures} event window check(s) failed.`);
  process.exit(1);
}
console.log('\nAll event window checks passed.');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('./feature-core.js');
const now = '2026-11-11T00:00:00Z';
const sample = overrides => ({
  source: 'fictional-calendar', id: 'sample-1', title: '架空バンドの夜ライブ',
  artistId: 'fictional-band', category: 'LIVE', status: 'confirmed', revision: 2,
  present: true, allDay: false, start: '2026-11-21T18:00:00+09:00',
  end: '2026-11-21T20:00:00+09:00', location: '架空ホール',
  note: '実際の予定ではないテスト資料。', evidence: '架空の公開資料。', ...overrides
});
const unfold = ics => ics.replace(/\r\n[ \t]/g, '');
const build = events => F.buildICS(events, { now });

test('CommonJS and isolated browser global expose the same dependency-free API', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('./feature-core.js', import.meta.url), 'utf8'), context);
  assert.equal(typeof context.AlertFeatures.buildICS, 'function');
  assert.deepEqual(Object.keys(context.AlertFeatures), Object.keys(F));
  assert.equal(Object.isFrozen(F), true);
});

test('stable identity includes both source and ID without delimiter collisions', () => {
  assert.equal(F.stableEventKey(sample()), F.stableEventKey('fictional-calendar', 'sample-1'));
  assert.notEqual(F.stableEventKey('a:b', 'c'), F.stableEventKey('a', 'b:c'));
  assert.notEqual(F.stableEventKey('a', 'same'), F.stableEventKey('b', 'same'));
  assert.equal(F.stableEventKey({ id: 'missing-source' }), null);
  assert.notEqual(F.stableEventKey('source', 0), null);
});

test('dedup uses latest revision of source+ID and never merges different sources', () => {
  const old = sample({ revision: 1 }), current = sample({ revision: 5 });
  const other = sample({ source: 'fictional-other', revision: 1 });
  const result = F.deduplicateEvents([current, old, other]);
  assert.deepEqual(result, [current, other]);
  const exportResult = build([current, old, other]);
  assert.equal(exportResult.included.length, 2);
  assert.equal((unfold(exportResult.ics).match(/^UID:/gm) || []).length, 2);
});

test('filters combine artistId, category, status, query and favorite keys', () => {
  const a = sample(), b = sample({ id: 'two', artistId: 'other', status: 'possible' });
  const favorites = new Set([F.stableEventKey(a)]);
  assert.deepEqual(F.filterEvents([a, b], { artist: 'fictional-band', category: 'LIVE', status: 'confirmed', query: 'ホール', favoritesOnly: true, favorites }), [a]);
  assert.deepEqual(F.filterEvents([a, b], { artistId: 'other' }), [b]);
  assert.deepEqual(F.filterEvents([a, b], { category: 'RADIO' }), []);
  assert.deepEqual(F.filterEvents([a, b], { status: ['possible', 'unknown'] }), [b]);
  assert.equal(F.isFavorite(sample({ source: 'other' }), favorites), false);
});

test('artist arrays, missing status, case-insensitive query and favorite map work', () => {
  const a = sample({ artists: ['架空歌手A', '架空歌手B'], present: false, note: 'SAMPLE TEXT' });
  assert.deepEqual(F.filterEvents([a], { artist: '架空歌手B', status: 'missing', query: 'sample text' }), [a]);
  assert.equal(F.isFavorite(a, { [F.stableEventKey(a)]: true }), true);
  assert.equal(F.isFavorite(a, [F.stableEventKey(a)]), true);
});

test('sort is nonmutating, puts favorites first and orders known dates before unknown', () => {
  const early = sample({ id: 'early', start: '2026-11-20T12:00:00+09:00' });
  const favorite = sample({ id: 'favorite', start: '2026-11-25T12:00:00+09:00' });
  const unknown = sample({ id: 'unknown', start: null });
  const input = [unknown, favorite, early], copy = [...input];
  assert.deepEqual(F.filterEvents(input, { sort: 'favorites', favorites: [F.stableEventKey(favorite)] }), [favorite, early, unknown]);
  assert.deepEqual(F.filterEvents(input), [early, favorite, unknown]);
  assert.deepEqual(F.filterEvents(input, { sort: 'date-desc' }), [favorite, early, unknown]);
  assert.deepEqual(input, copy);
});

test('sort supports artist, category, title and certainty status', () => {
  const a = sample({ id: 'a', artistId: 'A', category: 'RADIO', title: 'A', status: 'possible' });
  const b = sample({ id: 'b', artistId: 'B', category: 'LIVE', title: 'B', status: 'confirmed' });
  assert.deepEqual(F.filterEvents([b, a], { sort: 'artist' }), [a, b]);
  assert.deepEqual(F.filterEvents([b, a], { sort: 'title' }), [a, b]);
  assert.deepEqual(F.filterEvents([a, b], { sort: 'category' }), [b, a]);
  assert.deepEqual(F.filterEvents([a, b], { sort: 'status' }), [b, a]);
});

test('dateKey uses JST, supports explicit offsets and treats unzoned date-times as JST', () => {
  assert.equal(F.dateKey('2026-11-20T15:00:00Z'), '2026-11-21');
  assert.equal(F.dateKey('2026-11-20T23:00:00-05:00'), '2026-11-21');
  assert.equal(F.dateKey('2026-11-21'), '2026-11-21');
  assert.equal(F.parseInstant('2026-11-21T18:00'), Date.parse('2026-11-21T09:00:00Z'));
  assert.equal(F.dateKey(0), '1970-01-01');
});

test('invalid dates never silently roll into another day or manufacture a time', () => {
  for (const value of [null, '', 'unknown', '2026-02-29', '2026-02-31T10:00:00Z', '2026-11-21T24:00:00Z', '2026-11-21T12:99:00Z', '2026-11-21T12:00:00+99:00']) assert.equal(F.dateKey(value), null, String(value));
  assert.equal(F.dateKey('2028-02-29'), '2028-02-29');
  assert.equal(F.parseInstant('2026-11-21'), null);
});

test('all-day overlap uses exclusive end; missing end means only known start date', () => {
  const event = sample({ allDay: true, start: '2026-11-25', end: '2026-11-28' });
  assert.equal(F.overlapsDay(event, '2026-11-24'), false);
  assert.equal(F.overlapsDay(event, '2026-11-25'), true);
  assert.equal(F.overlapsDay(event, '2026-11-27'), true);
  assert.equal(F.overlapsDay(event, '2026-11-28'), false);
  assert.equal(F.overlapsDay({ ...event, end: null }, '2026-11-26'), false);
});

test('timed overlap crosses midnight correctly and excludes an exclusive midnight end', () => {
  const event = sample({ start: '2026-11-21T23:00:00+09:00', end: '2026-11-22T00:00:00+09:00' });
  assert.equal(F.overlapsDay(event, '2026-11-21'), true);
  assert.equal(F.overlapsDay(event, '2026-11-22'), false);
  assert.equal(F.overlapsDay({ ...event, end: '2026-11-22T00:01:00+09:00' }, '2026-11-22'), true);
  assert.equal(F.overlapsDay({ ...event, present: false }, '2026-11-21'), false);
  assert.equal(F.overlapsDay({ ...event, start: null }, '2026-11-21'), false);
});

test('date-only timed event can appear on the known day but cannot be exported', () => {
  const event = sample({ start: '2026-11-21', end: null, allDay: false });
  assert.equal(F.overlapsDay(event, '2026-11-21'), true);
  assert.equal(F.overlapsDay(event, '2026-11-22'), false);
  assert.equal(F.exportEligibility(event).reason, 'unknown_time');
  assert.equal(build(event).ics, '');
});

test('notification preview contains exact event name, information and fictional label', () => {
  const event = sample({ status: 'possible' });
  const result = F.notificationPreview(event);
  assert.match(result.title, /架空バンドの夜ライブ/);
  assert.match(result.title, /架空サンプル/);
  assert.match(result.title, /かも？/);
  assert.match(result.body, /架空ホール/);
  assert.match(result.body, /18:00 JST/);
  assert.match(result.body, /実際の通知は送信しません/);
  assert.equal(result.data.previewOnly, true);
  const missing = F.notificationPreview({ kind: 'unavailable', before: event, after: null, eventId: event.id, source: event.source, revision: 3 });
  assert.match(missing.body, /中止とは未確定/);
  assert.equal(missing.data.revision, 3);
});

test('notification tags dedup the same change but distinguish source, revision and kind', () => {
  const event = sample();
  assert.equal(F.notificationPreview(event).tag, F.notificationPreview({ ...event }).tag);
  for (const difference of [{ source: 'other' }, { revision: 3 }, { kind: 'updated' }]) assert.notEqual(F.notificationPreview(event).tag, F.notificationPreview({ ...event, ...difference }).tag);
});

test('ICS includes stable source+ID UID, revision sequence and UTC dates', () => {
  const event = sample();
  const first = unfold(build(event).ics), second = unfold(build({ ...event, revision: 3, start: '2026-11-21T19:00:00+09:00' }).ics);
  assert.match(first, /DTSTART:20261121T090000Z\r\n/);
  assert.match(first, /DTEND:20261121T110000Z\r\n/);
  assert.match(first, /DTSTAMP:20261111T000000Z\r\n/);
  assert.match(first, /SEQUENCE:2\r\n/);
  assert.match(second, /SEQUENCE:3\r\n/);
  assert.equal(first.match(/^UID:(.+)$/m)[1], second.match(/^UID:(.+)$/m)[1]);
  assert.match(first, /SUMMARY:\[架空サンプル\]/);
  assert.doesNotMatch(first, /VALARM|METHOD:REQUEST|ORGANIZER|ATTENDEE/);
});

test('ICS marks possible events tentative and labels them かも？', () => {
  const ics = unfold(build(sample({ status: 'possible' })).ics);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /SUMMARY:.*かも？/);
  assert.match(ics, /確定ではありません/);
});

test('ICS refuses cancelled, missing, unknown-date and invalid-date events', () => {
  const cases = [
    [sample({ status: 'cancelled' }), 'cancelled'],
    [sample({ present: false }), 'missing'],
    [sample({ start: null, status: 'unknown' }), 'unknown_date'],
    [sample({ start: '2026-02-31T10:00:00Z' }), 'unknown_date'],
    [sample({ source: undefined }), 'missing_identity'],
    [sample({ end: '2026-11-20T18:00:00+09:00' }), 'invalid_end']
  ];
  for (const [event, reason] of cases) {
    const result = build(event);
    assert.equal(result.ics, '');
    assert.equal(result.included.length, 0);
    assert.equal(result.skipped[0].reason, reason);
  }
});

test('latest cancellation cannot resurrect a previous confirmed duplicate in ICS', () => {
  const result = build([sample({ revision: 5, status: 'cancelled' }), sample({ revision: 1 })]);
  assert.equal(result.ics, '');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'cancelled');
});

test('missing end stays absent for both timed and all-day exports', () => {
  for (const event of [sample({ end: null }), sample({ allDay: true, start: '2026-11-25', end: null })]) {
    const ics = unfold(build(event).ics);
    assert.match(ics, /DTSTART/);
    assert.doesNotMatch(ics, /DTEND|DURATION/);
  }
});

test('all-day ICS keeps explicit end exclusive and does not create a timed event', () => {
  const ics = unfold(build(sample({ allDay: true, start: '2026-11-25', end: '2026-11-28' })).ics);
  assert.match(ics, /DTSTART;VALUE=DATE:20261125\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261128\r\n/);
  assert.doesNotMatch(ics, /DTSTART:|DTEND:/);
});

test('malicious text cannot inject ICS components or properties through CR, LF or separators', () => {
  const injection = '架空題名\\,;\r\nEND:VEVENT\nBEGIN:VEVENT\rDTSTART:19990101T000000Z\u0000';
  const ics = unfold(build(sample({ title: injection, note: injection, location: injection, source: injection, id: injection, category: injection })).ics);
  assert.equal((ics.match(/^BEGIN:VEVENT\r?$/gm) || []).length, 1);
  assert.equal((ics.match(/^END:VEVENT\r?$/gm) || []).length, 1);
  assert.equal((ics.match(/^DTSTART:/gm) || []).length, 1);
  assert.equal((ics.match(/^UID:/gm) || []).length, 1);
  assert.match(ics, /\\nEND:VEVENT\\nBEGIN:VEVENT\\nDTSTART/);
  assert.match(ics, /\\\\\\,\\;/);
  assert.doesNotMatch(ics, /\u0000/);
  assert.equal(F.escapeICSText('a\r\nb\rc\nd'), 'a\\nb\\nc\\nd');
});

test('every physical ICS line is at most 75 UTF-8 octets without splitting unicode', () => {
  const title = '架空🎵音楽会🧑🏽‍🎤' .repeat(40);
  const ics = build(sample({ title, source: '架空の出典'.repeat(40), note: title })).ics;
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${Buffer.byteLength(line)} octets`);
  assert.match(ics, /\r\n /);
  assert.ok(unfold(ics).includes(`SUMMARY:[架空サンプル] ${title}`));
  assert.equal(unfold(ics).includes('\ufffd'), false);
});

test('event reminder preview uses morning 08:00 JST and one hour before, future only', () => {
  const result = F.reminderTimes(sample(), { now });
  assert.deepEqual(result.times.map(t => t.at), ['2026-11-20T23:00:00.000Z', '2026-11-21T08:00:00.000Z']);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.previewOnly, true);
  assert.deepEqual(F.reminderTimes(sample(), { now: '2026-11-20T23:00:00Z' }).times.map(t => t.at), ['2026-11-21T08:00:00.000Z']);
  assert.deepEqual(F.reminderTimes(sample(), { now: '2026-11-21T09:00:00Z' }).times, []);
});

test('historical preview omits morning at or after start, never moves it to a guessed earlier day', () => {
  for (const hour of ['07', '08']) {
    const result = F.reminderTimes(sample({ start: `2026-11-21T${hour}:00:00+09:00` }), { now });
    assert.equal(result.times.length, 1);
    assert.equal(result.times[0].kind, 'event-1h');
    assert.equal(result.unresolved.length, 0);
    assert.equal(result.omitted[0].reason, 'morning_not_before_anchor');
    assert.equal(result.historicalPreview, true);
    assert.equal(result.currentTTMVerified, false);
    assert.match(result.ruleNote, /未検証/);
  }
});

test('coincident reminder stamps merge purposes instead of delivering duplicates', () => {
  const result = F.reminderTimes(sample({ start: '2026-11-21T09:00:00+09:00' }), { now });
  assert.equal(result.times.length, 1);
  assert.equal(result.times[0].at, '2026-11-20T23:00:00.000Z');
  assert.deepEqual(result.times[0].kinds, ['event-morning', 'event-1h']);
});

test('zero millisecond timestamp is retained when genuinely future', () => {
  const result = F.reminderTimes(sample({ start: '1970-01-01T10:00:00+09:00' }), { now: -60000 });
  assert.equal(result.times.length, 1);
  assert.equal(result.times[0].timestamp, 0);
  assert.equal(result.times[0].at, '1970-01-01T00:00:00.000Z');
});

test('explicit deadline defaults to deadline2, preserving historical 23:59 to 23:00 exception', () => {
  const event = sample({ allDay: true, start: '2026-11-25', end: '2026-11-28', deadline: '2026-11-27T14:59:00Z' });
  const result = F.reminderTimes(event, { now });
  assert.deepEqual(result.times.map(t => t.at), ['2026-11-26T23:00:00.000Z', '2026-11-27T14:00:00.000Z']);
  assert.equal(result.mode, 'deadline2');
  assert.equal(result.times[1].kind, 'deadline-special-2300');
  assert.match(result.times[1].label, /23:59締切/);
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(F.reminderTimes({ ...event, deadline: undefined }, { now }).times, []);
});

test('midnight and early reminders use previous-day one-hour-before and omit later morning', () => {
  for (const [start, expected] of [['2026-11-21T00:00:00+09:00', '2026-11-20T14:00:00.000Z'], ['2026-11-21T00:30:00+09:00', '2026-11-20T14:30:00.000Z']]) {
    const result = F.reminderTimes(sample({ start }), { now });
    assert.deepEqual(result.times.map(t => t.at), [expected]);
    assert.equal(result.omitted[0].reason, 'morning_not_before_anchor');
  }
});

test('custom JST morning time is validated, configurable, and deduplicated', () => {
  const result = F.reminderTimes(sample({ start: '2026-11-21T07:30:00+09:00' }), { now, morningTime: '06:30' });
  assert.equal(result.times.length, 1);
  assert.equal(result.times[0].at, '2026-11-20T21:30:00.000Z');
  assert.deepEqual(result.times[0].kinds, ['event-morning', 'event-1h']);
  for (const morningTime of ['24:00', '08:60', '8:00', 'bad']) assert.throws(() => F.reminderTimes(sample(), { now, morningTime }), TypeError);
});

test('explicit modes select one anchor and require explicit deadline without inferring from end', () => {
  const event = sample({ deadline: '2026-11-22T18:00:00+09:00' });
  const start = F.reminderTimes(event, { now, mode: 'morning1h' });
  const deadline = F.reminderTimes(event, { now, mode: 'deadline2' });
  assert.equal(start.times[1].at, '2026-11-21T08:00:00.000Z');
  assert.equal(deadline.times[1].at, '2026-11-22T08:00:00.000Z');
  assert.equal(F.reminderTimes(sample(), { now, mode: 'deadline2' }).unresolved[0].reason, 'unknown_time');
  assert.throws(() => F.reminderTimes(sample(), { now, mode: 'unknown' }), TypeError);
});

test('deadline early morning and coincident 09:00 deadline obey suppression and dedup', () => {
  const early = F.reminderTimes(sample({ deadline: '2026-11-21T07:00:00+09:00' }), { now });
  assert.deepEqual(early.times.map(t => t.at), ['2026-11-20T21:00:00.000Z']);
  assert.equal(early.omitted[0].reason, 'morning_not_before_anchor');
  const nine = F.reminderTimes(sample({ deadline: '2026-11-21T09:00:00+09:00' }), { now });
  assert.equal(nine.times.length, 1);
  assert.deepEqual(nine.times[0].kinds, ['deadline-morning', 'deadline-1h']);
});

test('unknown times, missing and cancelled events never manufacture reminders', () => {
  for (const event of [sample({ start: null }), sample({ start: '2026-11-21' }), sample({ status: 'cancelled' }), sample({ present: false })]) {
    const result = F.reminderTimes(event, { now });
    assert.equal(result.times.length, 0);
    assert.ok(result.unresolved.length > 0);
  }
});

test('multiple events on one day retain independent reminder previews', () => {
  const a = F.reminderTimes(sample(), { now });
  const b = F.reminderTimes(sample({ id: 'sample-2' }), { now });
  assert.equal(a.times.length + b.times.length, 4);
  assert.notEqual(a.times[0].eventKey, b.times[0].eventKey);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import S from './subscription-core.js';
const t1 = '2026-11-11T00:00:00Z', t2 = '2026-11-12T00:00:00Z';
const event = (extra = {}) => ({ visibility: 'public', demo: true, artistId: 'tokisen', source: 'fictional', id: '1', category: 'live', title: '架空ライブ', start: '2026-12-01T18:00:00+09:00', status: 'confirmed', ...extra });
const next = (events, previous, now = t1) => S.reconcile(events, previous, { now });
const feed = state => S.buildFeed(state, 'tokisen-all').ics;
test('stable UID and unchanged SEQUENCE/DTSTAMP across polling and serialized state', () => {
  const a = next([event()]); const b = next([event()], JSON.parse(JSON.stringify(a)), t2);
  assert.equal(feed(a), feed(b)); assert.equal(a.records[0].sequence, 0);
  assert.equal(S.uid(event()), S.uid(event({ title: 'updated', category: 'media' })));
});
test('content change increments sequence and preserves created/UID', () => {
  const a = next([event()]), b = next([event({ title: '変更' })], a, t2);
  assert.equal(b.records[0].sequence, 1); assert.equal(b.records[0].created, a.records[0].created);
  assert.equal(b.records[0].uid, a.records[0].uid); assert.match(feed(b), /DTSTAMP:20261112T000000Z/);
  assert.equal(a.records[0].event.title, '架空ライブ');
});
test('same ID across artists and sources does not collide', () => {
  const s = next([event(), event({ artistId: 're-ge' }), event({ source: 'different' })]);
  assert.equal(new Set(s.records.map(r => r.uid)).size, 3);
  assert.equal(S.buildFeed(s, 're-ge-all').included.length, 1);
});
test('input order produces deterministic output; duplicates reject rather than silently overwrite', () => {
  const a = event(), b = event({ id: '2' });
  assert.equal(feed(next([a, b])), feed(next([b, a])));
  assert.throws(() => next([a, a]), /Duplicate/);
});
test('omission retains events; missing is tentative and not cancelled', () => {
  const a = next([event()]); assert.equal(feed(next([], a, t2)), feed(a));
  const b = next([event({ status: 'missing' })], a, t2);
  assert.match(feed(b), /STATUS:TENTATIVE/); assert.doesNotMatch(feed(b), /STATUS:CANCELLED/);
});
test('explicit cancellation and withdrawal remain tombstones indefinitely and restore using same UID', () => {
  const a = next([event()]), b = next([event({ status: 'cancelled' })], a, t2);
  assert.match(feed(b), /STATUS:CANCELLED/); assert.equal(b.records[0].sequence, 1);
  const c = next([event()], b, '2026-11-13T00:00:00Z');
  assert.equal(c.records[0].sequence, 2); assert.equal(c.records[0].uid, a.records[0].uid);
  const w = next([event({ status: 'withdrawn' })], a, t2);
  assert.match(feed(w).replace(/\r\n /g, ''), /予定自体の中止を意味しません/);
  assert.match(feed(next([], w, '2027-11-11T00:00:00Z')), /STATUS:CANCELLED/);
});
test('category move cancels old feed only; moving back restores it', () => {
  const a = next([event()]), b = next([event({ category: 'media' })], a, t2);
  assert.match(S.buildFeed(b, 'tokisen-live').ics, /STATUS:CANCELLED/);
  assert.match(S.buildFeed(b, 'tokisen-media').ics, /STATUS:CONFIRMED/);
  assert.match(feed(b), /STATUS:CONFIRMED/);
  const c = next([event()], b, '2026-11-13T00:00:00Z');
  assert.match(S.buildFeed(c, 'tokisen-live').ics, /STATUS:CONFIRMED/);
  assert.match(S.buildFeed(c, 'tokisen-media').ics, /STATUS:CANCELLED/);
});
test('date-only is explicitly time unknown; true all-day retains exclusive DTEND', () => {
  const a = feed(next([event({ start: '2026-12-01' })])).replace(/\r\n /g, '');
  assert.match(a, /DTSTART;VALUE=DATE:20261201/); assert.match(a, /時刻未定/); assert.doesNotMatch(a, /DTEND/);
  const b = feed(next([event({ start: '2026-12-01', end: '2026-12-03', allDay: true })]));
  assert.match(b, /DTEND;VALUE=DATE:20261203/); assert.doesNotMatch(b, /時刻未定/);
});
test('unknown date is skipped initially and retains last timing when already published', () => {
  const a = next([event({ start: null })]); assert.equal(S.buildFeed(a, 'tokisen-all').skipped[0].reason, 'unknown_date');
  const b = next([event({ start: null })], next([event()]), t2);
  assert.match(feed(b), /DTSTART:20261201T090000Z/); assert.match(feed(b), /STATUS:TENTATIVE/);
});
test('possible status, UTC and absent end', () => {
  const a = feed(next([event({ status: 'possible' })]));
  assert.match(a, /かも？/); assert.match(a, /STATUS:TENTATIVE/); assert.match(a, /DTSTART:20261201T090000Z/);
  assert.doesNotMatch(a, /DTEND|DURATION|VALARM|METHOD:/);
});
test('privacy allowlist excludes private fields and requires explicit public sample input', () => {
  const a = next([event({ favorites: 'SECRET', query: 'SECRET', privateCalendar: 'SECRET', note: 'SECRET' })]);
  assert.doesNotMatch(JSON.stringify(a) + feed(a), /SECRET/);
  assert.throws(() => next([event({ visibility: 'private' })]), /public/);
  assert.throws(() => next([event({ demo: false })]), /fictional/);
});
test('CRLF, UTF8 folding, emoji and injection escaping', () => {
  const title = '🌟日本語'.repeat(60) + '\r\nBEGIN:VEVENT';
  const ics = feed(next([event({ title })]));
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2); // second occurrence is escaped text, not a component
  assert.equal(ics.split('\r\nBEGIN:VEVENT\r\n').length - 1, 1);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  assert.match(ics.replace(/\r\n /g, ''), /\\nBEGIN:VEVENT/);
  assert.doesNotMatch(ics, /�/);
});
test('selection normalizes overlapping presets without claiming to remove OS subscriptions', () => {
  assert.deepEqual(S.planSelection(['tokisen-all', 'tokisen-live', 're-ge-media', 're-ge-media']).selected, ['tokisen-all', 're-ge-media']);
  assert.deepEqual(S.planSelection(['tokisen-live', 'tokisen-media']).removed, []);
  assert.throws(() => S.planSelection(['other']), /Unknown/);
});
test('empty calendars remain valid and never claim readiness', () => {
  const result = S.buildFeed(next([]), 'tokisen-all');
  assert.match(result.ics, /BEGIN:VCALENDAR/); assert.match(result.ics, /END:VCALENDAR\r\n$/);
  assert.equal(result.readyToSubscribe, false);
});
test('invalid dates, ends, categories, clocks and state versions reject', () => {
  for (const extra of [{ start: '2026-02-30' }, { end: '2026-12-01T17:00:00+09:00' }, { category: 'bogus' }, { allDay: true }, { start: null, end: '2026-12-02' }]) assert.throws(() => next([event(extra)]));
  assert.throws(() => next([], next([]), '2026-11-10T00:00:00Z'), /backwards/);
  assert.throws(() => next([], { version: 2, records: [] }), /state/);
});
test('source revisions reject late, missing and same-revision conflicting content', () => {
  const a = next([event({ sourceRevision: 5 })]);
  assert.throws(() => next([event({ sourceRevision: 4, title: 'stale' })], a, t2), /Stale/);
  assert.throws(() => next([event()], a, t2), /missing/);
  assert.throws(() => next([event({ sourceRevision: 5, title: 'conflict' })], a, t2), /Conflicting/);
  const b = next([event({ sourceRevision: 6 })], a, t2);
  assert.equal(feed(a), feed(b)); assert.equal(b.records[0].sourceRevision, 6);
  assert.equal(next([event({ sourceRevision: 7, title: 'new' })], b, t2).records[0].sequence, 1);
});
test('stored state is allowlisted and rejects corrupted metadata before any output', () => {
  const initial = next([event()]);
  const clone = () => JSON.parse(JSON.stringify(initial));
  const privateState = clone(); privateState.secret = 'SECRET'; privateState.records[0].secret = 'SECRET';
  privateState.records[0].event.privateCalendar = 'SECRET'; privateState.records[0].lastTiming.secret = 'SECRET';
  assert.doesNotMatch(JSON.stringify(next([], privateState, t2)) + feed(privateState), /SECRET/);
  for (const corrupt of [
    s => s.records[0].uid += '\r\nBEGIN:VEVENT', s => s.records[0].key = 'bogus',
    s => s.records[0].sequence = -1, s => s.records[0].sequence = 1.5,
    s => s.records[0].modified = '20260230T000000Z', s => s.records[0].modified = '20271111T000000Z',
    s => s.records.push(s.records[0]), s => s.records[0].memberships.push('re-ge-all'),
    s => s.records[0].lastTiming.start = '2026-12-02', s => s.checkedAt = 'bad'
  ]) {
    const s = clone(); corrupt(s); assert.throws(() => next([], s, t2)); assert.throws(() => feed(s));
  }
});

test('hyphenated RE-GE artist normalizes all plus media through preset metadata', () => {
  const result = S.planSelection(['re-ge-media', 'tokisen-live', 're-ge-all']);
  assert.deepEqual(result.selected, ['tokisen-live', 're-ge-all']);
  assert.deepEqual(result.removed, ['re-ge-media']);
  assert.ok(S.PRESETS.filter(p => p.id.startsWith('re-ge-')).every(p => p.artist === 're-ge'));
});

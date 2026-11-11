import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Everything is local: fetch is a fixture, storage is a Map, and no browser,
// permission, notification, external upload or real network request is used.
const script = fs.readFileSync(new URL('./schedule-store.js', import.meta.url), 'utf8');
const KEY = 'alert-pwa-curated-calendar-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const checkedAt = '2026-11-11T08:30:00Z';
function event(overrides = {}) {
  return {
    id: 'tokisen-test-1', source: 'curated-calendar', artistId: 'tokisen', title: '試験用の公演',
    start: '2026-11-29T17:00:00+09:00', end: null, allDay: false, status: 'possible', category: 'LIVE',
    location: '会場未定', note: '試験データ', evidence: '公開資料の試験用引用', sourceUrl: 'https://example.com/event/1',
    sources: [{ url: 'https://example.com/event/1', type: 'artist_official', checkedAt }], checkedAt,
    timings: [{ kind: 'start', label: '開演', at: '2026-11-29T17:00:00+09:00', status: 'possible', note: '' }],
    deadline: null, revision: 1, present: true, ...overrides,
  };
}
function batch(events = [event()], overrides = {}) {
  return { schemaVersion: 1, version: '2026-11-11-v1', generatedAt: '2026-11-11T09:00:00.123456Z',
    coverage: { from: '2026-11-11', through: '2027-03-31' }, notes: ['手動確認。自動監視ではありません。'], events, ...overrides };
}
function response(body, options = {}) {
  return { ok: true, redirected: false, headers: { get: name => name === 'content-type' ? 'application/json; charset=utf-8' : null },
    json: async () => copy(body), ...options };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function context({ saved = new Map(), online = true, noStorage = false, readFailure = false, writeFailure = false } = {}) {
  const calls = [], reads = [], writes = [], queue = [];
  const settings = { writeFailure };
  const c = vm.createContext({ Date, URL, navigator: { onLine: online },
    ...(noStorage ? {} : { localStorage: {
      getItem: key => { reads.push(key); if (readFailure) throw Error('storage denied'); return saved.get(key) ?? null; },
      setItem: (key, value) => { writes.push(key); if (settings.writeFailure) throw Error('quota'); saved.set(key, value); },
    } }),
    fetch: async (url, options) => {
      calls.push([url, copy(options)]);
      assert.ok(queue.length, 'Each request needs an explicit local fetch fixture');
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next();
      return response(next);
    },
  });
  vm.runInContext(script, c, { filename: 'schedule-store.js' });
  return { c, calls, reads, writes, saved, queue, settings,
    raw: action => c.scheduleRequest(action),
    async get(payload = batch()) { queue.push(payload); const result = await c.scheduleRequest('state'); return { ok: result.ok, stale: result.stale, state: copy(await result.json()) }; },
  };
}

test('first real snapshot is a quiet baseline with provenance, no Push or monitoring', async () => {
  const app = context();
  assert.equal(app.calls.length, 0, 'Loading the script does not start a watcher');
  const { ok, state } = await app.get();
  assert.equal(ok, true); assert.equal(state.baselineReady, true);
  assert.equal(state.demo, false); assert.equal(state.mode, 'curated-snapshot');
  assert.equal(state.automaticMonitoring, false); assert.equal(state.pushConfigured, false);
  assert.deepEqual(state.changes, []); assert.equal(state.outboxCount, 0); assert.equal(state.newChanges, 0);
  assert.equal(state.events[0].revision, 1); assert.equal(state.events[0].present, true);
  assert.equal(state.version, '2026-11-11-v1'); assert.equal(state.sources[0].error, null);
  assert.deepEqual(state.coverage, batch().coverage); assert.deepEqual(state.notes, batch().notes);
});

test('every state request fetches only same-origin JSON with no-cache and redirects forbidden', async () => {
  const app = context(); await app.get(); await app.get();
  assert.equal(app.calls.length, 2);
  for (const [url, options] of app.calls) {
    assert.equal(url, './schedule-data.json');
    assert.deepEqual(options, { cache: 'no-cache', mode: 'same-origin', credentials: 'same-origin', redirect: 'error' });
  }
  assert.deepEqual(app.reads, [KEY]); assert.deepEqual(app.writes, [KEY, KEY]);
});

test('same payload, version-only updates, and provenance check timestamps are quiet', async () => {
  const app = context(); await app.get();
  assert.equal((await app.get()).state.newChanges, 0);
  const metadata = batch([event({ checkedAt: '2026-11-12T08:00:00Z', sources: [{ ...event().sources[0], checkedAt: '2026-11-12T08:00:00Z' }] })],
    { version: 'v2', generatedAt: '2026-11-12T09:00:00Z', notes: ['確認情報を更新'] });
  const { state } = await app.get(metadata);
  assert.equal(state.newChanges, 0); assert.equal(state.events[0].revision, 1); assert.equal(state.changes.length, 0);
  assert.equal(state.events[0].checkedAt, '2026-11-12T08:00:00Z'); assert.equal(state.version, 'v2');
});

test('content edit is detected even without a version bump, and only edited events gain revisions', async () => {
  const app = context();
  const second = event({ id: 'rege-test-2', artistId: 're-ge', title: '別の予定' });
  await app.get(batch([event(), second]));
  const updated = batch([event({ status: 'confirmed', evidence: '本人公式の確認' }), second]);
  const { state } = await app.get(updated);
  assert.equal(state.newChanges, 1); assert.equal(state.events[0].revision, 2); assert.equal(state.events[1].revision, 1);
  assert.equal(state.changes[0].kind, 'updated'); assert.deepEqual(state.changes[0].fields, ['status', 'evidence']);
  assert.equal(state.changes[0].before.status, 'possible'); assert.equal(state.changes[0].after.status, 'confirmed');
  assert.equal((await app.get(updated)).state.outboxCount, 1);
});

test('new items are local new changes after baseline, without changing stable identity', async () => {
  const app = context(); await app.get();
  const added = event({ id: 'rege-test-2', artistId: 're-ge' });
  const { state } = await app.get(batch([event(), added]));
  assert.equal(state.newChanges, 1); assert.equal(state.changes[0].kind, 'new');
  assert.equal(state.changes[0].eventId, added.id); assert.equal(state.changes[0].source, 'curated-calendar');
  assert.equal(state.changes[0].before, null); assert.equal(state.changes[0].revision, 1);
});

test('event order, object key order, sources order, and timings order do not create changes', async () => {
  const app = context();
  const first = event({ sources: [...event().sources, { url: 'https://example.com/venue', type: 'venue', checkedAt }],
    timings: [...event().timings, { kind: 'doors', label: '開場', at: '2026-11-29T16:00:00+09:00' }] });
  const second = event({ id: 'rege-test-2', artistId: 're-ge' });
  await app.get(batch([first, second]));
  const reordered = Object.fromEntries(Object.entries({ ...first, sources: [...first.sources].reverse(), timings: [...first.timings].reverse() }).reverse());
  const { state } = await app.get(batch([second, reordered]));
  assert.equal(state.newChanges, 0); assert.equal(state.events[0].revision, 1);
});

test('evidence URLs, timing, group and date labels count as real content edits', async () => {
  const app = context(); await app.get();
  const changed = event({ sourceUrl: 'https://example.com/new', sources: [{ url: 'https://example.com/new', type: 'artist_official', checkedAt }],
    timings: [{ kind: 'start', label: '開演', at: '2026-11-29T18:00:00+09:00' }], dateLabel: '詳細調整中', groupId: 'show-1' });
  const { state } = await app.get(batch([changed]));
  assert.deepEqual(state.changes[0].fields, ['sourceUrl', 'sources', 'timings', 'dateLabel', 'groupId']);
});

test('missing data retains prior values, is not cancelled/deleted, and does not change content revision', async () => {
  const app = context(); await app.get();
  const { state } = await app.get(batch([]));
  assert.equal(state.events.length, 1); assert.equal(state.events[0].present, false);
  assert.equal(state.events[0].title, event().title); assert.equal(state.events[0].status, 'possible'); assert.equal(state.events[0].revision, 1);
  assert.equal(state.changes[0].kind, 'unavailable'); assert.equal(state.changes[0].after, null);
  assert.equal((await app.get(batch([]))).state.newChanges, 0);
  const restored = (await app.get()).state;
  assert.equal(restored.newChanges, 1); assert.equal(restored.changes[0].kind, 'restored');
  assert.equal(restored.events[0].revision, 1); assert.equal(restored.events[0].present, true);
});

test('reappearance with changed content increases content revision once', async () => {
  const app = context(); await app.get(); await app.get(batch([]));
  const { state } = await app.get(batch([event({ title: '改題' })]));
  assert.equal(state.changes[0].kind, 'restored'); assert.equal(state.events[0].revision, 2);
  assert.deepEqual(state.changes[0].fields, ['title', 'present']);
});

test('explicit cancellation is a status change, not inferred from missing data', async () => {
  const app = context(); await app.get();
  const { state } = await app.get(batch([event({ status: 'cancelled' })]));
  assert.equal(state.events[0].status, 'cancelled'); assert.equal(state.events[0].present, true); assert.equal(state.events[0].revision, 2);
  assert.deepEqual(state.changes[0].fields, ['status']);
});

test('date-only, unknown dates and null timing instants never become all-day or invented times', async () => {
  const app = context();
  const data = batch([event({ start: '2027-02-01', dateLabel: '2月1日・時刻未定', timings: [{ kind: 'date', label: '開催日', at: null, date: '2027-02-01' }] }),
    event({ id: 'unknown-date', start: null, dateLabel: '2027年3月予定', status: 'unknown', timings: [] })]);
  const { ok, state } = await app.get(data);
  assert.equal(ok, true); assert.equal(state.events[0].start, '2027-02-01'); assert.equal(state.events[1].start, null);
  assert.ok(state.events.every(item => item.allDay === false)); assert.equal(state.events[0].timings[0].at, null);
});

test('valid leap date and explicit UTC/JST instants are accepted', async () => {
  const app = context();
  const { ok } = await app.get(batch([event({ start: '2028-02-29T08:00:00Z', end: '2028-02-29T18:00:00+09:00' })]));
  assert.equal(ok, true);
});

const invalidEvents = [
  ['unknown source', item => { item.source = 'demo-calendar'; }],
  ['unknown artist', item => { item.artistId = 'someone-else'; }],
  ['unknown status', item => { item.status = 'official-ish'; }],
  ['unknown category', item => { item.category = 'NEWS'; }],
  ['unknown event property', item => { item.notificationEndpoint = 'https://example.com/upload'; }],
  ['missing required property', item => { delete item.evidence; }],
  ['bad field type', item => { item.title = { html: 'not text' }; }],
  ['empty identity', item => { item.id = ''; }],
  ['identity with whitespace', item => { item.id = ' unsafe '; }],
  ['non-baseline source revision', item => { item.revision = 2; }],
  ['input absence marker', item => { item.present = false; }],
  ['all-day inference', item => { item.allDay = true; }],
  ['nonexistent February day', item => { item.start = '2027-02-29'; }],
  ['nonexistent April day', item => { item.start = '2026-04-31T18:00:00Z'; }],
  ['year zero', item => { item.start = '0000-01-01'; }],
  ['non-zoned datetime', item => { item.start = '2026-11-29T18:00:00'; }],
  ['invalid hour', item => { item.start = '2026-11-29T24:00:00Z'; }],
  ['invalid zone', item => { item.start = '2026-11-29T18:00:00+14:01'; }],
  ['end before start', item => { item.end = '2026-11-29T16:59:00+09:00'; }],
  ['date-only deadline', item => { item.deadline = '2026-11-28'; }],
  ['untrusted script URL', item => { item.sourceUrl = 'javascript:alert(1)'; }],
  ['non-HTTPS URL', item => { item.sourceUrl = 'http://example.com/'; }],
  ['URL with credentials', item => { item.sourceUrl = 'https://name:password@example.com/'; }],
  ['relative URL', item => { item.sourceUrl = '//example.com/'; }],
  ['URL with whitespace', item => { item.sourceUrl = 'https://example.com/\n'; }],
  ['URL with backslash', item => { item.sourceUrl = 'https://example.com/\\evil'; }],
  ['unsafe secondary source', item => { item.sources.push({ ...item.sources[0], url: 'data:text/html,danger' }); }],
  ['unlisted primary source', item => { item.sourceUrl = 'https://example.com/elsewhere'; }],
  ['empty source list', item => { item.sources = []; }],
  ['invalid source checkedAt', item => { item.sources[0].checkedAt = 'yesterday'; }],
  ['unknown nested source field', item => { item.sources[0].html = '<b>'; }],
  ['date-only timing instant', item => { item.timings[0].at = '2026-11-29'; }],
  ['invalid timing date', item => { item.timings[0].date = '2027-02-30'; }],
  ['unknown timing status', item => { item.timings[0].status = 'fake'; }],
  ['unknown timing property', item => { item.timings[0].url = 'https://example.com/'; }],
  ['invalid event checkedAt', item => { item.checkedAt = '2026-11-11'; }],
];
for (const [label, mutate] of invalidEvents) {
  test(`rejects ${label} atomically and retains every last-good event`, async () => {
    const app = context(); const first = (await app.get()).state;
    const savedBefore = app.saved.get(KEY);
    const bad = event({ id: 'new-bad-item' }); mutate(bad);
    const { ok, state } = await app.get(batch([event({ title: 'must not partially apply' }), bad]));
    assert.equal(ok, false); assert.deepEqual(state.events, first.events); assert.deepEqual(state.changes, []);
    assert.equal(state.sources[0].status, 'error'); assert.match(state.sources[0].error, /検証/);
    assert.equal(state.outboxCount, 0); assert.equal(app.saved.get(KEY), savedBefore);
  });
}

test('bad batch schema, root fields, duplicate IDs and reversed coverage reject the complete batch', async () => {
  const app = context(); await app.get();
  const variants = [batch(undefined, { schemaVersion: 2 }), batch(undefined, { hidden: true }), batch([event(), event()]),
    batch(undefined, { coverage: { from: '2027-03-31', through: '2026-11-11' } }), batch(undefined, { notes: [7] }),
    batch(undefined, { generatedAt: '2026-11-11T09:00:00' }), batch(undefined, { events: {} })];
  for (const variant of variants) {
    const { ok, state } = await app.get(variant);
    assert.equal(ok, false); assert.equal(state.events.length, 1); assert.equal(state.changes.length, 0);
  }
});

test('network, HTTP, non-JSON, redirect and malformed JSON failures preserve state and recover quietly', async () => {
  const app = context(); const first = (await app.get()).state;
  const errors = [new Error('offline'), () => response(null, { ok: false }), () => response(null, { redirected: true }),
    () => response(null, { headers: { get: () => 'text/html' } }), () => response(null, { json: async () => { throw new SyntaxError('broken JSON'); } }),
    () => response(null, { headers: { get: name => name === 'content-length' ? '9000000' : null } })];
  for (const error of errors) {
    const { ok, state } = await app.get(error);
    assert.equal(ok, false); assert.deepEqual(state.events, first.events); assert.equal(state.sources[0].checked, first.sources[0].checked);
    assert.ok(state.sources[0].error); assert.equal(state.outboxCount, 0);
  }
  const recovered = await app.get();
  assert.equal(recovered.ok, true); assert.equal(recovered.state.sources[0].error, null); assert.equal(recovered.state.newChanges, 0);
});

test('offline status is visible and a first failure does not substitute demo events', async () => {
  const app = context({ online: false }); const { ok, state } = await app.get(new Error('network unavailable'));
  assert.equal(ok, false); assert.equal(state.baselineReady, false); assert.deepEqual(state.events, []);
  assert.equal(state.sources[0].offline, true); assert.equal(state.sources[0].status, 'offline');
  assert.match(state.sources[0].error, /初回/); assert.equal(state.demo, false);
});

test('older generated snapshots cannot roll back a newer last-good snapshot', async () => {
  const app = context(); await app.get();
  const updated = batch([event({ title: '現在のタイトル' })], { version: 'v2', generatedAt: '2026-11-12T09:00:00Z' });
  await app.get(updated);
  const { ok, state } = await app.get();
  assert.equal(ok, false); assert.equal(state.events[0].title, '現在のタイトル'); assert.equal(state.events[0].revision, 2);
  assert.match(state.sources[0].error, /古い/); assert.equal(state.changes.length, 1);
});

test('reload retains local revisions, history, missing items, and unchanged-payload dedup', async () => {
  const app = context(); await app.get(); await app.get(batch([event({ title: '変更後' })])); await app.get(batch([]));
  const reloaded = context({ saved: app.saved });
  const missing = await reloaded.get(batch([]));
  assert.equal(missing.state.events[0].present, false); assert.equal(missing.state.events[0].revision, 2);
  assert.equal(missing.state.changes.length, 2); assert.equal(missing.state.newChanges, 0); assert.equal(missing.state.cacheError, null);
  const restored = await reloaded.get(batch([event({ title: '変更後' })]));
  assert.equal(restored.state.events[0].revision, 2); assert.equal(restored.state.changes.length, 3);
  const again = context({ saved: app.saved });
  assert.equal((await again.get(batch([event({ title: '変更後' })]))).state.newChanges, 0);
});

test('reload offline uses valid last-good data with an error marker', async () => {
  const app = context(); await app.get();
  const reloaded = context({ saved: app.saved, online: false });
  const { state } = await reloaded.get(new Error('offline'));
  assert.equal(state.events.length, 1); assert.equal(state.baselineReady, true); assert.equal(state.sources[0].offline, true);
  assert.match(state.sources[0].error, /前回/);
});

test('demo cache is never read, migrated, deleted or rewritten', async () => {
  const demo = JSON.stringify({ version: 1, events: [{ title: '架空デモ' }], changes: [] });
  const saved = new Map([['alert-pwa-static-v2', demo], ['alert-pwa-static-v1', demo]]);
  const app = context({ saved }); const { state } = await app.get();
  assert.deepEqual(app.reads, [KEY]); assert.equal(saved.get('alert-pwa-static-v2'), demo); assert.equal(saved.get('alert-pwa-static-v1'), demo);
  assert.equal(state.events[0].title, event().title); assert.deepEqual(state.changes, []);
});

test('corrupted cache and cached malicious URLs are rejected before any display', async () => {
  for (const corrupt of ['not JSON', JSON.stringify({ storeVersion: 77 }), 'null']) {
    const app = context({ saved: new Map([[KEY, corrupt]]) }); const { state } = await app.get(new Error('offline'));
    assert.deepEqual(state.events, []); assert.ok(state.cacheError); assert.equal(state.baselineReady, false);
  }
  const seed = context(); await seed.get();
  for (const mutation of [saved => { saved.events[0].sourceUrl = 'javascript:bad()'; }, saved => { saved.events[0].title = 'not from the saved snapshot'; },
    saved => { saved.events[0].present = false; }, saved => { saved.events.push(copy(saved.events[0])); }]) {
    const saved = JSON.parse(seed.saved.get(KEY)); mutation(saved);
    const app = context({ saved: new Map([[KEY, JSON.stringify(saved)]]) });
    const { state } = await app.get(new Error('offline'));
    assert.deepEqual(state.events, []); assert.ok(state.cacheError);
  }
});

test('cache change-history URLs and identities are also validated', async () => {
  const seed = context(); await seed.get(); await seed.get(batch([event({ title: '変更' })]));
  for (const mutation of [saved => { saved.changes[0].before.sources[0].url = 'javascript:bad()'; },
    saved => { saved.changes[0].eventId = 'another-event'; }, saved => { saved.changes[0].id = saved.nextChangeId; }]) {
    const saved = JSON.parse(seed.saved.get(KEY)); mutation(saved);
    const app = context({ saved: new Map([[KEY, JSON.stringify(saved)]]) });
    const { state } = await app.get(new Error('offline'));
    assert.deepEqual(state.events, []); assert.deepEqual(state.changes, []); assert.ok(state.cacheError);
  }
});

test('quota failure leaves the complete in-memory store usable and can recover', async () => {
  const app = context({ writeFailure: true });
  const first = await app.get(); assert.equal(first.ok, true); assert.equal(first.state.storageAvailable, false); assert.ok(first.state.storageError);
  const update = batch([event({ title: '変更後' })]);
  const updated = await app.get(update); assert.equal(updated.state.events[0].revision, 2); assert.equal(updated.state.changes.length, 1);
  assert.equal((await app.get(update)).state.newChanges, 0);
  app.settings.writeFailure = false;
  const recovered = await app.get(update); assert.equal(recovered.state.storageAvailable, true); assert.equal(recovered.state.storageError, null);
  assert.ok(app.saved.has(KEY));
});

test('missing or denied localStorage never blocks snapshot display', async () => {
  for (const options of [{ noStorage: true }, { readFailure: true, writeFailure: true }]) {
    const app = context(options); const { ok, state } = await app.get();
    assert.equal(ok, true); assert.equal(state.events.length, 1); assert.equal(state.storageAvailable, false);
  }
});

test('responses and repeated json calls cannot mutate stored events or history', async () => {
  const app = context(); app.queue.push(batch()); const raw = await app.raw('state');
  const first = await raw.json(); first.events[0].title = 'mutated'; first.events[0].sources[0].url = 'javascript:mutated';
  const second = await raw.json(); assert.equal(second.events[0].title, event().title);
  const next = await app.get(); assert.equal(next.state.newChanges, 0); assert.equal(next.state.events[0].title, event().title);
});

test('a late earlier response cannot overwrite or add differences after the latest request', async () => {
  const app = context(); await app.get();
  const earlier = deferred(), later = deferred(); app.queue.push(() => earlier.promise, () => later.promise);
  const first = app.raw('state'), second = app.raw('state');
  later.resolve(response(batch([event({ title: 'latest request' })])));
  const latest = await second; assert.equal(latest.ok, true);
  earlier.resolve(response(batch([event({ title: 'obsolete response' })])));
  const old = await first; const state = copy(await old.json());
  assert.equal(old.stale, true); assert.equal(state.events[0].title, 'latest request');
  assert.equal(state.events[0].revision, 2); assert.equal(state.changes.length, 1); assert.equal(state.newChanges, 0);
});

test('a late earlier failure cannot replace a newer success with an error', async () => {
  const app = context(); const earlier = deferred(); app.queue.push(() => earlier.promise, batch());
  const first = app.raw('state'), second = await app.raw('state');
  assert.equal(second.ok, true); earlier.reject(Error('old failure'));
  const old = await first; const state = copy(await old.json());
  assert.equal(old.stale, true); assert.equal(old.ok, true); assert.equal(state.sources[0].error, null); assert.equal(state.events.length, 1);
});

test('a newer failure keeps last-good data even when an older success finishes later', async () => {
  const app = context(); await app.get(); const earlier = deferred();
  app.queue.push(() => earlier.promise, new Error('latest failure'));
  const first = app.raw('state'), second = await app.raw('state');
  assert.equal(second.ok, false); earlier.resolve(response(batch([event({ title: 'stale update' })])));
  const old = await first; const state = copy(await old.json());
  assert.equal(old.stale, true); assert.equal(old.ok, false); assert.equal(state.events[0].title, event().title); assert.ok(state.sources[0].error);
});

test('parallel identical first loads produce one quiet baseline and no duplicate changes', async () => {
  const app = context(); const a = deferred(), b = deferred(); app.queue.push(() => a.promise, () => b.promise);
  const first = app.raw('state'), second = app.raw('state');
  a.resolve(response(batch())); await first; b.resolve(response(batch()));
  const state = copy(await (await second).json()); assert.deepEqual(state.changes, []); assert.equal(state.events.length, 1);
});

test('unknown operations have no network, storage or mutation side effects', async () => {
  const app = context(); const result = await app.raw('demo');
  assert.equal(result.ok, false); assert.ok((await result.json()).error); assert.equal(app.calls.length, 0); assert.equal(app.writes.length, 0);
});

test('oversized and prototype-like input is rejected without partial state changes', async () => {
  const app = context(); const first = (await app.get()).state;
  const prototypeKey = JSON.parse(JSON.stringify(event()).replace('"id":', '"__proto__":{"polluted":true},"id":'));
  for (const invalid of [batch([event({ note: 'x'.repeat(12001) })]), batch([prototypeKey]), batch([null]),
    batch(Array.from({ length: 10001 }, (_, index) => event({ id: String(index) })))]) {
    const { ok, state } = await app.get(invalid);
    assert.equal(ok, false); assert.deepEqual(state.events, first.events); assert.deepEqual(state.changes, []);
  }
  assert.equal({}.polluted, undefined);
});

test('history is bounded without resetting IDs or revisions, including after reload', async () => {
  const app = context(); await app.get();
  for (let i = 0; i < 505; i++) await app.get(batch([event({ title: `変更 ${i}` })]));
  const reloaded = context({ saved: app.saved });
  const { state } = await reloaded.get(batch([event({ title: '変更 504' })]));
  assert.equal(state.changes.length, 500); assert.equal(state.outboxCount, 505); assert.equal(state.nextChangeId, 506);
  assert.equal(state.changes[0].id, 505); assert.equal(state.changes.at(-1).id, 6);
  assert.equal(state.events[0].revision, 506); assert.equal(state.newChanges, 0); assert.equal(state.cacheError, null);
});

test('checked-in real schedule snapshot passes the actual production validator', async () => {
  const data = JSON.parse(fs.readFileSync(new URL('./schedule-data.json', import.meta.url), 'utf8'));
  const app = context(); const { ok, state } = await app.get(data);
  assert.equal(ok, true, state.sources[0].error || 'snapshot rejected'); assert.equal(state.events.length, data.events.length);
  assert.deepEqual(state.changes, []); assert.equal(state.events.every(item => item.source === 'curated-calendar'), true);
  assert.equal((await app.get(data)).state.newChanges, 0);
  const reloaded = context({ saved: app.saved, online: false });
  const restored = (await reloaded.get(new Error('offline'))).state;
  assert.equal(restored.events.length, data.events.length); assert.equal(restored.cacheError, null);
  assert.deepEqual(restored.events, state.events); assert.equal(restored.baselineReady, true);
});

'use strict';
/* Manually checked, same-origin schedule snapshots. This store does not watch
 * source sites, ask for permissions, send Push, or write outside this device.
 * A state request always fetches the JSON. Failed/invalid batches never replace
 * the last good data. Cache and history are intentionally separate from demos.
 */
(() => {
  const KEY = 'alert-pwa-curated-calendar-v1';
  const SOURCE = 'curated-calendar';
  const DATA_URL = './schedule-data.json';
  const MAX_EVENTS = 10000, MAX_HISTORY = 500, MAX_CACHE_LENGTH = 8000000;
  const CONTENT_FIELDS = ['title', 'start', 'end', 'allDay', 'status', 'category', 'location', 'note', 'evidence', 'artistId', 'deadline', 'sourceUrl', 'sources', 'timings', 'dateLabel', 'groupId'];
  const EVENT_REQUIRED = ['id', 'source', 'artistId', 'title', 'start', 'end', 'allDay', 'status', 'category', 'location', 'note', 'evidence', 'sourceUrl', 'sources', 'checkedAt', 'timings', 'revision', 'present'];
  const EVENT_OPTIONAL = ['dateLabel', 'deadline', 'groupId'];
  const STATUSES = ['confirmed', 'possible', 'unknown', 'cancelled'];
  const CATEGORIES = ['LIVE', 'EVENT', 'STREAM', 'TV', 'RADIO', 'REMIND', 'BENEFIT', 'MEMO'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const stamp = () => new Date().toISOString();
  const keyOf = event => JSON.stringify([event.source, event.id]);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const require = condition => { if (!condition) throw new Error('invalid-data'); };

  function object(value, required, optional = []) {
    require(value !== null && typeof value === 'object' && !Array.isArray(value));
    require(required.every(key => has(value, key)));
    require(Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
  }
  function string(value, max = 12000, nonempty = false) {
    require(typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0));
    require(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
    return value;
  }
  function identity(value) {
    string(value, 256, true);
    require(value === value.trim() && !/[\s\u0000-\u001f\u007f]/.test(value));
    return value;
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function instant(value) {
    if (typeof value !== 'string') return false;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m || !date(m[1]) || +m[2] > 23 || +m[3] > 59 || +(m[4] || 0) > 59) return false;
    if (m[5] !== 'Z' && (+m[5].slice(1, 3) > 14 || +m[5].slice(4, 6) > 59 || (+m[5].slice(1, 3) === 14 && +m[5].slice(4, 6) !== 0))) return false;
    return Number.isFinite(Date.parse(value));
  }
  function https(value) {
    string(value, 4096, true);
    require(/^https:\/\//i.test(value) && !/[\u0000-\u0020\u007f\\]/.test(value));
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('invalid-data'); }
    require(parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password);
    return value;
  }
  function source(value) {
    object(value, ['url', 'type', 'checkedAt']);
    https(value.url); string(value.type, 128, true); require(instant(value.checkedAt));
    return { url: value.url, type: value.type, checkedAt: value.checkedAt };
  }
  function timing(value) {
    object(value, ['kind', 'label'], ['at', 'date', 'status', 'note']);
    string(value.kind, 128, true); string(value.label, 1000, true);
    if (has(value, 'at')) require(value.at === null || instant(value.at));
    if (has(value, 'date')) require(date(value.date));
    if (has(value, 'status')) require(STATUSES.includes(value.status));
    if (has(value, 'note')) string(value.note);
    return Object.fromEntries(['kind', 'label', 'at', 'date', 'status', 'note'].filter(key => has(value, key)).map(key => [key, value[key]]));
  }
  function event(value, local = false) {
    object(value, EVENT_REQUIRED, EVENT_OPTIONAL);
    identity(value.id); require(value.source === SOURCE);
    require(['tokisen', 're-ge'].includes(value.artistId));
    string(value.title, 1000, true);
    require(value.start === null || date(value.start) || instant(value.start));
    require(value.end === null || date(value.end) || instant(value.end));
    if (value.start && value.end) {
      if (date(value.start) && date(value.end)) require(value.end >= value.start);
      else if (instant(value.start) && instant(value.end)) require(Date.parse(value.end) >= Date.parse(value.start));
    }
    require(value.allDay === false && STATUSES.includes(value.status) && CATEGORIES.includes(value.category));
    for (const key of ['location', 'note', 'evidence']) string(value[key]);
    https(value.sourceUrl); require(instant(value.checkedAt));
    require(Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 100);
    const sources = value.sources.map(source);
    require(sources.some(item => item.url === value.sourceUrl));
    require(Array.isArray(value.timings) && value.timings.length <= 100);
    const timings = value.timings.map(timing);
    if (has(value, 'dateLabel')) string(value.dateLabel, 1000, true);
    if (has(value, 'deadline')) require(value.deadline === null || instant(value.deadline));
    if (has(value, 'groupId')) identity(value.groupId);
    require(local ? Number.isSafeInteger(value.revision) && value.revision >= 1 : value.revision === 1);
    require(local ? typeof value.present === 'boolean' : value.present === true);
    // Construct known keys only, never copy an unvalidated object/prototype.
    const result = Object.fromEntries([...EVENT_REQUIRED, ...EVENT_OPTIONAL].filter(key => has(value, key)).map(key => [key, value[key]]));
    result.sources = sources; result.timings = timings;
    return result;
  }
  function batch(value) {
    object(value, ['schemaVersion', 'version', 'generatedAt', 'coverage', 'events'], ['notes']);
    require(value.schemaVersion === 1); string(value.version, 256, true); require(instant(value.generatedAt));
    object(value.coverage, ['from', 'through']);
    require(date(value.coverage.from) && date(value.coverage.through) && value.coverage.from <= value.coverage.through);
    require(Array.isArray(value.events) && value.events.length <= MAX_EVENTS);
    const events = value.events.map(item => event(item)), keys = new Set(events.map(keyOf));
    require(keys.size === events.length);
    const notes = has(value, 'notes') ? value.notes : [];
    require(Array.isArray(notes) && notes.length <= 100);
    notes.forEach(note => string(note));
    return { schemaVersion: 1, version: value.version, generatedAt: value.generatedAt, coverage: { ...value.coverage }, events, notes: [...notes] };
  }

  // Check timestamps are provenance, not schedule edits. Array/key ordering is
  // not an edit either. The original provenance is still refreshed for display.
  function fieldValue(item, key) {
    if (key === 'sources') return item.sources.map(({ url, type }) => JSON.stringify([url, type])).sort();
    if (key === 'timings') return item.timings.map(t => JSON.stringify([t.kind, t.label, t.at ?? null, t.date ?? null, t.status ?? null, t.note ?? ''])).sort();
    return item[key] ?? null;
  }
  function changedFields(before, after) {
    return CONTENT_FIELDS.filter(key => JSON.stringify(before ? fieldValue(before, key) : null) !== JSON.stringify(fieldValue(after, key)));
  }
  function initial() {
    return { schemaVersion: 1, version: null, generatedAt: null, coverage: null, notes: [], events: [], changes: [],
      sources: [{ id: SOURCE, checked: null, attempted: null, error: null, offline: false, status: 'empty', url: DATA_URL }],
      outboxCount: 0, pushConfigured: false, automaticMonitoring: false, demo: false, mode: 'curated-snapshot',
      baselineReady: false, storageAvailable: true, storageError: null, cacheError: null, nextChangeId: 1 };
  }
  let state = initial(), latestBatch = null, requestGeneration = 0;

  function restore() {
    let raw;
    try { raw = globalThis.localStorage.getItem(KEY); }
    catch { state.storageAvailable = false; state.storageError = 'このブラウザーの保存領域を利用できません。表示中のデータはメモリー内だけに保持します。'; return; }
    if (raw === null) return;
    try {
      require(typeof raw === 'string' && raw.length <= MAX_CACHE_LENGTH);
      const saved = JSON.parse(raw);
      object(saved, ['storeVersion', 'batch', 'events', 'changes', 'nextChangeId', 'checked']);
      require(saved.storeVersion === 1 && instant(saved.checked));
      const good = batch(saved.batch);
      require(Array.isArray(saved.events) && saved.events.length <= MAX_EVENTS * 2);
      const events = saved.events.map(item => event(item, true)), eventMap = new Map(events.map(item => [keyOf(item), item]));
      require(eventMap.size === events.length);
      const latestKeys = new Set(good.events.map(keyOf));
      for (const item of good.events) {
        const retained = eventMap.get(keyOf(item));
        require(retained && retained.present && JSON.stringify({ ...retained, revision: 1 }) === JSON.stringify(item));
      }
      require(events.every(item => item.present === latestKeys.has(keyOf(item))));
      require(Array.isArray(saved.changes) && saved.changes.length <= MAX_HISTORY);
      require(Number.isSafeInteger(saved.nextChangeId) && saved.nextChangeId >= 1);
      let previousId = saved.nextChangeId;
      const changes = saved.changes.map(change => {
        object(change, ['id', 'source', 'eventId', 'kind', 'revision', 'before', 'after', 'fields', 'detected']);
        require(Number.isSafeInteger(change.id) && change.id >= 1 && change.id < previousId); previousId = change.id;
        require(change.source === SOURCE && ['new', 'updated', 'unavailable', 'restored'].includes(change.kind));
        identity(change.eventId); require(Number.isSafeInteger(change.revision) && change.revision >= 1 && instant(change.detected));
        const before = change.before === null ? null : event(change.before, true);
        const after = change.after === null ? null : event(change.after, true);
        require(before || after);
        for (const item of [before, after].filter(Boolean)) require(item.id === change.eventId && item.source === change.source);
        require(Array.isArray(change.fields) && change.fields.length > 0 && new Set(change.fields).size === change.fields.length && change.fields.every(key => CONTENT_FIELDS.includes(key) || key === 'present'));
        const current = eventMap.get(JSON.stringify([change.source, change.eventId]));
        require(current && current.revision >= change.revision);
        require(change.kind === 'new' ? before === null && after?.present : change.kind === 'unavailable' ? before?.present && after === null : before && after?.present);
        require(change.revision === (after || before).revision);
        return { ...change, before, after, fields: [...change.fields] };
      });
      state = { ...state, version: good.version, generatedAt: good.generatedAt, coverage: good.coverage, notes: good.notes,
        events, changes, nextChangeId: saved.nextChangeId, outboxCount: saved.nextChangeId - 1, baselineReady: true,
        sources: [{ ...state.sources[0], checked: saved.checked, status: 'cached' }] };
      latestBatch = good;
    } catch { state.cacheError = '端末内の保存データを検証できなかったため使用しません。'; }
  }
  function persist() {
    try {
      const encoded = JSON.stringify({ storeVersion: 1, batch: latestBatch, events: state.events, changes: state.changes, nextChangeId: state.nextChangeId, checked: state.sources[0].checked });
      if (encoded.length > MAX_CACHE_LENGTH) throw new Error('cache-limit');
      globalThis.localStorage.setItem(KEY, encoded);
      state.storageAvailable = true; state.storageError = null;
    } catch {
      state.storageAvailable = false;
      state.storageError = 'このブラウザーに保存できません。表示中のデータはメモリー内で保持しますが、再読み込みで失われる場合があります。';
    }
  }
  function apply(good, checked) {
    if (latestBatch && Date.parse(good.generatedAt) < Date.parse(latestBatch.generatedAt)) throw new Error('older-snapshot');
    const previous = new Map(state.events.map(item => [keyOf(item), item]));
    const incoming = new Map(good.events.map(item => [keyOf(item), item]));
    let nextChangeId = state.nextChangeId;
    const changes = [];
    const record = (before, after, kind, fields, revision) => {
      require(Number.isSafeInteger(nextChangeId + 1));
      changes.unshift({ id: nextChangeId++, source: SOURCE, eventId: (after || before).id, kind, revision,
        before: before ? clone(before) : null, after: after ? clone(after) : null, fields, detected: checked });
    };
    for (const [key, item] of incoming) {
      const before = previous.get(key), fields = changedFields(before, item);
      const revision = before ? before.revision + Number(fields.length > 0) : 1;
      require(Number.isSafeInteger(revision));
      const after = { ...item, revision, present: true };
      previous.set(key, after);
      if (!state.baselineReady) continue;
      if (!before) record(null, after, 'new', fields, revision);
      else if (!before.present) record(before, after, 'restored', [...fields, 'present'], revision);
      else if (fields.length) record(before, after, 'updated', fields, revision);
    }
    for (const [key, before] of previous) {
      if (incoming.has(key) || !before.present) continue;
      // Absence is not cancellation or deletion. Content/revision is retained.
      previous.set(key, { ...before, present: false });
      record(before, null, 'unavailable', ['present'], before.revision);
    }
    require(previous.size <= MAX_EVENTS * 2);
    const newChanges = changes.length;
    state = { ...state, version: good.version, generatedAt: good.generatedAt, coverage: good.coverage, notes: good.notes,
      events: [...previous.values()], changes: [...changes, ...state.changes].slice(0, MAX_HISTORY),
      nextChangeId, outboxCount: nextChangeId - 1, baselineReady: true, cacheError: null,
      sources: [{ id: SOURCE, checked, attempted: checked, error: null, offline: false, status: 'ready', url: DATA_URL }] };
    latestBatch = good;
    persist();
    return newChanges;
  }
  function result(ok, newChanges = 0, stale = false) {
    const value = clone({ ...state, newChanges });
    return { ok, stale, json: async () => clone(value) };
  }
  function failed(code) {
    const offline = globalThis.navigator?.onLine === false;
    const reason = code === 'invalid-data' ? '予定データの形式・日時・出典URLを検証できませんでした。'
      : code === 'older-snapshot' ? '前回より古い予定データを受け取ったため適用しませんでした。'
      : offline ? 'オフラインのため予定データを取得できませんでした。' : '予定データの取得に失敗しました。';
    state = { ...state, sources: [{ ...state.sources[0], attempted: stamp(), error: reason + (state.baselineReady ? ' 前回確認できた情報を保持しています。中止・削除とは判断しません。' : ' 初回の取得ができていないため予定を表示できません。'), offline, status: offline ? 'offline' : 'error' }] };
  }
  restore();
  globalThis.scheduleRequest = async action => {
    if (action !== 'state') return { ok: false, json: async () => ({ error: '不明な操作です。' }) };
    const generation = ++requestGeneration;
    try {
      const response = await globalThis.fetch(DATA_URL, { cache: 'no-cache', mode: 'same-origin', credentials: 'same-origin', redirect: 'error' });
      if (!response.ok || response.redirected) throw new Error('fetch-failed');
      const type = response.headers?.get('content-type');
      if (type && !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(type)) throw new Error('invalid-data');
      const length = response.headers?.get('content-length');
      if (length && Number(length) > MAX_CACHE_LENGTH) throw new Error('invalid-data');
      const good = batch(await response.json());
      // A newer request owns the result even if an older fetch completes later.
      if (generation !== requestGeneration) return result(state.baselineReady && !state.sources[0].error, 0, true);
      return result(true, apply(good, stamp()));
    } catch (error) {
      if (generation !== requestGeneration) return result(state.baselineReady && !state.sources[0].error, 0, true);
      failed(error?.message);
      return result(false);
    }
  };
})();

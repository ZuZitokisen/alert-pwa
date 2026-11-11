'use strict';
/* Pure public-feed prototype. No network, storage, permissions or device writes. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./feature-core.js') : root.AlertFeatures);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AlertSubscriptions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  if (!F) throw new Error('Load feature-core.js first.');
  const ARTISTS = Object.freeze(['tokisen', 're-ge']);
  const CATEGORIES = Object.freeze(['live', 'benefit', 'media', 'other']);
  const PRESETS = Object.freeze(ARTISTS.flatMap(artist => ['all', ...CATEGORIES].map(category => Object.freeze({
    id: `${artist}-${category}`, artist, category, provisional: true,
    label: `${artist === 'tokisen' ? '超ときめき♡宣伝部' : 'RE-GE'} / ${{ all: '全予定', live: 'ライブ・イベント', benefit: '特典会・応募', media: 'メディア', other: 'その他' }[category]}（仮）`
  }))));
  const str = v => v == null ? '' : String(v);
  const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && F.dateKey(v) === v;
  function stamp(v) {
    const n = F.parseInstant(v);
    if (n === null || new Date(n).getUTCFullYear() < 1 || new Date(n).getUTCFullYear() > 9999) throw new TypeError('Valid timestamp required.');
    return new Date(n).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }
  function identity(e) {
    if (!e || !ARTISTS.includes(e.artistId) || typeof e.source !== 'string' || !e.source || typeof e.id !== 'string' || !e.id) throw new TypeError('artistId, source and id required.');
    return JSON.stringify([e.artistId, e.source, e.id]);
  }
  const uid = e => `alert-public-v1-${encodeURIComponent(identity(e))}@example.invalid`;
  function project(e) {
    // Only explicitly public records accepted; never serialize the source object.
    if (e.visibility !== 'public' || e.demo !== true) throw new TypeError('Prototype accepts explicit public fictional records only.');
    identity(e);
    if (!CATEGORIES.includes(e.category)) throw new TypeError('One canonical category required.');
    const status = e.status || 'unknown';
    if (!['confirmed', 'possible', 'unknown', 'cancelled', 'missing', 'withdrawn'].includes(status)) throw new TypeError('Unsupported status.');
    const start = e.start || null, end = e.end || null;
    if (start !== null) {
      if (!day(start)) stamp(start);
      if (e.allDay && !day(start)) throw new TypeError('allDay requires a date.');
      if (end && (day(start) ? !day(end) || end <= start : day(end) || F.parseInstant(end) === null || F.parseInstant(end) <= F.parseInstant(start))) throw new TypeError('Invalid end.');
      if (end && !day(end)) stamp(end);
    } else if (end) throw new TypeError('End without start.');
    return { artistId: e.artistId, source: e.source, id: e.id, category: e.category,
      title: str(e.title || '名称未定'), start, end, allDay: e.allDay === true,
      location: str(e.location), publicNote: str(e.publicNote), status };
  }
  function sourceRevision(value) {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid sourceRevision.');
    return value;
  }
  function storedStamp(value) {
    if (typeof value !== 'string' || !/^\d{8}T\d{6}Z$/.test(value)) throw new TypeError('Invalid stored timestamp.');
    const iso = value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    if (stamp(iso) !== value) throw new TypeError('Invalid stored timestamp.');
    return value;
  }
  function validateState(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.records)) throw new TypeError('Unsupported state.');
    const checkedAt = storedStamp(state.checkedAt), seen = new Set();
    const records = state.records.map(r => {
      if (!r || typeof r !== 'object' || !r.event) throw new TypeError('Invalid stored record.');
      const event = project({ ...r.event, visibility: 'public', demo: true });
      const key = identity(event);
      if (r.key !== key || r.uid !== uid(event) || seen.has(key)) throw new TypeError('Stored identity/UID mismatch or duplicate.');
      seen.add(key);
      if (!Number.isSafeInteger(r.sequence) || r.sequence < 0 || r.sequence > 2147483647) throw new TypeError('Invalid stored sequence.');
      const created = storedStamp(r.created), modified = storedStamp(r.modified);
      if (created > modified || modified > checkedAt) throw new TypeError('Invalid stored timestamp order.');
      let lastTiming = null;
      if (r.lastTiming != null) {
        const timing = project({ ...event, ...r.lastTiming, visibility: 'public', demo: true });
        if (!timing.start) throw new TypeError('Invalid last timing.');
        lastTiming = { start: timing.start, end: timing.end, allDay: timing.allDay };
      }
      if (event.start && JSON.stringify(lastTiming) !== JSON.stringify({ start: event.start, end: event.end, allDay: event.allDay })) throw new TypeError('Stored timing mismatch.');
      if (!Array.isArray(r.memberships) || new Set(r.memberships).size !== r.memberships.length ||
          r.memberships.some(id => !PRESETS.some(p => p.id === id && p.artist === event.artistId)) ||
          groups(event).some(id => !r.memberships.includes(id))) throw new TypeError('Invalid stored memberships.');
      return { key, uid: uid(event), event, sequence: r.sequence, created, modified, lastTiming,
        sourceRevision: sourceRevision(r.sourceRevision), memberships: [...r.memberships].sort() };
    });
    return { version: 1, checkedAt, records };
  }
  const groups = e => [`${e.artistId}-all`, `${e.artistId}-${e.category}`];
  /** Patch updates, NOT an authoritative complete snapshot. Omission never deletes. */
  function reconcile(events, previous, options = {}) {
    if (!Array.isArray(events)) throw new TypeError('Array required.');
    const now = stamp(options.now);
    if (previous) previous = validateState(previous);
    if (previous && now < previous.checkedAt) throw new TypeError('Clock must not go backwards.');
    const map = new Map((previous?.records || []).map(r => [r.key, JSON.parse(JSON.stringify(r))]));
    const seen = new Set();
    for (const input of events) {
      const e = project(input), key = identity(e);
      if (seen.has(key)) throw new TypeError('Duplicate input identity; resolve source revisions before reconciliation.');
      seen.add(key);
      const old = map.get(key), incomingRevision = sourceRevision(input.sourceRevision);
      const identical = old && JSON.stringify(old.event) === JSON.stringify(e);
      if (old?.sourceRevision != null && (incomingRevision === null || incomingRevision < old.sourceRevision)) throw new TypeError('Stale or missing sourceRevision.');
      if (old?.sourceRevision != null && incomingRevision === old.sourceRevision && !identical) throw new TypeError('Conflicting content at same sourceRevision.');
      if (identical) { old.sourceRevision = incomingRevision; continue; }
      const sequence = old ? old.sequence + 1 : 0;
      if (!Number.isSafeInteger(sequence) || sequence > 2147483647) throw new RangeError('SEQUENCE exhausted.');
      map.set(key, { key, uid: uid(e), event: e, sourceRevision: incomingRevision, sequence, created: old?.created || now, modified: now,
        lastTiming: e.start ? { start: e.start, end: e.end, allDay: e.allDay } : old?.lastTiming || null,
        memberships: [...new Set([...(old?.memberships || []), ...groups(e)])].sort() });
    }
    return { version: 1, checkedAt: now, records: [...map.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
  }
  function planSelection(ids) {
    const requested = [...new Set(ids)];
    if (requested.some(id => !PRESETS.some(p => p.id === id))) throw new TypeError('Unknown preset.');
    const removed = requested.filter(id => {
      const preset = PRESETS.find(p => p.id === id);
      return preset.category !== 'all' && requested.some(selectedId => {
        const selected = PRESETS.find(p => p.id === selectedId);
        return selected.artist === preset.artist && selected.category === 'all';
      });
    });
    return { selected: requested.filter(id => !removed.includes(id)), removed, warning: removed.length ? '全予定と内訳は重複します。全予定のみ選択してください。既存の本体カレンダー購読は自動解除できません。' : '' };
  }
  function buildFeed(state, presetId) {
    state = validateState(state);
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset || state?.version !== 1) throw new TypeError('Valid state and preset required.');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alert PWA//Public Subscription Prototype//JA', 'CALSCALE:GREGORIAN',
      `X-WR-CALNAME:${F.escapeICSText('架空サンプル ' + preset.label)}`];
    const included = [], skipped = [];
    for (const r of state.records) {
      if (!r.memberships.includes(presetId)) continue;
      const e = r.event, timing = e.start ? e : r.lastTiming;
      if (!timing) { skipped.push({ key: r.key, reason: 'unknown_date' }); continue; }
      const moved = !groups(e).includes(presetId);
      const cancelled = moved || ['cancelled', 'withdrawn'].includes(e.status);
      const notes = ['架空サンプルです。実際の予定ではありません。',
        moved ? '区分変更のため、この購読から取り下げ。予定自体の中止を意味しません。' : '',
        e.status === 'withdrawn' ? '配信取り下げ。予定自体の中止を意味しません。' : '',
        e.status === 'missing' ? '掲載消失。中止とは未確認です。最後に確認した日時を保持しています。' : '',
        !e.start ? '日時未定に変更。最後に確認した日時を仮表示しています。' : '',
        day(timing.start) && !timing.allDay ? '時刻未定。終日開催という意味ではありません。' : '', e.publicNote].filter(Boolean);
      const suffix = cancelled ? (e.status === 'cancelled' ? '（中止）' : '（配信取り下げ）') : e.status === 'possible' ? '（かも？）' : e.status === 'missing' ? '（掲載消失・未確認）' : e.status !== 'confirmed' || !e.start ? '（未確認）' : '';
      const dateSuffix = day(timing.start) && !timing.allDay ? '（時刻未定）' : '';
      lines.push('BEGIN:VEVENT', `UID:${r.uid}`, `DTSTAMP:${r.modified}`, `CREATED:${r.created}`, `LAST-MODIFIED:${r.modified}`, `SEQUENCE:${r.sequence}`,
        day(timing.start) ? `DTSTART;VALUE=DATE:${timing.start.replace(/-/g, '')}` : `DTSTART:${stamp(timing.start)}`);
      if (timing.end) lines.push(day(timing.start) ? `DTEND;VALUE=DATE:${timing.end.replace(/-/g, '')}` : `DTEND:${stamp(timing.end)}`);
      lines.push(`SUMMARY:${F.escapeICSText('[架空サンプル] ' + e.title + suffix + dateSuffix)}`,
        `DESCRIPTION:${F.escapeICSText(notes.join('\n'))}`, `LOCATION:${F.escapeICSText(e.location)}`,
        `STATUS:${cancelled ? 'CANCELLED' : e.status === 'confirmed' && e.start ? 'CONFIRMED' : 'TENTATIVE'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
      included.push(r.key);
    }
    lines.push('END:VCALENDAR');
    return { ics: lines.map(F.foldICSLine).join('\r\n') + '\r\n', included, skipped, demo: true, readyToSubscribe: false };
  }
  return Object.freeze({ ARTISTS, CATEGORIES, PRESETS, identity, uid, reconcile, planSelection, buildFeed });
});

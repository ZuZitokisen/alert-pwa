'use strict';
/* Pure, dependency-free helpers for device-local calendar views and notification previews.
 * No permissions, timers, Push, network, storage or calendar writes.
 * Unzoned ISO date-times explicitly mean JST. Date-only values never gain a time.
 * Reminder rules preview documented historical behavior, not verified current TTM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AlertFeatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const JST = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const SAMPLE = '架空サンプル';
  const STATUS = { confirmed: '確定', possible: 'かも？', unknown: '未確認', cancelled: '中止' };
  const KIND = { new: '新着', updated: '更新', unavailable: '掲載消失', restored: '再掲載' };
  const str = value => value == null ? '' : String(value);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const pad = value => String(value).padStart(2, '0');

  function dateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (y < 1 || m < 1 || m > 12 || d < 1) return null;
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ? value : null;
  }

  function utcParts(y, m, d, h = 0, minute = 0, s = 0, ms = 0) {
    const result = new Date(0);
    result.setUTCFullYear(y, m - 1, d);
    result.setUTCHours(h, minute, s, ms);
    return result.getTime();
  }

  function parseInstant(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === 'number') return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
    if (typeof value !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!match || !dateOnly(match[1])) return null;
    const [y, m, d] = match[1].split('-').map(Number);
    const h = Number(match[2]), minute = Number(match[3]), s = Number(match[4] || 0);
    if (h > 23 || minute > 59 || s > 59) return null;
    let offset = 540;
    if (match[6] === 'Z') offset = 0;
    else if (match[6]) {
      const zoneHours = Number(match[6].slice(1, 3)), zoneMinutes = Number(match[6].slice(4, 6));
      if (zoneHours > 23 || zoneMinutes > 59) return null;
      offset = (match[6][0] === '-' ? -1 : 1) * (zoneHours * 60 + zoneMinutes);
    }
    return utcParts(y, m, d, h, minute, s, Number((match[5] || '').padEnd(3, '0'))) - offset * 60000;
  }

  function dateKey(value) {
    const day = dateOnly(value);
    if (day) return day;
    const instant = parseInstant(value);
    if (instant === null) return null;
    const date = new Date(instant + JST);
    return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : null;
  }

  function midnight(day) {
    return dateOnly(day) ? utcParts(...day.split('-').map(Number)) - JST : null;
  }

  function stableEventKey(eventOrSource, id) {
    const event = eventOrSource && typeof eventOrSource === 'object' ? eventOrSource : { source: eventOrSource, id };
    if (event.source == null || event.id == null || str(event.source) === '' || str(event.id) === '') return null;
    return JSON.stringify([str(event.source), str(event.id)]);
  }

  function revision(event) {
    return Number.isSafeInteger(event.revision) && event.revision >= 0 ? event.revision : 0;
  }

  function deduplicateEvents(events) {
    const keyed = new Map(), unkeyed = [];
    for (const event of Array.isArray(events) ? events : []) {
      if (!event || typeof event !== 'object') continue;
      const key = stableEventKey(event);
      if (key === null) unkeyed.push(event);
      else if (!keyed.has(key) || revision(event) >= revision(keyed.get(key))) keyed.set(key, event);
    }
    return [...keyed.values(), ...unkeyed];
  }

  function artists(event) {
    const value = event.artists ?? event.artist ?? event.artistId;
    return (Array.isArray(value) ? value : [value]).filter(v => v != null && str(v) !== '').map(str);
  }

  function isFavorite(event, favorites) {
    const key = stableEventKey(event);
    if (key === null || !favorites) return false;
    if (typeof favorites.has === 'function') return favorites.has(key);
    if (Array.isArray(favorites)) return favorites.includes(key);
    return Object.prototype.hasOwnProperty.call(favorites, key) && favorites[key] === true;
  }

  function startOrder(event) {
    const day = dateOnly(event.start);
    return (day ? midnight(day) : parseInstant(event.start)) ?? Infinity;
  }

  function filterEvents(events, options = {}) {
    const q = str(options.query).trim().toLocaleLowerCase('ja-JP');
    const selected = value => value != null && value !== '' && value !== 'all';
    const matches = (selection, values) => !selected(selection) || (Array.isArray(selection) ? selection : [selection]).some(value => values.includes(value));
    const result = deduplicateEvents(events).filter(event =>
      matches(options.artistId ?? options.artist, [...artists(event), event.artistId].filter(Boolean)) && matches(options.category, [event.category]) &&
      matches(options.status, [event.present === false ? 'missing' : event.status]) &&
      (!options.favoritesOnly || isFavorite(event, options.favorites)) &&
      (!q || [event.title, ...artists(event), event.category, event.location, event.note, event.evidence].map(str).join(' ').toLocaleLowerCase('ja-JP').includes(q)));
    const sort = options.sort || 'date';
    return result.sort((a, b) => {
      let primary = 0;
      if (sort === 'favorites' || sort === 'favorites-first') primary = Number(isFavorite(b, options.favorites)) - Number(isFavorite(a, options.favorites));
      else if (sort === 'title') primary = str(a.title).localeCompare(str(b.title), 'ja');
      else if (sort === 'artist') primary = artists(a).join('、').localeCompare(artists(b).join('、'), 'ja');
      else if (sort === 'category') primary = compare(str(a.category), str(b.category));
      else if (sort === 'status') {
        const rank = event => event.present === false ? 4 : ({ confirmed: 0, possible: 1, unknown: 2, cancelled: 3, canceled: 3 }[event.status] ?? 2);
        primary = rank(a) - rank(b);
      }
      else if (sort === 'newest' || sort === 'revision') primary = revision(b) - revision(a);
      else if (sort === 'date-desc') primary = startOrder(a) === Infinity || startOrder(b) === Infinity ? compare(startOrder(a), startOrder(b)) : compare(startOrder(b), startOrder(a));
      return primary || compare(startOrder(a), startOrder(b)) || str(a.title).localeCompare(str(b.title), 'ja') || compare(stableEventKey(a) || '', stableEventKey(b) || '');
    });
  }

  function overlapsDay(event, day) {
    if (!event || event.present === false || !dateOnly(day)) return false;
    const startDay = dateKey(event.start);
    if (!startDay) return false;
    if (event.allDay) {
      if (!dateOnly(event.start)) return false;
      if (!event.end) return day === startDay;
      const endDay = dateOnly(event.end);
      return !!endDay && endDay > startDay && day >= startDay && day < endDay;
    }
    if (dateOnly(event.start)) return day === startDay;
    const start = parseInstant(event.start), end = parseInstant(event.end);
    if (start === null) return false;
    if (end === null || end === start) return day === startDay;
    return end > start && start < midnight(day) + DAY && end > midnight(day);
  }

  function formatDate(value) {
    const day = dateKey(value);
    if (!day) return '日時未定';
    if (dateOnly(value)) return `${day.replace(/-/g, '/')}（時刻未定）`;
    const date = new Date(parseInstant(value) + JST);
    return `${day.replace(/-/g, '/')} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} JST`;
  }

  function timing(event) {
    if (event.allDay && dateOnly(event.start)) return `${event.start} 終日${dateOnly(event.end) ? ` 〜 ${event.end}（終了日を除く）` : ''}`;
    return formatDate(event.start) + (event.end ? ` 〜 ${formatDate(event.end)}` : '');
  }

  function notificationPreview(eventOrChange, options = {}) {
    const change = eventOrChange || {};
    const event = change.after || change.before || change;
    const identity = { source: event.source ?? change.source, id: event.id ?? change.eventId };
    const key = stableEventKey(identity);
    const kind = options.kind || change.kind || 'new';
    const rev = revision({ revision: change.revision ?? event.revision });
    const title = str(event.title || '名称未定').replace(/[\r\n]+/g, ' ');
    const body = [
      options.real ? '表示例です。実際の通知は送信しません。' : '架空サンプルです。実際の通知は送信しません。',
      timing(event),
      artists(event).length ? `アーティスト: ${artists(event).join('、')}` : '',
      `確度: ${event.present === false || kind === 'unavailable' ? '掲載消失（中止とは未確定）' : STATUS[event.status] || '未確認'}`,
      event.location ? `場所: ${event.location}` : '',
      event.note ? `内容: ${event.note}` : '',
      event.evidence ? `根拠: ${event.evidence}` : '',
      event.deadline || event.deadlineAt ? `締切: ${formatDate(event.deadline ?? event.deadlineAt)}` : ''
    ].filter(Boolean).join('\n');
    return { title: `[${options.real?'通知プレビュー':SAMPLE}] ${KIND[kind] || '予定'} · ${title}${event.status === 'possible' ? '（かも？）' : ''}`, body,
      tag: JSON.stringify([key, rev, kind]),
      data: { demo: !options.real, previewOnly: true, eventKey: key, source: identity.source ?? null, eventId: identity.id ?? null, revision: rev, kind } };
  }

  // RFC 5545 TEXT values: CR/LF must never inject a new property or component.
  function escapeICSText(value) {
    return str(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }

  function utf8Length(character) {
    const code = character.codePointAt(0);
    return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }

  function foldICSLine(line) {
    let result = '', octets = 0;
    for (const char of str(line)) {
      const size = utf8Length(char);
      if (octets + size > 75) { result += '\r\n '; octets = 1; }
      result += char; octets += size;
    }
    return result;
  }

  function utcStamp(value) {
    const instant = parseInstant(value);
    if (instant === null) return null;
    const d = new Date(instant);
    if (d.getUTCFullYear() < 1 || d.getUTCFullYear() > 9999) return null;
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function exportEligibility(event) {
    const reject = (reason, label) => ({ eligible: false, reason, label });
    if (!event || typeof event !== 'object') return reject('invalid_event', '予定情報がありません');
    if (event.present === false || event.status === 'missing' || event.status === 'unavailable') return reject('missing', '掲載消失');
    if (event.status === 'cancelled' || event.status === 'canceled') return reject('cancelled', '中止');
    if (!stableEventKey(event)) return reject('missing_identity', '出典または予定IDがありません');
    if (!dateKey(event.start)) return reject('unknown_date', '日時未定または不正な日時');
    if (event.allDay) {
      if (!dateOnly(event.start)) return reject('invalid_all_day_date', '終日予定には日付のみが必要です');
      if (event.end && (!dateOnly(event.end) || event.end <= event.start)) return reject('invalid_end', '終了日は開始日より後の日付が必要です');
    } else {
      if (dateOnly(event.start)) return reject('unknown_time', '時刻未定（終日予定ではありません）');
      if (!utcStamp(event.start)) return reject('unknown_date', '日時未定または不正な日時');
      if (event.end && (!utcStamp(event.end) || parseInstant(event.end) <= parseInstant(event.start))) return reject('invalid_end', '終了時刻が不正、未定、または開始以前です');
    }
    return { eligible: true, reason: null, label: '書き出し可能' };
  }

  function buildICS(events, options = {}) {
    const input = Array.isArray(events) ? events : events ? [events] : [];
    const included = [], skipped = [];
    const stamp = utcStamp(options.now ?? new Date());
    if (!stamp) throw new TypeError('A valid now timestamp is required.');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alert PWA//Fictional Preview//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:架空サンプル アラート PWA'];
    for (const event of deduplicateEvents(input)) {
      const eligibility = exportEligibility(event);
      if (!eligibility.eligible) { skipped.push({ event, key: stableEventKey(event), ...eligibility }); continue; }
      included.push(event);
      const uncertain = event.status !== 'confirmed';
      const suffix = event.status === 'possible' ? '（かも？）' : uncertain ? '（未確認）' : '';
      const description = ['架空サンプルです。実際の予定ではありません。',
        event.status === 'possible' ? 'かも？（可能性のある予定です。確定ではありません。）' : '',
        artists(event).length ? `アーティスト: ${artists(event).join('、')}` : '',
        event.note, event.evidence ? `根拠: ${event.evidence}` : '', `出典: ${event.source}`].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:alert-demo-${encodeURIComponent(stableEventKey(event))}@example.invalid`, `DTSTAMP:${stamp}`, `SEQUENCE:${revision(event)}`,
        `DTSTART${event.allDay ? ';VALUE=DATE:' + event.start.replace(/-/g, '') : ':' + utcStamp(event.start)}`);
      // Missing end is deliberately omitted. Never fabricate a duration or deadline.
      if (event.end) lines.push(`DTEND${event.allDay ? ';VALUE=DATE:' + event.end.replace(/-/g, '') : ':' + utcStamp(event.end)}`);
      lines.push(`SUMMARY:${escapeICSText(`[${SAMPLE}] ${event.title || '名称未定'}${suffix}`)}`, `STATUS:${uncertain ? 'TENTATIVE' : 'CONFIRMED'}`,
        `DESCRIPTION:${escapeICSText(description)}`);
      if (event.location) lines.push(`LOCATION:${escapeICSText(event.location)}`);
      if (event.category) lines.push(`CATEGORIES:${escapeICSText(event.category)}`);
      lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return { ics: included.length ? lines.map(foldICSLine).join('\r\n') + '\r\n' : '', included, skipped, demo: true };
  }

  function reminderTimes(event, options = {}) {
    const now = parseInstant(options.now ?? new Date());
    if (now === null) throw new TypeError('A valid now timestamp is required.');
    const deadline = event && (event.deadline ?? event.deadlineAt);
    const mode = options.mode ?? (deadline != null && deadline !== '' ? 'deadline2' : 'morning1h');
    if (!['morning1h', 'deadline2'].includes(mode)) throw new TypeError('Unknown historical reminder mode.');
    const morningTime = options.morningTime ?? '08:00';
    if (typeof morningTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(morningTime)) throw new TypeError('morningTime must be HH:mm in JST.');
    const [morningHour, morningMinute] = morningTime.split(':').map(Number);
    const timesByStamp = new Map(), unresolved = [], omitted = [], key = stableEventKey(event || {});
    const metadata = { previewOnly: true, historicalPreview: true, currentTTMVerified: false, mode, morningTime,
      ruleNote: '記録で確認できた過去ルールのプレビューです。現在のTTMコードとの一致・実際の配信は未検証です。' };
    const unresolvedItem = (kind, reason, label) => unresolved.push({ kind, reason, label, eventKey: key });
    if (!event || event.present === false || ['cancelled', 'canceled', 'missing', 'unavailable'].includes(event.status)) {
      unresolvedItem('event', 'not_active', '掲載消失・中止の予定はリマインド候補にしません');
      return { times: [], unresolved, omitted, ...metadata };
    }
    function add(at, kind, label) {
      if (at <= now) { omitted.push({ kind, reason: 'not_future', label: '通知候補時刻を過ぎています', at: new Date(at).toISOString(), eventKey: key }); return; }
      const existing = timesByStamp.get(at);
      if (existing) { existing.kinds.push(kind); existing.labels.push(label); existing.label = existing.labels.join(' / '); }
      else timesByStamp.set(at, { at: new Date(at).toISOString(), timestamp: at, kind, kinds: [kind], label, labels: [label], eventKey: key });
    }
    function anchor(value, kind, label, isAllDay = false) {
      const instant = isAllDay ? null : parseInstant(value);
      if (instant === null || !dateKey(value)) { unresolvedItem(kind, 'unknown_time', `${label}の時刻未定。通知時刻は推測しません`); return; }
      const morning = midnight(dateKey(value)) + (morningHour * 60 + morningMinute) * 60000;
      if (morning >= instant) omitted.push({ kind: `${kind}-morning`, reason: 'morning_not_before_anchor', label: `${morningTime} JSTが${label}時刻以降のため省略（過去ルール）`, at: new Date(morning).toISOString(), eventKey: key });
      else add(morning, `${kind}-morning`, `${label}当日 朝 ${morningTime} JST`);
      const local = new Date(instant + JST);
      const deadlineException = kind === 'deadline' && local.getUTCHours() === 23 && local.getUTCMinutes() === 59;
      if (deadlineException) add(midnight(dateKey(value)) + 23 * 60 * 60 * 1000, 'deadline-special-2300', '締切前 23:00 JST（23:59締切の過去ルール特例）');
      else add(instant - 60 * 60 * 1000, `${kind}-1h`, `${label}1時間前`);
    }
    if (mode === 'deadline2') anchor(deadline, 'deadline', '締切');
    else anchor(event.start, 'event', '開始', event.allDay === true);
    return { times: [...timesByStamp.values()].sort((a, b) => a.timestamp - b.timestamp), unresolved, omitted, ...metadata };
  }

  return Object.freeze({ stableEventKey, deduplicateEvents, artists, isFavorite, filterEvents,
    parseInstant, dateKey, overlapsDay, formatDate, timing, notificationPreview,
    escapeICSText, foldICSLine, exportEligibility, buildICS, reminderTimes });
});

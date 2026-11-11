import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./pwa-update.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Events {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type }); }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
class Worker extends Events {
  constructor(state) { super(); this.state = state; this.messages = []; }
  postMessage(message) { this.messages.push(JSON.parse(JSON.stringify(message))); }
  change(state) { this.state = state; this.emit('statechange'); }
}
function fixture({ supported = true, registered = true, controlled = true, online = true } = {}) {
  const root = new Events();
  const worker = new Worker('activated');
  const registration = Object.assign(new Events(), { active: worker, waiting: null, installing: null, calls: 0 });
  registration.update = async () => { registration.calls++; return registration; };
  const container = Object.assign(new Events(), { controller: controlled ? worker : null, lookups: 0 });
  container.getRegistration = async () => { container.lookups++; return registered ? registration : undefined; };
  for (const property of ['ready', 'register', 'unregister']) Object.defineProperty(container, property, { get() { throw Error('Unexpected ' + property); } });
  root.navigator = { onLine: online, ...(supported ? { serviceWorker: container } : {}) };
  root.location = { href: 'https://example.test/alert-pwa/?test=yes#favorites', hash: '#favorites', reloads: 0, reload(...args) { assert.equal(args.length, 0); this.reloads++; } };
  root.setTimeout = setTimeout;
  root.clearTimeout = clearTimeout;
  root.setInterval = setInterval;
  root.clearInterval = clearInterval;
  for (const property of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'history']) Object.defineProperty(root, property, { get() { throw Error('Unexpected data access: ' + property); } });
  root.window = root;
  vm.runInNewContext(source, root);
  const statuses = [];
  function start(options = {}) { return root.AlertPwaUpdates.updateAndReload({ timeoutMs: 1000, onStatus: value => statuses.push(value), ...options }); }
  function installing(next = new Worker('installing')) { registration.installing = next; registration.emit('updatefound'); return next; }
  function waiting(next) { registration.installing = null; registration.waiting = next; next.change('installed'); }
  function activate(next, claim = true) {
    registration.waiting = null; registration.installing = null; registration.active = next;
    next.change('activating');
    if (claim) { container.controller = next; container.emit('controllerchange'); }
    next.change('activated');
  }
  function clean(...workers) {
    for (const target of [root, registration, container, worker, ...workers]) assert.equal(target.count(), 0, 'operation listeners removed');
  }
  return { root, worker, registration, container, statuses, start, installing, waiting, activate, clean };
}

const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('loading updater has no network, background listeners, or reload side effects', () => {
  const f = fixture();
  f.container.emit('controllerchange');
  f.registration.emit('updatefound');
  assert.equal(f.container.lookups, 0);
  assert.equal(f.registration.calls, 0);
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('unsupported service workers use one normal reload of the same URL', async () => {
  const f = fixture({ supported: false });
  const before = f.root.location.href;
  const result = await f.start();
  assert.equal(result.status, 'reloading');
  assert.equal(result.updated, false);
  assert.equal(f.root.location.reloads, 1);
  assert.equal(f.root.location.href, before);
  assert.equal(f.root.location.hash, '#favorites');
  assert.deepEqual(f.statuses, ['checking', 'reloading']);
  f.clean();
});

test('no existing registration reloads without registering or waiting for ready', async () => {
  const f = fixture({ registered: false });
  assert.equal((await f.start()).updated, false);
  assert.equal(f.container.lookups, 1);
  assert.equal(f.registration.calls, 0);
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('unchanged worker is checked online before reloading', async () => {
  const f = fixture();
  assert.equal((await f.start()).updated, false);
  assert.equal(f.registration.calls, 1);
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('already waiting worker receives only explicit activation message, then reloads once', async () => {
  const f = fixture();
  const next = f.registration.waiting = new Worker('installed');
  const promise = f.start();
  await tick();
  assert.deepEqual(next.messages, [{ type: 'ALERT_PWA_SKIP_WAITING' }]);
  next.emit('statechange');
  f.container.emit('controllerchange');
  assert.equal(next.messages.length, 1);
  assert.equal(f.root.location.reloads, 0);
  f.activate(next);
  assert.equal((await promise).updated, true);
  f.container.emit('controllerchange');
  next.emit('statechange');
  assert.equal(f.root.location.reloads, 1);
  assert.deepEqual(f.statuses, ['checking', 'activating', 'reloading']);
  f.clean(next);
});

test('new installation waits through install, activation, and controller change', async () => {
  const f = fixture();
  const next = new Worker('installing');
  f.registration.update = async () => { f.registration.calls++; f.installing(next); };
  const promise = f.start();
  await tick();
  assert.equal(f.root.location.reloads, 0);
  assert.deepEqual(f.statuses, ['checking', 'installing']);
  f.waiting(next);
  assert.equal(next.messages.length, 1);
  f.activate(next, false);
  assert.equal(f.root.location.reloads, 0, 'activated alone does not replace an old controller');
  f.container.controller = next;
  f.container.emit('controllerchange');
  assert.equal((await promise).updated, true);
  assert.equal(f.root.location.reloads, 1);
  f.clean(next);
});

test('first-load uncontrolled page waits for initial install without waiting for controller claim', async () => {
  const f = fixture({ controlled: false });
  f.registration.active = null;
  const next = f.registration.installing = new Worker('installing');
  const promise = f.start();
  await tick();
  assert.equal(f.root.location.reloads, 0);
  f.activate(next, false);
  assert.equal((await promise).updated, true);
  assert.equal(f.root.location.reloads, 1);
  f.clean(next);
});

test('first-load page with already active worker does not require a controller', async () => {
  const f = fixture({ controlled: false });
  assert.equal((await f.start()).updated, false);
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('existing activating worker finishes before reload', async () => {
  const f = fixture({ controlled: false });
  f.worker.state = 'activating';
  const promise = f.start();
  await tick();
  assert.equal(f.root.location.reloads, 0);
  f.worker.change('activated');
  await promise;
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('activation during update check cannot trigger reload until check succeeds', async () => {
  const f = fixture();
  const checked = deferred();
  f.registration.update = () => checked.promise;
  const promise = f.start();
  await tick();
  const next = f.installing();
  f.activate(next);
  assert.equal(f.root.location.reloads, 0);
  checked.resolve(f.registration);
  await promise;
  assert.equal(f.root.location.reloads, 1);
  f.clean(next);
});

test('failed update does not activate an existing waiting worker or reload', async () => {
  const f = fixture();
  const next = f.registration.waiting = new Worker('installed');
  f.registration.update = async () => { throw Error('network failed'); };
  await rejectsCode(f.start(), 'update-failed');
  assert.equal(next.messages.length, 0);
  assert.equal(f.root.location.reloads, 0);
  f.clean(next);
});

test('registration lookup failure is reported, never hidden by a reload', async () => {
  const f = fixture();
  f.container.getRegistration = async () => { throw Error('blocked'); };
  await rejectsCode(f.start(), 'update-failed');
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('synchronous update failures are reported and can be retried', async () => {
  const f = fixture();
  f.registration.update = () => { throw Error('invalid state'); };
  await rejectsCode(f.start(), 'update-failed');
  f.registration.update = async () => f.registration;
  await f.start();
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('failed installation is remembered after registration clears installing', async () => {
  const f = fixture();
  const next = f.registration.installing = new Worker('installing');
  const promise = f.start();
  await tick();
  f.registration.installing = null;
  next.change('redundant');
  await rejectsCode(promise, 'install-failed');
  assert.equal(f.root.location.reloads, 0);
  f.clean(next);
});

test('fast install failure before update resolves is not mistaken for unchanged success', async () => {
  const f = fixture();
  let next;
  f.registration.update = async () => {
    next = f.installing();
    f.registration.installing = null;
    next.change('redundant');
  };
  await rejectsCode(f.start(), 'install-failed');
  assert.equal(f.root.location.reloads, 0);
  f.clean(next);
});

test('new install failure never falls back to an older waiting version as success', async () => {
  const f = fixture();
  const old = f.registration.waiting = new Worker('installed');
  let next;
  f.registration.update = async () => {
    next = f.installing();
    f.registration.installing = null;
    next.change('redundant');
  };
  await rejectsCode(f.start(), 'install-failed');
  assert.equal(old.messages.length, 0);
  assert.equal(f.root.location.reloads, 0);
  f.clean(old, next);
});

test('new installation supersedes an old waiting worker before activation', async () => {
  const f = fixture();
  const old = f.registration.waiting = new Worker('installed');
  let next;
  f.registration.update = async () => { next = f.installing(); };
  const promise = f.start();
  await tick();
  old.change('redundant');
  assert.equal(old.messages.length, 0);
  f.waiting(next);
  f.activate(next);
  await promise;
  assert.equal(next.messages.length, 1);
  assert.equal(f.root.location.reloads, 1);
  f.clean(old, next);
});

test('offline click is rejected without touching service worker registration', async () => {
  const f = fixture({ online: false });
  await rejectsCode(f.start(), 'offline');
  assert.equal(f.container.lookups, 0);
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('losing connection during update stops immediately and ignores late completion', async () => {
  const f = fixture();
  const checked = deferred();
  f.registration.update = () => checked.promise;
  const promise = f.start();
  await tick();
  f.root.navigator.onLine = false;
  f.root.emit('offline');
  await rejectsCode(promise, 'offline');
  checked.resolve(f.registration);
  await tick();
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('offline state change without an event is checked again before reload', async () => {
  const f = fixture();
  f.registration.update = async () => { f.root.navigator.onLine = false; };
  await rejectsCode(f.start(), 'offline');
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('registration lookup has a deadline and late response cannot reload', async () => {
  const f = fixture();
  const lookup = deferred();
  f.container.getRegistration = () => lookup.promise;
  await rejectsCode(f.start({ timeoutMs: 10 }), 'timeout');
  lookup.resolve(f.registration);
  await tick();
  assert.equal(f.registration.calls, 0);
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('update timeout permits retry and stale response cannot affect the retry', async () => {
  const f = fixture();
  const first = deferred(), second = deferred();
  f.registration.update = () => first.promise;
  await rejectsCode(f.start({ timeoutMs: 10 }), 'timeout');
  f.registration.update = () => second.promise;
  const retry = f.start();
  await tick();
  first.resolve(f.registration);
  await tick();
  assert.equal(f.root.location.reloads, 0);
  second.resolve(f.registration);
  await retry;
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('old waiting worker without message support times out, never reloads later', async () => {
  const f = fixture();
  const next = f.registration.waiting = new Worker('installed');
  await rejectsCode(f.start({ timeoutMs: 10 }), 'timeout');
  assert.equal(next.messages.length, 1);
  f.activate(next);
  await tick();
  assert.equal(f.root.location.reloads, 0);
  f.clean(next);
  await f.start();
  assert.equal(f.root.location.reloads, 1);
});

test('activation messaging failure is reported without a reload', async () => {
  const f = fixture();
  const next = f.registration.waiting = new Worker('installed');
  next.postMessage = () => { throw Error('closed'); };
  await rejectsCode(f.start(), 'update-failed');
  assert.equal(f.root.location.reloads, 0);
  f.clean(next);
});

test('repeated clicks share the exact promise, callbacks, and single reload', async () => {
  const f = fixture();
  const checked = deferred();
  let before = 0;
  f.registration.update = () => { f.registration.calls++; return checked.promise; };
  const a = f.start({ beforeReload: () => before++ });
  const b = f.start({ beforeReload: () => before += 100 });
  assert.equal(a, b);
  await tick();
  checked.resolve(f.registration);
  await a;
  assert.equal(f.start(), a, 'successful request remains latched until navigation');
  assert.equal(f.registration.calls, 1);
  assert.equal(f.root.location.reloads, 1);
  assert.equal(before, 1);
  f.clean();
});

test('throwing optional callbacks cannot break update or leave it stuck', async () => {
  const f = fixture();
  await f.start({ onStatus() { throw Error('UI failed'); }, beforeReload() { throw Error('storage blocked'); } });
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('beforeReload is synchronous, called only immediately before the reload', async () => {
  const f = fixture();
  const events = [];
  f.root.location.reload = () => events.push('reload');
  await f.start({ onStatus: status => events.push(status), beforeReload: () => { events.push('before'); return new Promise(() => {}); } });
  assert.deepEqual(events, ['checking', 'reloading', 'before', 'reload']);
  f.clean();
});

test('failed updates never call beforeReload', async () => {
  const f = fixture({ online: false });
  let before = 0;
  await rejectsCode(f.start({ beforeReload: () => before++ }), 'offline');
  assert.equal(before, 0);
  f.clean();
});

test('reload exception releases latch and allows a later retry', async () => {
  const f = fixture();
  f.root.location.reload = () => { throw Error('navigation blocked'); };
  await rejectsCode(f.start(), 'reload-failed');
  f.root.location.reload = () => { f.root.location.reloads++; };
  await f.start();
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

test('updater never touches storage, caches, history, or a foreign registration', async () => {
  const f = fixture();
  f.container.getRegistration = async (...args) => { assert.equal(args.length, 0); return f.registration; };
  await f.start();
  assert.equal(f.root.location.reloads, 1);
  assert.equal(f.root.location.href, 'https://example.test/alert-pwa/?test=yes#favorites');
  f.clean();
});

test('pre-existing install failure never activates a concurrently waiting older version', async () => {
  const f = fixture();
  const old = f.registration.waiting = new Worker('installed');
  const next = f.registration.installing = new Worker('installing');
  const promise = f.start();
  await tick();
  f.registration.installing = null;
  next.change('redundant');
  await rejectsCode(promise, 'install-failed');
  assert.equal(old.messages.length, 0);
  assert.equal(f.root.location.reloads, 0);
  f.clean(old, next);
});

test('browser DOMException numeric codes are normalized to the documented error contract', async () => {
  const f = fixture();
  f.registration.update = async () => { throw new DOMException('No worker', 'InvalidStateError'); };
  await rejectsCode(f.start(), 'update-failed');
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('promise rejection without an Error still rejects with the documented error contract', async () => {
  const f = fixture();
  f.registration.update = () => Promise.reject();
  await rejectsCode(f.start(), 'update-failed');
  assert.equal(f.root.location.reloads, 0);
  f.clean();
});

test('re-entrant lifecycle event in beforeReload cannot call it or reload twice', async () => {
  const f = fixture();
  let count = 0;
  await f.start({ beforeReload() { count++; f.container.emit('controllerchange'); } });
  assert.equal(count, 1);
  assert.equal(f.root.location.reloads, 1);
  f.clean();
});

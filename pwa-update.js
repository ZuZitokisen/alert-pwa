/* Explicit, bounded app-shell updates. Loading this script never reloads the page. */
(function (root) {
  'use strict';

  let pending = null;

  function failure(code, cause) {
    const error = new Error(code);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function updateFailure(error) {
    return error && ['offline', 'timeout', 'update-failed', 'install-failed', 'reload-failed'].includes(error.code)
      ? error : failure('update-failed', error);
  }

  /**
   * Call only from an explicit user action.
   * onStatus(status): checking | installing | activating | reloading.
   * beforeReload(): optional synchronous, best-effort UI bookkeeping hook.
   * timeoutMs: whole-operation deadline, default 15s, maximum 60s.
   * Resolves {status:'reloading', updated:boolean} once reload is requested.
   * Rejects an Error with code: offline, timeout, update-failed, install-failed,
   * or reload-failed. Callers must catch errors and restore their busy UI.
   * Concurrent calls share the first call's Promise and callbacks. A successful
   * request stays latched until navigation, preventing duplicate reloads.
   * Does not register/unregister workers or read, clear, or change saved data.
   */
  function updateAndReload(options = {}) {
    if (pending) return pending;
    options = options || {};
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, 60000) : 15000;
    let resolveTask, rejectTask;
    pending = new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
    const task = pending;
    let running = true;
    let reloadStarted = false;
    let lastStatus;
    const cleanups = [];

    function status(value) {
      if (!running || value === lastStatus) return;
      lastStatus = value;
      try { if (typeof options.onStatus === 'function') options.onStatus(value); } catch (_) { /* UI is best effort. */ }
    }

    function finish(error, result) {
      if (!running) return;
      running = false;
      for (const cleanup of cleanups) cleanup();
      if (error) {
        // Failed operations can be retried. Late browser promises cannot resume
        // this operation, send activation messages, or reload after its deadline.
        pending = null;
        rejectTask(error);
      } else resolveTask(result);
    }

    function listen(target, type, listener) {
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    }

    function checkOnline() {
      if (root.navigator.onLine === false) throw failure('offline');
    }

    function reload(updated) {
      if (!running || reloadStarted) return;
      checkOnline();
      reloadStarted = true;
      status('reloading');
      try { if (typeof options.beforeReload === 'function') options.beforeReload(); } catch (_) { /* Storage can be unavailable. */ }
      if (!running) return;
      checkOnline();
      try {
        // Reload the current URL, including its hash. Leave scroll restoration
        // to the browser; do not force top, rewrite history, or clear storage.
        root.location.reload();
      } catch (error) {
        finish(failure('reload-failed', error));
        return;
      }
      finish(null, { status: 'reloading', updated });
    }

    const deadline = root.setTimeout(() => finish(failure('timeout')), timeoutMs);
    cleanups.push(() => root.clearTimeout(deadline));

    // Defer work so re-entrant callbacks see the same in-flight Promise.
    Promise.resolve().then(async () => {
      status('checking');
      checkOnline();
      listen(root, 'offline', () => finish(failure('offline')));
      const container = root.navigator.serviceWorker;
      if (!container || typeof container.getRegistration !== 'function') {
        reload(false);
        return;
      }

      // Look up only this page's existing registration; never create a second
      // worker or wait on serviceWorker.ready (which may never resolve).
      const registration = await container.getRegistration();
      if (!running) return;
      checkOnline();
      if (!registration) {
        reload(false);
        return;
      }

      const initialActive = registration.active;
      const initialController = container.controller;
      const observed = new Set();
      const messaged = new Set();
      let candidate = null;
      let checked = false;

      function observe(worker) {
        if (!worker || observed.has(worker)) return;
        observed.add(worker);
        listen(worker, 'statechange', inspect);
      }

      function currentWorker() {
        // Prefer a new installation over an older waiting version. Keep a
        // reference after installation failure clears registration.installing.
        const active = registration.active !== initialActive || registration.active?.state === 'activating'
          ? registration.active : null;
        let next = registration.installing;
        if (!next && (!candidate || (registration.waiting && !observed.has(registration.waiting)))) next = registration.waiting;
        if (!next && (!candidate || (active && !observed.has(active)))) next = active;
        // Do not fall back to an older, already-observed waiting version when
        // a newer installation fails. That would misreport an update success.
        if (next) candidate = next;
        observe(registration.installing);
        observe(registration.waiting);
        observe(active);
        return candidate;
      }

      function inspect() {
        if (!running) return;
        try {
          const worker = currentWorker();
          if (!checked) return; // Never activate/reload when update() failed.
          checkOnline();
          if (!worker) {
            reload(false); // Server checked; no newer worker was found.
          } else if (worker.state === 'redundant') {
            finish(failure('install-failed'));
          } else if (worker.state === 'activated') {
            // Controlled pages wait for the new controller. First-load pages
            // need no claim event: navigation will attach the active worker.
            if (!initialController || container.controller === worker) reload(true);
          } else if (worker.state === 'installed' || worker.state === 'activating') {
            status('activating');
            if (registration.waiting === worker && !messaged.has(worker)) {
              messaged.add(worker);
              worker.postMessage({ type: 'ALERT_PWA_SKIP_WAITING' });
            }
          } else status('installing');
        } catch (error) {
          finish(updateFailure(error));
        }
      }

      // Observe before update() so even a fast failed installation is retained.
      currentWorker();
      listen(registration, 'updatefound', inspect);
      listen(container, 'controllerchange', inspect);
      // A bounded fallback covers queued registration/state property changes
      // when no further event is delivered to this page (not background work).
      const poll = root.setInterval(inspect, 100);
      cleanups.push(() => root.clearInterval(poll));
      await registration.update();
      if (!running) return;
      checked = true;
      inspect();
    }).catch(error => {
      finish(updateFailure(error));
    });

    return task;
  }

  root.AlertPwaUpdates = Object.freeze({ updateAndReload });
})(window);

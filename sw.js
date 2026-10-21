/* HabitBoard service worker: lets the app open without a connection.

   - Only the app's own files are kept in Cache Storage. Your tasks, habits and notes live in
     localStorage (habitboard:v1), which this file never reads, writes or clears.
   - Pages and files are fetched from the network first, so a new version deployed to
     GitHub Pages appears as soon as you are online. The saved copy is used only when the
     network fails (offline) or is very slow.
   - Failed responses (404, 500 and so on) are never saved.
   - Only caches whose names start with "habitboard-" are ever deleted. Other projects on the
     same github.io address are left alone. */
'use strict';

var CACHE_PREFIX = 'habitboard-';
var CACHE_NAME = CACHE_PREFIX + 'app-v6'; // change the number to make every device rebuild its saved copy
var NETWORK_TIMEOUT_MS = 6000;            // after this long, a saved copy is used if there is one
var SCOPE_PATH = new URL('./', self.location.href).pathname; // "/habitboard/" on GitHub Pages

// Paths are relative to this file, so they work under /habitboard/.
var PRECACHE = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

function isCacheable(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

/* Keeps one saved copy per file: older copies that differ only by ?v= are dropped. */
function store(url, response) {
  var wanted = new URL(url, self.location.href);
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        var u = new URL(k.url);
        return u.pathname === wanted.pathname && u.search !== wanted.search;
      }).map(function (k) { return cache.delete(k); }));
    }).then(function () { return cache.put(url, response); });
  });
}

function lookup(request, isNavigation) {
  var opts = { cacheName: CACHE_NAME, ignoreSearch: true, ignoreVary: true };
  return caches.match(request.url, opts).then(function (hit) {
    if (hit || !isNavigation) return hit;
    return caches.match('./', opts); // any page in the app falls back to the saved start page
  });
}

function keepAlive(event, promise) {
  try { event.waitUntil(promise); } catch (e) { /* the copy is still written if the worker stays alive */ }
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(PRECACHE.map(function (path) {
        return fetch(new Request(path, { cache: 'reload' })).then(function (response) {
          if (!isCacheable(response)) throw new Error('Could not fetch ' + path);
          return cache.put(path, response);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
    // If anything above fails, installation is abandoned and the website simply keeps working online.
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME;
      }).map(function (name) { return caches.delete(name); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(SCOPE_PATH) !== 0) return;
  event.respondWith(networkFirst(event, request));
});

function networkFirst(event, request) {
  var isNavigation = request.mode === 'navigate';
  return new Promise(function (resolve) {
    var settled = false;
    var timer = null;
    function done(response) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    }
    function fallback(orElse) {
      lookup(request, isNavigation).then(function (saved) { done(saved || orElse); });
    }

    // Slow network: show the saved copy if there is one, otherwise keep waiting for the network.
    timer = setTimeout(function () {
      lookup(request, isNavigation).then(function (saved) { if (saved) done(saved); });
    }, NETWORK_TIMEOUT_MS);

    fetch(request, { cache: 'no-cache' }).then(function (response) {
      if (isCacheable(response)) {
        keepAlive(event, store(request.url, response.clone()).catch(function () {}));
        done(response);
      } else if (response.status >= 500) {
        fallback(response);   // server trouble: prefer the saved copy
      } else {
        done(response);       // 404 and similar are shown as they are, and never saved
      }
    }).catch(function () {
      fallback(Response.error()); // offline
    });
  });
}

/* ---------- Daily reminder (best effort) ----------
   The page saves the reminder settings in IndexedDB, because a service worker cannot read
   localStorage. When Chrome runs a periodic background check, this shows ONE generic notification
   if today's reminder is due. It never reads tasks, habits or notes, and never touches
   habitboard:v1. Chrome and Android decide if and when a background check runs, so this cannot
   be guaranteed. */
var REM_DB = 'habitboard-reminders';
var REM_STORE = 'settings';
var REM_ID = 'config';
var REM_TAG = 'habitboard-daily-check';
var REM_WINDOW_MIN = 240; // a reminder is due from the chosen time until 4 hours later

function remPad(n) { return n < 10 ? '0' + n : String(n); }
function remDay(d) { return d.getFullYear() + '-' + remPad(d.getMonth() + 1) + '-' + remPad(d.getDate()); }
function remValidTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }

function reminderDue(cfg, now) {
  if (!cfg || cfg.enabled !== true || !remValidTime(cfg.time)) return false;
  if (cfg.lastShown === remDay(now)) return false;
  var start = Number(cfg.time.slice(0, 2)) * 60 + Number(cfg.time.slice(3, 5));
  var mins = now.getHours() * 60 + now.getMinutes();
  return mins >= start && mins < start + REM_WINDOW_MIN;
}

function remDb(op, value) { // op is 'get' or 'put'; always resolves, with null when anything goes wrong
  return new Promise(function (resolve) {
    try {
      var req = self.indexedDB.open(REM_DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(REM_STORE); };
      req.onerror = function () { resolve(null); };
      req.onsuccess = function () {
        try {
          var db = req.result;
          var tx = db.transaction(REM_STORE, op === 'put' ? 'readwrite' : 'readonly');
          var os = tx.objectStore(REM_STORE);
          if (op === 'put') {
            tx.oncomplete = function () { db.close(); resolve(value); };
            tx.onerror = tx.onabort = function () { resolve(null); };
            os.put(value, REM_ID);
          } else {
            var q = os.get(REM_ID);
            q.onsuccess = function () { db.close(); resolve(q.result || null); };
            q.onerror = function () { resolve(null); };
          }
        } catch (e) { resolve(null); }
      };
    } catch (e) { resolve(null); }
  });
}

function remShow() {
  return self.registration.showNotification('HabitBoard', {
    body: 'Time to check your tasks and habits.', // fixed generic text: never task titles or notes
    icon: 'icon-192.png',
    tag: 'habitboard-daily'
  });
}

self.addEventListener('periodicsync', function (event) {
  if (event.tag !== REM_TAG) return;
  event.waitUntil(remDb('get').then(function (cfg) {
    var now = new Date();
    if (!reminderDue(cfg, now) || self.Notification.permission !== 'granted') return null;
    return remShow().then(function () {
      cfg.lastShown = remDay(now);
      return remDb('put', cfg);
    });
  }).catch(function () { /* nothing to do: the next background check tries again */ }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(self.registration.scope);
  }));
});

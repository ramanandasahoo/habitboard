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
var CACHE_NAME = CACHE_PREFIX + 'app-v5'; // change the number to make every device rebuild its saved copy
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

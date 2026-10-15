/* HabitBoard: tasks, habits, daily completions and dated notes, saved in localStorage.
   Version 2 added a date selector, a calendar and a notes history.
   Version 3 adds backup export and restore.
   Version 4 adds installable app / offline support (see sw.js).
   Version 5 adds a read-only weekly statistics dashboard. */
(function () {
  'use strict';

  var STORAGE_KEY = 'habitboard:v1';   // unchanged, so existing saved data keeps loading
  var SCHEMA_VERSION = 1;
  var PRIO = { 1: 'Low priority', 2: 'Medium priority', 3: 'High priority' };
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MIN_DAY = '1970-01-01';
  var MAX_DAY = '2100-12-31';

  /* ---------- Small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; // textContent keeps user text safe
    return n;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function copy(obj) {
    var o = {};
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = obj[k]; }
    return o;
  }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /* ---------- Dates (always the device's local date, as 'YYYY-MM-DD') ---------- */
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }
  function parseKey(key) { // midday avoids daylight-saving edge cases
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
  }
  function addDays(key, n) { var d = parseKey(key); d.setDate(d.getDate() + n); return dateKey(d); }
  function dayDiff(a, b) { return Math.round((parseKey(a) - parseKey(b)) / 86400000); }
  function validKey(key) {
    return typeof key === 'string' && DATE_RE.test(key) && key >= MIN_DAY && key <= MAX_DAY &&
      dateKey(parseKey(key)) === key; // rejects impossible dates such as 2026-02-30
  }

  var todayDay = todayKey();      // the real current date
  var selectedDay = todayDay;     // the date being viewed

  function fmtLong(key) {
    return parseKey(key).toLocaleDateString(undefined,
      { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtShort(key) { // year is shown only when it is not the current year
    var o = { weekday: 'short', day: 'numeric', month: 'short' };
    if (key.slice(0, 4) !== todayDay.slice(0, 4)) o.year = 'numeric';
    return parseKey(key).toLocaleDateString(undefined, o);
  }
  function relLabel(key) {
    var n = dayDiff(key, todayDay);
    if (n === 0) return 'Today';
    if (n === -1) return 'Yesterday';
    if (n === 1) return 'Tomorrow';
    return n < 0 ? (-n) + ' days ago' : 'In ' + n + ' days';
  }

  /* ---------- Banner (storage and data notices) ---------- */
  var banner = $('banner');
  var bannerKind = '';
  function showBanner(msg, kind) { banner.textContent = msg; banner.hidden = false; bannerKind = kind; }
  function hideBanner() { banner.textContent = ''; banner.hidden = true; bannerKind = ''; }

  /* ---------- Safe localStorage access ---------- */
  var storageReadable = true;
  var dirty = false; // true while the last save failed, so memory holds newer data than storage

  function storageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (e) { storageReadable = false; return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }

  /* ---------- Data model ----------
     {
       version: 1,
       tasks:  [{ id, title, priority 1-3, done, doneAt?, date 'YYYY-MM-DD', createdAt }],
       habits: [{ id, name, createdAt }],
       log:    { 'YYYY-MM-DD': [habitId, ...] },   habits completed on that day
       notes:  { 'YYYY-MM-DD': 'text' }
     }
     doneAt is new and optional: the day a task was completed. Data saved by earlier
     versions has no doneAt and still loads (it is treated as completed on the task's
     own date). Unknown fields are kept so no data is lost. */
  function emptyState() { return { version: SCHEMA_VERSION, tasks: [], habits: [], log: {}, notes: {} }; }

  function sampleState() {
    var day = todayKey(), now = Date.now();
    var s = emptyState();
    s.tasks = [
      { id: newId(), title: 'Review today\'s plan', priority: 3, done: false, date: day, createdAt: now },
      { id: newId(), title: 'Reply to messages', priority: 2, done: false, date: day, createdAt: now },
      { id: newId(), title: 'Tidy the desk', priority: 1, done: false, date: day, createdAt: now },
      { id: newId(), title: 'Evening walk', priority: 2, done: false, date: day, createdAt: now }
    ];
    s.habits = [
      { id: newId(), name: 'Drink water', createdAt: now },
      { id: newId(), name: 'Read 10 pages', createdAt: now },
      { id: newId(), name: 'Stretch', createdAt: now }
    ];
    return s;
  }

  function cleanTasks(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (t) {
      if (!isPlainObject(t) || typeof t.title !== 'string' || !t.title.trim()) return;
      var n = copy(t), p = Number(t.priority);
      n.id = t.id ? String(t.id) : newId();
      n.title = t.title.trim().slice(0, 80);
      n.priority = (p >= 1 && p <= 3) ? Math.round(p) : 2;
      n.done = t.done === true;
      if (n.done && DATE_RE.test(t.doneAt)) n.doneAt = t.doneAt; else delete n.doneAt;
      n.date = DATE_RE.test(t.date) ? t.date : todayKey();
      out.push(n);
    });
    return out;
  }

  function cleanHabits(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (h) {
      if (!isPlainObject(h) || typeof h.name !== 'string' || !h.name.trim()) return;
      var n = copy(h);
      n.id = h.id ? String(h.id) : newId();
      n.name = h.name.trim().slice(0, 80);
      out.push(n);
    });
    return out;
  }

  function cleanLog(log) { // keeps every key, so nothing saved earlier is dropped
    var out = {};
    if (!isPlainObject(log)) return out;
    Object.keys(log).forEach(function (day) {
      if (!Array.isArray(log[day])) return;
      var ids = log[day].map(String).filter(function (id, i, a) { return a.indexOf(id) === i; });
      if (ids.length) out[day] = ids;
    });
    return out;
  }

  function cleanNotes(notes) { // keeps every non-empty note, whatever its key
    var out = {};
    if (!isPlainObject(notes)) return out;
    Object.keys(notes).forEach(function (day) {
      if (typeof notes[day] === 'string' && notes[day] !== '') out[day] = notes[day];
    });
    return out;
  }

  function normalize(raw) {
    var s = isPlainObject(raw) ? copy(raw) : {};
    s.version = Math.max(SCHEMA_VERSION, Number(s.version) || 0);
    s.tasks = cleanTasks(s.tasks);
    s.habits = cleanHabits(s.habits);
    s.log = cleanLog(s.log);
    s.notes = cleanNotes(s.notes);
    return s;
  }

  function parseState(text) {
    try { return normalize(JSON.parse(text)); } catch (e) { return null; }
  }

  function persist(s) {
    if (!storageReadable) return false;
    if (!storageSet(STORAGE_KEY, JSON.stringify(s))) {
      dirty = true;
      showBanner('Could not save your changes. Browser storage may be full or blocked.', 'save');
      return false;
    }
    dirty = false;
    if (bannerKind === 'save') hideBanner();
    return true;
  }

  var state = emptyState();
  function save() { return persist(state); }

  function loadState() {
    var text = storageGet(STORAGE_KEY);
    if (!storageReadable) {
      showBanner('Saving is unavailable in this browser, so changes will be lost when you close the page.', 'storage');
      return sampleState();
    }
    if (text === null) { // first ever run: start with a few examples
      var fresh = sampleState();
      persist(fresh);
      return fresh;
    }
    var parsed = parseState(text);
    if (parsed) return parsed;
    // Unreadable data: keep a backup copy and never overwrite it silently.
    storageSet(STORAGE_KEY + ':backup-' + Date.now(), text);
    showBanner('Your saved data could not be read. A backup copy was kept in this browser and the board started fresh.', 'data');
    return emptyState();
  }

  /* ---------- Habits: completion and streak for a given day ---------- */
  function habitDone(day, id) {
    var a = state.log[day];
    return !!a && a.indexOf(id) > -1;
  }
  function setHabitDone(day, id, value) {
    var a = (state.log[day] || []).filter(function (x) { return x !== id; });
    if (value) a.push(id);
    if (a.length) state.log[day] = a; else delete state.log[day];
  }
  function streakFor(id, day) { // consecutive days ending on `day` (or the day before if not done yet)
    var key = day;
    if (!habitDone(key, id)) key = addDays(key, -1);
    var n = 0;
    while (n < 3650 && habitDone(key, id)) { n++; key = addDays(key, -1); }
    return n;
  }

  /* ---------- Tasks: what each task looks like on a given day ----------
     A task appears on its own date, and on later days while it is unfinished (carried over).
     It is completed on exactly one day (doneAt). On that day it can be unticked again. On any
     other day it is shown read-only, so a tick on one day never changes another day. */
  function taskView(t, day) {
    var eff = t.done ? (t.doneAt || t.date) : null; // day it was completed, if any
    return {
      shown: t.date === day || (t.date < day && (eff === null || eff >= day)),
      checked: eff !== null && eff <= day,
      locked: eff !== null && eff !== day,
      eff: eff,
      carried: t.date < day
    };
  }
  function visibleTasks() {
    return state.tasks
      .map(function (t) { return { t: t, v: taskView(t, selectedDay) }; })
      .filter(function (x) { return x.v.shown; });
  }

  /* ---------- Dial ticks ---------- */
  var tickEls = [];
  function buildTicks() {
    var svg = $('ticks');
    for (var i = 0; i < 40; i++) {
      var ln = document.createElementNS(SVG_NS, 'line');
      ln.setAttribute('x1', '70'); ln.setAttribute('y1', '4');
      ln.setAttribute('x2', '70'); ln.setAttribute('y2', '12');
      ln.setAttribute('transform', 'rotate(' + i * 9 + ' 70 70)');
      svg.appendChild(ln);
      tickEls.push(ln);
    }
  }

  /* ---------- Saving / Saved indicator ---------- */
  var saveEl = $('save-state');
  function setSaveState(kind) {
    saveEl.dataset.state = kind;
    saveEl.textContent = kind === 'saving' ? 'Saving...' : kind === 'error' ? 'Not saved' : 'Saved';
  }

  /* ---------- Rendering ---------- */
  var habitMeta = {};

  function renderHeader() {
    var now = new Date(), h = now.getHours();
    $('greeting').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function renderDateBar() {
    var isToday = selectedDay === todayDay, full = fmtLong(selectedDay);
    $('d-rel').textContent = relLabel(selectedDay);
    $('d-full').textContent = full;
    $('date-open').setAttribute('aria-label', 'Selected date: ' + full + '. Open calendar');
    $('today').disabled = isToday;
    $('prev').disabled = selectedDay <= MIN_DAY;
    $('next').disabled = selectedDay >= MAX_DAY;
    $('day-label').textContent = isToday ? 'Today' : fmtShort(selectedDay);
    $('t-h').textContent = isToday ? 'Today\'s tasks' : 'Tasks';
    $('n-h').textContent = isToday ? 'Daily note' : 'Note for ' + fmtShort(selectedDay);
  }

  function editButton(label, onClick) {
    var b = el('button', 'icon-btn');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderTasks() {
    var ul = $('tasks');
    ul.textContent = '';
    var list = visibleTasks();
    if (!list.length) {
      ul.append(el('li', 'empty meta', 'No tasks for this day. Tap + to add one.'));
      return;
    }
    list.forEach(function (x) {
      var t = x.t, v = x.v;
      var li = el('li', 'row'), lab = el('label', 'row-main');
      var cb = el('input', 'box');
      cb.type = 'checkbox';
      cb.checked = v.checked;
      cb.disabled = v.locked;
      cb.addEventListener('change', function () {
        if (cb.checked) { t.done = true; t.doneAt = selectedDay; }
        else { t.done = false; delete t.doneAt; }
        save();
        update();
      });
      var tx = el('span', 'row-text');
      var sub = PRIO[t.priority];
      if (v.carried) sub += ' \u00B7 carried over';
      if (v.locked && v.eff) sub += ' \u00B7 done ' + fmtShort(v.eff);
      tx.append(el('span', 'title', t.title), el('span', 'meta', sub));
      var p = el('span', 'prio');
      p.dataset.p = t.priority;
      p.setAttribute('aria-hidden', 'true');
      p.append(el('i'), el('i'), el('i'));
      lab.append(cb, tx, p);
      li.append(lab, editButton('Edit task: ' + t.title, function () { openDialog('task', t); }));
      ul.append(li);
    });
  }

  function renderHabits() {
    var ul = $('habits');
    ul.textContent = '';
    habitMeta = {};
    if (!state.habits.length) {
      ul.append(el('li', 'empty meta', 'No habits yet. Tap + and choose Habit.'));
      return;
    }
    state.habits.forEach(function (hb) {
      var li = el('li', 'row'), lab = el('label', 'row-main');
      var tx = el('span', 'row-text');
      var meta = el('span', 'meta');
      habitMeta[hb.id] = meta;
      tx.append(el('span', 'title', hb.name), meta);
      var sw = el('input', 'sw');
      sw.type = 'checkbox';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-label', hb.name);
      sw.checked = habitDone(selectedDay, hb.id);
      sw.addEventListener('change', function () {
        setHabitDone(selectedDay, hb.id, sw.checked);
        save();
        update();
      });
      lab.append(tx, sw);
      li.append(lab, editButton('Edit habit: ' + hb.name, function () { openDialog('habit', hb); }));
      ul.append(li);
    });
  }

  function renderNote() {
    if (noteTimer !== null) return; // unsaved typing is in the box; do not overwrite it
    var v = state.notes[selectedDay] || '';
    if (note.value !== v) note.value = v;
    setSaveState(dirty || !storageReadable ? 'error' : 'saved');
  }

  /* Notes history: every date that has a note, newest first */
  var historyLimit = 10;

  function preview(text) {
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].replace(/\s+/g, ' ').trim();
      if (s) return s.length > 120 ? s.slice(0, 120) + '\u2026' : s;
    }
    return '';
  }

  function renderHistory() {
    var ul = $('history');
    ul.textContent = '';
    var days = Object.keys(state.notes).filter(function (k) {
      return DATE_RE.test(k) && state.notes[k].trim() !== '';
    }).sort().reverse();
    $('hist-count').textContent = days.length ? days.length + (days.length === 1 ? ' note' : ' notes') : '';
    if (!days.length) {
      ul.append(el('li', 'empty meta', 'No notes yet. Notes you write are listed here by date.'));
      $('hist-more').hidden = true;
      return;
    }
    days.slice(0, historyLimit).forEach(function (day) {
      var li = el('li', 'row'), b = el('button', 'hist-item');
      b.type = 'button';
      if (day === selectedDay) b.setAttribute('aria-current', 'date');
      b.append(
        el('span', 'hist-date', (day === todayDay ? 'Today \u00B7 ' : '') + fmtShort(day)),
        el('span', 'hist-preview', preview(state.notes[day]))
      );
      b.addEventListener('click', function () { goToDay(day); scrollToNote(); });
      li.append(b);
      ul.append(li);
    });
    $('hist-more').hidden = days.length <= historyLimit;
  }

  function scrollToNote() {
    var h = $('n-h');
    if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start' });
  }

  /* ---------- Weekly statistics (read-only: never changes saved data) ----------
     Weeks run Sunday to Saturday, like the calendar. Everything is worked out from the
     saved tasks and habit history using the device's local dates. */
  var DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var statsWeek = weekStartOf(todayDay); // first day (Sunday) of the week being viewed

  function weekStartOf(key) { return addDays(key, -parseKey(key).getDay()); }
  function pctOf(part, whole) { return whole > 0 ? Math.round(part / whole * 100) : null; }

  function computeWeek(start) {
    var days = [], i;
    for (i = 0; i < 7; i++) days.push(addDays(start, i));
    var end = days[6];
    var cap = end < todayDay ? end : todayDay; // nothing after today counts as done

    // Chart: what the daily dial shows for each day (tasks on that day's list)
    var perDay = days.map(function (day) {
      var total = 0, done = 0;
      state.tasks.forEach(function (t) {
        var v = taskView(t, day);
        if (!v.shown) return;
        total++;
        if (v.eff !== null && v.eff <= day && v.eff <= todayDay) done++;
      });
      return { day: day, total: total, done: done, future: day > todayDay };
    });

    // Week totals: each task is counted once, however many days it was on the list
    var tTotal = 0, tDone = 0;
    state.tasks.forEach(function (t) {
      var onList = false;
      for (var j = 0; j < 7 && !onList; j++) onList = taskView(t, days[j]).shown;
      if (!onList) return;
      tTotal++;
      var eff = taskView(t, end).eff; // the day it was ticked, or null
      if (eff !== null && eff <= cap) tDone++;
    });

    // Habits: a day counts as done only if the saved history has that date
    var hDone = 0, hElig = 0;
    var habits = state.habits.map(function (h) {
      var created = (typeof h.createdAt === 'number' && isFinite(h.createdAt)) ?
        dateKey(new Date(h.createdAt)) : null;
      var done = 0, elig = 0;
      days.forEach(function (day) {
        if (day > todayDay) return;                          // future days are not counted
        if (habitDone(day, h.id)) { done++; elig++; }
        else if (created === null || day >= created) elig++; // days before it existed are not misses
      });
      hDone += done; hElig += elig;
      return { name: h.name, done: done, eligible: elig, pct: pctOf(done, elig) };
    });

    return {
      start: start, end: end, days: perDay, habits: habits,
      tDone: tDone, tTotal: tTotal, hDone: hDone, hElig: hElig,
      tPct: pctOf(tDone, tTotal), hPct: pctOf(hDone, hElig),
      oPct: pctOf(tDone + hDone, tTotal + hElig)
    };
  }

  function fmtRange(a, b) {
    var sameYear = a.slice(0, 4) === b.slice(0, 4);
    var left = parseKey(a).toLocaleDateString(undefined,
      sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    var right = parseKey(b).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return left + ' \u2013 ' + right;
  }
  function weekRel(start) {
    var n = Math.round(dayDiff(start, weekStartOf(todayDay)) / 7);
    if (n === 0) return 'This week';
    if (n === -1) return 'Last week';
    if (n === 1) return 'Next week';
    return n < 0 ? (-n) + ' weeks ago' : 'In ' + n + ' weeks';
  }
  function pctText(p) { return p === null ? '\u2014' : p + '%'; }

  function renderChart(cur) {
    var ul = $('st-chart'), max = 1;
    ul.textContent = '';
    cur.days.forEach(function (d) { if (d.total > max) max = d.total; });
    cur.days.forEach(function (d) {
      var dt = parseKey(d.day);
      var li = el('li', 'bar-col' + (d.day === todayDay ? ' today' : '') + (d.future ? ' future' : ''));
      li.setAttribute('role', 'img');
      li.setAttribute('aria-label', dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) +
        ': ' + d.done + ' of ' + d.total + (d.total === 1 ? ' task' : ' tasks') + ' done' + (d.future ? ' (upcoming)' : ''));
      var well = el('div', 'bar-well');
      if (d.total) {
        var tot = el('div', 'bar-total');
        tot.style.height = Math.max(8, Math.round(d.total / max * 100)) + '%';
        if (d.done) {
          var fill = el('div', 'bar-fill');
          fill.style.height = Math.round(d.done / d.total * 100) + '%';
          tot.append(fill);
        }
        well.append(tot);
      }
      li.append(well, el('span', 'bar-n', d.done + '/' + d.total),
        el('span', 'bar-day', DAY_NAMES[dt.getDay()]), el('span', 'bar-date', String(dt.getDate())));
      ul.append(li);
    });
  }

  function renderHabitStats(cur) {
    var ul = $('st-habits');
    ul.textContent = '';
    if (!cur.habits.length) {
      ul.append(el('li', 'empty meta', 'No habits yet. Tap + and choose Habit.'));
      return;
    }
    cur.habits.forEach(function (h) {
      var li = el('li', 'st-habit'), top = el('div', 'st-hrow');
      top.append(el('span', 'title', h.name), el('span', 'meta',
        h.eligible ? h.done + ' of ' + h.eligible + (h.eligible === 1 ? ' day' : ' days') + ' \u00B7 ' + h.pct + '%'
                   : 'Not counted yet'));
      var track = el('div', 'track'), fill = el('div', 'fill');
      track.setAttribute('aria-hidden', 'true');
      fill.style.width = (h.pct || 0) + '%';
      track.append(fill);
      li.append(top, track);
      if (h.eligible > 0 && h.eligible < 7) li.append(el('p', 'meta st-sub', 'Counted for ' + h.eligible + ' of 7 days'));
      ul.append(li);
    });
  }

  function cmpRow(title, noun, now, before) {
    var li = el('li', 'st-cmp-row'), msg;
    if (now === null) msg = 'No ' + noun + ' data this week to compare.';
    else if (before === null) msg = 'No ' + noun + ' data in the previous week, so there is nothing to compare.';
    else {
      var d = now - before, a = Math.abs(d);
      msg = (d === 0 ? 'No change' : (d > 0 ? '\u25B2 Up ' : '\u25BC Down ') + a + (a === 1 ? ' point' : ' points')) +
        '. ' + now + '% now, ' + before + '% in the previous week.';
    }
    li.append(el('span', 'label', title), el('span', 'st-cmp-msg', msg));
    return li;
  }

  function renderStats() {
    var cur = computeWeek(statsWeek);
    var prev = computeWeek(addDays(statsWeek, -7));
    var started = statsWeek <= todayDay;

    $('wk-rel').textContent = weekRel(statsWeek);
    $('wk-range').textContent = fmtRange(cur.start, cur.end);
    $('wk-prev').disabled = statsWeek <= weekStartOf(MIN_DAY);
    $('wk-next').disabled = addDays(statsWeek, 7) > MAX_DAY;
    $('wk-now').disabled = statsWeek === weekStartOf(todayDay);

    var empty = !started || (cur.tTotal === 0 && cur.hElig === 0);
    $('st-empty').hidden = !empty;
    $('st-body').hidden = empty;
    if (empty) {
      $('st-empty').textContent = started
        ? 'No tasks or habits were recorded for this week.'
        : 'This week has not started yet, so there are no statistics.';
      return;
    }

    $('st-tdone').textContent = cur.tDone;
    $('st-ttotal').textContent = cur.tTotal;
    $('st-tpct').textContent = pctText(cur.tPct);
    $('st-tpct-s').textContent = cur.tTotal ? '' : 'No tasks';
    $('st-hpct').textContent = pctText(cur.hPct);
    $('st-hpct-s').textContent = cur.hElig
      ? cur.hDone + ' of ' + cur.hElig + (cur.hElig === 1 ? ' habit day' : ' habit days') : 'No habits counted';
    $('st-opct').textContent = pctText(cur.oPct);
    $('st-live').hidden = !(cur.end >= todayDay);

    renderChart(cur);
    renderHabitStats(cur);
    var cmp = $('st-cmp');
    cmp.textContent = '';
    cmp.append(cmpRow('Tasks', 'task', cur.tPct, prev.tPct), cmpRow('Habits', 'habit', cur.hPct, prev.hPct));
  }

  $('wk-prev').addEventListener('click', function () { statsWeek = addDays(statsWeek, -7); renderStats(); });
  $('wk-next').addEventListener('click', function () { statsWeek = addDays(statsWeek, 7); renderStats(); });
  $('wk-now').addEventListener('click', function () { statsWeek = weekStartOf(todayDay); renderStats(); });

  function update() {
    var tasks = visibleTasks();
    var td = tasks.filter(function (x) { return x.v.checked; }).length;
    var hd = state.habits.filter(function (h) { return habitDone(selectedDay, h.id); }).length;
    var total = tasks.length + state.habits.length;
    var done = td + hd;
    var pct = total ? Math.round(done / total * 100) : 0;

    $('pct').textContent = pct + '%';
    $('dial').style.setProperty('--a', pct * 3.6 + 'deg');
    $('dial').setAttribute('aria-valuenow', pct);
    var lit = Math.round(pct * 0.4);
    tickEls.forEach(function (ln, i) { ln.classList.toggle('on', i < lit); });

    $('summary').textContent = total ? done + ' of ' + total + ' done' : 'Nothing planned yet';
    $('split').textContent = td + ' of ' + tasks.length + ' tasks, ' + hd + ' of ' + state.habits.length + ' habits';
    $('t-count').textContent = td + ' of ' + tasks.length;
    $('h-count').textContent = hd + ' of ' + state.habits.length;
    state.habits.forEach(function (hb) {
      if (habitMeta[hb.id]) habitMeta[hb.id].textContent = 'Streak ' + streakFor(hb.id, selectedDay);
    });
    renderStats(); // keep the weekly dashboard in step with every change
  }

  function renderAll() {
    renderHeader();
    renderDateBar();
    renderTasks();
    renderHabits();
    renderNote();
    renderHistory();
    update();
  }

  /* ---------- Daily note (saved against the date it was typed on) ---------- */
  var note = $('note');
  var noteTimer = null;
  var noteDay = selectedDay;

  note.addEventListener('input', function () {
    noteDay = selectedDay; // remember which date this text belongs to
    setSaveState('saving');
    if (noteTimer !== null) clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNote, 400);
  });

  function flushNote() { // writes any pending note right away
    if (noteTimer === null) return;
    clearTimeout(noteTimer);
    noteTimer = null;
    if (note.value === '') delete state.notes[noteDay]; else state.notes[noteDay] = note.value;
    setSaveState(save() ? 'saved' : 'error');
    renderHistory();
  }
  note.addEventListener('blur', flushNote);

  /* ---------- Changing the selected date ---------- */
  function goToDay(key) {
    if (!validKey(key)) return;
    flushNote(); // save the current note against its own date before switching
    selectedDay = key;
    renderAll();
  }

  $('prev').addEventListener('click', function () { goToDay(addDays(selectedDay, -1)); });
  $('next').addEventListener('click', function () { goToDay(addDays(selectedDay, 1)); });
  $('today').addEventListener('click', function () { goToDay(todayKey()); });
  $('hist-more').addEventListener('click', function () { historyLimit += 10; renderHistory(); });

  /* ---------- Dialog helpers ---------- */
  function openModal(d) {
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function closeModal(d) {
    if (typeof d.close === 'function') { if (d.open) d.close(); } else d.removeAttribute('open');
  }

  /* ---------- Calendar picker ---------- */
  var cal = $('cal');
  var calYear = 0, calMonth = 0;

  function renderCalendar() {
    $('cal-title').textContent = new Date(calYear, calMonth, 1, 12)
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    var grid = $('cal-grid');
    grid.textContent = '';
    var offset = new Date(calYear, calMonth, 1, 12).getDay(); // weeks start on Sunday
    for (var i = 0; i < 42; i++) {
      var d = new Date(calYear, calMonth, 1 - offset + i, 12);
      var key = dateKey(d);
      var hasNote = typeof state.notes[key] === 'string' && state.notes[key].trim() !== '';
      var cls = 'cal-day' + (d.getMonth() !== calMonth ? ' out' : '') + (key === todayDay ? ' today' : '') +
        (key === selectedDay ? ' sel' : '') + (hasNote ? ' has-note' : '');
      var b = el('button', cls, String(d.getDate()));
      b.type = 'button';
      b.setAttribute('aria-label', fmtLong(key) + (hasNote ? ', has a note' : ''));
      if (key === selectedDay) b.setAttribute('aria-pressed', 'true');
      if (key === todayDay) b.setAttribute('aria-current', 'date');
      bindCalendarDay(b, key);
      grid.append(b);
    }
  }
  function bindCalendarDay(b, key) {
    b.addEventListener('click', function () { closeModal(cal); goToDay(key); });
  }
  function shiftMonth(n) {
    var m = calMonth + n, y = calYear;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    if (y < 1970 || y > 2100) return;
    calYear = y; calMonth = m;
    renderCalendar();
  }
  function openCalendar() {
    flushNote(); // so the note dots are up to date
    var d = parseKey(selectedDay);
    calYear = d.getFullYear(); calMonth = d.getMonth();
    renderCalendar();
    openModal(cal);
  }

  $('date-open').addEventListener('click', openCalendar);
  $('cal-prev').addEventListener('click', function () { shiftMonth(-1); });
  $('cal-next').addEventListener('click', function () { shiftMonth(1); });
  $('cal-today').addEventListener('click', function () { closeModal(cal); goToDay(todayKey()); });
  $('cal-close').addEventListener('click', function () { closeModal(cal); });

  /* ---------- Add / edit dialog ---------- */
  var dlg = $('dlg'), form = $('form');
  var editing = null;      // { type, item } while editing, otherwise null
  var deleteArmed = false;

  function resetDelete() {
    deleteArmed = false;
    $('delete').textContent = 'Delete';
  }

  function syncDialog() {
    var type = $('t-type').value;
    $('f-prio').hidden = type === 'habit';
    $('f-type').hidden = !!editing;
    $('delete').hidden = !editing;
    $('d-h').textContent = (editing ? 'Edit ' : 'New ') + type;
    $('d-sub').textContent = editing ? '' :
      (type === 'habit' ? 'Habits appear on every day.' : 'Added to ' + fmtLong(selectedDay) + '.');
    $('save').textContent = editing ? 'Save' : (type === 'habit' ? 'Add habit' : 'Add task');
  }

  function openDialog(type, item) {
    form.reset();
    resetDelete();
    editing = item ? { type: type, item: item } : null;
    $('t-type').value = type;
    if (item) {
      $('t-title').value = type === 'habit' ? item.name : item.title;
      if (type === 'task') $('t-prio').value = String(item.priority);
    }
    syncDialog();
    openModal(dlg);
    $('t-title').focus();
  }

  $('add').addEventListener('click', function () { openDialog('task', null); });
  $('t-type').addEventListener('change', syncDialog);
  $('cancel').addEventListener('click', function () { closeModal(dlg); resetDelete(); });
  dlg.addEventListener('close', resetDelete);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('t-title').value.trim();
    if (!title) { $('t-title').focus(); return; }
    var type = $('t-type').value;

    if (editing) {
      if (editing.type === 'habit') editing.item.name = title;
      else { editing.item.title = title; editing.item.priority = Number($('t-prio').value); }
    } else if (type === 'habit') {
      state.habits.push({ id: newId(), name: title, createdAt: Date.now() });
    } else {
      state.tasks.push({
        id: newId(), title: title, priority: Number($('t-prio').value),
        done: false, date: selectedDay, createdAt: Date.now()
      });
    }
    save();
    renderTasks();
    renderHabits();
    update();
    closeModal(dlg);
    resetDelete();
  });

  $('delete').addEventListener('click', function () {
    if (!editing) return;
    if (!deleteArmed) { // first tap asks for confirmation
      deleteArmed = true;
      $('delete').textContent = 'Tap again to delete';
      return;
    }
    var item = editing.item;
    if (editing.type === 'habit') {
      state.habits = state.habits.filter(function (h) { return h !== item; });
      Object.keys(state.log).forEach(function (day) {
        var left = state.log[day].filter(function (id) { return id !== item.id; });
        if (left.length) state.log[day] = left; else delete state.log[day];
      });
    } else {
      state.tasks = state.tasks.filter(function (t) { return t !== item; });
    }
    save();
    renderTasks();
    renderHabits();
    update();
    closeModal(dlg);
    resetDelete();
  });

  /* ---------- Backup & restore ----------
     Export writes a JSON file made on this device (no server). Import reads a file the
     person picks, checks it completely, asks for confirmation, and only then replaces the
     saved data. Nothing is written to storage until every check has passed. */
  var BACKUP_APP = 'HabitBoard';
  var BACKUP_FORMAT = 1;                  // version of the backup file wrapper
  var MAX_BACKUP_BYTES = 5 * 1024 * 1024; // browsers keep about 5 MB, so a bigger file cannot be restored
  var bkMsg = $('bk-msg'), rsMsg = $('rs-msg');
  var rdlg = $('restore');
  var fileInput = $('import-file');
  var pendingRestore = null;              // validated data waiting for the person to confirm

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function say(target, text, kind) {
    target.textContent = text;
    target.dataset.kind = kind;
    target.hidden = false;
    if (target.scrollIntoView) target.scrollIntoView({ block: 'end' }); // keep the message in view, clear of the + button
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function describe(s) {
    var notes = Object.keys(s.notes).filter(function (k) { return s.notes[k].trim() !== ''; }).length;
    var days = Object.keys(s.log).length;
    return plural(s.tasks.length, 'task', 'tasks') + ', ' + plural(s.habits.length, 'habit', 'habits') + ', ' +
      plural(notes, 'note', 'notes') + ', ' + plural(days, 'day of habit history', 'days of habit history');
  }
  function fmtExported(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* Export: the whole saved state, wrapped with a few labels so the file can be recognised later. */
  function exportBackup(target) {
    try {
      flushNote(); // include a note that is still being typed
      var name = 'habitboard-backup-' + todayKey() + '.json';
      var payload = {
        app: BACKUP_APP,
        backupFormat: BACKUP_FORMAT,
        storageKey: STORAGE_KEY,
        exportedAt: new Date().toISOString(),
        data: state
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      say(target, 'Backup created: ' + name + ' (' + describe(state) + '). Look for it in your Downloads folder.', 'ok');
      return true;
    } catch (e) {
      say(target, 'Could not create the backup file. Nothing was changed.', 'error');
      return false;
    }
  }

  /* Validation: returns '' when the data is usable, otherwise a plain-language reason. */
  function isDateText(v) { return typeof v === 'string' && DATE_RE.test(v); }
  function isWholeNumber(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 1; }

  function checkData(p) {
    var i, t, h, keys, ids = {};
    if (p.version !== undefined) {
      if (!isWholeNumber(p.version)) return 'The data has an invalid version number.';
      if (p.version > SCHEMA_VERSION) return 'The data was saved by a newer version of HabitBoard.';
    }
    if (!Array.isArray(p.tasks)) return 'The list of tasks is missing.';
    if (!Array.isArray(p.habits)) return 'The list of habits is missing.';
    if (!isPlainObject(p.log)) return 'The habit history is missing.';
    if (!isPlainObject(p.notes)) return 'The notes are missing.';

    for (i = 0; i < p.tasks.length; i++) {
      t = p.tasks[i];
      if (!isPlainObject(t) || typeof t.title !== 'string' || !t.title.trim()) return 'Task ' + (i + 1) + ' has no title.';
      if (t.priority !== undefined && !(typeof t.priority === 'number' && t.priority >= 1 && t.priority <= 3)) {
        return 'Task ' + (i + 1) + ' has an invalid priority.';
      }
      if (t.done !== undefined && typeof t.done !== 'boolean') return 'Task ' + (i + 1) + ' has an invalid done value.';
      if (t.date !== undefined && !isDateText(t.date)) return 'Task ' + (i + 1) + ' has an invalid date.';
      if (t.doneAt !== undefined && !isDateText(t.doneAt)) return 'Task ' + (i + 1) + ' has an invalid completion date.';
    }
    for (i = 0; i < p.habits.length; i++) {
      h = p.habits[i];
      if (!isPlainObject(h) || typeof h.name !== 'string' || !h.name.trim()) return 'Habit ' + (i + 1) + ' has no name.';
      if (h.id !== undefined) {
        if (typeof h.id !== 'string' && typeof h.id !== 'number') return 'Habit ' + (i + 1) + ' has an invalid id.';
        if (ids['id:' + h.id]) return 'Two habits share the same id.';
        ids['id:' + h.id] = true;
      }
    }
    keys = Object.keys(p.log);
    for (i = 0; i < keys.length; i++) {
      var list = p.log[keys[i]];
      if (!Array.isArray(list)) return 'The habit history for ' + keys[i] + ' is not a list.';
      for (var j = 0; j < list.length; j++) {
        if (typeof list[j] !== 'string' && typeof list[j] !== 'number') return 'The habit history for ' + keys[i] + ' is invalid.';
      }
    }
    keys = Object.keys(p.notes);
    for (i = 0; i < keys.length; i++) {
      if (typeof p.notes[keys[i]] !== 'string') return 'The note for ' + keys[i] + ' is not text.';
    }
    return '';
  }

  /* Accepts a HabitBoard backup file, or the bare data object stored under habitboard:v1. */
  function parseBackup(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // ignore a byte-order mark
    var root;
    try { root = JSON.parse(text); }
    catch (e) { return { error: 'The file is not valid JSON, so it is not a HabitBoard backup.' }; }
    if (!isPlainObject(root)) return { error: 'The file does not have the structure of a HabitBoard backup.' };

    var payload = root, exportedAt = '';
    if (hasOwn(root, 'app') || hasOwn(root, 'backupFormat') || hasOwn(root, 'data')) {
      if (root.app !== BACKUP_APP) return { error: 'The file was not created by HabitBoard.' };
      if (!isWholeNumber(root.backupFormat)) return { error: 'The backup file has no valid format number.' };
      if (root.backupFormat > BACKUP_FORMAT) return { error: 'The backup was made by a newer version of HabitBoard.' };
      if (!isPlainObject(root.data)) return { error: 'The backup file contains no data.' };
      payload = root.data;
      if (typeof root.exportedAt === 'string') exportedAt = root.exportedAt;
    }
    var problem = checkData(payload);
    if (problem) return { error: problem };
    return { data: normalize(payload), exportedAt: exportedAt }; // normalize keeps unknown fields
  }

  /* Restore: writes the new data, checks it was stored, and only then switches the app over.
     If anything goes wrong the old data stays exactly as it was. */
  function applyRestore(next) {
    if (!storageReadable) return 'Saving is unavailable in this browser, so a restored backup could not be kept.';
    var text = JSON.stringify(next);
    var previous = storageGet(STORAGE_KEY);
    if (!storageSet(STORAGE_KEY, text)) return 'The browser could not store the backup. Storage may be full or blocked.';
    if (storageGet(STORAGE_KEY) !== text) { // confirm what was written is what we meant to write
      if (previous !== null) storageSet(STORAGE_KEY, previous);
      return 'The backup could not be stored correctly.';
    }
    state = next;
    dirty = false;
    if (bannerKind === 'save' || bannerKind === 'data') hideBanner();
    checkNewDay();
    selectedDay = todayDay;
    historyLimit = 10;
    renderAll();
    return '';
  }

  function failMsg(reason) { return 'Restore failed: ' + reason + ' Your current data was not changed.'; }

  function openRestoreDialog(fileName, result) {
    flushNote(); // so the "now" counts include a note that is still being typed
    pendingRestore = result.data;
    var when = result.exportedAt ? fmtExported(result.exportedAt) : '';
    $('rs-file').textContent = fileName + (when ? ' \u00B7 exported ' + when : '');
    $('rs-new').textContent = describe(result.data);
    $('rs-cur').textContent = describe(state);
    rsMsg.textContent = '';
    rsMsg.hidden = true;
    openModal(rdlg);
  }

  $('export').addEventListener('click', function () { exportBackup(bkMsg); });
  $('import').addEventListener('click', function () { fileInput.click(); });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size === 0) { fileInput.value = ''; say(bkMsg, failMsg('The file is empty.'), 'error'); return; }
    if (file.size > MAX_BACKUP_BYTES) {
      fileInput.value = '';
      say(bkMsg, failMsg('The file is larger than 5 MB, which is more than this browser can store.'), 'error');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { fileInput.value = ''; say(bkMsg, failMsg('The file could not be read.'), 'error'); };
    reader.onload = function () {
      fileInput.value = ''; // lets the same file be chosen again later
      var result = parseBackup(String(reader.result));
      if (result.error) { say(bkMsg, failMsg(result.error), 'error'); return; }
      openRestoreDialog(file.name, result);
    };
    reader.readAsText(file);
  });

  $('rs-go').addEventListener('click', function () {
    var next = pendingRestore;
    pendingRestore = null;
    closeModal(rdlg);
    if (!next) return;
    flushNote();
    var reason = applyRestore(next);
    if (reason) say(bkMsg, failMsg(reason), 'error');
    else say(bkMsg, 'Backup restored: ' + describe(state) + '.', 'ok');
  });
  $('rs-cancel').addEventListener('click', function () { pendingRestore = null; closeModal(rdlg); });
  $('rs-keep').addEventListener('click', function () { exportBackup(rsMsg); });
  rdlg.addEventListener('close', function () { pendingRestore = null; });

  /* ---------- Refresh when the page comes back, or the real date changes ---------- */
  function refreshFromStorage() {
    if (!storageReadable || dirty || noteTimer !== null) return;
    var text = storageGet(STORAGE_KEY);
    if (text === null) return;
    var parsed = parseState(text);
    if (parsed) state = parsed;
  }
  function checkNewDay() { // midnight passed: follow the new date only if viewing "today"
    var t = todayKey();
    if (t === todayDay) return;
    var followToday = selectedDay === todayDay;
    var followWeek = statsWeek === weekStartOf(todayDay); // dashboard follows the current week too
    todayDay = t;
    if (followToday) selectedDay = t;
    if (followWeek) statsWeek = weekStartOf(t);
  }
  function refresh() {
    if (dlg.open || cal.open || rdlg.open) return; // do not rebuild lists under an open dialog
    checkNewDay();
    refreshFromStorage();
    renderAll();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushNote(); else refresh();
  });
  window.addEventListener('pagehide', flushNote);
  window.addEventListener('pageshow', function (e) { if (e.persisted) refresh(); });
  setInterval(function () {
    if (todayKey() !== todayDay) { flushNote(); refresh(); }
  }, 60000);

  /* ---------- Offline support (installable app) ----------
     Registers sw.js so the app can open without a connection. It only stores the app's own
     files, never your saved data, and if anything goes wrong the website keeps working
     online exactly as before. */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    function register() {
      try {
        navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' })
          .catch(function () { /* offline support is unavailable; the app is unaffected */ });
      } catch (e) { /* ignore */ }
    }
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);
  }

  /* ---------- Start ---------- */
  state = loadState();
  buildTicks();
  renderAll();
  registerServiceWorker();
})();

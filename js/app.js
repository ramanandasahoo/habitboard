/* HabitBoard: tasks, habits, daily completions and dated notes, saved in localStorage.
   Version 2 adds a date selector, a calendar and a notes history. */
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
    todayDay = t;
    if (followToday) selectedDay = t;
  }
  function refresh() {
    if (dlg.open || cal.open) return; // do not rebuild lists under an open dialog
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

  /* ---------- Start ---------- */
  state = loadState();
  buildTicks();
  renderAll();
})();

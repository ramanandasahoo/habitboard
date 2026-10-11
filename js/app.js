/* HabitBoard: tasks, habits, daily completions and notes, saved in localStorage. */
(function () {
  'use strict';

  var STORAGE_KEY = 'habitboard:v1';
  var SCHEMA_VERSION = 1;
  var PRIO = { 1: 'Low priority', 2: 'Medium priority', 3: 'High priority' };
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- Small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; // textContent keeps user text safe
    return n;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function copy(obj) {
    var o = {};
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = obj[k]; }
    return o;
  }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /* ---------- Banner (storage and data notices) ---------- */
  var banner = $('banner');
  var bannerKind = '';
  function showBanner(msg, kind) { banner.textContent = msg; banner.hidden = false; bannerKind = kind; }
  function hideBanner() { banner.textContent = ''; banner.hidden = true; bannerKind = ''; }

  /* ---------- Safe localStorage access ---------- */
  var storageReadable = true;

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
       tasks:  [{ id, title, priority 1-3, done, date 'YYYY-MM-DD', createdAt }],
       habits: [{ id, name, createdAt }],
       log:    { 'YYYY-MM-DD': [habitId, ...] },   habits completed on that day
       notes:  { 'YYYY-MM-DD': 'text' }
     }
     Unknown fields are kept, so newer versions of the app never lose data. */
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

  function cleanLog(log) {
    var out = {};
    if (!isPlainObject(log)) return out;
    Object.keys(log).forEach(function (day) {
      if (!DATE_RE.test(day) || !Array.isArray(log[day])) return;
      var ids = log[day].map(String).filter(function (id, i, a) { return a.indexOf(id) === i; });
      if (ids.length) out[day] = ids;
    });
    return out;
  }

  function cleanNotes(notes) {
    var out = {};
    if (!isPlainObject(notes)) return out;
    Object.keys(notes).forEach(function (day) {
      if (DATE_RE.test(day) && typeof notes[day] === 'string' && notes[day] !== '') out[day] = notes[day];
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
      showBanner('Could not save your changes. Browser storage may be full or blocked.', 'save');
      return false;
    }
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

  /* ---------- Habit log and streaks ---------- */
  var renderedDay = todayKey();

  function habitDone(day, id) {
    var a = state.log[day];
    return !!a && a.indexOf(id) > -1;
  }
  function setHabitDone(day, id, value) {
    var a = (state.log[day] || []).filter(function (x) { return x !== id; });
    if (value) a.push(id);
    if (a.length) state.log[day] = a; else delete state.log[day];
  }
  function streakFor(id) {
    var d = new Date();
    d.setHours(12, 0, 0, 0); // midday avoids daylight-saving edge cases
    if (!habitDone(dateKey(d), id)) d.setDate(d.getDate() - 1);
    var n = 0;
    while (n < 3650 && habitDone(dateKey(d), id)) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------- Tasks shown today: today's, plus unfinished ones from earlier days ---------- */
  function visibleTasks() {
    return state.tasks.filter(function (t) {
      return t.date === renderedDay || (t.date < renderedDay && !t.done);
    });
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

  /* ---------- Rendering ---------- */
  var habitMeta = {};

  function renderHeader() {
    var now = new Date(), h = now.getHours();
    $('greeting').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
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
      ul.append(el('li', 'empty meta', 'No tasks yet. Tap + to add one.'));
      return;
    }
    list.forEach(function (t) {
      var li = el('li', 'row'), lab = el('label', 'row-main');
      var cb = el('input', 'box');
      cb.type = 'checkbox';
      cb.checked = t.done;
      cb.addEventListener('change', function () { t.done = cb.checked; save(); update(); });
      var tx = el('span', 'row-text');
      var sub = PRIO[t.priority] + (t.date < renderedDay ? ' \u00B7 carried over' : '');
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
      sw.checked = habitDone(renderedDay, hb.id);
      sw.addEventListener('change', function () {
        setHabitDone(renderedDay, hb.id, sw.checked);
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
    var box = $('note'), v = state.notes[renderedDay] || '';
    if (box.value !== v) box.value = v;
  }

  function update() {
    var tasks = visibleTasks();
    var td = tasks.filter(function (t) { return t.done; }).length;
    var hd = state.habits.filter(function (h) { return habitDone(renderedDay, h.id); }).length;
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
      if (habitMeta[hb.id]) habitMeta[hb.id].textContent = 'Streak ' + streakFor(hb.id);
    });
  }

  function renderAll() {
    renderedDay = todayKey();
    renderHeader();
    renderTasks();
    renderHabits();
    renderNote();
    update();
  }

  /* ---------- Daily note ---------- */
  var note = $('note');
  var noteTimer = null;
  var noteDay = renderedDay;

  note.addEventListener('input', function () {
    noteDay = renderedDay;
    if (noteTimer !== null) clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNote, 400);
  });
  function flushNote() {
    if (noteTimer === null) return;
    clearTimeout(noteTimer);
    noteTimer = null;
    if (note.value === '') delete state.notes[noteDay]; else state.notes[noteDay] = note.value;
    save();
  }
  note.addEventListener('blur', flushNote);

  /* ---------- Add / edit dialog ---------- */
  var dlg = $('dlg'), form = $('form');
  var editing = null;      // { type, item } while editing, otherwise null
  var deleteArmed = false;

  function openModal() {
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeModal() {
    if (typeof dlg.close === 'function') { if (dlg.open) dlg.close(); } else dlg.removeAttribute('open');
    resetDelete();
  }
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
    openModal();
    $('t-title').focus();
  }

  $('add').addEventListener('click', function () { openDialog('task', null); });
  $('t-type').addEventListener('change', syncDialog);
  $('cancel').addEventListener('click', closeModal);
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
        done: false, date: renderedDay, createdAt: Date.now()
      });
    }
    save();
    renderTasks();
    renderHabits();
    update();
    closeModal();
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
    closeModal();
  });

  /* ---------- Refresh when the page comes back, or the date changes ---------- */
  function refreshFromStorage() {
    if (!storageReadable || noteTimer !== null) return;
    var text = storageGet(STORAGE_KEY);
    if (text === null) return;
    var parsed = parseState(text);
    if (parsed) state = parsed;
  }
  function refresh() {
    if (dlg.open) return; // do not rebuild lists under an open dialog
    refreshFromStorage();
    renderAll();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushNote(); else refresh();
  });
  window.addEventListener('pagehide', flushNote);
  window.addEventListener('pageshow', function (e) { if (e.persisted) refresh(); });
  setInterval(function () {
    if (todayKey() !== renderedDay) { flushNote(); refresh(); }
  }, 60000);

  /* ---------- Start ---------- */
  state = loadState();
  buildTicks();
  renderAll();
})();

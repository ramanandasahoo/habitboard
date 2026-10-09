/* HabitBoard Home prototype. Sample data only; nothing is saved yet. */
(function () {
  'use strict';

  var tasks = [
    { title: 'Review today\'s plan', priority: 3, done: true },
    { title: 'Reply to messages', priority: 2, done: false },
    { title: 'Tidy the desk', priority: 1, done: false },
    { title: 'Evening walk', priority: 2, done: false }
  ];
  // prior = streak length up to yesterday
  var habits = [
    { name: 'Drink water', prior: 5, done: true },
    { name: 'Read 10 pages', prior: 12, done: false },
    { name: 'Stretch', prior: 0, done: false }
  ];
  var PRIO = { 1: 'Low priority', 2: 'Medium priority', 3: 'High priority' };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; // textContent keeps user text safe
    return n;
  }

  // Header
  var now = new Date();
  var h = now.getHours();
  $('greeting').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // 40 ticks around the dial
  var ticksHtml = '';
  for (var i = 0; i < 40; i++) {
    ticksHtml += '<line x1="70" y1="4" x2="70" y2="12" transform="rotate(' + i * 9 + ' 70 70)"/>';
  }
  $('ticks').innerHTML = ticksHtml;
  var tickEls = $('ticks').querySelectorAll('line');

  function renderTasks() {
    var ul = $('tasks');
    ul.textContent = '';
    tasks.forEach(function (t) {
      var li = el('li', 'row'), lab = el('label', 'row-main');
      var cb = el('input', 'box');
      cb.type = 'checkbox';
      cb.checked = t.done;
      cb.addEventListener('change', function () { t.done = cb.checked; update(); });
      var tx = el('span', 'row-text');
      tx.append(el('span', 'title', t.title), el('span', 'meta', PRIO[t.priority]));
      var p = el('span', 'prio');
      p.dataset.p = t.priority;
      p.setAttribute('aria-hidden', 'true');
      p.append(el('i'), el('i'), el('i'));
      lab.append(cb, tx, p);
      li.append(lab);
      ul.append(li);
    });
  }

  function renderHabits() {
    var ul = $('habits');
    ul.textContent = '';
    habits.forEach(function (hb) {
      var li = el('li', 'row'), lab = el('label', 'row-main');
      var tx = el('span', 'row-text');
      hb.meta = el('span', 'meta');
      tx.append(el('span', 'title', hb.name), hb.meta);
      var sw = el('input', 'sw');
      sw.type = 'checkbox';
      sw.setAttribute('role', 'switch');
      sw.checked = hb.done;
      sw.addEventListener('change', function () { hb.done = sw.checked; update(); });
      lab.append(tx, sw);
      li.append(lab);
      ul.append(li);
    });
  }

  function update() {
    var td = tasks.filter(function (t) { return t.done; }).length;
    var hd = habits.filter(function (x) { return x.done; }).length;
    var total = tasks.length + habits.length;
    var done = td + hd;
    var pct = total ? Math.round(done / total * 100) : 0;

    $('pct').textContent = pct + '%';
    $('dial').style.setProperty('--a', pct * 3.6 + 'deg');
    $('dial').setAttribute('aria-valuenow', pct);
    var lit = Math.round(pct * 0.4);
    tickEls.forEach(function (ln, i) { ln.classList.toggle('on', i < lit); });

    $('summary').textContent = total ? done + ' of ' + total + ' done' : 'Nothing planned yet';
    $('split').textContent = td + ' of ' + tasks.length + ' tasks, ' + hd + ' of ' + habits.length + ' habits';
    $('t-count').textContent = td + ' of ' + tasks.length;
    $('h-count').textContent = hd + ' of ' + habits.length;
    habits.forEach(function (hb) {
      hb.meta.textContent = 'Streak ' + (hb.prior + (hb.done ? 1 : 0));
    });
  }

  // Add task dialog
  var dlg = $('dlg'), form = $('form');
  $('add').addEventListener('click', function () {
    form.reset();
    dlg.showModal();
    $('t-title').focus();
  });
  $('cancel').addEventListener('click', function () { dlg.close(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('t-title').value.trim();
    if (!title) return;
    tasks.push({ title: title, priority: Number($('t-prio').value), done: false });
    renderTasks();
    update();
    dlg.close();
  });

  renderTasks();
  renderHabits();
  update();
})();

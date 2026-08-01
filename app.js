(() => {
  const STORAGE_KEY = 'planera-ios-v1';
  const todayKey = new Date().toISOString().slice(0, 10);
  const baseState = {
    selectedDate: todayKey,
    tasks: [],
    expenses: [],
    monthlyResetDay: 28,
    activeTimerId: null
  };
  let state = loadState();
  let timerInterval = null;
  let entryType = null;

  const $ = (selector) => document.querySelector(selector);
  const taskList = $('#taskList');
  const goalList = $('#goalList');
  const expenseList = $('#expenseList');
  const dialog = $('#entryDialog');
  const form = $('#entryForm');
  const fields = $('#formFields');

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved ? { ...baseState, ...saved } : structuredClone(baseState);
    } catch { return structuredClone(baseState); }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function id() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function formatDate(dateString) {
    return new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${dateString}T12:00:00`));
  }
  function shortDate(date) { return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(date); }
  function formatCurrency(value) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
  }
  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  function dayTasks() { return state.tasks.filter(task => task.date === state.selectedDate); }
  function dayExpenses() { return state.expenses.filter(expense => expense.date === state.selectedDate); }
  function currentWeekDates() {
    const target = new Date(`${state.selectedDate}T12:00:00`);
    const mondayOffset = (target.getDay() + 6) % 7;
    target.setDate(target.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, i) => { const day = new Date(target); day.setDate(day.getDate() + i); return day.toISOString().slice(0, 10); });
  }
  function dateFromKey(dateKey) { return new Date(`${dateKey}T12:00:00`); }
  function dateKey(date) { return date.toISOString().slice(0, 10); }
  function weekNumber(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  }
  function weekBounds() {
    const dates = currentWeekDates();
    return { start: dateFromKey(dates[0]), end: dateFromKey(dates[6]) };
  }
  function monthlyBounds() {
    const selected = dateFromKey(state.selectedDate);
    const resetDay = Number(state.monthlyResetDay) || 28;
    const start = new Date(selected.getFullYear(), selected.getMonth() - (selected.getDate() < resetDay ? 1 : 0), resetDay, 12);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, resetDay - 1, 12);
    return { start, end };
  }
  function expensesBetween(start, end) {
    return state.expenses.filter(expense => {
      const date = dateFromKey(expense.date);
      return date >= start && date <= end;
    });
  }
  function taskGoalGroups() {
    const weekDates = new Set(currentWeekDates());
    const grouped = new Map();
    state.tasks.filter(task => task.weeklyGoal && weekDates.has(task.date)).forEach(task => {
      const key = task.goalGroupId || task.id;
      if (!grouped.has(key)) grouped.set(key, { title: task.title, tasks: [] });
      grouped.get(key).tasks.push(task);
    });
    return [...grouped.values()];
  }
  function doneCount(items) { return items.filter(item => item.done).length; }
  function updateText(el, value) { if (el) el.textContent = value; }

  function render() {
    renderHeader(); renderTasks(); renderGoals(); renderExpenses(); renderMetrics();
  }
  function renderHeader() {
    const label = formatDate(state.selectedDate);
    updateText($('#todayLabel'), label);
    updateText($('#todayButton'), state.selectedDate === todayKey ? 'Idag' : 'Till idag');
    $('#datePicker').value = state.selectedDate;
  }
  function renderTasks() {
    const tasks = dayTasks();
    taskList.innerHTML = '';
    if (!tasks.length) {
      taskList.innerHTML = '<p class="muted">Här blir dagen tydlig. Lägg in din första uppgift.</p>';
      return;
    }
    const template = $('#taskTemplate');
    tasks.forEach((task, index) => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector('.task-card');
      card.dataset.id = task.id;
      card.classList.toggle('done', task.done);
      const check = node.querySelector('.check-button');
      check.setAttribute('aria-label', task.done ? 'Markera uppgift som inte klar' : 'Markera uppgift som klar');
      node.querySelector('h3').textContent = task.title;
      const details = [task.time, task.duration ? `${task.duration} min` : '', task.weeklyGoal ? 'Veckomål' : ''].filter(Boolean).join(' · ');
      node.querySelector('.task-meta').textContent = details || 'Utan tid';
      node.querySelector('.move-up').disabled = index === 0;
      node.querySelector('.move-down').disabled = index === tasks.length - 1;
      const timerLine = node.querySelector('.timer-line');
      if (task.duration) {
        timerLine.hidden = false;
        const remaining = remainingSeconds(task);
        const timerButton = node.querySelector('.timer-button');
        node.querySelector('.timer-value').textContent = formatTime(remaining);
        if (task.timerRunning) { timerButton.textContent = 'Pausa'; timerButton.classList.add('running'); }
        else if (remaining === 0) timerButton.textContent = 'Klar';
      }
      taskList.appendChild(node);
    });
  }
  function renderGoals() {
    goalList.innerHTML = '';
    const groups = taskGoalGroups();
    if (!groups.length) { goalList.innerHTML = '<p class="muted">Gör en schemapost till ett veckomål när du lägger till den.</p>'; return; }
    groups.forEach(group => {
      const card = document.createElement('article');
      const done = doneCount(group.tasks);
      const allDone = done === group.tasks.length;
      card.className = `goal-card ${allDone ? 'done' : ''}`;
      card.innerHTML = `<span class="check-button" aria-hidden="true"></span><div class="goal-info"><h3></h3><p></p></div><span class="frequency-pill"></span>`;
      card.querySelector('h3').textContent = group.title;
      card.querySelector('p').textContent = `${done} av ${group.tasks.length} dagar genomförda`;
      card.querySelector('.frequency-pill').textContent = `${done} / ${group.tasks.length}`;
      goalList.appendChild(card);
    });
  }
  function renderExpenses() {
    const expenses = dayExpenses();
    expenseList.innerHTML = '';
    if (!expenses.length) { expenseList.innerHTML = '<p class="muted">Ingen utgift registrerad för idag.</p>'; return; }
    expenses.forEach(expense => {
      const card = document.createElement('article');
      card.className = 'expense-card'; card.dataset.id = expense.id;
      card.innerHTML = `<div><h3></h3><p></p></div><div class="expense-right"><strong></strong><button class="delete-button" type="button" aria-label="Ta bort utgift">×</button></div>`;
      card.querySelector('h3').textContent = expense.title;
      card.querySelector('p').textContent = expense.category || 'Övrigt';
      card.querySelector('strong').textContent = formatCurrency(expense.amount);
      expenseList.appendChild(card);
    });
  }
  function renderMetrics() {
    const tasks = dayTasks();
    const doneTasks = doneCount(tasks);
    const dayPercentage = tasks.length ? Math.round(doneTasks / tasks.length * 100) : 0;
    $('#dayRing').style.setProperty('--value', `${dayPercentage}%`);
    updateText($('#dayPercent'), `${dayPercentage}%`);
    updateText($('#daySummary'), `${doneTasks} av ${tasks.length} klart`);
    const weekTasks = state.tasks.filter(task => currentWeekDates().includes(task.date));
    const doneWeekTasks = doneCount(weekTasks);
    const weekPercent = weekTasks.length ? Math.round(doneWeekTasks / weekTasks.length * 100) : 0;
    $('#weekRing').style.setProperty('--value', `${weekPercent}%`);
    updateText($('#weekPercent'), `${weekPercent}%`);
    updateText($('#weekSummary'), `${doneWeekTasks} av ${weekTasks.length} moment`);
    updateText($('#goalWeekLabel'), `Vecka ${weekNumber(dateFromKey(state.selectedDate))}`);
    const expenses = dayExpenses();
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    updateText($('#moneyTotal'), formatCurrency(total));
    updateText($('#moneyCount'), expenses.length ? `${expenses.length} ${expenses.length === 1 ? 'utgift' : 'utgifter'} registrerade` : 'Inga utgifter registrerade');
    const week = weekBounds(); const month = monthlyBounds();
    updateText($('#weekMoneyTotal'), formatCurrency(expensesBetween(week.start, week.end).reduce((sum, expense) => sum + Number(expense.amount), 0)));
    updateText($('#monthMoneyTotal'), formatCurrency(expensesBetween(month.start, month.end).reduce((sum, expense) => sum + Number(expense.amount), 0)));
    updateText($('#weekMoneyDates'), `${shortDate(week.start)}–${shortDate(week.end)}`);
    updateText($('#monthMoneyDates'), `${shortDate(month.start)}–${shortDate(month.end)}`);
    updateText($('#moneyPeriodButton'), `Period: ${state.monthlyResetDay}–${Number(state.monthlyResetDay) - 1 || 31}`);
  }
  function categoryBreakdown(expenses) {
    const totals = new Map();
    expenses.forEach(expense => {
      const category = expense.category || 'Övrigt';
      totals.set(category, (totals.get(category) || 0) + Number(expense.amount));
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }
  function openSpendingBreakdown(period) {
    const bounds = period === 'week' ? weekBounds() : monthlyBounds();
    const expenses = expensesBetween(bounds.start, bounds.end);
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const label = period === 'week' ? 'Denna vecka' : 'Denna månad';
    updateText($('#spendingPeriodLabel'), `${label} · ${shortDate(bounds.start)}–${shortDate(bounds.end)}`);
    updateText($('#spendingDialogTotal'), formatCurrency(total));
    const chart = $('#categoryChart');
    chart.innerHTML = '';
    if (!expenses.length) {
      chart.innerHTML = '<p class="category-empty">Inga utgifter har registrerats under perioden ännu.</p>';
    } else {
      categoryBreakdown(expenses).forEach(([category, amount]) => {
        const share = Math.round(amount / total * 100);
        const row = document.createElement('article');
        row.className = 'category-chart-item';
        const head = document.createElement('div'); head.className = 'category-head';
        const name = document.createElement('span'); name.textContent = category;
        const value = document.createElement('strong'); value.textContent = formatCurrency(amount);
        const bar = document.createElement('div'); bar.className = 'category-bar';
        const fill = document.createElement('div'); fill.className = 'category-fill'; fill.style.width = `${share}%`;
        const note = document.createElement('p'); note.className = 'category-share'; note.textContent = `${share} % av periodens utgifter`;
        head.append(name, value); bar.appendChild(fill); row.append(head, bar, note); chart.appendChild(row);
      });
    }
    $('#spendingDialog').showModal();
  }
  function remainingSeconds(task) {
    if (!task.duration) return 0;
    if (!task.timerRunning) return task.remainingSeconds ?? task.duration * 60;
    const elapsed = Math.max(0, Math.floor((Date.now() - task.timerStartedAt) / 1000));
    return Math.max(0, task.remainingSeconds - elapsed);
  }
  function tickTimers() {
    let modified = false;
    state.tasks.forEach(task => {
      if (task.timerRunning && remainingSeconds(task) <= 0) {
        task.timerRunning = false; task.remainingSeconds = 0; task.done = true; modified = true;
        if (navigator.vibrate) navigator.vibrate([130, 80, 130]);
      }
    });
    if (modified) saveState();
    renderTasks(); renderGoals(); renderMetrics();
  }
  function startTicking() { clearInterval(timerInterval); timerInterval = setInterval(tickTimers, 1000); }
  function openEntry(type) {
    entryType = type;
    const schemas = {
      task: { title: 'Ny uppgift', content: `<div class="field"><label for="entryTitle">Vad vill du göra?</label><input required autofocus id="entryTitle" name="title" placeholder="Exempel: Gympass"></div><div class="inline-fields"><div class="field"><label for="entryTime">Tid (valfritt)</label><input id="entryTime" name="time" type="time"></div><div class="field"><label for="entryDuration">Timer i minuter</label><input id="entryDuration" name="duration" type="number" min="1" placeholder="30"></div></div><div class="field"><label class="weekly-goal-toggle"><input id="weeklyGoal" name="weeklyGoal" type="checkbox"> Gör till veckomål</label></div><div class="weekday-picker" id="weekdayPicker" aria-label="Välj dagar"><button class="weekday-option" type="button" data-day="0">Mån</button><button class="weekday-option" type="button" data-day="1">Tis</button><button class="weekday-option" type="button" data-day="2">Ons</button><button class="weekday-option" type="button" data-day="3">Tors</button><button class="weekday-option" type="button" data-day="4">Fre</button><button class="weekday-option" type="button" data-day="5">Lör</button><button class="weekday-option" type="button" data-day="6">Sön</button></div>` },
      expense: { title: 'Ny utgift', content: `<div class="field"><label for="entryTitle">Vad köpte du?</label><input required autofocus id="entryTitle" name="title" placeholder="Exempel: Lunch"></div><div class="inline-fields"><div class="field"><label for="entryAmount">Belopp (£)</label><input required id="entryAmount" name="amount" type="number" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label for="entryCategory">Kategori</label><input id="entryCategory" name="category" placeholder="Mat, resa ..."></div></div>` }
    };
    $('#dialogTitle').textContent = schemas[type].title;
    fields.innerHTML = schemas[type].content;
    if (type === 'task') {
      const toggle = $('#weeklyGoal'); const picker = $('#weekdayPicker');
      toggle.addEventListener('change', () => picker.classList.toggle('visible', toggle.checked));
      picker.addEventListener('click', event => {
        const button = event.target.closest('.weekday-option');
        if (button) button.classList.toggle('selected');
      });
    }
    dialog.showModal();
    setTimeout(() => $('#entryTitle')?.focus(), 0);
  }
  function closeEntry() { dialog.close(); fields.innerHTML = ''; entryType = null; }
  function submitEntry(event) {
    event.preventDefault(); const data = new FormData(form); const title = data.get('title').trim(); if (!title) return;
    if (entryType === 'task') {
      const duration = Number(data.get('duration')) || 0;
      const weeklyGoal = data.get('weeklyGoal') === 'on';
      const selectedDays = [...fields.querySelectorAll('.weekday-option.selected')].map(button => Number(button.dataset.day));
      const dates = weeklyGoal && selectedDays.length ? currentWeekDates().filter((_, index) => selectedDays.includes(index)) : [state.selectedDate];
      const groupId = weeklyGoal ? id() : null;
      dates.forEach(date => state.tasks.push({ id: id(), title, date, time: data.get('time'), duration, remainingSeconds: duration * 60, done: false, timerRunning: false, weeklyGoal, goalGroupId: groupId }));
    }
    if (entryType === 'expense') state.expenses.push({ id: id(), title, amount: Number(data.get('amount')), category: data.get('category').trim(), date: state.selectedDate });
    saveState(); closeEntry(); render();
  }
  function taskFromEvent(event) { const card = event.target.closest('.task-card'); return card ? state.tasks.find(task => task.id === card.dataset.id) : null; }
  taskList.addEventListener('click', event => {
    const task = taskFromEvent(event); if (!task) return;
    if (event.target.closest('.check-button')) {
      task.done = !task.done;
      if (task.done && task.timerRunning) { task.remainingSeconds = remainingSeconds(task); task.timerRunning = false; }
    }
    else if (event.target.closest('.delete-button')) { state.tasks = state.tasks.filter(item => item.id !== task.id); }
    else if (event.target.closest('.move-up') || event.target.closest('.move-down')) {
      const tasks = dayTasks(); const index = tasks.indexOf(task); const direction = event.target.closest('.move-up') ? -1 : 1; const other = tasks[index + direction];
      if (other) { const a = state.tasks.indexOf(task), b = state.tasks.indexOf(other); [state.tasks[a], state.tasks[b]] = [state.tasks[b], state.tasks[a]]; }
    } else if (event.target.closest('.timer-button')) {
      if (remainingSeconds(task) === 0) { task.remainingSeconds = task.duration * 60; task.done = false; }
      if (task.timerRunning) { task.remainingSeconds = remainingSeconds(task); task.timerRunning = false; }
      else { task.timerRunning = true; task.timerStartedAt = Date.now(); }
    } else return;
    saveState(); render();
  });
  expenseList.addEventListener('click', event => {
    const card = event.target.closest('.expense-card'); if (!card || !event.target.closest('.delete-button')) return;
    state.expenses = state.expenses.filter(item => item.id !== card.dataset.id); saveState(); render();
  });
  ['#addTaskButton', '#addTaskButtonWide'].forEach(sel => $(sel).addEventListener('click', () => openEntry('task')));
  ['#addExpenseButton', '#addExpenseButtonWide'].forEach(sel => $(sel).addEventListener('click', () => openEntry('expense')));
  $('#closeDialog').addEventListener('click', closeEntry); $('#cancelDialog').addEventListener('click', closeEntry); form.addEventListener('submit', submitEntry);
  const moneySettingsDialog = $('#moneySettingsDialog');
  const moneySettingsForm = $('#moneySettingsForm');
  const resetDaySelect = $('#monthlyResetDay');
  for (let day = 1; day <= 28; day += 1) {
    const option = document.createElement('option'); option.value = day; option.textContent = `${day}:e varje månad`; resetDaySelect.appendChild(option);
  }
  $('#moneyPeriodButton').addEventListener('click', () => { resetDaySelect.value = state.monthlyResetDay; moneySettingsDialog.showModal(); });
  $('#closeMoneySettings').addEventListener('click', () => moneySettingsDialog.close());
  $('#cancelMoneySettings').addEventListener('click', () => moneySettingsDialog.close());
  moneySettingsForm.addEventListener('submit', event => {
    event.preventDefault(); state.monthlyResetDay = Number(resetDaySelect.value); saveState(); moneySettingsDialog.close(); renderMetrics();
  });
  $('#weekPeriodCard').addEventListener('click', () => openSpendingBreakdown('week'));
  $('#monthPeriodCard').addEventListener('click', () => openSpendingBreakdown('month'));
  $('#closeSpendingDialog').addEventListener('click', () => $('#spendingDialog').close());
  $('#todayButton').addEventListener('click', () => { state.selectedDate = todayKey; saveState(); render(); });
  $('#datePicker').addEventListener('change', event => { if (!event.target.value) return; state.selectedDate = event.target.value; saveState(); render(); });
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === tab.dataset.view));
  }));
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
  render(); startTicking();
})();

/* NovaFit — интерфейс. Все данные хранятся только на телефоне (localStorage). */
(function () {
  'use strict';
  const NF = window.NF;
  const KEY = 'novafit.v1';
  const LIQUID = { milk: 1, kefir: 1 };
  const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];

  // ───────────────── состояние ─────────────────
  function todayStr(d) {
    d = d || new Date();
    const z = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function addDays(date, n) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function defaults() {
    return {
      v: 1,
      profile: null,
      draftProfile: { sex: 'm', age: 20, height: 178, weight: 60, target: 68, activity: 1.375, pace: 'normal' },
      startWeight: null,
      calAdjust: 0, lastAdjust: null, adaptMsg: null,
      weights: [],
      inventory: { buckwheat: 900, rice: 800, oats: 500, eggs: 550, milk: 1000, chicken_breast: 900, cottage5: 400, banana: 600, peanut_butter: 300, sunflower_oil: 500, frozen_veg: 400, cucumber: 300, bread: 450, cheese: 200 },
      demoInventory: true,
      invVersion: 1,
      customFoods: [],
      plans: {},
      sleep: { bed: '23:30', wake: '07:30', log: [] },
      equip: { db: 1, dbKg: 10, adjustable: false, bar: false, bench: false, band: false },
      level: 'beginner',
      train: { days: [1, 3, 5], time: '18:00' },
      workouts: [],
      draft: null,
      tab: 'today',
      extras: {},          // еда вне плана: {дата: [{id, g, t}]}
      expiry: {},          // сроки годности: {id продукта: 'YYYY-MM-DD'}
      measures: [],        // замеры тела
      reminders: { enabled: false, meals: true, lead: 10, sleep: true, train: true, weigh: true, measure: true },
      remFired: {},        // какие напоминания уже показаны: {дата: {ключ: 1}}
      timer: null,         // таймер отдыха/подхода: {kind, endAt, total, label, exId}
      autoRest: true,
      icsExported: false,
    };
  }

  /** Пример сроков для демо-запасов: видно, как работает «сначала то, что портится». */
  function demoExpiry() {
    const t = todayStr();
    return { chicken_breast: addDays(t, 1), cottage5: addDays(t, 3), milk: addDays(t, 4), eggs: addDays(t, 18), banana: addDays(t, 4), cucumber: addDays(t, 5), bread: addDays(t, 3), cheese: addDays(t, 15) };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        const st = Object.assign(defaults(), obj);
        st.reminders = Object.assign(defaults().reminders, obj.reminders || {});
        return st;
      }
    } catch (e) { /* приватный режим и т. п. */ }
    const d = defaults();
    d.expiry = demoExpiry();
    return d;
  }
  let S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  const ui = { extraOpen: false, extraSearch: '', extraPick: null, editExp: null, reportWeek: 0, measureOpen: false, foodSeg: 'stock', search: '', addFood: null, calcSel: [], calcMeal: 'l', calcStock: true, recFilter: 'all', shopDays: 3, shopChecked: {}, confirmReset: false, customOpen: false, importOpen: false, errors: [] };

  // ───────────────── утилиты ─────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r0 = (n) => Math.round(n);
  const fm = () => NF.foodMap(S.customFoods);
  const recipeById = (id) => NF.RECIPES.find((r) => r.id === id);
  const exById = (id) => NF.EXERCISES.find((e) => e.id === id);
  function fmtDate(date, opts) {
    return new Intl.DateTimeFormat('ru-RU', opts || { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date + 'T12:00:00'));
  }
  function fmtDur(min) { const h = Math.floor(min / 60), m = min % 60; return h + ' ч' + (m ? ' ' + m + ' мин' : ''); }
  function qtyLabel(food, g) {
    const u = LIQUID[food.id] ? 'мл' : 'г';
    let s = r0(g) + ' ' + u;
    if (food.perUnit && food.unit) {
      const n = g / food.perUnit;
      const nn = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1).replace('.', ',');
      s += ' · ' + nn + ' ' + food.unit;
    }
    return s;
  }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }

  function targets() { return S.profile ? NF.calcTargets(S.profile, S.calAdjust) : null; }

  function isTrainDay(date) { return S.train.days.indexOf(new Date(date + 'T12:00:00').getDay()) >= 0; }

  function sleepEntry(date) { return S.sleep.log.find((e) => e.date === date); }

  function scheduleFor(date) {
    const e = sleepEntry(date);
    const wake = e ? e.wake : S.sleep.wake;
    return NF.mealSchedule(wake, S.sleep.bed, isTrainDay(date) ? S.train.time : null);
  }

  function recentPenalty(date) {
    const pen = {};
    [1, 2].forEach((back) => {
      const p = S.plans[addDays(date, -back)];
      if (p) p.meals.forEach((m) => { if (m.recipeId) pen[m.recipeId] = (pen[m.recipeId] || 0) + (back === 1 ? 1.2 : 0.6); });
    });
    return pen;
  }

  // ── сроки годности ──
  function daysLeft(id) {
    const e = S.expiry[id];
    return e ? NF.daysBetween(todayStr(), e) : null;
  }
  /** Запасы для планирования: просроченное в меню не попадает. */
  function usableInventory() {
    const inv = {};
    Object.keys(S.inventory).forEach((id) => { const d = daysLeft(id); if (d == null || d >= 0) inv[id] = S.inventory[id]; });
    return inv;
  }
  /** Насколько срочно доесть продукт: 1 — сегодня/завтра, 0,6 — 2–3 дня. */
  function urgencyMap() {
    const u = {};
    Object.keys(S.inventory).forEach((id) => { const d = daysLeft(id); if (d != null && d >= 0) u[id] = d <= 1 ? 1 : d <= 3 ? 0.6 : 0; });
    return u;
  }
  function setExpiryOnAdd(id, date) {
    if (!date) return;
    // если дома уже есть такой продукт со сроком раньше — оставляем более ранний (безопаснее)
    if (!S.expiry[id] || (S.inventory[id] || 0) <= 0 || date < S.expiry[id]) S.expiry[id] = date;
  }
  function suggestExpiry(id) { const d = NF.SHELF[id]; return d ? addDays(todayStr(), d) : ''; }

  // ── еда вне плана ──
  function extrasFor(date) { return S.extras[date] || []; }
  function extraMacros(date) { return NF.macrosOf(extrasFor(date), fm()); }

  function planOpts(date) { return { urgency: urgencyMap(), extraMacros: extraMacros(date) }; }

  function buildPlan(date, seed) {
    const T = targets();
    const plan = NF.planDay(date, T, scheduleFor(date), usableInventory(), fm(), recentPenalty(date), seed || 0, false, planOpts(date));
    plan.invVersion = S.invVersion;
    plan.kcal = T.kcal;
    return plan;
  }

  function getPlan(date) {
    if (!S.plans[date]) {
      S.plans[date] = buildPlan(date, 0);
      // храним планы только за последние 21 день
      Object.keys(S.plans).forEach((d) => { if (d < addDays(date, -21)) delete S.plans[d]; });
      save();
    }
    return S.plans[date];
  }

  /** Пересобрать несъеденные приёмы: съеденные и еда вне плана учитываются. */
  function rebuildPlan(date, newSeed) {
    const old = getPlan(date);
    const T = targets();
    const seed = newSeed ? (old.seed || 0) + 1 : old.seed || 0;
    const fresh = NF.planRest(old, T, scheduleFor(date), usableInventory(), fm(), recentPenalty(date), seed, planOpts(date));
    fresh.invVersion = S.invVersion;
    fresh.kcal = T.kcal;
    fresh.swaps = old.swaps || 0;
    S.plans[date] = fresh;
    save();
  }

  /** Всё съеденное за день: отмеченные приёмы + еда вне плана. */
  function eatenMacros(plan) {
    return NF.dayIntake(plan, extrasFor(plan.date), fm()).macros;
  }

  function changeInventory(id, delta) {
    const cur = S.inventory[id] || 0;
    const next = Math.max(0, cur + delta);
    if (next <= 0) { delete S.inventory[id]; delete S.expiry[id]; } else S.inventory[id] = next;
    S.invVersion++;
  }

  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t); clearTimeout(toast._h);
    requestAnimationFrame(() => t.classList.add('show'));
    toast._t = setTimeout(() => {
      t.classList.remove('show');
      toast._h = setTimeout(() => { t.hidden = true; }, 260);
    }, ms || 2600);
  }

  function runAdaptation() {
    const T = targets();
    if (!T) return;
    const res = NF.adaptCalories(S.weights, T.weekly, todayStr(), S.calAdjust, S.lastAdjust);
    if (res.rate != null) {
      // проверка состоялась — следующая не раньше чем через 7 дней
      S.adaptMsg = res.reason;
      S.calAdjust = res.adjust;
      S.lastAdjust = todayStr();
    } else if (res.reason) {
      S.adaptMsg = res.reason;
    }
  }

  // ───────────────── компоненты ─────────────────
  function macroLine(m, cls) {
    return '<span class="macros ' + (cls || '') + '"><b>' + r0(m.kcal) + '</b> ккал · Б ' + r0(m.p) + ' · Ж ' + r0(m.f) + ' · У ' + r0(m.c) + '</span>';
  }

  function bar(label, val, max, unit, mod) {
    const pct = Math.max(0, Math.min(100, (val / Math.max(1, max)) * 100));
    const key = 'bar-' + (mod || label);
    return '<div class="bar ' + (mod || '') + '"><div class="bar-top"><span>' + label + '</span><span class="num">' + r0(val) + ' / ' + r0(max) + ' ' + unit + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" data-k="' + key + '" data-w="' + pct.toFixed(1) + '" style="width:' + pct.toFixed(1) + '%"></div></div></div>';
  }

  function ring(val, max) {
    const pct = Math.max(0, Math.min(1, val / Math.max(1, max)));
    const R = 52, C = 2 * Math.PI * R;
    return '<svg class="ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="' + R + '" class="ring-bg"/>' +
      '<circle cx="64" cy="64" r="' + R + '" class="ring-fg" data-k="ring" data-dash="' + (C * pct).toFixed(1) + '" data-c="' + C.toFixed(1) + '" stroke-dasharray="' + (C * pct).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 64 64)"/></svg>';
  }

  function warningsBlock(ws) {
    if (!ws || !ws.length) return '';
    return ws.map((w) => '<div class="note note-' + w.level + '">' + esc(w.text) + '</div>').join('');
  }

  // ───────────────── вкладка «Сегодня» ─────────────────
  function renderToday() {
    if (!S.profile) return renderOnboarding();
    const date = todayStr();
    const T = targets();
    const plan = getPlan(date);
    const eaten = eatenMacros(plan);
    const F = fm();
    const stale = plan.invVersion !== S.invVersion || Math.abs(plan.kcal - T.kcal) > T.kcal * 0.03;
    const sl = sleepEntry(date);
    const train = isTrainDay(date);
    const program = currentProgram();
    const next = program[S.workouts.length % program.length];
    const doneToday = S.workouts.some((w) => w.date === date);
    const sched = scheduleFor(date);
    const lastW = S.weights.length ? S.weights[S.weights.length - 1].kg : S.profile.weight;
    const start = S.startWeight || S.profile.weight;
    const prog = Math.max(0, Math.min(1, (lastW - start) / Math.max(0.1, S.profile.target - start)));
    const left = T.kcal - eaten.kcal;

    let html = '<section class="hero">' +
      '<p class="eyebrow">' + esc(fmtDate(date)) + '</p>' +
      '<div class="hero-row">' +
      '<div class="ring-wrap">' + ring(eaten.kcal, T.kcal) + '<div class="ring-label"><span class="ring-num count" data-k="kcal" data-n="' + r0(eaten.kcal) + '">' + r0(eaten.kcal) + '</span><span class="ring-sub">из ' + T.kcal + ' ккал</span></div></div>' +
      '<div class="hero-bars">' +
      bar('Белки', eaten.p, T.protein, 'г', 'p') + bar('Жиры', eaten.f, T.fat, 'г', 'f') + bar('Углеводы', eaten.c, T.carbs, 'г', 'c') +
      '</div></div>' +
      '<div class="goal"><div class="goal-top"><span>' + lastW.toFixed(1).replace('.', ',') + ' кг</span><span class="muted">цель ' + S.profile.target + ' кг · ~' + T.weeks + ' ' + plural(T.weeks, 'неделя', 'недели', 'недель') + '</span></div>' +
      '<div class="bar-track thin"><div class="bar-fill goal-fill" data-k="goal" data-w="' + (prog * 100).toFixed(1) + '" style="width:' + (prog * 100).toFixed(1) + '%"></div></div></div>' +
      '</section>';

    html += '<div class="chips-row">' +
      '<button class="chip-card" data-act="tab" data-tab="sleep"><span class="chip-k">Сон</span><span class="chip-v">' + (sl ? fmtDur(NF.sleepMinutes(sl.bed, sl.wake)) : 'отметить') + '</span></button>' +
      '<button class="chip-card" data-act="tab" data-tab="train"><span class="chip-k">' + (train ? 'Тренировка' : 'Отдых') + '</span><span class="chip-v">' + (train ? (doneToday ? 'выполнена ✓' : esc(next.title) + ' · ' + S.train.time) : 'восстановление') + '</span></button>' +
      '<div class="chip-card"><span class="chip-k">Вода</span><span class="chip-v">' + ((train ? T.waterTrain : T.water) / 1000).toFixed(1).replace('.', ',') + ' л</span></div>' +
      '</div>';

    html += todayAlerts(plan);

    if (S.demoInventory) {
      html += '<div class="note note-info">Запасы продуктов сейчас примерные, чтобы показать, как работает план. Замени их на свои во вкладке «Питание».</div>';
    }
    if (stale) {
      html += '<div class="note note-action"><span>Запасы или норма изменились. Пересобрать несъеденные приёмы пищи?</span><button class="btn small" data-act="rebuild">Обновить план</button></div>';
    }

    html += '<div class="section-head"><h2 class="h2">План питания</h2><button class="btn small ghost" data-act="extra-toggle" aria-expanded="' + ui.extraOpen + '">' + (ui.extraOpen ? 'Скрыть' : '+ Добавить еду') + '</button></div>';
    if (ui.extraOpen) html += extraPanel();
    html += extrasList(date);
    if (sched.note) html += '<p class="hint">' + esc(sched.note) + '</p>';
    if (left < 0) html += '<p class="note note-info">Норма на сегодня закрыта, перебор ' + r0(-left) + ' ккал. Немного сверху — не страшно: на наборе это нормально, если не каждый день.</p>';

    const nowIdx = currentMealIndex(plan);
    html += '<ol class="timeline">';
    plan.meals.forEach((m, i) => {
      const rec = m.recipeId ? recipeById(m.recipeId) : null;
      const mm = NF.macrosOf(m.items, F);
      const title = rec ? rec.name : 'Тарелка из твоих продуктов';
      html += '<li class="meal' + (m.eaten ? ' eaten' : '') + (i === nowIdx ? ' now' : '') + (ui.justEaten === i ? ' just-eaten' : '') + (ui.justSwapped === i ? ' swap-in' : '') + '">' +
        '<div class="meal-time"><span class="num">' + esc(m.time) + '</span>' + (m.eaten ? '<span class="check" aria-label="съедено">✓</span>' : '') + '<span class="meal-type">' + NF.MEAL_LABEL[m.type] + '</span>' + (i === nowIdx ? '<span class="now-tag">сейчас</span>' : '') + '</div>' +
        '<div class="meal-body">' +
        '<h3>' + esc(title) + '</h3>' + macroLine(mm) +
        (m.light && !m.eaten ? '<p class="hint">Лёгкий приём: норма почти закрыта едой вне плана.</p>' : '') +
        '<ul class="items">' + m.items.map((it) => {
          const f = F[it.id]; if (!f) return '';
          const miss = m.missing.find((x) => x.id === it.id);
          const dl = daysLeft(it.id);
          const urgent = !m.eaten && dl != null && dl >= 0 && dl <= 1;
          return '<li><span>' + esc(f.name) + (urgent ? ' <em class="tag-exp">' + (dl === 0 ? 'сегодня' : 'до завтра') + '</em>' : '') + '</span><span class="num">' + qtyLabel(f, it.g) + (miss ? ' <em class="tag-miss">нет ' + r0(miss.g) + '</em>' : '') + '</span></li>';
        }).join('') + '</ul>' +
        (m.extra && F[m.extra] ? '<p class="hint">Добавка к блюду: ' + esc(F[m.extra].name.toLowerCase()) + ', чтобы добрать калории.</p>' : '') +
        (m.skipped && m.skipped.length ? '<p class="hint">Можно без: ' + m.skipped.map((id) => esc(F[id] ? F[id].name.toLowerCase() : id)).join(', ') + ' (нет дома).</p>' : '') +
        (rec ? '<details class="steps"><summary>Как готовить · ' + rec.min + ' мин</summary><ol>' + rec.steps.map((st) => '<li>' + esc(st) + '</li>').join('') + '</ol></details>' : '') +
        '<div class="meal-actions">' +
        (m.eaten ? '<button class="btn ghost small" data-act="uneat" data-i="' + i + '">Отменить</button>'
          : '<button class="btn small" data-act="eat" data-i="' + i + '">Съел</button><button class="btn ghost small" data-act="swap" data-i="' + i + '">Другой вариант</button>') +
        '</div></div></li>';
    });
    html += '</ol>';
    html += '<p class="hint">Когда отмечаешь «Съел» или добавляешь еду вне плана, продукты списываются из запасов, а оставшиеся приёмы пересчитываются под остаток нормы.</p>';
    return html;
  }

  /** Приём пищи «сейчас»: от 30 мин до его времени и до 90 мин после, если не съеден. */
  function currentMealIndex(plan) {
    const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
    let idx = -1;
    plan.meals.forEach((m, i) => {
      if (m.eaten || idx >= 0) return;
      const t = NF.toMin(m.time);
      if (nm >= t - 30 && nm <= t + 90) idx = i;
    });
    return idx;
  }

  /** Предупреждения дня: просрочка, что скоро испортится, замеры, отчёт. */
  function todayAlerts(plan) {
    const F = fm();
    let html = '';
    const expired = Object.keys(S.inventory).filter((id) => F[id] && daysLeft(id) != null && daysLeft(id) < 0);
    if (expired.length) {
      html += '<div class="note note-danger"><span><b>Просрочено:</b> ' + expired.map((id) => esc(F[id].name)).join(', ') + '. В меню не попадает. Не ешь, особенно мясо, рыбу и молочку.</span>' +
        '<button class="btn small danger" data-act="drop-expired">Убрать из запасов</button></div>';
    }
    const planned = {};
    plan.meals.forEach((m) => { if (!m.eaten) m.items.forEach((it) => { planned[it.id] = (planned[it.id] || 0) + it.g; }); });
    const soon = Object.keys(S.inventory).filter((id) => F[id] && daysLeft(id) != null && daysLeft(id) >= 0 && daysLeft(id) <= 2);
    if (soon.length) {
      html += '<div class="note note-warn expiring"><span><b>Скоро испортится</b></span><ul>' + soon.sort((a, b) => daysLeft(a) - daysLeft(b)).map((id) => {
        const d = daysLeft(id);
        const inPlan = planned[id] ? 'в плане: ' + r0(Math.min(planned[id], S.inventory[id])) + ' из ' + r0(S.inventory[id]) + (LIQUID[id] ? ' мл' : ' г') : 'пока не в плане';
        return '<li><span>' + esc(F[id].name) + '</span><span class="small">' + (d === 0 ? 'сегодня' : d === 1 ? 'завтра' : 'через 2 дня') + ' · ' + inPlan + '</span></li>';
      }).join('') + '</ul>' + (soon.some((id) => !planned[id]) ? '<p class="small">Можно заморозить мясо и рыбу: в морозилке они хранятся месяцы. После разморозки срок — сутки.</p>' : '') + '</div>';
    }
    const lastM = S.measures.length ? S.measures[S.measures.length - 1].date : null;
    if (S.profile && (!lastM || NF.daysBetween(lastM, todayStr()) >= 14)) {
      html += '<div class="note note-action"><span>' + (lastM ? 'Прошло 2 недели — пора сделать замеры тела.' : 'Сделай первые замеры тела: по ним видно, мышцы растут или жир.') + '</span><button class="btn small" data-act="open-measure">Замерить</button></div>';
    }
    const wk = NF.weekStart(todayStr());
    if (S.profile && S.weights.length && S.weights[0].date < wk && S.reportSeen !== wk) {
      const r = weekReportFor(-1);
      html += '<button class="report-teaser" data-act="open-report"><span class="eyebrow">Итоги прошлой недели</span><span class="report-teaser-main">' + esc(r.advice[0].text) + '</span><span class="link">Открыть отчёт →</span></button>';
    }
    return html;
  }

  function extraPanel() {
    const F = fm();
    const q = ui.extraSearch.trim().toLowerCase();
    let html = '<div class="card extra-panel"><label class="label" for="extra-search">Что съел вне плана?</label>' +
      '<input id="extra-search" class="input" type="search" autocomplete="off" placeholder="Например: банан, хлеб, творог" value="' + esc(ui.extraSearch) + '">' +
      '<div id="extra-results">' + extraResults() + '</div>';
    if (!q) {
      const quick = ['banana', 'bread', 'peanuts', 'cottage5', 'eggs', 'milk', 'apple', 'cheese'].filter((id) => F[id]);
      html += '<div class="pick">' + quick.map((id) => '<button class="pill" data-act="extra-pick" data-id="' + id + '">' + esc(F[id].name.split(' (')[0]) + '</button>').join('') + '</div>';
    }
    return html + '<p class="hint">Еды нет в базе? Добавь свой продукт во вкладке «Питание → Запасы» с КБЖУ с упаковки.</p></div>';
  }

  function extraResults() {
    const F = fm();
    const q = ui.extraSearch.trim().toLowerCase();
    let list = q ? NF.allFoods(S.customFoods).filter((f) => f.name.toLowerCase().indexOf(q) >= 0).slice(0, 6) : [];
    if (ui.extraPick && list.indexOf(F[ui.extraPick]) < 0) list = [F[ui.extraPick]].concat(list);
    if (q && !list.length) return '<p class="muted small">Ничего не нашлось.</p>';
    return '<ul class="results">' + list.map((f) => {
      const open = ui.extraPick === f.id;
      const inStock = (S.inventory[f.id] || 0) > 0;
      return '<li><button class="result' + (open ? ' on' : '') + '" data-act="extra-pick" data-id="' + esc(f.id) + '"><span>' + esc(f.name) + '</span><span class="muted small">' + f.kcal + ' ккал на 100 ' + (LIQUID[f.id] ? 'мл' : 'г') + (inStock ? ' · есть дома' : '') + '</span></button>' +
        (open ? '<div class="add-row"><input id="extra-qty" class="input num-in" type="number" inputmode="decimal" min="0" placeholder="' + (f.perUnit ? '1' : '100') + '">' +
          '<select id="extra-unit" class="input">' + (f.perUnit ? '<option value="unit">' + esc(f.unit) + '</option>' : '') + '<option value="g">' + (LIQUID[f.id] ? 'мл' : 'г') + '</option></select>' +
          '<button class="btn small" data-act="extra-add" data-id="' + esc(f.id) + '">Добавить</button></div>' +
          (inStock ? '<label class="check small"><input type="checkbox" id="extra-stock" checked> списать из запасов</label>' : '') : '') + '</li>';
    }).join('') + '</ul>';
  }

  function extrasList(date) {
    const xs = extrasFor(date);
    if (!xs.length) return '';
    const F = fm();
    const m = NF.macrosOf(xs, F);
    return '<div class="extras"><div class="split"><span class="h3">Вне плана</span>' + macroLine(m) + '</div><ul class="items">' + xs.map((x, i) => {
      const f = F[x.id]; if (!f) return '';
      return '<li><span>' + esc(x.t || '') + ' ' + esc(f.name) + '</span><span class="num">' + qtyLabel(f, x.g) + ' <button class="icon-btn tiny" data-act="extra-del" data-i="' + i + '" aria-label="Удалить">×</button></span></li>';
    }).join('') + '</ul></div>';
  }

  function renderOnboarding() {
    return '<section class="hero onboard"><p class="eyebrow">Добро пожаловать</p>' +
      '<h1 class="display">Набор массы без перегибов</h1>' +
      '<p>Введи рост, вес и цель. NovaFit посчитает безопасную норму калорий и БЖУ, соберёт меню из твоих продуктов, распишет приёмы пищи по сну и составит тренировки под твой инвентарь.</p></section>' +
      profileForm(true);
  }

  // ───────────────── вкладка «Питание» ─────────────────
  function renderFood() {
    const segs = [['stock', 'Запасы'], ['calc', 'Порция'], ['recipes', 'Рецепты'], ['shop', 'Покупки']];
    let html = '<h1 class="h1">Питание</h1><div class="seg" data-k="seg-food" role="tablist"><span class="seg-thumb" aria-hidden="true"></span>' + segs.map((s) =>
      '<button role="tab" aria-selected="' + (ui.foodSeg === s[0]) + '" class="seg-btn' + (ui.foodSeg === s[0] ? ' on' : '') + '" data-act="seg" data-seg="' + s[0] + '">' + s[1] + '</button>').join('') + '</div>';
    if (ui.foodSeg === 'stock') html += renderStock();
    if (ui.foodSeg === 'calc') html += renderCalc();
    if (ui.foodSeg === 'recipes') html += renderRecipes();
    if (ui.foodSeg === 'shop') html += renderShop();
    return html;
  }

  function renderStock() {
    const F = fm();
    let html = '<div class="card"><label class="label" for="food-search">Добавить продукт</label>' +
      '<input id="food-search" class="input" type="search" autocomplete="off" placeholder="Например: гречка, яйца, творог" value="' + esc(ui.search) + '">' +
      '<div id="search-results">' + searchResults() + '</div>' +
      '<button class="link" data-act="custom-toggle">' + (ui.customOpen ? 'Скрыть' : 'Нет в списке? Добавить свой продукт') + '</button>' +
      (ui.customOpen ? customFoodForm() : '') + '</div>';

    const ids = Object.keys(S.inventory).filter((id) => F[id]);
    if (S.demoInventory) {
      html += '<div class="note note-info"><span>Это пример запасов. Замени на то, что реально лежит дома.</span><button class="btn small ghost" data-act="clear-demo">Очистить пример</button></div>';
    }
    if (!ids.length) {
      html += '<div class="empty"><p>Запасов пока нет.</p><p class="muted">Найди продукт выше и укажи, сколько его дома. План питания соберётся из того, что есть, а недостающее попадёт в список покупок.</p></div>';
      return html;
    }
    const groups = {};
    ids.forEach((id) => { const c = F[id].cat; (groups[c] = groups[c] || []).push(id); });
    Object.keys(NF.CAT_LABEL).forEach((cat) => {
      if (!groups[cat]) return;
      html += '<h2 class="h3">' + NF.CAT_LABEL[cat] + '</h2><ul class="stock">';
      groups[cat].sort((a, b) => F[a].name.localeCompare(F[b].name, 'ru')).forEach((id) => {
        const f = F[id];
        html += '<li' + (expClass(id) ? ' class="' + expClass(id) + '"' : '') + '><div class="stock-name"><span>' + esc(f.name) + '</span><span class="muted small">' + qtyLabel(f, S.inventory[id]) + '</span>' + expBadge(id) + '</div>' +
          '<div class="stock-ctrl"><input class="input num-in" type="number" inputmode="numeric" min="0" step="10" id="inv-' + esc(id) + '" data-bind="inv" data-id="' + esc(id) + '" value="' + r0(S.inventory[id]) + '" aria-label="Количество, ' + (LIQUID[id] ? 'мл' : 'г') + '">' +
          '<span class="unit">' + (LIQUID[id] ? 'мл' : 'г') + '</span>' +
          '<button class="icon-btn" data-act="inv-del" data-id="' + esc(id) + '" aria-label="Удалить">×</button></div></li>';
      });
      html += '</ul>';
    });
    return html;
  }

  function searchResults() {
    const q = ui.search.trim().toLowerCase();
    if (!q) return '';
    const list = NF.allFoods(S.customFoods).filter((f) => f.name.toLowerCase().indexOf(q) >= 0).slice(0, 8);
    if (!list.length) return '<p class="muted small">Ничего не нашлось. Добавь продукт вручную ниже.</p>';
    return '<ul class="results">' + list.map((f) => {
      const open = ui.addFood === f.id;
      return '<li><button class="result" data-act="pick-food" data-id="' + esc(f.id) + '"><span>' + esc(f.name) + '</span><span class="muted small">' + f.kcal + ' ккал · Б ' + f.p + ' Ж ' + f.f + ' У ' + f.c + '</span></button>' +
        (open ? '<div class="add-row"><input id="add-qty" class="input num-in" type="number" inputmode="decimal" min="0" placeholder="' + (f.perUnit ? '1' : '500') + '">' +
          '<select id="add-unit" class="input">' + (f.perUnit ? '<option value="unit">' + esc(f.unit) + '</option>' : '') + '<option value="g">' + (LIQUID[f.id] ? 'мл' : 'г') + '</option>' + (f.perUnit ? '' : '<option value="kg">' + (LIQUID[f.id] ? 'л' : 'кг') + '</option>') + '</select>' +
          '<button class="btn small" data-act="add-food" data-id="' + esc(f.id) + '">Добавить</button></div>' +
          '<label class="exp-row">Годен до<input id="add-exp" class="input" type="date" value="' + esc(suggestExpiry(f.id)) + '"><span class="muted small">' + (NF.SHELF[f.id] ? 'обычно ' + NF.SHELF[f.id] + ' ' + plural(NF.SHELF[f.id], 'день', 'дня', 'дней') + ' в холодильнике' : 'хранится долго, можно оставить пустым') + '</span></label>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function customFoodForm() {
    return '<div class="custom"><p class="muted small">Значения с упаковки, на 100 г.</p>' +
      '<input id="cf-name" class="input" placeholder="Название">' +
      '<div class="grid4"><label>ккал<input id="cf-kcal" class="input" type="number" inputmode="decimal"></label><label>Б<input id="cf-p" class="input" type="number" inputmode="decimal"></label><label>Ж<input id="cf-f" class="input" type="number" inputmode="decimal"></label><label>У<input id="cf-c" class="input" type="number" inputmode="decimal"></label></div>' +
      '<div class="grid2"><label>Категория<select id="cf-cat" class="input">' + Object.keys(NF.CAT_LABEL).map((k) => '<option value="' + k + '">' + NF.CAT_LABEL[k] + '</option>').join('') + '</select></label>' +
      '<label>Сколько дома, г<input id="cf-qty" class="input" type="number" inputmode="numeric"></label></div>' +
      '<button class="btn" data-act="custom-add">Сохранить продукт</button></div>';
  }

  function expClass(id) { const d = daysLeft(id); return d == null ? '' : d < 0 ? 'exp-bad' : d <= 2 ? 'exp-soon' : ''; }
  function expBadge(id) {
    const d = daysLeft(id);
    if (ui.editExp === id) {
      return '<span class="exp-edit"><input id="exp-' + esc(id) + '" class="input small-in" type="date" value="' + esc(S.expiry[id] || suggestExpiry(id)) + '">' +
        '<button class="btn small" data-act="exp-save" data-id="' + esc(id) + '">ОК</button>' + (S.expiry[id] ? '<button class="btn small ghost" data-act="exp-clear" data-id="' + esc(id) + '">Без срока</button>' : '') + '</span>';
    }
    let label, cls;
    if (d == null) { label = 'указать срок'; cls = 'none'; }
    else if (d < 0) { label = 'просрочено'; cls = 'bad'; }
    else if (d === 0) { label = 'годен сегодня'; cls = 'bad'; }
    else if (d === 1) { label = 'до завтра'; cls = 'soon'; }
    else if (d <= 2) { label = 'ещё 2 дня'; cls = 'soon'; }
    else { label = 'до ' + fmtDate(S.expiry[id], { day: 'numeric', month: 'short' }); cls = 'ok'; }
    return '<button class="exp-badge ' + cls + '" data-act="exp-edit" data-id="' + esc(id) + '">' + label + '</button>';
  }

  function renderCalc() {
    const F = fm();
    const T = targets();
    if (!T) return '<div class="empty"><p>Сначала заполни профиль, чтобы знать твою норму.</p></div>';
    const target = NF.targetFor(T, NF.MEAL_SHARE[ui.calcMeal]);
    const pool = Object.keys(S.inventory).filter((id) => F[id]);
    let html = '<div class="card"><p class="muted small">Выбери продукты, которые хочешь съесть сейчас. NovaFit посчитает граммы, чтобы закрыть норму на этот приём пищи.</p>' +
      '<div class="seg small" data-k="seg-calc"><span class="seg-thumb" aria-hidden="true"></span>' + NF.MEAL_ORDER.map((t) => '<button class="seg-btn' + (ui.calcMeal === t ? ' on' : '') + '" data-act="calc-meal" data-t="' + t + '">' + NF.MEAL_LABEL[t] + '</button>').join('') + '</div>' +
      '<p class="small">Цель на ' + NF.MEAL_LABEL[ui.calcMeal].toLowerCase() + ': ' + macroLine(target) + '</p>' +
      '<label class="check"><input type="checkbox" id="calc-stock" data-bind="calc-stock"' + (ui.calcStock ? ' checked' : '') + '> не больше, чем есть дома</label>';
    if (!pool.length) html += '<p class="muted">Добавь продукты в запасы, и они появятся здесь.</p>';
    html += '<div class="pick">' + pool.map((id) => '<button class="pill' + (ui.calcSel.indexOf(id) >= 0 ? ' on' : '') + '" data-act="calc-toggle" data-id="' + esc(id) + '">' + esc(F[id].name) + '</button>').join('') + '</div></div>';
    const sel = ui.calcSel.filter((id) => F[id]);
    if (sel.length) {
      const res = NF.portionCalc(sel, target, S.inventory, F, ui.calcStock);
      const d = res.macros.kcal - target.kcal;
      html += '<div class="card result-card"><h2 class="h3">Сколько съесть</h2><ul class="items big">' +
        res.items.map((it) => '<li><span>' + esc(F[it.id].name) + '</span><span class="num">' + qtyLabel(F[it.id], it.g) + '</span></li>').join('') + '</ul>' +
        macroLine(res.macros) +
        (Math.abs(d) > target.kcal * 0.12 ? '<p class="note note-warn">' + (d < 0 ? 'Этих продуктов не хватает до нормы на ' + r0(-d) + ' ккал. Добавь что-то калорийное: орехи, масло, хлеб, банан.' : 'Получается больше нормы. Убери самый калорийный продукт.') + '</p>' : '') +
        (res.macros.p < target.p * 0.75 ? '<p class="note note-warn">Мало белка: добавь яйца, творог, мясо или рыбу.</p>' : '') +
        '</div>';
    }
    return html;
  }

  function recipeStatus(r) {
    const req = r.ing.filter((i) => !i[2]);
    const missing = req.filter((i) => (S.inventory[i[0]] || 0) < i[1] * 0.6);
    return missing;
  }

  function renderRecipes() {
    const F = fm();
    const filters = [['all', 'Все'], ['b', 'Завтрак'], ['l', 'Обед/ужин'], ['s', 'Перекус']];
    let list = NF.RECIPES.filter((r) => ui.recFilter === 'all' || r.meals.indexOf(ui.recFilter) >= 0);
    list = list.map((r) => ({ r: r, miss: recipeStatus(r) })).sort((a, b) => a.miss.length - b.miss.length);
    let html = '<div class="seg small" data-k="seg-rec"><span class="seg-thumb" aria-hidden="true"></span>' + filters.map((f) => '<button class="seg-btn' + (ui.recFilter === f[0] ? ' on' : '') + '" data-act="rec-filter" data-f="' + f[0] + '">' + f[1] + '</button>').join('') + '</div>';
    html += '<p class="hint">Граммовки указаны базовые. В плане на день они пересчитываются под твою норму.</p><div class="recipes">';
    list.forEach((x) => {
      const r = x.r;
      const baseItems = r.ing.filter((i) => !i[2]).map((i) => ({ id: i[0], g: i[1] }));
      const m = NF.macrosOf(baseItems, F);
      const ok = x.miss.length === 0;
      html += '<details class="recipe"><summary><span class="status ' + (ok ? 'ok' : x.miss.length <= 2 ? 'near' : 'no') + '">' + (ok ? 'Можно готовить' : 'Не хватает: ' + x.miss.length) + '</span>' +
        '<span class="recipe-name">' + esc(r.name) + '</span><span class="muted small">' + r.meals.split('').map((t) => NF.MEAL_LABEL[t]).join(', ') + ' · ' + r.min + ' мин · ' + r0(m.kcal) + ' ккал</span></summary>' +
        '<ul class="items">' + r.ing.map((i) => {
          const f = F[i[0]]; const have = (S.inventory[i[0]] || 0) >= i[1] * 0.6;
          return '<li class="' + (have ? '' : 'lack') + '"><span>' + esc(f.name) + (i[2] ? ' <span class="muted">(по желанию)</span>' : '') + '</span><span class="num">' + qtyLabel(f, i[1]) + '</span></li>';
        }).join('') + '</ul>' + macroLine(m) +
        '<ol class="steps-list">' + r.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></details>';
    });
    return html + '</div>';
  }

  function renderShop() {
    const T = targets();
    if (!T) return '<div class="empty"><p>Сначала заполни профиль.</p></div>';
    const F = fm();
    const list = NF.shoppingList(todayStr(), ui.shopDays, T, scheduleFor(todayStr()), S.inventory, F, recentPenalty(todayStr()));
    let html = '<div class="seg small" data-k="seg-shop"><span class="seg-thumb" aria-hidden="true"></span>' + [3, 7].map((d) => '<button class="seg-btn' + (ui.shopDays === d ? ' on' : '') + '" data-act="shop-days" data-d="' + d + '">На ' + d + ' ' + plural(d, 'день', 'дня', 'дней') + '</button>').join('') + '</div>';
    if (!list.length) return html + '<div class="empty"><p>Всё необходимое на ' + ui.shopDays + ' ' + plural(ui.shopDays, 'день', 'дня', 'дней') + ' уже есть дома.</p></div>';
    html += '<p class="hint">Список собран по меню на ближайшие дни с учётом того, что уже лежит дома. Отметь купленное и нажми кнопку внизу: продукты добавятся в запасы.</p><ul class="shop">';
    list.forEach((it) => {
      const f = F[it.id];
      const on = !!ui.shopChecked[it.id];
      html += '<li><label class="check"><input type="checkbox" id="shop-' + esc(it.id) + '" data-bind="shop" data-id="' + esc(it.id) + '" data-g="' + it.g + '"' + (on ? ' checked' : '') + '><span>' + esc(f.name) + '</span></label><span class="num">' + qtyLabel(f, it.g) + '</span></li>';
    });
    html += '</ul><button class="btn wide" data-act="shop-apply">Добавить купленное в запасы</button>';
    return html;
  }

  // ───────────────── вкладка «Тренировки» ─────────────────
  function currentProgram() { return NF.buildProgram(S.equip, S.level, S.train.days.length || 3); }

  function renderTrain() {
    const program = currentProgram();
    const idx = S.workouts.length % program.length;
    const w = S.draft && program.find((p) => p.key === S.draft.key) || program[idx];
    const eq = S.equip;
    let html = '<h1 class="h1">Тренировки</h1>';

    html += '<details class="card equip"' + (S.workouts.length ? '' : ' open') + '><summary><span class="h3">Инвентарь и расписание</span><span class="muted small">' +
      (eq.db ? eq.db + ' ' + plural(eq.db, 'гантель', 'гантели', 'гантелей') + ' по ' + eq.dbKg + ' кг' : 'без гантелей') + ' · ' + S.train.days.length + ' ' + plural(S.train.days.length, 'тренировка', 'тренировки', 'тренировок') + '/нед</span></summary>' +
      '<div class="grid2"><label>Гантелей<select id="eq-db" class="input" data-bind="eq-db"><option value="0"' + (eq.db === 0 ? ' selected' : '') + '>нет</option><option value="1"' + (eq.db === 1 ? ' selected' : '') + '>1</option><option value="2"' + (eq.db === 2 ? ' selected' : '') + '>2</option></select></label>' +
      '<label>Вес гантели, кг<input id="eq-kg" class="input" type="number" inputmode="decimal" min="1" max="60" step="0.5" data-bind="eq-kg" value="' + eq.dbKg + '"></label></div>' +
      '<div class="checks">' + [['adjustable', 'Гантель разборная'], ['bar', 'Турник'], ['bench', 'Скамья'], ['band', 'Резинка-эспандер']].map((x) =>
        '<label class="check"><input type="checkbox" id="eq-' + x[0] + '" data-bind="eq-flag" data-k="' + x[0] + '"' + (eq[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>').join('') + '</div>' +
      '<label class="label">Дни тренировок</label><div class="days">' + WEEK.map((d) => '<button class="day' + (S.train.days.indexOf(d[0]) >= 0 ? ' on' : '') + '" data-act="day" data-d="' + d[0] + '">' + d[1] + '</button>').join('') + '</div>' +
      '<div class="grid2"><label>Время тренировки<input id="tr-time" class="input" type="time" data-bind="tr-time" value="' + esc(S.train.time) + '"></label>' +
      '<label>Уровень<select id="tr-level" class="input" data-bind="level"><option value="beginner"' + (S.level === 'beginner' ? ' selected' : '') + '>Новичок (до 1 года)</option><option value="intermediate"' + (S.level === 'intermediate' ? ' selected' : '') + '>Средний</option></select></label></div>' +
      '<p class="hint">' + (S.train.days.length >= 4 ? 'Сплит «верх/низ»: каждая мышца 2 раза в неделю.' : 'Фулбоди: всё тело за тренировку, между тренировками минимум день отдыха.') +
      (S.train.days.length > 5 ? ' Больше 5 тренировок в неделю мешают восстановлению при наборе массы.' : '') + '</p></details>';

    html += '<div class="prog-row">' + program.map((p, i) => '<div class="prog-pill' + (p.key === w.key ? ' on' : '') + '"><span class="small muted">' + (i === idx ? 'следующая' : 'день ' + (i + 1)) + '</span><b>' + esc(p.title) + '</b><span class="small muted">' + p.items.length + ' упр.</span></div>').join('') + '</div>';

    const draft = S.draft && S.draft.key === w.key ? S.draft : null;
    html += '<section class="workout"><div class="workout-head"><h2 class="h2">' + esc(w.title) + '</h2>' +
      (draft ? '<span class="badge">идёт</span>' : '<button class="btn small" data-act="w-start" data-k="' + w.key + '">Начать</button>') + '</div>' +
      (draft ? '<label class="check small"><input type="checkbox" id="auto-rest" data-bind="auto-rest"' + (S.autoRest ? ' checked' : '') + '> Запускать таймер отдыха, как только записал подход</label>' : '');
    html += '<details class="card"><summary class="h3">Разминка · 7–10 мин</summary><ul class="dots">' + NF.WARMUP.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></details>';
    w.items.forEach((it) => {
      const ex = exById(it.id);
      const pr = NF.progression(it, S.workouts, eq);
      html += '<article class="ex"><div class="ex-head"><div><p class="eyebrow">' + esc(NF.SLOT_LABEL[it.slot]) + '</p><h3>' + esc(ex.name) + '</h3><p class="muted small">' + esc(ex.muscles) + '</p></div>' +
        '<div class="ex-rx"><b class="num">' + it.sets + ' × ' + it.lo + '–' + it.hi + '</b><span class="small muted">' + it.unit + (ex.uni ? ' на сторону' : '') + ' · отдых ' + it.rest + ' с</span></div></div>' +
        (it.tempo ? '<p class="tempo">' + esc(it.tempo) + '</p>' : '') +
        '<details><summary class="small">Техника</summary><p class="small">' + esc(ex.tips) + '</p></details>' +
        '<p class="prog prog-' + pr.status + '">' + esc(pr.text) + '</p>';
      if (draft) {
        const vals = draft.sets[it.id] || [];
        const timed = ex.kind === 'time';
        const done = vals.filter((v) => v > 0).length;
        html += '<div class="sets">' + Array.from({ length: it.sets }, (_, si) => '<div class="set' + (vals[si] > 0 ? ' done' : '') + '"><span class="small muted">' + (si + 1) + '</span><input class="input num-in" type="number" inputmode="numeric" min="0" max="300" id="set-' + it.id + '-' + si + '" data-bind="set" data-id="' + it.id + '" data-i="' + si + '" value="' + (vals[si] != null ? vals[si] : '') + '" placeholder="' + (timed ? it.lo : it.hi) + '" aria-label="Подход ' + (si + 1) + ', ' + it.unit + '">' +
          (timed && !(vals[si] > 0) ? '<button class="icon-btn play" data-act="work-start" data-id="' + it.id + '" data-i="' + si + '" data-s="' + it.lo + '" aria-label="Засечь ' + it.lo + ' секунд">▶</button>' : '') + '</div>').join('') + '</div>' +
          '<div class="set-foot"><span class="small muted">' + done + ' из ' + it.sets + ' подходов</span><button class="btn small ghost" data-act="rest-start" data-id="' + it.id + '">Отдых ' + it.rest + ' с</button></div>';
      }
      html += '</article>';
    });
    html += '<details class="card"><summary class="h3">Заминка</summary><ul class="dots">' + NF.COOLDOWN.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></details>';
    if (draft) html += '<div class="row-btns"><button class="btn wide" data-act="w-finish">Завершить тренировку</button><button class="btn ghost" data-act="w-cancel">Отменить</button></div>';
    html += '</section>';

    if (S.workouts.length) {
      html += '<h2 class="h3">История</h2><ul class="history">' + S.workouts.slice(-6).reverse().map((h) => {
        const vol = Object.keys(h.sets).reduce((s, k) => s + h.sets[k].reduce((a, b) => a + (b || 0), 0), 0);
        return '<li><span>' + esc(fmtDate(h.date, { day: 'numeric', month: 'short' })) + '</span><span>' + esc(h.title) + '</span><span class="num muted">' + vol + ' повт.</span></li>';
      }).join('') + '</ul>';
    }
    html += '<p class="hint">Повторения записывай честно: прогрессия считается по ним. Подходы заканчивай с запасом 1–2 повтора, до отказа доводи только последний подход изолирующих упражнений.</p>';
    return html;
  }

  // ───────────────── вкладка «Сон» ─────────────────
  function renderSleep() {
    const date = todayStr();
    const e = sleepEntry(date);
    const log = S.sleep.log.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last7 = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(date, -i); last7.push({ date: d, e: log.find((x) => x.date === d) }); }
    const durs = last7.filter((x) => x.e).map((x) => NF.sleepMinutes(x.e.bed, x.e.wake));
    const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
    const teen = S.profile && S.profile.age < 18;
    const need = teen ? [480, 600] : [420, 540];
    const sched = scheduleFor(date);

    let html = '<h1 class="h1">Сон</h1>';
    html += '<div class="card"><h2 class="h3">Как спал сегодня ночью</h2>' +
      '<div class="grid2"><label>Лёг<input id="sl-bed" class="input" type="time" value="' + esc(e ? e.bed : S.sleep.bed) + '"></label>' +
      '<label>Проснулся<input id="sl-wake" class="input" type="time" value="' + esc(e ? e.wake : S.sleep.wake) + '"></label></div>' +
      '<label class="label">Качество сна</label><div class="days q">' + [1, 2, 3, 4, 5].map((q) => '<button class="day' + ((e ? e.q : ui.sleepQ || 3) === q ? ' on' : '') + '" data-act="sleep-q" data-q="' + q + '">' + q + '</button>').join('') + '</div>' +
      '<button class="btn wide" data-act="sleep-save">' + (e ? 'Обновить запись' : 'Сохранить') + '</button></div>';

    const maxH = 11 * 60;
    html += '<div class="card"><div class="split"><h2 class="h3">Последние 7 ночей</h2><span class="num">' + (avg ? 'в среднем ' + fmtDur(r0(avg)) : 'нет данных') + '</span></div>' +
      '<div class="sleep-chart" role="img" aria-label="Длительность сна за 7 дней">' +
      '<div class="guide" style="bottom:' + (need[0] / maxH * 100).toFixed(1) + '%"><span>' + need[0] / 60 + ' ч</span></div>' +
      '<div class="guide" style="bottom:' + (need[1] / maxH * 100).toFixed(1) + '%"><span>' + need[1] / 60 + ' ч</span></div>' +
      last7.map((x) => {
        const m = x.e ? NF.sleepMinutes(x.e.bed, x.e.wake) : 0;
        const cls = !x.e ? 'none' : m < need[0] ? 'low' : 'ok';
        return '<div class="sbar" style="--j:' + last7.indexOf(x) + '"><div class="sbar-fill ' + cls + '" style="height:' + (Math.min(m, maxH) / maxH * 100).toFixed(1) + '%" title="' + (x.e ? fmtDur(m) : 'нет записи') + '"></div><span class="small muted">' + esc(fmtDate(x.date, { weekday: 'short' })) + '</span></div>';
      }).join('') + '</div>';
    if (avg != null && avg < need[0]) html += '<p class="note note-warn">Меньше ' + need[0] / 60 + ' часов сна снижает выработку тестостерона и гормона роста и мешает набирать именно мышцы, а не жир. Сдвинь отбой на 30 минут раньше.</p>';
    else if (avg != null) html += '<p class="note note-ok">Сна достаточно для восстановления.</p>';
    html += '</div>';

    html += '<div class="card"><h2 class="h3">Обычный режим</h2><p class="muted small">По этому режиму строится расписание еды. Если отметил сон за сегодня, используется фактическое время подъёма.</p>' +
      '<div class="grid2"><label>Отбой<input id="sl-def-bed" class="input" type="time" data-bind="sleep-def" data-k="bed" value="' + esc(S.sleep.bed) + '"></label>' +
      '<label>Подъём<input id="sl-def-wake" class="input" type="time" data-bind="sleep-def" data-k="wake" value="' + esc(S.sleep.wake) + '"></label></div>' +
      '<p class="muted small">Сон по режиму: ' + fmtDur(NF.sleepMinutes(S.sleep.bed, S.sleep.wake)) + (teen ? ' (в твоём возрасте нужно 8–10 ч)' : ' (взрослым нужно 7–9 ч)') + '</p>' +
      '<h3 class="h3">Расписание еды на сегодня</h3><ul class="sched">' + sched.meals.map((m) => '<li><span class="num">' + m.time + '</span><span>' + NF.MEAL_LABEL[m.type] + '</span><span class="muted small">' + r0(m.share * 100) + ' % нормы</span></li>').join('') +
      '<li><span class="num">' + esc(S.sleep.bed) + '</span><span>Отбой</span><span class="muted small">последняя еда за 3 ч</span></li></ul>' +
      (sched.note ? '<p class="hint">' + esc(sched.note) + '</p>' : '') + '</div>';

    html += '<details class="card"><summary class="h3">Как спать лучше для роста мышц</summary><ul class="dots">' +
      '<li>Ложись и вставай в одно время, даже в выходные: разброс не больше часа.</li>' +
      '<li>За 3 часа до сна — без тяжёлой еды. Если голодно, подойдёт творог или кефир: казеин медленно отдаёт белок ночью.</li>' +
      '<li>Кофеин — не позже, чем за 8 часов до сна.</li>' +
      '<li>Экран — за 30–60 минут до сна убрать или включить ночной режим.</li>' +
      '<li>В спальне прохладно (18–20 °C) и темно.</li>' +
      '<li>Тяжёлую тренировку заканчивай хотя бы за 2–3 часа до отбоя.</li></ul></details>';
    if (log.length) {
      html += '<h2 class="h3">Журнал</h2><ul class="history">' + log.slice(-10).reverse().map((x) => '<li><span>' + esc(fmtDate(x.date, { day: 'numeric', month: 'short' })) + '</span><span class="num">' + esc(x.bed) + ' → ' + esc(x.wake) + '</span><span class="num">' + fmtDur(NF.sleepMinutes(x.bed, x.wake)) + ' · ' + x.q + '/5</span></li>').join('') + '</ul>';
    }
    return html;
  }

  // ───────────────── вкладка «Профиль» ─────────────────
  function profileForm(first) {
    const p = S.profile || S.draftProfile;
    const opt = (v, cur, label) => '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>';
    return '<form class="card form" id="profile-form" novalidate>' +
      (first ? '<p class="muted small">Поля заполнены примером. Замени на свои данные.</p>' : '') +
      '<div class="grid2"><label>Пол<select id="pf-sex" class="input">' + opt('m', p.sex, 'Мужской') + opt('f', p.sex, 'Женский') + '</select></label>' +
      '<label>Возраст<input id="pf-age" class="input" type="number" inputmode="numeric" min="12" max="90" value="' + p.age + '"></label></div>' +
      '<div class="grid3"><label>Рост, см<input id="pf-height" class="input" type="number" inputmode="numeric" value="' + p.height + '"></label>' +
      '<label>Вес, кг<input id="pf-weight" class="input" type="number" inputmode="decimal" step="0.1" value="' + p.weight + '"></label>' +
      '<label>Цель, кг<input id="pf-target" class="input" type="number" inputmode="decimal" step="0.1" value="' + p.target + '"></label></div>' +
      '<label>Активность<select id="pf-activity" class="input">' + NF.ACTIVITY.map((a) => opt(a.v, p.activity, a.label)).join('') + '</select></label>' +
      '<label>Темп набора<select id="pf-pace" class="input">' + Object.keys(NF.PACE).map((k) => opt(k, p.pace, NF.PACE[k].label)).join('') + '</select></label>' +
      (ui.errors.length ? '<div class="note note-danger">' + ui.errors.map(esc).join('<br>') + '</div>' : '') +
      '<button class="btn wide" type="submit">' + (first ? 'Рассчитать мою программу' : 'Сохранить') + '</button></form>';
  }

  function weightChart() {
    const pts = S.weights.slice(-60);
    if (pts.length < 2) return '<p class="muted small">Взвешивайся 2–3 раза в неделю утром натощак. С двумя записями появится график.</p>';
    const target = S.profile.target;
    const vals = pts.map((p) => p.kg).concat([target]);
    let lo = Math.floor(Math.min.apply(null, vals) - 0.5), hi = Math.ceil(Math.max.apply(null, vals) + 0.5);
    const W = 320, H = 150, L = 34, R = 8, Tp = 10, B = 22;
    const t0 = new Date(pts[0].date).getTime(), t1 = Math.max(t0 + 864e5, new Date(pts[pts.length - 1].date).getTime());
    const x = (d) => L + (new Date(d).getTime() - t0) / (t1 - t0) * (W - L - R);
    const y = (v) => Tp + (hi - v) / (hi - lo) * (H - Tp - B);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.kg).toFixed(1)).join(' ');
    const area = path + ' L' + x(pts[pts.length - 1].date).toFixed(1) + ' ' + (H - B) + ' L' + x(pts[0].date).toFixed(1) + ' ' + (H - B) + ' Z';
    const mid = Math.round((lo + hi) / 2);
    const last = pts[pts.length - 1];
    return '<div class="chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="График веса">' +
      [lo, mid, hi].map((v) => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="axis" text-anchor="end">' + v + '</text>').join('') +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(target) + '" y2="' + y(target) + '" class="target"/><text x="' + (W - R) + '" y="' + (y(target) - 5) + '" class="axis accent" text-anchor="end">цель ' + target + '</text>' +
      '<path d="' + area + '" class="area"/><path d="' + path + '" class="line" pathLength="1"/>' +
      '<circle cx="' + x(last.date) + '" cy="' + y(last.kg) + '" r="4" class="dot"/>' +
      '<text x="' + L + '" y="' + (H - 6) + '" class="axis">' + esc(fmtDate(pts[0].date, { day: 'numeric', month: 'short' })) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="axis" text-anchor="end">' + esc(fmtDate(last.date, { day: 'numeric', month: 'short' })) + '</text>' +
      '</svg></div>';
  }

  // ── недельный отчёт ──
  function weekReportFor(offset) {
    const start = addDays(NF.weekStart(todayStr()), 7 * offset);
    return NF.weekReport({
      start: start, today: todayStr(), plans: S.plans, extras: S.extras, weights: S.weights, sleepLog: S.sleep.log,
      workouts: S.workouts, trainDays: S.train.days, profile: S.profile, targets: targets(), fm: fm(), measures: S.measures,
    });
  }

  function reportCard() {
    const off = ui.reportWeek;
    const r = weekReportFor(off);
    const title = off === 0 ? 'Эта неделя' : off === -1 ? 'Прошлая неделя' : fmtDate(r.start, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(r.end, { day: 'numeric', month: 'short' });
    const maxK = Math.max.apply(null, r.days.map((d) => Math.max(d.kcal, d.target))) * 1.08;
    const tgt = r.days[0].target;
    let html = '<section class="card report" id="report"><div class="split"><h2 class="h3">Отчёт: ' + esc(title) + '</h2><div class="pager">' +
      '<button class="icon-btn" data-act="report-week" data-d="-1" aria-label="Предыдущая неделя"' + (off <= -4 ? ' disabled' : '') + '>‹</button>' +
      '<button class="icon-btn" data-act="report-week" data-d="1" aria-label="Следующая неделя"' + (off >= 0 ? ' disabled' : '') + '>›</button></div></div>' +
      '<p class="muted small">' + esc(fmtDate(r.start, { day: 'numeric', month: 'long' })) + ' – ' + esc(fmtDate(r.end, { day: 'numeric', month: 'long' })) + (r.complete ? '' : ' · неделя идёт') + '</p>';
    // калории по дням
    html += '<div class="kchart" role="img" aria-label="Калории по дням недели">' +
      '<div class="kchart-target" style="bottom:calc(22px + (100% - 22px) * ' + (tgt / maxK).toFixed(3) + ')"><span>норма</span></div>' +
      r.days.map((d, i) => '<div class="kcol" style="--j:' + i + '"><div class="karea"><div class="kbar ' + d.status + '" style="height:' + (d.status === 'future' || d.status === 'none' ? 4 : Math.max(4, d.kcal / maxK * 100)).toFixed(1) + '%"><span class="kval num">' + (d.kcal ? (d.kcal / 1000).toFixed(1).replace('.', ',') : '') + '</span></div></div>' +
        '<span class="small muted">' + esc(fmtDate(d.date, { weekday: 'short' })) + '</span></div>').join('') + '</div>' +
      '<div class="legend small"><span><i class="lg ok"></i>норма закрыта</span><span><i class="lg low"></i>недобор</span><span><i class="lg none"></i>не отмечено</span></div>';
    // ключевые цифры
    const stat = (label, value, sub, cls) => '<div class="stat ' + (cls || '') + '"><span class="stat-k">' + label + '</span><b class="num">' + value + '</b><span class="small muted">' + sub + '</span></div>';
    const wd = r.weightDelta;
    html += '<div class="stats">' +
      stat('Вес', wd == null ? '—' : (wd >= 0 ? '+' : '−') + Math.abs(wd).toFixed(2).replace('.', ',') + ' кг', wd == null ? 'нужно 2 взвешивания' : 'план +' + String(r.plannedWeekly).replace('.', ','), wd == null ? '' : wd < r.plannedWeekly * 0.5 ? 'warn' : wd > Math.max(0.3, r.plannedWeekly * 1.5) ? 'warn' : 'good') +
      stat('Норма', r.okDays + ' из ' + r.pastDays, 'дней закрыто', r.pastDays && r.okDays >= r.pastDays * 0.7 ? 'good' : r.loggedDays ? 'warn' : '') +
      stat('Калории', r.avgKcal == null ? '—' : r0(r.avgKcal), 'в среднем за день', '') +
      stat('Белок', r.avgP == null ? '—' : r0(r.avgP) + ' г', 'из ' + r.proteinTarget + ' г', r.avgP == null ? '' : r.avgP >= r.proteinTarget * 0.85 ? 'good' : 'warn') +
      stat('Сон', r.sleepAvg == null ? '—' : fmtDur(r0(r.sleepAvg)), r.sleepNights ? r.sleepShort + ' ' + plural(r.sleepShort, 'ночь', 'ночи', 'ночей') + ' меньше ' + r.sleepNeed / 60 + ' ч' : 'нет записей', r.sleepAvg == null ? '' : r.sleepAvg >= r.sleepNeed ? 'good' : 'warn') +
      stat('Тренировки', r.workoutsDone + ' из ' + r.workoutsPlanned, 'по плану', r.workoutsPlanned ? (r.workoutsDone >= r.workoutsPlanned ? 'good' : r.workoutsDone < r.workoutsPlanned - 1 ? 'warn' : '') : '') +
      '</div>';
    html += '<div class="advice"><p class="eyebrow">Главное на следующую неделю</p>' + r.advice.map((a, i) => '<p class="note note-' + a.level + (i ? ' minor' : '') + '">' + esc(a.text) + '</p>').join('') + '</div>';
    return html + '</section>';
  }

  // ── замеры ──
  function measuresCard() {
    const ms = S.measures.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = ms[ms.length - 1], first = ms[0];
    const ins = NF.measureInsight(ms, S.weights);
    const due = !last || NF.daysBetween(last.date, todayStr()) >= 14;
    let html = '<details class="card" id="measures"' + (ui.measureOpen ? ' open' : '') + '><summary><span class="h3">Замеры тела</span><span class="muted small">' + (last ? 'последние ' + esc(fmtDate(last.date, { day: 'numeric', month: 'short' })) + (due ? ' · пора обновить' : '') : 'ещё не было') + '</span></summary>';
    if (ms.length) {
      html += '<div class="mtable" role="table"><div class="mrow head" role="row"><span></span><span>сейчас</span><span>с начала</span></div>' +
        NF.MEASURES.map((m) => {
          const cur = last[m.k], d = ins.deltas ? ins.deltas[m.k] : null;
          return '<div class="mrow" role="row"><span>' + m.label + '</span><span class="num">' + (cur != null ? String(cur).replace('.', ',') + ' см' : '—') + '</span><span class="num ' + (d == null || ms.length < 2 ? '' : d > 0 ? (m.k === 'waist' ? 'up-waist' : 'up') : '') + '">' + (d == null || ms.length < 2 ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '') + String(Math.abs(d)).replace('.', ',')) + '</span></div>';
        }).join('') + '</div>';
    }
    html += '<p class="note note-' + ins.verdict.level + '">' + esc(ins.verdict.text) + '</p>';
    html += '<div class="grid2 mform">' + NF.MEASURES.map((m) => '<label>' + m.label + ', см<input id="ms-' + m.k + '" class="input" type="number" inputmode="decimal" step="0.1" min="10" max="250" placeholder="' + (last && last[m.k] != null ? String(last[m.k]) : '') + '"></label>').join('') + '</div>' +
      '<button class="btn wide" data-act="measure-save">Сохранить замеры</button>' +
      '<details><summary class="small">Как мерить, чтобы цифры были честными</summary><ul class="dots small">' +
      '<li>Утром, натощак, до тренировки и еды. Раз в 2 недели в один и тот же день.</li>' +
      NF.MEASURES.map((m) => '<li><b>' + m.label + ':</b> ' + esc(m.how.toLowerCase()) + '.</li>').join('') +
      '<li>Сантиметровая лента горизонтально, прилегает, но не врезается в кожу.</li></ul></details>';
    if (ms.length > 1) html += '<p class="hint">Записей: ' + ms.length + ', с ' + esc(fmtDate(first.date, { day: 'numeric', month: 'long' })) + '.</p>';
    return html + '</details>';
  }

  // ── напоминания ──
  // В Android-приложении (APK) системные функции даёт мост window.NovaAndroid.
  const NA = window.NovaAndroid || null;

  function notifState() {
    if (NA) { try { return NA.notifState(); } catch (e) { return 'unsupported'; } }
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // default | granted | denied
  }

  function remindersCard() {
    const R = S.reminders;
    const st = notifState();
    const date = todayStr();
    const evs = R.enabled ? todaysEvents(date) : [];
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const opt = (k, label) => '<label class="check"><input type="checkbox" data-bind="rem" data-k="' + k + '" id="rem-' + k + '"' + (R[k] ? ' checked' : '') + '> ' + label + '</label>';
    let html = '<details class="card" id="reminders"' + (ui.remOpen ? ' open' : '') + '><summary><span class="h3">Напоминания</span><span class="muted small">' + (R.enabled ? 'включены' : 'выключены') + '</span></summary>';
    if (NA) {
      html += '<div class="split"><span class="h3">Уведомления</span>' +
        '<label class="switch"><input type="checkbox" id="rem-enabled" data-bind="rem-enabled"' + (R.enabled ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span class="sr">Включить</span></label></div>' +
        '<p class="hint">Приходят, даже когда NovaFit закрыт, и после перезагрузки телефона. Напоминания ставятся на 7 дней вперёд и обновляются при каждом открытии приложения.</p>';
      if (st === 'denied') html += '<p class="note note-warn">Уведомления для NovaFit выключены. Включи: Настройки → Приложения → NovaFit → Уведомления.</p>';
      let exact = true; try { exact = NA.exactAlarms(); } catch (e) { exact = true; }
      if (R.enabled && !exact) html += '<div class="note note-info"><span>Сейчас напоминания могут приходить с опозданием на несколько минут. Разреши «Будильники и напоминания», чтобы они приходили минута в минуту.</span><button class="btn small" data-act="alarm-settings">Разрешить</button></div>';
    }
    html += '<p class="small">' + (NA ? 'Можно также добавить события в календарь телефона.' : 'Самый надёжный способ — <b>добавить напоминания в календарь телефона</b>. Они сработают, даже если NovaFit закрыт.') + '</p>' +
      (window.__NF_EMBED
        ? '<p class="note note-info">В этом превью скачивание файлов недоступно. Кнопка «Добавить в календарь» работает в установленном приложении (ссылка из GitHub Pages, «На экран Домой»).</p>'
        : '<button class="btn wide" data-act="ics">Добавить в календарь телефона</button>' +
          '<p class="hint">Скачается файл <code>novafit.ics</code>. Открой его: iPhone предложит «Добавить все», на Android откроется Google Календарь. Если поменяешь режим сна или дни тренировок, скачай файл заново.</p>');
    if (!NA) html += '<hr class="sep"><div class="split"><span class="h3">Уведомления в приложении</span>' +
      '<label class="switch"><input type="checkbox" id="rem-enabled" data-bind="rem-enabled"' + (R.enabled ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span class="sr">Включить</span></label></div>';
    if (NA) { /* состояние показано выше */ }
    else if (st === 'unsupported') html += '<p class="note note-info">Здесь системные уведомления недоступны. Пока приложение открыто, напоминания будут всплывать внутри него. Для фоновых используй календарь.</p>';
    else if (st === 'denied') html += '<p class="note note-warn">Уведомления запрещены в настройках браузера. Разреши их для NovaFit в настройках телефона или используй календарь.</p>';
    if (!NA) html += '<p class="hint">Работают, пока NovaFit открыт или свёрнут недавно. Телефон может «усыпить» приложение в фоне, поэтому для гарантии используй календарь.</p>';
    html += '<div class="checks">' + opt('meals', 'Приёмы пищи') + opt('train', 'Тренировка (за час)') + opt('sleep', 'Отбой (за 30 мин)') + opt('weigh', 'Взвешивание (пн, чт)') + opt('measure', 'Замеры (раз в 2 нед.)') + '</div>' +
      '<label>За сколько минут до еды<select id="rem-lead" class="input" data-bind="rem-lead">' + [0, 5, 10, 15, 30].map((v) => '<option value="' + v + '"' + (R.lead === v ? ' selected' : '') + '>' + (v ? v + ' мин' : 'в момент приёма') + '</option>').join('') + '</select></label>';
    if (R.enabled) {
      html += '<h3 class="h3">Сегодня</h3><ul class="sched">' + (evs.length ? evs.map((e) => {
        const past = NF.toMin(e.at) < nowM;
        return '<li class="' + (past ? 'past' : '') + '"><span class="num">' + e.at + '</span><span>' + esc(e.title) + '</span><span class="muted small">' + (S.remFired[date] && S.remFired[date][e.key] ? 'показано' : past ? 'прошло' : '') + '</span></li>';
      }).join('') : '<li><span></span><span class="muted">На сегодня больше нет</span><span></span></li>') + '</ul>' +
        '<button class="btn small ghost" data-act="rem-test">Проверить уведомление</button>';
    }
    return html + '</details>';
  }

  function renderProfile() {
    if (!S.profile) return renderOnboarding();
    const T = targets();
    let html = '<h1 class="h1">Профиль и норма</h1>';
    html += '<section class="card targets"><p class="eyebrow">Твоя норма в день</p><div class="big-kcal"><span class="display num">' + T.kcal + '</span> ккал</div>' +
      '<div class="tgrid"><div><b class="num">' + T.protein + ' г</b><span>белки · ' + T.proteinPerKg.toString().replace('.', ',') + ' г/кг</span></div><div><b class="num">' + T.fat + ' г</b><span>жиры</span></div><div><b class="num">' + T.carbs + ' г</b><span>углеводы</span></div>' +
      '<div><b class="num">' + (T.water / 1000).toFixed(1).replace('.', ',') + ' л</b><span>вода (+0,5 л в день тренировки)</span></div><div><b class="num">' + T.fiber + ' г</b><span>клетчатка</span></div><div><b class="num">+' + T.weekly.toString().replace('.', ',') + ' кг</b><span>в неделю</span></div></div>' +
      '<p class="calc-line small muted">Базовый обмен ' + T.bmr + ' × активность = расход ' + T.tdee + ' ккал. Профицит +' + T.surplus + (T.adjust ? (T.adjust > 0 ? ' +' : ' ') + T.adjust + ' (подстройка по весу)' : '') + '. ИМТ ' + T.bmi + ' → ' + T.targetBmi + ' на цели, ~' + T.weeks + ' ' + plural(T.weeks, 'неделя', 'недели', 'недель') + '.</p>' +
      warningsBlock(T.warnings) + '</section>';

    html += reportCard();
    html += '<section class="card"><div class="split"><h2 class="h3">Вес</h2><span class="muted small">старт ' + (S.startWeight || S.profile.weight) + ' кг</span></div>' + weightChart() +
      '<div class="add-row"><input id="w-kg" class="input num-in" type="number" inputmode="decimal" step="0.1" placeholder="' + S.profile.weight + '"><span class="unit">кг</span><button class="btn small" data-act="w-add">Записать вес</button></div>' +
      (S.adaptMsg ? '<p class="note note-info">' + esc(S.adaptMsg) + '</p>' : '') +
      '<p class="hint">Раз в неделю NovaFit сравнивает средний вес за 7 дней с прошлой неделей и сам поправляет калории на ±100 ккал (в сумме не больше ±300).</p></section>';

    html += measuresCard();
    html += remindersCard();
    html += '<details class="card"><summary class="h3">Изменить данные</summary>' + profileForm(false) + '</details>';

    html += '<details class="card"><summary class="h3">Откуда цифры и что безопасно</summary><div class="prose small">' +
      '<p><b>Калории.</b> Базовый обмен по формуле Миффлина — Сан Жеора × коэффициент активности. Сверху профицит 200–500 ккал, чтобы прибавлять 0,25–0,5 % массы тела в неделю. Быстрее не надо: лишнее уходит в жир, а не в мышцы (Iraki et al., 2019; позиция ISSN).</p>' +
      '<p><b>Белок</b> 1,6–2,2 г на кг веса. Выше 2,2 г/кг дополнительной пользы для мышц нет (метаанализ Morton et al., 2018). Приложение никогда не превышает этот потолок.</p>' +
      '<p><b>Жиры</b> 25–30 % калорий, но не меньше 0,8 г/кг: это нужно для гормонов. <b>Углеводы</b> занимают остальное и дают энергию на тренировки.</p>' +
      '<p><b>Сон</b> 7–9 часов (подросткам 8–10). При недосыпе при той же еде набирается больше жира и меньше мышц.</p>' +
      '<p><b>Добавки.</b> Достаточно обычной еды. Сывороточный протеин — это просто еда в порошке. Креатин моногидрат 3–5 г в день — самая изученная добавка для взрослых здоровых людей. Больше 5 г пользы не даёт, загрузочные фазы не нужны. До 18 лет, при болезнях почек или при приёме лекарств — только после консультации врача. Никаких «гормональных» и «жиросжигающих» препаратов.</p>' +
      '<p><b>Когда идти к врачу.</b> ИМТ ниже 16; вес падает без причины; есть хронические болезни (почки, печень, диабет, ЖКТ); после еды бывают отёки, сердцебиение или боль.</p>' +
      '<p class="muted">NovaFit не ставит диагнозов и не заменяет врача или диетолога.</p></div></details>';

    html += '<details class="card"><summary class="h3">Данные</summary><p class="small muted">Всё хранится только на этом устройстве. Сделай копию, чтобы перенести данные на другой телефон.</p>' +
      '<div class="row-btns"><button class="btn ghost small" data-act="export">Скопировать данные</button><button class="btn ghost small" data-act="import-toggle">Вставить данные</button></div>' +
      (ui.importOpen ? '<textarea id="import-text" class="input" rows="4" placeholder="Вставь сюда скопированные данные"></textarea><button class="btn small" data-act="import">Загрузить</button>' : '') +
      (ui.confirmReset ? '<div class="note note-danger"><span>Удалить все данные без возможности восстановления?</span><div class="row-btns"><button class="btn small danger" data-act="reset-yes">Удалить</button><button class="btn small ghost" data-act="reset-no">Отмена</button></div></div>'
        : '<button class="link danger-text" data-act="reset">Сбросить всё</button>') + '</details>';
    return html;
  }

  // ───────────────── напоминания ─────────────────
  let remTimers = [];

  function todaysEvents(date) {
    if (!S.profile) return [];
    const plan = getPlan(date);
    const lastM = S.measures.length ? S.measures[S.measures.length - 1].date : null;
    const e = sleepEntry(date);
    return NF.reminderEvents({
      date: date,
      meals: plan.meals.map((m) => ({ type: m.type, time: m.time, eaten: m.eaten, title: m.recipeId && recipeById(m.recipeId) ? recipeById(m.recipeId).name : 'Тарелка из твоих продуктов' })),
      bed: S.sleep.bed, wake: e ? e.wake : S.sleep.wake,
      trainTime: isTrainDay(date) && !S.workouts.some((w) => w.date === date) ? S.train.time : null,
      lead: S.reminders.lead, opts: S.reminders,
      measureDue: !lastM || NF.daysBetween(lastM, date) >= 14,
    });
  }

  /**
   * Android: отдаём системе будильники на 7 дней вперёд — напоминания придут,
   * даже если приложение закрыто. На сегодня — по фактическому плану,
   * на следующие дни — по обычному режиму сна и тренировок.
   */
  let lastNativeSchedule = '';
  function scheduleNative() {
    const list = [];
    if (S.reminders.enabled && S.profile) {
      const nowMs = Date.now();
      const lastM = S.measures.length ? S.measures[S.measures.length - 1].date : null;
      for (let d = 0; d < 7; d++) {
        const date = addDays(todayStr(), d);
        const evs = d === 0 ? todaysEvents(date) : NF.reminderEvents({
          date: date,
          meals: scheduleFor(date).meals.map((m) => ({ type: m.type, time: m.time, eaten: false, title: 'Блюдо и граммовки — в NovaFit' })),
          bed: S.sleep.bed, wake: S.sleep.wake, trainTime: isTrainDay(date) ? S.train.time : null,
          lead: S.reminders.lead, opts: S.reminders, measureDue: !lastM || NF.daysBetween(lastM, date) >= 14,
        });
        evs.forEach((e, i) => {
          const at = new Date(date + 'T' + e.at + ':00').getTime();
          if (at > nowMs + 30000) list.push({ id: 1000 + d * 20 + i, at: at, title: e.title, body: e.body });
        });
      }
    }
    const json = JSON.stringify(list);
    if (json === lastNativeSchedule) return;
    lastNativeSchedule = json;
    try { NA.schedule(json); } catch (e) { /* ignore */ }
  }

  function scheduleReminders() {
    remTimers.forEach(clearTimeout); remTimers = [];
    if (NA) { scheduleNative(); return; }
    if (!S.reminders.enabled || !S.profile) return;
    const date = todayStr();
    const now = new Date();
    const nm = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const fired = S.remFired[date] || {};
    todaysEvents(date).forEach((e) => {
      if (fired[e.key]) return;
      const delta = NF.toMin(e.at) - nm;
      if (delta < -5) return; // давно прошло — не спамим задним числом
      remTimers.push(setTimeout(() => fireReminder(date, e), Math.max(0, delta * 60000)));
    });
    remTimers.push(setTimeout(scheduleReminders, (1440 - nm) * 60000 + 5000)); // после полуночи — на новый день
  }

  function fireReminder(date, e) {
    const f = (S.remFired[date] = S.remFired[date] || {});
    if (f[e.key]) return;
    f[e.key] = 1;
    Object.keys(S.remFired).forEach((d) => { if (d < addDays(date, -7)) delete S.remFired[d]; });
    save();
    notify(e.title, e.body, 'nf-' + e.key);
  }

  /** Видно приложение — плашка внутри; свёрнуто — системное уведомление. */
  function notify(title, body, tag, force) {
    if (!document.hidden && !force) { toast(title + '. ' + body, 6000); return; }
    if (NA) { try { NA.notifyNow(title, body); } catch (e) { toast(title + '. ' + body, 6000); } return; }
    if (notifState() !== 'granted') { toast(title + '. ' + body, 6000); return; }
    const opts = { body: body, tag: tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [120, 60, 120], renotify: true };
    const fallback = () => { try { new Notification(title, opts); } catch (err) { toast(title + '. ' + body, 6000); } };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then((reg) => { if (reg) reg.showNotification(title, opts); else fallback(); }, fallback);
      } else fallback();
    } catch (err) { fallback(); }
  }

  function askPermission() {
    if (notifState() !== 'default') return Promise.resolve(notifState());
    if (NA) {
      return new Promise((resolve) => {
        const done = (st) => { window.__nfPerm = null; resolve(st); };
        window.__nfPerm = done;
        try { NA.requestNotifications(); } catch (e) { done('denied'); }
        setTimeout(() => { if (window.__nfPerm === done) done(notifState()); }, 30000);
      });
    }
    try { return Promise.resolve(Notification.requestPermission()).catch(() => 'denied'); } catch (e) { return Promise.resolve('denied'); }
  }

  function downloadICS() {
    const ics = NF.buildICS({
      start: todayStr(), lead: S.reminders.lead || 10, opts: S.reminders, wake: S.sleep.wake, bed: S.sleep.bed,
      trainDays: S.train.days, trainTime: S.train.time,
      schedRest: NF.mealSchedule(S.sleep.wake, S.sleep.bed, null), schedTrain: NF.mealSchedule(S.sleep.wake, S.sleep.bed, S.train.time),
      stamp: new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    });
    if (NA) {
      let ok = false;
      try { ok = NA.openCalendar(ics); } catch (e) { ok = false; }
      toast(ok ? 'Выбери календарь, чтобы добавить события' : 'Не нашлось календаря, который открывает файлы', 5000);
      return;
    }
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    try {
      if (iOS) {
        // Safari на iPhone открывает календарный файл сразу с предложением «Добавить все»
        window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      } else {
        const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'novafit.ics';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      }
      S.icsExported = true; save();
      toast('Файл календаря готов. Открой его, чтобы добавить напоминания', 5000);
    } catch (e) { toast('Не получилось скачать файл. Открой NovaFit в браузере телефона и попробуй снова', 5000); }
  }

  // ───────────────── таймер отдыха ─────────────────
  let timerTick = null, audioCtx = null, wakeLock = null;

  function ensureAudio() {
    try {
      if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function beep(times) {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime;
      for (let i = 0; i < times; i++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = i === times - 1 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.28 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + i * 0.28); o.stop(t0 + i * 0.28 + 0.24);
      }
    } catch (e) { /* звук необязателен */ }
  }
  function vibrate(p) {
    try { if (NA) NA.vibrate(p.join(',')); else if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ }
  }

  let awakeState = null;
  function keepAwake(on) {
    if (NA) { if (awakeState !== on) { awakeState = on; try { NA.keepAwake(on); } catch (e) { /* ignore */ } } return; }
    try {
      if (on && !wakeLock && navigator.wakeLock && !document.hidden) {
        navigator.wakeLock.request('screen').then((l) => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }, () => {});
      } else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { /* не везде поддерживается */ }
  }

  function startTimer(kind, seconds, label, exId, setIdx) {
    ensureAudio();
    S.timer = { kind: kind, endAt: Date.now() + seconds * 1000, total: seconds, label: label, exId: exId || null, setIdx: setIdx == null ? null : setIdx };
    save();
    runTimer();
  }

  /** Android: дублируем таймер системным будильником — сигнал придёт и из свёрнутого приложения. */
  function syncNativeTimer() {
    if (!NA) return;
    try {
      const t = S.timer;
      if (!t) { NA.cancelTimer(); return; }
      const title = t.kind === 'work' ? 'Подход закончен' : 'Отдых окончен';
      const body = t.kind === 'work' ? t.label : 'Следующий подход: ' + t.label.replace(/^Отдых · /, '');
      NA.timer(t.endAt + 1500, title, body); // +1,5 с: если приложение открыто, оно успеет само
    } catch (e) { /* ignore */ }
  }

  function runTimer() {
    clearInterval(timerTick);
    syncNativeTimer();
    const el = document.getElementById('timer');
    if (!S.timer) { el.classList.remove('show'); setTimeout(() => { if (!S.timer) el.hidden = true; }, 300); return; }
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    const tick = () => {
      if (!S.timer) return;
      const left = Math.max(0, (S.timer.endAt - Date.now()) / 1000);
      paintTimer(left);
      if (left <= 0) finishTimer();
    };
    tick();
    timerTick = setInterval(tick, 200);
  }

  function paintTimer(left) {
    const t = S.timer; if (!t) return;
    const sec = Math.ceil(left);
    document.getElementById('timer-num').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    document.getElementById('timer-label').textContent = t.label;
    const C = 2 * Math.PI * 22;
    const frac = t.total ? left / t.total : 0;
    document.getElementById('timer-arc').setAttribute('stroke-dasharray', (C * frac).toFixed(1) + ' ' + C.toFixed(1));
    const el = document.getElementById('timer');
    el.classList.toggle('work', t.kind === 'work');
    el.classList.toggle('ending', left <= 5 && left > 0);
  }

  function finishTimer() {
    const t = S.timer;
    S.timer = null; save();
    clearInterval(timerTick);
    beep(3); vibrate([250, 120, 250, 120, 400]);
    if (t.kind === 'work') {
      // подход «на время» закончен: записываем секунды и запускаем отдых
      if (S.draft && t.exId != null && t.setIdx != null) {
        const arr = (S.draft.sets[t.exId] = S.draft.sets[t.exId] || []);
        if (arr[t.setIdx] == null) arr[t.setIdx] = t.total;
        save();
        if (S.tab === 'train') render();
      }
      const it = currentWorkoutItem(t.exId);
      if (it && S.autoRest) { startTimer('rest', it.rest, 'Отдых · ' + exById(it.id).name, it.id); toast('Подход записан: ' + t.total + ' с'); return; }
      notify('Подход закончен', t.label, 'nf-timer');
    } else {
      notify('Отдых окончен', 'Следующий подход: ' + t.label.replace(/^Отдых · /, ''), 'nf-timer');
    }
    runTimer();
  }

  function currentWorkoutItem(exId) {
    if (!S.draft) return null;
    const w = currentProgram().find((p) => p.key === S.draft.key);
    return w ? w.items.find((i) => i.id === exId) : null;
  }

  // ───────────────── рендер ─────────────────
  const TABS = { today: renderToday, food: renderFood, train: renderTrain, sleep: renderSleep, profile: renderProfile };

  // ───────────────── анимации ─────────────────
  const motionOK = () => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const prevVals = {};
  let lastScreen = null;

  /** Плавно переводит полоски, кольцо и числа от прошлого значения к новому. */
  function animateValues(fromZero) {
    const view = document.getElementById('view');
    const anim = motionOK();
    const fills = view.querySelectorAll('[data-w]');
    const ring = view.querySelector('.ring-fg[data-dash]');
    const counts = view.querySelectorAll('.count[data-n]');
    const start = (k) => (fromZero || prevVals[k] == null ? 0 : prevVals[k]);
    if (anim) {
      fills.forEach((el) => { el.style.transition = 'none'; el.style.width = start(el.dataset.k) + '%'; });
      if (ring) { ring.style.transition = 'none'; ring.setAttribute('stroke-dasharray', start('ring') + ' ' + ring.dataset.c); }
      void view.offsetWidth; // зафиксировать стартовое состояние
      requestAnimationFrame(() => {
        fills.forEach((el) => { el.style.transition = ''; el.style.width = el.dataset.w + '%'; });
        if (ring) { ring.style.transition = ''; ring.setAttribute('stroke-dasharray', ring.dataset.dash + ' ' + ring.dataset.c); }
      });
      counts.forEach((el) => {
        const from = start(el.dataset.k), to = +el.dataset.n;
        if (from === to) return;
        const t0 = performance.now(), dur = 700;
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          el.textContent = Math.round(from + (to - from) * e);
          if (k < 1 && el.isConnected) requestAnimationFrame(step);
        };
        el.textContent = from;
        requestAnimationFrame(step);
      });
    }
    fills.forEach((el) => { prevVals[el.dataset.k] = +el.dataset.w; });
    if (ring) prevVals.ring = +ring.dataset.dash;
    counts.forEach((el) => { prevVals[el.dataset.k] = +el.dataset.n; });
  }

  /** Подложка сегментов переезжает от прошлой кнопки к активной. */
  function placeThumbs() {
    document.querySelectorAll('.seg[data-k]').forEach((seg) => {
      const thumb = seg.querySelector('.seg-thumb'); const on = seg.querySelector('.seg-btn.on');
      if (!thumb || !on) return;
      const to = { x: on.offsetLeft, w: on.offsetWidth };
      const from = prevVals[seg.dataset.k];
      const set = (p) => { thumb.style.width = p.w + 'px'; thumb.style.transform = 'translateX(' + p.x + 'px)'; };
      if (from && motionOK()) {
        thumb.style.transition = 'none'; set(from); void thumb.offsetWidth;
        requestAnimationFrame(() => { thumb.style.transition = ''; set(to); });
      } else set(to);
      prevVals[seg.dataset.k] = to;
    });
  }

  function placeNavIndicator() {
    const ind = document.querySelector('.nav-ind'); const on = document.querySelector('.nav-btn.on');
    if (!ind || !on) return;
    ind.style.width = on.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }

  function render() {
    const view = document.getElementById('view');
    const tab = TABS[S.tab] ? S.tab : 'today';
    const screen = tab + (tab === 'food' ? ':' + ui.foodSeg : '');
    const prevTab = lastScreen && lastScreen.split(':')[0];
    const entering = screen !== lastScreen;
    lastScreen = screen;
    const openIds = entering ? [] : Array.from(view.querySelectorAll('details[open][id]')).map((d) => d.id);
    view.innerHTML = TABS[tab]();
    openIds.forEach((id) => { const d = document.getElementById(id); if (d) d.open = true; });
    if (entering && motionOK()) {
      // при смене вкладки блоки появляются по очереди; при смене сегмента — только содержимое под ним
      let kids = Array.from(view.children);
      if (prevTab === tab) { const seg = view.querySelector('.seg'); kids = kids.slice(kids.indexOf(seg) + 1); }
      kids.forEach((c, i) => { c.style.setProperty('--i', Math.min(i, 8)); c.classList.add('enter'); });
    }
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    animateValues(entering && prevTab !== tab);
    placeThumbs();
    placeNavIndicator();
    ui.justEaten = null; ui.justSwapped = null;
    keepAwake(!!S.draft && tab === 'train');
    scheduleReminders();
  }
  window.addEventListener('resize', () => { placeNavIndicator(); document.querySelectorAll('.seg[data-k]').forEach((s) => { delete prevVals[s.dataset.k]; }); placeThumbs(); });

  function num(id) { const el = document.getElementById(id); return el ? parseFloat(String(el.value).replace(',', '.')) : NaN; }
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  // ───────────────── действия ─────────────────
  const ACTIONS = {
    tab(el) { S.tab = el.dataset.tab; save(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); },
    rebuild() { rebuildPlan(todayStr()); render(); toast('План пересобран из текущих запасов'); },
    eat(el) {
      const plan = getPlan(todayStr()); const m = plan.meals[+el.dataset.i];
      m.eaten = true; ui.justEaten = +el.dataset.i; m.items.forEach((it) => { if (S.inventory[it.id] != null) changeInventory(it.id, -it.g); });
      plan.invVersion = S.invVersion; save(); render(); toast('Записал. Продукты списаны из запасов');
    },
    uneat(el) {
      const plan = getPlan(todayStr()); const m = plan.meals[+el.dataset.i];
      m.eaten = false; m.items.forEach((it) => { if (!m.missing.find((x) => x.id === it.id)) changeInventory(it.id, it.g); });
      plan.invVersion = S.invVersion; save(); render();
    },
    swap(el) {
      const date = todayStr(); const plan = getPlan(date); const i = +el.dataset.i;
      plan.swaps = (plan.swaps || 0) + 1;
      const inv = usableInventory();
      plan.meals.forEach((m, j) => { if (j !== i && !m.eaten) m.items.forEach((it) => { if (inv[it.id] != null) inv[it.id] = Math.max(0, inv[it.id] - it.g); }); });
      ui.justSwapped = i;
      plan.meals[i] = NF.replanMeal(plan, i, targets(), scheduleFor(date), inv, fm(), recentPenalty(date), plan.swaps, planOpts(date));
      save(); render();
    },
    seg(el) { ui.foodSeg = el.dataset.seg; render(); },
    'pick-food'(el) { ui.addFood = ui.addFood === el.dataset.id ? null : el.dataset.id; document.getElementById('search-results').innerHTML = searchResults(); const q = document.getElementById('add-qty'); if (q) q.focus(); },
    'add-food'(el) {
      const f = fm()[el.dataset.id]; const q = num('add-qty'); const u = val('add-unit');
      if (!(q > 0)) { toast('Укажи количество'); return; }
      const g = u === 'unit' ? q * f.perUnit : u === 'kg' ? q * 1000 : q;
      if (S.demoInventory) S.demoInventory = false;
      const exp = val('add-exp');
      setExpiryOnAdd(f.id, exp);
      changeInventory(f.id, g); ui.addFood = null; ui.search = ''; save(); render(); toast(f.name + ': +' + r0(g) + (LIQUID[f.id] ? ' мл' : ' г'));
    },
    'inv-del'(el) { delete S.inventory[el.dataset.id]; S.invVersion++; save(); render(); },
    'clear-demo'() { S.inventory = {}; S.expiry = {}; S.demoInventory = false; S.invVersion++; save(); render(); },
    'exp-edit'(el) { ui.editExp = el.dataset.id; render(); const i = document.getElementById('exp-' + el.dataset.id); if (i) i.focus(); },
    'exp-save'(el) { const v = val('exp-' + el.dataset.id); if (v) S.expiry[el.dataset.id] = v; else delete S.expiry[el.dataset.id]; ui.editExp = null; S.invVersion++; save(); render(); },
    'exp-clear'(el) { delete S.expiry[el.dataset.id]; ui.editExp = null; S.invVersion++; save(); render(); },
    'drop-expired'() {
      Object.keys(S.inventory).forEach((id) => { const d = daysLeft(id); if (d != null && d < 0) { delete S.inventory[id]; delete S.expiry[id]; } });
      S.invVersion++; rebuildPlan(todayStr()); save(); render(); toast('Просроченное убрано, план пересобран');
    },
    'extra-toggle'() { ui.extraOpen = !ui.extraOpen; ui.extraSearch = ''; ui.extraPick = null; render(); if (ui.extraOpen) { const i = document.getElementById('extra-search'); if (i) i.focus(); } },
    'extra-pick'(el) {
      ui.extraPick = ui.extraPick === el.dataset.id ? null : el.dataset.id;
      const box = document.getElementById('extra-results');
      if (box && ui.extraSearch.trim()) box.innerHTML = extraResults(); else render();
      const q = document.getElementById('extra-qty'); if (q) q.focus();
    },
    'extra-add'(el) {
      const f = fm()[el.dataset.id]; const q = num('extra-qty'); const u = val('extra-unit');
      if (!(q > 0)) { toast('Укажи количество'); return; }
      const g = Math.round(u === 'unit' ? q * f.perUnit : q);
      if (g > 3000) { toast('Слишком много для одного раза. Проверь число'); return; }
      const date = todayStr();
      const stock = document.getElementById('extra-stock');
      const fromStock = !!(stock && stock.checked);
      const now = new Date();
      (S.extras[date] = S.extras[date] || []).push({ id: f.id, g: g, t: NF.fromMin(now.getHours() * 60 + now.getMinutes()), stock: fromStock });
      if (fromStock) changeInventory(f.id, -g);
      Object.keys(S.extras).forEach((d) => { if (d < addDays(date, -35)) delete S.extras[d]; });
      ui.extraPick = null; ui.extraSearch = ''; ui.extraOpen = false;
      rebuildPlan(date);
      const left = targets().kcal - eatenMacros(getPlan(date)).kcal;
      save(); render();
      toast(f.name.split(' (')[0] + ': +' + r0(f.kcal * g / 100) + ' ккал. ' + (left > 0 ? 'План пересчитан, осталось ' + r0(left) + ' ккал' : 'Норма на сегодня закрыта'));
    },
    'extra-del'(el) {
      const date = todayStr(); const xs = extrasFor(date); const x = xs[+el.dataset.i];
      if (!x) return;
      xs.splice(+el.dataset.i, 1);
      if (x.stock) changeInventory(x.id, x.g);
      rebuildPlan(date); save(); render(); toast('Удалено, план пересчитан');
    },
    'open-measure'() { S.tab = 'profile'; ui.measureOpen = true; save(); render(); const el = document.getElementById('measures'); if (el) el.scrollIntoView({ block: 'start' }); },
    'open-report'() { S.tab = 'profile'; ui.reportWeek = -1; S.reportSeen = NF.weekStart(todayStr()); save(); render(); const el = document.getElementById('report'); if (el) el.scrollIntoView({ block: 'start' }); },
    'custom-toggle'() { ui.customOpen = !ui.customOpen; render(); },
    'custom-add'() {
      const name = val('cf-name').trim(); const kcal = num('cf-kcal'), p = num('cf-p'), f = num('cf-f'), c = num('cf-c');
      if (!name || !(kcal >= 0) || !(p >= 0) || !(f >= 0) || !(c >= 0)) { toast('Заполни название и КБЖУ на 100 г'); return; }
      if (Math.abs(p * 4 + f * 9 + c * 4 - kcal) > Math.max(40, kcal * 0.25)) { toast('КБЖУ не сходятся с калориями. Проверь цифры на упаковке.'); return; }
      const cat = val('cf-cat');
      const id = 'c_' + Date.now().toString(36);
      S.customFoods.push({ id: id, name: name, kcal: kcal, p: p, f: f, c: c, cat: cat, maxMeal: cat === 'fat' ? 40 : cat === 'veg' ? 300 : 250, unit: null, perUnit: null, custom: true });
      const q = num('cf-qty'); if (q > 0) changeInventory(id, q);
      S.demoInventory = false; ui.customOpen = false; save(); render(); toast('Продукт добавлен');
    },
    'calc-meal'(el) { ui.calcMeal = el.dataset.t; render(); },
    'calc-toggle'(el) { const id = el.dataset.id; const i = ui.calcSel.indexOf(id); if (i >= 0) ui.calcSel.splice(i, 1); else ui.calcSel.push(id); render(); },
    'rec-filter'(el) { ui.recFilter = el.dataset.f; render(); },
    'shop-days'(el) { ui.shopDays = +el.dataset.d; ui.shopChecked = {}; render(); },
    'shop-apply'() {
      const ids = Object.keys(ui.shopChecked); if (!ids.length) { toast('Отметь, что купил'); return; }
      ids.forEach((id) => changeInventory(id, ui.shopChecked[id]));
      S.demoInventory = false; ui.shopChecked = {}; save(); render(); toast('Добавлено в запасы: ' + ids.length);
    },
    day(el) {
      const d = +el.dataset.d; const i = S.train.days.indexOf(d);
      if (i >= 0) { if (S.train.days.length <= 2) { toast('Минимум 2 тренировки в неделю'); return; } S.train.days.splice(i, 1); } else S.train.days.push(d);
      S.draft = null; save(); render();
    },
    'w-start'(el) { ensureAudio(); S.draft = { key: el.dataset.k, date: todayStr(), sets: {} }; save(); render(); toast('Экран не погаснет до конца тренировки'); },
    'w-cancel'() { S.draft = null; S.timer = null; save(); runTimer(); render(); },
    'rest-start'(el) { const it = currentWorkoutItem(el.dataset.id); if (it) startTimer('rest', it.rest, 'Отдых · ' + exById(it.id).name, it.id); },
    'work-start'(el) {
      const ex = exById(el.dataset.id);
      startTimer('work', +el.dataset.s, ex.name + ' · подход ' + (+el.dataset.i + 1), ex.id, +el.dataset.i);
    },
    'timer-add'(el) {
      if (!S.timer) return;
      S.timer.endAt += +el.dataset.d * 1000; S.timer.total = Math.max(1, S.timer.total + +el.dataset.d);
      if (S.timer.endAt <= Date.now()) S.timer.endAt = Date.now() + 1000;
      save(); syncNativeTimer();
    },
    'timer-stop'() {
      const t = S.timer; S.timer = null; save(); runTimer();
      if (t && t.kind === 'work' && S.draft && t.setIdx != null) {
        const left = Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
        const arr = (S.draft.sets[t.exId] = S.draft.sets[t.exId] || []);
        arr[t.setIdx] = Math.max(1, t.total - left); save(); render();
      }
    },
    'report-week'(el) { ui.reportWeek = Math.max(-4, Math.min(0, ui.reportWeek + +el.dataset.d)); render(); },
    'measure-save'() {
      const rec = { date: todayStr() };
      let n = 0, bad = false;
      NF.MEASURES.forEach((m) => { const v = num('ms-' + m.k); if (!isNaN(v)) { if (v < 10 || v > 250) bad = true; rec[m.k] = Math.round(v * 10) / 10; n++; } });
      if (bad) { toast('Значения от 10 до 250 см'); return; }
      if (!n) { toast('Впиши хотя бы талию'); return; }
      const ex = S.measures.find((m) => m.date === rec.date);
      if (ex) Object.assign(ex, rec); else S.measures.push(rec);
      S.measures.sort((a, b) => (a.date < b.date ? -1 : 1));
      ui.measureOpen = true; save(); render();
      const el = document.getElementById('measures'); if (el) el.scrollIntoView({ block: 'start' });
      toast('Замеры сохранены. Следующие через 2 недели');
    },
    ics() { downloadICS(); },
    'alarm-settings'() { try { NA.openAlarmSettings(); } catch (e) { /* ignore */ } },
    'rem-test'() { askPermission().then(() => { notify('Проверка NovaFit', 'Так будут выглядеть напоминания', 'nf-test', true); render(); }); },
    'w-finish'() {
      const program = currentProgram(); const w = program.find((p) => p.key === S.draft.key);
      const filled = Object.keys(S.draft.sets).some((k) => S.draft.sets[k].some((v) => v > 0));
      if (!filled) { toast('Впиши повторения хотя бы в один подход'); return; }
      S.workouts.push({ date: todayStr(), key: w.key, title: w.title, sets: S.draft.sets });
      S.draft = null; S.timer = null; save(); runTimer(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); toast('Тренировка записана. Отдыхай и ешь по плану');
    },
    'sleep-q'(el) { ui.sleepQ = +el.dataset.q; const e = sleepEntry(todayStr()); if (e) { e.q = ui.sleepQ; save(); } render(); },
    'sleep-save'() {
      const bed = val('sl-bed'), wake = val('sl-wake');
      if (NF.toMin(bed) == null || NF.toMin(wake) == null) { toast('Укажи время'); return; }
      const date = todayStr(); const e = sleepEntry(date);
      const q = ui.sleepQ || (e ? e.q : 3);
      if (e) Object.assign(e, { bed: bed, wake: wake, q: q }); else S.sleep.log.push({ date: date, bed: bed, wake: wake, q: q });
      S.sleep.log = S.sleep.log.slice(-120);
      // время еды завязано на подъём — пересобираем время в плане
      const plan = S.plans[date];
      if (plan) { const sc = scheduleFor(date); plan.meals.forEach((m, i) => { if (sc.meals[i]) m.time = sc.meals[i].time; }); }
      save(); render(); toast('Сон записан: ' + fmtDur(NF.sleepMinutes(bed, wake)));
    },
    'w-add'() {
      const kg = num('w-kg'); if (!(kg >= 30 && kg <= 250)) { toast('Вес от 30 до 250 кг'); return; }
      const date = todayStr(); const ex = S.weights.find((w) => w.date === date);
      if (ex) ex.kg = kg; else S.weights.push({ date: date, kg: kg });
      S.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
      S.profile.weight = kg;
      runAdaptation(); save(); render();
      if (kg >= S.profile.target) toast('Цель достигнута! Поставь новую или перейди на поддержание');
      else toast('Вес записан');
    },
    export() {
      const text = JSON.stringify(S);
      const done = () => toast('Данные скопированы');
      if (NA) { let ok = false; try { ok = NA.copy(text); } catch (e) { ok = false; } if (ok) done(); else fallbackCopy(text); return; }
      try {
        navigator.clipboard.writeText(text).then(done, () => { fallbackCopy(text); });
      } catch (e) { fallbackCopy(text); }
    },
    'import-toggle'() { ui.importOpen = !ui.importOpen; render(); },
    import() {
      try {
        const obj = JSON.parse(val('import-text'));
        if (!obj || obj.v !== 1) throw new Error('bad');
        S = Object.assign(defaults(), obj); ui.importOpen = false; save(); render(); toast('Данные загружены');
      } catch (e) { toast('Это не данные NovaFit. Скопируй их заново.'); }
    },
    reset() { ui.confirmReset = true; render(); },
    'reset-no'() { ui.confirmReset = false; render(); },
    'reset-yes'() { S = defaults(); ui.confirmReset = false; save(); render(); toast('Все данные удалены'); },
  };

  function fallbackCopy(text) {
    ui.importOpen = true; render();
    const ta = document.getElementById('import-text');
    ta.value = text; ta.select();
    toast('Выделил данные: скопируй их вручную');
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'extra-search') {
      ui.extraSearch = el.value; ui.extraPick = null;
      const box = document.getElementById('extra-results');
      if (box) box.innerHTML = extraResults();
      return;
    }
    if (el.id === 'food-search') {
      ui.search = el.value; ui.addFood = null;
      document.getElementById('search-results').innerHTML = searchResults();
    }
    if (el.dataset.bind === 'set') {
      const id = el.dataset.id, i = +el.dataset.i;
      const arr = (S.draft.sets[id] = S.draft.sets[id] || []);
      const v = parseInt(el.value, 10);
      arr[i] = isNaN(v) ? null : Math.max(0, Math.min(200, v));
      save();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target; const b = el.dataset.bind;
    if (!b) return;
    if (b === 'inv') {
      const g = Math.max(0, parseFloat(el.value) || 0);
      const cur = S.inventory[el.dataset.id] || 0;
      changeInventory(el.dataset.id, g - cur); S.demoInventory = false; save(); render();
    } else if (b === 'calc-stock') { ui.calcStock = el.checked; render(); }
    else if (b === 'set') {
      // подход записан → таймер отдыха (кроме последнего подхода последнего упражнения)
      const v = parseInt(el.value, 10);
      const it = currentWorkoutItem(el.dataset.id);
      if (v > 0 && it && S.autoRest && !(S.timer && S.timer.kind === 'work')) {
        const w = currentProgram().find((p) => p.key === S.draft.key);
        const lastEx = w.items[w.items.length - 1].id === it.id;
        const filled = (S.draft.sets[it.id] || []).filter((x) => x > 0).length;
        if (!(lastEx && filled >= it.sets)) startTimer('rest', it.rest, 'Отдых · ' + exById(it.id).name, it.id);
      }
      const box = el.closest('.set'); if (box) box.classList.toggle('done', v > 0);
    }
    else if (b === 'auto-rest') { S.autoRest = el.checked; save(); }
    else if (b === 'rem-enabled') {
      const on = el.checked;
      ui.remOpen = true;
      (on ? askPermission() : Promise.resolve()).then(() => { S.reminders.enabled = on; save(); render(); toast(on ? (notifState() === 'granted' ? 'Напоминания включены' : 'Напоминания будут внутри приложения') : 'Напоминания выключены'); });
    }
    else if (b === 'rem') { S.reminders[el.dataset.k] = el.checked; ui.remOpen = true; save(); render(); }
    else if (b === 'rem-lead') { S.reminders.lead = +el.value; ui.remOpen = true; save(); render(); }
    else if (b === 'shop') { if (el.checked) ui.shopChecked[el.dataset.id] = +el.dataset.g; else delete ui.shopChecked[el.dataset.id]; }
    else if (b === 'eq-db') { S.equip.db = +el.value; S.draft = null; save(); render(); }
    else if (b === 'eq-kg') { const v = parseFloat(el.value); if (v > 0 && v <= 60) { S.equip.dbKg = v; S.draft = null; save(); render(); } }
    else if (b === 'eq-flag') { S.equip[el.dataset.k] = el.checked; S.draft = null; save(); render(); }
    else if (b === 'tr-time') { S.train.time = el.value || '18:00'; save(); render(); }
    else if (b === 'level') { S.level = el.value; S.draft = null; save(); render(); }
    else if (b === 'sleep-def') { if (NF.toMin(el.value) != null) { S.sleep[el.dataset.k] = el.value; save(); render(); } }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'profile-form') return;
    e.preventDefault();
    const p = {
      sex: val('pf-sex'), age: num('pf-age'), height: num('pf-height'), weight: num('pf-weight'), target: num('pf-target'),
      activity: parseFloat(val('pf-activity')), pace: val('pf-pace'),
    };
    ui.errors = NF.validateProfile(p);
    if (ui.errors.length) { render(); return; }
    const first = !S.profile;
    S.profile = p;
    if (first) { S.startWeight = p.weight; S.weights = [{ date: todayStr(), kg: p.weight }]; }
    else {
      const ex = S.weights.find((w) => w.date === todayStr());
      if (ex) ex.kg = p.weight; else if (!S.weights.length || S.weights[S.weights.length - 1].kg !== p.weight) S.weights.push({ date: todayStr(), kg: p.weight });
    }
    if (first) S.tab = 'today';
    save(); render(); window.scrollTo({ top: 0, behavior: 'instant' });
    toast(first ? 'Программа готова' : 'Сохранено');
  });

  // ───────────────── старт ─────────────────
  if (S.profile) { runAdaptation(); save(); }
  render();
  if (S.timer) runTimer();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // вернулись в приложение: догоняем таймер и напоминания, обновляем «сейчас»
    if (S.timer) runTimer();
    const a = document.activeElement;
    if (!(a && a.matches && a.matches('input, select, textarea'))) render(); else scheduleReminders();
  });
  // раз в 5 минут обновляем подсветку текущего приёма пищи
  setInterval(() => {
    const a = document.activeElement;
    if (!document.hidden && S.tab === 'today' && !(a && a.matches && a.matches('input, select, textarea'))) render();
  }, 5 * 60000);

  // Android: кнопка «Назад» и возврат в приложение
  window.__nfBack = () => {
    if (S.timer || S.tab === 'today') return false;
    S.tab = 'today'; save(); render(); window.scrollTo({ top: 0, behavior: 'instant' });
    return true;
  };
  window.__nfResume = () => {
    if (S.timer) runTimer();
    const a = document.activeElement;
    if (!(a && a.matches && a.matches('input, select, textarea'))) render(); else scheduleReminders();
  };

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__NF_EMBED && !NA) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
  }
})();

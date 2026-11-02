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
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* приватный режим и т. п. */ }
    return defaults();
  }
  let S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  const ui = { foodSeg: 'stock', search: '', addFood: null, calcSel: [], calcMeal: 'l', calcStock: true, recFilter: 'all', shopDays: 3, shopChecked: {}, confirmReset: false, customOpen: false, importOpen: false, errors: [] };

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

  function buildPlan(date, seed) {
    const T = targets();
    const plan = NF.planDay(date, T, scheduleFor(date), Object.assign({}, S.inventory), fm(), recentPenalty(date), seed || 0);
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

  function rebuildPlan(date) {
    const old = S.plans[date];
    const fresh = buildPlan(date, ((old && old.seed) || 0) + 1);
    if (old) {
      old.meals.forEach((m, i) => { if (m.eaten && fresh.meals[i]) fresh.meals[i] = m; });
    }
    S.plans[date] = fresh;
    save();
  }

  function eatenMacros(plan) {
    const items = [];
    plan.meals.forEach((m) => { if (m.eaten) items.push.apply(items, m.items); });
    return NF.macrosOf(items, fm());
  }

  function changeInventory(id, delta) {
    const cur = S.inventory[id] || 0;
    const next = Math.max(0, cur + delta);
    if (next <= 0) delete S.inventory[id]; else S.inventory[id] = next;
    S.invVersion++;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t); clearTimeout(toast._h);
    requestAnimationFrame(() => t.classList.add('show'));
    toast._t = setTimeout(() => {
      t.classList.remove('show');
      toast._h = setTimeout(() => { t.hidden = true; }, 260);
    }, 2600);
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

    if (S.demoInventory) {
      html += '<div class="note note-info">Запасы продуктов сейчас примерные, чтобы показать, как работает план. Замени их на свои во вкладке «Питание».</div>';
    }
    if (stale) {
      html += '<div class="note note-action"><span>Запасы или норма изменились. Пересобрать несъеденные приёмы пищи?</span><button class="btn small" data-act="rebuild">Обновить план</button></div>';
    }
    if (sched.note) html += '<p class="hint">' + esc(sched.note) + '</p>';

    html += '<h2 class="h2">План питания</h2><ol class="timeline">';
    plan.meals.forEach((m, i) => {
      const rec = m.recipeId ? recipeById(m.recipeId) : null;
      const mm = NF.macrosOf(m.items, F);
      const title = rec ? rec.name : 'Тарелка из твоих продуктов';
      html += '<li class="meal' + (m.eaten ? ' eaten' : '') + (ui.justEaten === i ? ' just-eaten' : '') + (ui.justSwapped === i ? ' swap-in' : '') + '">' +
        '<div class="meal-time"><span class="num">' + esc(m.time) + '</span>' + (m.eaten ? '<span class="check" aria-label="съедено">✓</span>' : '') + '<span class="meal-type">' + NF.MEAL_LABEL[m.type] + '</span></div>' +
        '<div class="meal-body">' +
        '<h3>' + esc(title) + '</h3>' + macroLine(mm) +
        '<ul class="items">' + m.items.map((it) => {
          const f = F[it.id]; if (!f) return '';
          const miss = m.missing.find((x) => x.id === it.id);
          return '<li><span>' + esc(f.name) + '</span><span class="num">' + qtyLabel(f, it.g) + (miss ? ' <em class="tag-miss">нет ' + r0(miss.g) + '</em>' : '') + '</span></li>';
        }).join('') + '</ul>' +
        (m.extra && F[m.extra] ? '<p class="hint">Добавка к блюду: ' + esc(F[m.extra].name.toLowerCase()) + ', чтобы добрать калории.</p>' : '') +
        (m.skipped && m.skipped.length ? '<p class="hint">Можно без: ' + m.skipped.map((id) => esc(F[id] ? F[id].name.toLowerCase() : id)).join(', ') + ' (нет дома).</p>' : '') +
        (rec ? '<details class="steps"><summary>Как готовить · ' + rec.min + ' мин</summary><ol>' + rec.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></details>' : '') +
        '<div class="meal-actions">' +
        (m.eaten ? '<button class="btn ghost small" data-act="uneat" data-i="' + i + '">Отменить</button>'
          : '<button class="btn small" data-act="eat" data-i="' + i + '">Съел</button><button class="btn ghost small" data-act="swap" data-i="' + i + '">Другой вариант</button>') +
        '</div></div></li>';
    });
    html += '</ol>';
    html += '<p class="hint">Когда отмечаешь «Съел», продукты списываются из запасов, и следующие планы собираются из того, что осталось.</p>';
    return html;
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
        html += '<li><div class="stock-name"><span>' + esc(f.name) + '</span><span class="muted small">' + qtyLabel(f, S.inventory[id]) + '</span></div>' +
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
          '<button class="btn small" data-act="add-food" data-id="' + esc(f.id) + '">Добавить</button></div>' : '') + '</li>';
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
      (draft ? '<span class="badge">идёт</span>' : '<button class="btn small" data-act="w-start" data-k="' + w.key + '">Начать</button>') + '</div>';
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
        html += '<div class="sets">' + Array.from({ length: it.sets }, (_, si) => '<label class="set"><span class="small muted">' + (si + 1) + '</span><input class="input num-in" type="number" inputmode="numeric" min="0" max="200" id="set-' + it.id + '-' + si + '" data-bind="set" data-id="' + it.id + '" data-i="' + si + '" value="' + (vals[si] != null ? vals[si] : '') + '" placeholder="' + it.hi + '"></label>').join('') + '</div>';
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

  function renderProfile() {
    if (!S.profile) return renderOnboarding();
    const T = targets();
    let html = '<h1 class="h1">Профиль и норма</h1>';
    html += '<section class="card targets"><p class="eyebrow">Твоя норма в день</p><div class="big-kcal"><span class="display num">' + T.kcal + '</span> ккал</div>' +
      '<div class="tgrid"><div><b class="num">' + T.protein + ' г</b><span>белки · ' + T.proteinPerKg.toString().replace('.', ',') + ' г/кг</span></div><div><b class="num">' + T.fat + ' г</b><span>жиры</span></div><div><b class="num">' + T.carbs + ' г</b><span>углеводы</span></div>' +
      '<div><b class="num">' + (T.water / 1000).toFixed(1).replace('.', ',') + ' л</b><span>вода (+0,5 л в день тренировки)</span></div><div><b class="num">' + T.fiber + ' г</b><span>клетчатка</span></div><div><b class="num">+' + T.weekly.toString().replace('.', ',') + ' кг</b><span>в неделю</span></div></div>' +
      '<p class="calc-line small muted">Базовый обмен ' + T.bmr + ' × активность = расход ' + T.tdee + ' ккал. Профицит +' + T.surplus + (T.adjust ? (T.adjust > 0 ? ' +' : ' ') + T.adjust + ' (подстройка по весу)' : '') + '. ИМТ ' + T.bmi + ' → ' + T.targetBmi + ' на цели, ~' + T.weeks + ' ' + plural(T.weeks, 'неделя', 'недели', 'недель') + '.</p>' +
      warningsBlock(T.warnings) + '</section>';

    html += '<section class="card"><div class="split"><h2 class="h3">Вес</h2><span class="muted small">старт ' + (S.startWeight || S.profile.weight) + ' кг</span></div>' + weightChart() +
      '<div class="add-row"><input id="w-kg" class="input num-in" type="number" inputmode="decimal" step="0.1" placeholder="' + S.profile.weight + '"><span class="unit">кг</span><button class="btn small" data-act="w-add">Записать вес</button></div>' +
      (S.adaptMsg ? '<p class="note note-info">' + esc(S.adaptMsg) + '</p>' : '') +
      '<p class="hint">Раз в неделю NovaFit сравнивает средний вес за 7 дней с прошлой неделей и сам поправляет калории на ±100 ккал (в сумме не больше ±300).</p></section>';

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
    view.innerHTML = TABS[tab]();
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
      const inv = Object.assign({}, S.inventory);
      plan.meals.forEach((m, j) => { if (j !== i && !m.eaten) m.items.forEach((it) => { if (inv[it.id] != null) inv[it.id] = Math.max(0, inv[it.id] - it.g); }); });
      ui.justSwapped = i;
      plan.meals[i] = NF.replanMeal(plan, i, targets(), scheduleFor(date), inv, fm(), recentPenalty(date), plan.swaps);
      save(); render();
    },
    seg(el) { ui.foodSeg = el.dataset.seg; render(); },
    'pick-food'(el) { ui.addFood = ui.addFood === el.dataset.id ? null : el.dataset.id; document.getElementById('search-results').innerHTML = searchResults(); const q = document.getElementById('add-qty'); if (q) q.focus(); },
    'add-food'(el) {
      const f = fm()[el.dataset.id]; const q = num('add-qty'); const u = val('add-unit');
      if (!(q > 0)) { toast('Укажи количество'); return; }
      const g = u === 'unit' ? q * f.perUnit : u === 'kg' ? q * 1000 : q;
      if (S.demoInventory) S.demoInventory = false;
      changeInventory(f.id, g); ui.addFood = null; ui.search = ''; save(); render(); toast(f.name + ': +' + r0(g) + (LIQUID[f.id] ? ' мл' : ' г'));
    },
    'inv-del'(el) { delete S.inventory[el.dataset.id]; S.invVersion++; save(); render(); },
    'clear-demo'() { S.inventory = {}; S.demoInventory = false; S.invVersion++; save(); render(); },
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
    'w-start'(el) { S.draft = { key: el.dataset.k, date: todayStr(), sets: {} }; save(); render(); },
    'w-cancel'() { S.draft = null; save(); render(); },
    'w-finish'() {
      const program = currentProgram(); const w = program.find((p) => p.key === S.draft.key);
      const filled = Object.keys(S.draft.sets).some((k) => S.draft.sets[k].some((v) => v > 0));
      if (!filled) { toast('Впиши повторения хотя бы в один подход'); return; }
      S.workouts.push({ date: todayStr(), key: w.key, title: w.title, sets: S.draft.sets });
      S.draft = null; save(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); toast('Тренировка записана. Отдыхай и ешь по плану');
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

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__NF_EMBED) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
  }
})();

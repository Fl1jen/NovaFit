/* NovaFit — интерфейс.
 * Структура: 4 раздела (Сегодня · Еда · Тренировка · Прогресс), кнопка «+» для
 * всего, что записываешь, настройки — шестерёнкой. Подробности открываются в
 * нижних шторках. Все данные хранятся только на телефоне (localStorage).
 */
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
      lowAppetite: false,  // режим «нет аппетита»: 6 приёмов, калорийно-плотные блюда
      shopExtra: {},       // добавлено в покупки вручную (из рецептов): {id: граммы}
      barcodes: {},        // штрихкод → id продукта (работает без интернета)
      lastTz: null, lastOffset: null, tzNotice: null,
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
        // разделы прежних версий
        if (st.tab === 'sleep') st.tab = 'today';
        if (st.tab === 'profile') st.tab = 'progress';
        if (['today', 'food', 'train', 'progress', 'settings'].indexOf(st.tab) < 0) st.tab = 'today';
        return st;
      }
    } catch (e) { /* приватный режим и т. п. */ }
    const d = defaults();
    d.expiry = demoExpiry();
    return d;
  }
  let S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  const ui = {
    sheet: null, prevTab: 'today',
    foodSeg: 'fridge', recQuery: '', recFilter: 'all', recTime: 0, recNoCook: false, recMore: {},
    shopDays: 3, shopChecked: {}, search: '', addFood: null, customOpen: false,
    extraSearch: '', extraPick: null, calcSel: [], calcMeal: 'l', calcStock: true,
    reportWeek: 0, errors: [], profileDraft: null, importOpen: false, confirmReset: false, sleepQ: null,
    justEaten: null, justSwapped: null, scan: null,
  };

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
  // формы слова для штучных продуктов: 1 ломтик, 3 ломтика, 5 ломтиков, 1,5 ломтика
  const UNIT_FORMS = {
    'ломтик': ['ломтик', 'ломтика', 'ломтиков', 'ломтика'],
    'лист': ['лист', 'листа', 'листов', 'листа'],
    'банка': ['банка', 'банки', 'банок', 'банки'],
    'мерная ложка': ['мерная ложка', 'мерные ложки', 'мерных ложек', 'мерной ложки'],
  };
  function qtyLabel(food, g) {
    const u = LIQUID[food.id] ? 'мл' : 'г';
    let s = r0(g) + ' ' + u;
    if (food.perUnit && food.unit) {
      const n = g / food.perUnit;
      const whole = Math.abs(n - Math.round(n)) < 0.05;
      const nn = whole ? Math.round(n) : n.toFixed(1).replace('.', ',');
      const forms = UNIT_FORMS[food.unit];
      s += ' · ' + nn + ' ' + (!forms ? food.unit : whole ? plural(nn, forms[0], forms[1], forms[2]) : forms[3]);
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
    return NF.mealSchedule(wake, S.sleep.bed, isTrainDay(date) ? S.train.time : null, S.lowAppetite ? 'six' : 'four');
  }
  const mealLabel = (m) => m.label || NF.MEAL_LABEL[m.type];

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

  function planOpts(date) { return { urgency: urgencyMap(), extraMacros: extraMacros(date), dense: !!S.lowAppetite }; }

  /**
   * Переключили режим питания (4 ↔ 6 приёмов): строим новый план, съеденное
   * сохраняем. Если съеденному приёму не нашлось места в новом расписании,
   * он уходит в «еду вне плана» — ничего не теряется.
   */
  function rebuildForMode() {
    const date = todayStr();
    const old = S.plans[date];
    const fresh = buildPlan(date, old ? old.seed || 0 : 0);
    S.plans[date] = fresh;
    if (old) {
      const used = {};
      let placed = 0;
      old.meals.filter((m) => m.eaten).forEach((m) => {
        let best = -1, bd = 1e9;
        fresh.meals.forEach((f, i) => {
          if (used[i] || f.type !== m.type) return;
          const d = Math.abs(NF.toMin(f.time) - NF.toMin(m.time));
          if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0) {
          used[best] = 1; placed++;
          fresh.meals[best] = Object.assign({}, m, { label: fresh.meals[best].label, night: fresh.meals[best].night });
        } else {
          const xs = (S.extras[date] = S.extras[date] || []);
          m.items.forEach((it) => xs.push({ id: it.id, g: it.g, t: m.time, stock: false }));
        }
      });
      if (placed || extrasFor(date).length) rebuildPlan(date);
    }
    save();
  }

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
  const ICONS = {
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="M9.5 6l6 6-6 6"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    meal: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path d="M8 7.5c0-1.5 1-1.5 1-3M12 7.5c0-1.5 1-1.5 1-3M16 7.5c0-1.5 1-1.5 1-3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
    dumbbell: '<rect x="2.5" y="8" width="4" height="8" rx="1"/><rect x="17.5" y="8" width="4" height="8" rx="1"/><path d="M6.5 12h11"/>',
    chart: '<path d="M3.5 17l5-5 4 4 8-8"/><path d="M14.5 8h6v6"/>',
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 9a5 5 0 0 1 7 0l-2 2.5h-3Z"/>',
    barcode: '<path d="M3.5 6v12M6.5 6v12M10 6v12M12.5 6v12M16 6v12M18.5 6v12M21 6v12"/>',
    fridge: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M5 10h14M8.5 5.5v2M8.5 13v3"/>',
    drop: '<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5Z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    cart: '<path d="M3 4h2.2l2.2 10.5h10.4L20 7.5H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
    plate: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>',
    data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
    ruler: '<rect x="2.5" y="8" width="19" height="8" rx="2"/><path d="M6.5 8v3M10 8v4M13.5 8v3M17 8v4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  };
  function icon(name, cls) { return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>'; }

  const fmtNum = (n) => Math.round(n).toLocaleString('ru-RU');
  const fmtKg = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

  /** Заголовок экрана: надзаголовок, крупное название, справа — настройки (или «назад»). */
  function screenHead(title, eyebrow, back) {
    return '<header class="screen-head">' +
      (back ? '<button class="icon-btn round" data-act="back" aria-label="Назад">' + icon('back') + '</button>' : '') +
      '<div class="screen-head-text">' + (eyebrow ? '<p class="eyebrow">' + esc(eyebrow) + '</p>' : '') + '<h1 class="screen-title">' + esc(title) + '</h1></div>' +
      (back ? '' : '<button class="icon-btn round" data-act="open-settings" aria-label="Настройки">' + icon('gear') + '</button>') +
      '</header>';
  }

  function dataAttrs(d) { return Object.keys(d || {}).map((k) => ' data-' + k + '="' + esc(d[k]) + '"').join(''); }

  /**
   * Строка списка. o: { title (HTML), sub (HTML), lead (HTML), trail (HTML),
   * act, data, id, cls, chevron }. С act — это кнопка, без — просто строка.
   */
  function row(o) {
    const tag = o.act ? 'button' : 'div';
    return '<' + tag + ' class="row' + (o.cls ? ' ' + o.cls : '') + '"' + (o.act ? ' data-act="' + o.act + '"' + dataAttrs(o.data) : '') + (o.id ? ' id="' + o.id + '"' : '') + '>' +
      (o.lead ? '<span class="row-lead">' + o.lead + '</span>' : '') +
      '<span class="row-main"><span class="row-title">' + o.title + '</span>' + (o.sub ? '<span class="row-sub">' + o.sub + '</span>' : '') + '</span>' +
      (o.trail != null && o.trail !== '' ? '<span class="row-trail">' + o.trail + '</span>' : '') +
      (o.act && o.chevron !== false ? icon('chevron', 'row-chev') : '') +
      '</' + tag + '>';
  }
  function list(rows, cls) { return rows.length ? '<div class="list' + (cls ? ' ' + cls : '') + '">' + rows.join('') + '</div>' : ''; }
  function section(title, body, aside, id) {
    return '<section class="sec"' + (id ? ' id="' + id + '"' : '') + '>' + (title ? '<div class="sec-head"><h2 class="sec-title">' + title + '</h2>' + (aside || '') + '</div>' : '') + body + '</section>';
  }

  /** Сегменты с «подложкой», которая переезжает к выбранному (см. placeThumbs). */
  function seg(key, items, current, act, cls) {
    return '<div class="seg' + (cls ? ' ' + cls : '') + '" data-k="' + key + '" role="tablist"><span class="seg-thumb" aria-hidden="true"></span>' + items.map((x) =>
      '<button role="tab" aria-selected="' + (current === x[0]) + '" class="seg-btn' + (current === x[0] ? ' on' : '') + '" data-act="' + act + '" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  }

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
      '<circle cx="64" cy="64" r="' + R + '" class="ring-fg' + (pct > 0 ? '' : ' zero') + '" data-k="ring" data-dash="' + (C * pct).toFixed(1) + '" data-c="' + C.toFixed(1) + '" stroke-dasharray="' + (C * pct).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 64 64)"/></svg>';
  }

  function warningsBlock(ws) {
    if (!ws || !ws.length) return '';
    return ws.map((w) => '<p class="note n-' + w.level + '">' + esc(w.text) + '</p>').join('');
  }

  /** Заметка: точка-маркер, текст и (необязательно) одно действие. */
  function noticeHtml(n) {
    return '<div class="notice n-' + n.level + (n.cls ? ' ' + n.cls : '') + '"><span class="dot" aria-hidden="true"></span>' +
      '<span class="notice-text">' + esc(n.text) + '</span>' +
      (n.act ? '<button class="btn small ' + (n.level === 'danger' ? 'danger' : 'soft') + '" data-act="' + n.act + '"' + dataAttrs(n.data) + '>' + esc(n.label) + '</button>' : '') + '</div>';
  }

  function emptyState(title, text, actions) {
    return '<div class="empty"><p class="empty-title">' + title + '</p>' + (text ? '<p class="muted">' + text + '</p>' : '') + (actions ? '<div class="empty-actions">' + actions + '</div>' : '') + '</div>';
  }

  // ───────────────── нижние шторки ─────────────────
  // Подробности (блюдо, рецепт, продукт, формы) открываются шторкой снизу —
  // экран под ней не меняется, закрыть: крестик, тап по фону, «Назад», Esc.
  const SHEETS = {};

  function openSheet(name, params) {
    ui.sheet = Object.assign({ name: name }, params || {});
    renderSheet(true);
  }

  function closeSheet() {
    if (!ui.sheet) return;
    ui.sheet = null;
    document.body.classList.remove('sheet-open');
    const el = document.getElementById('sheet');
    el.classList.remove('show');
    setTimeout(() => { if (!ui.sheet) { el.hidden = true; el.innerHTML = ''; } }, 300);
  }

  function renderSheet(opening) {
    const el = document.getElementById('sheet');
    if (!ui.sheet || !SHEETS[ui.sheet.name]) return;
    const out = SHEETS[ui.sheet.name](ui.sheet);
    if (!out) { closeSheet(); return; }
    const old = el.querySelector('.sheet-body');
    const scroll = !opening && old ? old.scrollTop : 0;
    const openIds = opening ? [] : Array.from(el.querySelectorAll('details[open][id]')).map((d) => d.id);
    el.innerHTML = '<div class="sheet-backdrop" data-act="sheet-close"></div>' +
      '<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="' + esc(out.title) + '">' +
      '<div class="sheet-grab" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2 class="sheet-title">' + esc(out.title) + '</h2><button class="icon-btn round" data-act="sheet-close" aria-label="Закрыть">' + icon('close') + '</button></div>' +
      '<div class="sheet-body">' + out.body + '</div></div>';
    openIds.forEach((id) => { const d = document.getElementById(id); if (d) d.open = true; });
    el.hidden = false;
    document.body.classList.add('sheet-open');
    const body = el.querySelector('.sheet-body');
    if (opening) {
      requestAnimationFrame(() => el.classList.add('show'));
      const f = el.querySelector('[data-autofocus]');
      if (f) setTimeout(() => { try { f.focus(); } catch (e) { /* ignore */ } }, 320);
    } else {
      el.classList.add('show');
      body.scrollTop = scroll;
    }
    placeThumbs();
  }


  // ───────────────── «Сегодня»: маршрут дня ─────────────────
  function renderToday() {
    if (!S.profile) return renderOnboarding();
    const date = todayStr();
    const T = targets();
    const plan = getPlan(date);
    const F = fm();
    const eaten = eatenMacros(plan);
    const left = T.kcal - eaten.kcal;
    const train = isTrainDay(date);
    const water = (train ? T.waterTrain : T.water) / 1000;

    let html = screenHead('Сегодня', fmtDate(date));
    html += '<section class="fuel">' +
      '<div class="ring-wrap">' + ring(eaten.kcal, T.kcal) + '<div class="ring-label"><span class="ring-num num count" data-k="kcal" data-n="' + r0(eaten.kcal) + '">' + r0(eaten.kcal) + '</span><span class="ring-sub">из ' + fmtNum(T.kcal) + ' ккал</span></div></div>' +
      '<div class="fuel-info">' +
      (left > T.kcal * 0.03
        ? '<p class="fuel-k">Осталось съесть</p><p class="fuel-left"><b class="num">' + fmtNum(left) + '</b> ккал</p>'
        : '<p class="fuel-k">Норма на сегодня</p><p class="fuel-left done"><b>закрыта</b> ✓</p>') +
      bar('Белок', eaten.p, T.protein, 'г', 'p') +
      '<button class="pill-mini" data-act="open-sheet" data-sheet="water">' + icon('drop') + 'Вода ' + String(water.toFixed(1)).replace('.', ',') + ' л</button>' +
      '</div></section>';

    const n = todayNotice(plan);
    if (n) html += noticeHtml(n);

    html += section('Мой день', timeline(plan, F),
      S.lowAppetite ? '<button class="pill-mini" data-act="open-sheet" data-sheet="appetite">' + plan.meals.length + ' приёмов · нет аппетита</button>' : '');
    return html;
  }

  /** Одна заметка — самое важное на сегодня. Остальное живёт в своих разделах. */
  function todayNotice(plan) {
    const F = fm();
    const expired = Object.keys(S.inventory).filter((id) => F[id] && daysLeft(id) != null && daysLeft(id) < 0);
    if (expired.length) return { level: 'danger', text: 'Просрочено: ' + expired.map((id) => shortName(F[id])).join(', ') + '. В меню не попадёт — не ешь.', act: 'drop-expired', label: 'Убрать' };
    if (S.tzNotice) {
      const d = S.tzNotice.diff;
      const h = Math.abs(d) % 1 ? Math.abs(d).toFixed(1).replace('.', ',') : Math.abs(d);
      return { level: 'info', cls: 'tz', text: 'Новый часовой пояс: ' + (d > 0 ? '+' : '−') + h + ' ч, ' + (d > 0 ? 'на восток' : 'на запад') + '. Всё по местному времени.', act: 'open-sheet', data: { sheet: 'jetlag' }, label: 'Советы' };
    }
    if (plan.invVersion !== S.invVersion || Math.abs(plan.kcal - targets().kcal) > targets().kcal * 0.03) {
      return { level: 'action', text: 'Запасы или норма изменились — пересобрать меню на сегодня?', act: 'rebuild', label: 'Обновить' };
    }
    const soon = Object.keys(S.inventory).filter((id) => F[id] && daysLeft(id) != null && daysLeft(id) >= 0 && daysLeft(id) <= 1);
    if (soon.length) return { level: 'warn', text: 'Доешь в ближайшие сутки: ' + soon.map((id) => shortName(F[id])).join(', ') + '. Уже в меню.', act: 'go-fridge', label: 'Холодильник' };
    if (S.demoInventory) return { level: 'info', text: 'В холодильнике пока пример. Добавь свои продукты — меню соберётся из них.', act: 'go-fridge', label: 'Открыть' };
    return null;
  }

  /** Лента дня: подъём, приёмы пищи, тренировка, еда вне плана и отбой — по времени. */
  function timeline(plan, F) {
    const date = plan.date;
    const sl = sleepEntry(date);
    const wake = NF.toMin(sl ? sl.wake : S.sleep.wake);
    const items = [{ t: wake, kind: 'wake' }];
    plan.meals.forEach((m, i) => items.push({ t: NF.toMin(m.time), kind: 'meal', i: i, m: m }));
    const train = isTrainDay(date);
    if (train) items.push({ t: NF.toMin(S.train.time), kind: 'train' });
    extrasFor(date).forEach((x, k) => items.push({ t: NF.toMin(x.t || '12:00'), kind: 'extra', x: x, k: k }));
    items.push({ t: NF.toMin(S.sleep.bed), kind: 'bed' });
    // всё, что раньше подъёма, — это уже после полуночи
    items.forEach((it) => { if (it.kind !== 'wake' && it.t < wake) it.t += 1440; });
    const ord = { wake: 0, meal: 1, extra: 2, train: 3, bed: 4 };
    items.sort((a, b) => a.t - b.t || ord[a.kind] - ord[b.kind]);
    const now = new Date();
    let nm = now.getHours() * 60 + now.getMinutes();
    if (nm < wake) nm += 1440;
    const nowIdx = currentMealIndex(plan);
    const preIdx = train && !S.workouts.some((w) => w.date === date) ? preTrainIndex(plan) : -1;
    const program = currentProgram();
    const next = program[S.workouts.length % program.length];
    const trainedToday = S.workouts.some((w) => w.date === date);

    let html = '<ol class="tl">';
    let nowPlaced = false;
    let n = 0;
    const st = () => ' style="--n:' + Math.min(n++, 10) + '"';
    items.forEach((it) => {
      if (!nowPlaced && it.t > nm) {
        nowPlaced = true;
        html += '<li class="tl-now"' + st() + '><span class="tl-time num">' + NF.fromMin(nm) + '</span><span class="tl-now-line"><span>сейчас</span></span></li>';
      }
      const time = '<span class="tl-time num">' + NF.fromMin(it.t) + '</span>';
      if (it.kind === 'wake') {
        const dur = sl ? NF.sleepMinutes(sl.bed, sl.wake) : null;
        html += '<li class="tl-item k-wake' + (sl ? ' done' : '') + '"' + st() + '>' + time + '<span class="tl-node">' + icon('sun') + '</span>' +
          '<div class="tl-card"><button class="tl-main" data-act="open-sheet" data-sheet="sleep"><span class="tl-label">Подъём</span>' +
          '<span class="tl-title">' + (sl ? 'Сон ' + fmtDur(dur) : 'Как спал?') + '</span>' +
          '<span class="tl-sub">' + (sl ? 'качество ' + sl.q + ' из 5' : 'отметь сон — от подъёма строится расписание еды') + '</span></button></div></li>';
      } else if (it.kind === 'meal') {
        const m = it.m, i = it.i;
        const rec = m.recipeId ? recipeById(m.recipeId) : null;
        const mm = NF.macrosOf(m.items, F);
        const tags = (i === nowIdx ? '<span class="now-tag">сейчас</span>' : '') +
          (i === preIdx ? '<span class="tag">до тренировки</span>' : '') +
          (m.missing.length && !m.eaten ? '<span class="tag warn">надо купить</span>' : '');
        html += '<li class="tl-item k-meal' + (m.eaten ? ' done' : '') + (i === nowIdx ? ' now' : '') + (ui.justEaten === i ? ' just-eaten' : '') + (ui.justSwapped === i ? ' swap-in' : '') + '" data-meal="' + i + '"' + st() + '>' + time +
          '<span class="tl-node">' + (m.eaten ? icon('check') : icon('meal')) + '</span>' +
          '<div class="tl-card"><button class="tl-main" data-act="open-sheet" data-sheet="meal" data-i="' + i + '">' +
          '<span class="tl-label">' + esc(mealLabel(m)) + tags + '</span>' +
          '<span class="tl-title">' + esc(rec ? rec.name : 'Тарелка из твоих продуктов') + '</span>' +
          '<span class="tl-sub"><b class="kcal">' + r0(mm.kcal) + '</b> ккал · белок ' + r0(mm.p) + ' г</span></button>' +
          (m.eaten ? '<button class="tick on" data-act="uneat" data-i="' + i + '" aria-label="Отменить отметку">' + icon('check') + '</button>'
            : '<button class="tick" data-act="eat" data-i="' + i + '" aria-label="Съел">' + icon('check') + '</button>') +
          '</div></li>';
      } else if (it.kind === 'train') {
        html += '<li class="tl-item k-train' + (trainedToday ? ' done' : '') + '"' + st() + '>' + time + '<span class="tl-node">' + icon('dumbbell') + '</span>' +
          '<div class="tl-card"><button class="tl-main" data-act="tab" data-tab="train"><span class="tl-label">Тренировка</span>' +
          '<span class="tl-title">' + (trainedToday ? 'Готово ✓' : esc(next.title)) + '</span>' +
          '<span class="tl-sub">' + (trainedToday ? 'отдыхай и ешь по плану' : next.items.length + ' упражнений · около ' + workoutMinutes(next) + ' мин') + '</span></button></div></li>';
      } else if (it.kind === 'extra') {
        const f = F[it.x.id];
        if (!f) return;
        html += '<li class="tl-item k-extra done"' + st() + '>' + time + '<span class="tl-node small"></span>' +
          '<div class="tl-card"><div class="tl-main static"><span class="tl-label">Вне плана</span>' +
          '<span class="tl-title">' + esc(f.name) + '</span>' +
          '<span class="tl-sub">' + qtyLabel(f, it.x.g) + ' · <b class="kcal">' + r0(f.kcal * it.x.g / 100) + '</b> ккал</span></div>' +
          '<button class="tick del" data-act="extra-del" data-i="' + it.k + '" aria-label="Удалить">' + icon('close') + '</button></div></li>';
      } else if (it.kind === 'bed') {
        html += '<li class="tl-item k-bed"' + st() + '>' + time + '<span class="tl-node">' + icon('moon') + '</span>' +
          '<div class="tl-card"><div class="tl-main static"><span class="tl-label">Отбой</span>' +
          '<span class="tl-title">Спать</span><span class="tl-sub">до подъёма ' + fmtDur(NF.sleepMinutes(S.sleep.bed, S.sleep.wake)) + '</span></div></div></li>';
      }
    });
    if (!nowPlaced) html += '<li class="tl-now"' + st() + '><span class="tl-time num">' + NF.fromMin(nm) + '</span><span class="tl-now-line"><span>сейчас</span></span></li>';
    html += '</ol>';
    html += '<button class="btn soft wide" data-act="open-sheet" data-sheet="eat">' + icon('plus') + 'Съел что-то вне плана</button>';
    return html;
  }

  function workoutMinutes(w) {
    const sec = w.items.reduce((s, it) => s + it.sets * (45 + it.rest), 0);
    return Math.round((sec / 60 + 10) / 5) * 5;
  }

  // ── шторка: приём пищи ──
  SHEETS.meal = (p) => {
    const plan = getPlan(todayStr());
    const m = plan.meals[p.i];
    if (!m) return null;
    const F = fm();
    const rec = m.recipeId ? recipeById(m.recipeId) : null;
    const mm = NF.macrosOf(m.items, F);
    let b = '<h3 class="dish">' + esc(rec ? rec.name : 'Тарелка из твоих продуктов') + '</h3>' + macroLine(mm);
    b += list(m.items.map((it) => {
      const f = F[it.id]; if (!f) return '';
      const miss = m.missing.find((x) => x.id === it.id);
      const dl = daysLeft(it.id);
      const urgent = !m.eaten && dl != null && dl >= 0 && dl <= 1;
      return row({
        title: esc(f.name),
        sub: [it.sub && F[it.sub] ? '<span class="sub-tag">вместо: ' + esc(shortName(F[it.sub])) + '</span>' : '', urgent ? '<span class="tag-exp">' + (dl === 0 ? 'съесть сегодня' : 'до завтра') + '</span>' : '', miss ? '<span class="tag-miss">нет дома ' + r0(miss.g) + ' г</span>' : ''].join(' ').trim(),
        trail: '<span class="num">' + qtyLabel(f, it.g) + '</span>',
      });
    }), 'compact');
    const notes = [];
    if (m.light && !m.eaten) notes.push('Лёгкий приём: норма почти закрыта едой вне плана.');
    if (m.extra && F[m.extra]) notes.push((m.extraDense ? 'Калорийная добавка без лишнего объёма: ' : 'Добавка, чтобы добрать калории: ') + F[m.extra].name.toLowerCase() + '.');
    if (m.pinned && !m.eaten) notes.push('Блюдо выбрано тобой, граммовки подогнаны под норму.');
    if (m.skipped && m.skipped.length) notes.push('Можно без: ' + m.skipped.map((id) => shortName(F[id])).join(', ') + ' (нет дома).');
    b += notes.map((n) => '<p class="hint">' + esc(n) + '</p>').join('');
    if (rec) b += '<h4 class="sub-h">Как готовить · ' + rec.min + ' мин</h4><ol class="steps-list">' + rec.steps.map((st) => '<li>' + esc(st) + '</li>').join('') + '</ol>';
    b += '<div class="sheet-actions">' +
      (m.eaten ? '<button class="btn soft wide" data-act="uneat" data-i="' + p.i + '">Отменить «съел»</button>'
        : '<button class="btn primary wide" data-act="eat" data-i="' + p.i + '">' + icon('check') + 'Съел</button><button class="btn soft wide" data-act="swap" data-i="' + p.i + '">Другое блюдо</button>') +
      '</div>';
    return { title: mealLabel(m) + ' · ' + m.time, body: b };
  };

  // ── шторка: «Съел что-то вне плана» ──
  SHEETS.eat = () => {
    const F = fm();
    let b = '<div class="search-row"><input id="extra-search" class="input" type="search" autocomplete="off" placeholder="Банан, хлеб, творог…" value="' + esc(ui.extraSearch) + '" aria-label="Что съел" data-autofocus>' + scanButton('extra') + '</div>' +
      '<div id="extra-results">' + extraResults() + '</div>';
    const xs = extrasFor(todayStr());
    if (xs.length) {
      const m = NF.macrosOf(xs, F);
      b += '<h4 class="sub-h">Сегодня вне плана · ' + r0(m.kcal) + ' ккал</h4>' + list(xs.map((x, i) => {
        const f = F[x.id]; if (!f) return '';
        return '<div class="row"><span class="row-main"><span class="row-title">' + esc(f.name) + '</span><span class="row-sub">' + esc(x.t || '') + ' · ' + qtyLabel(f, x.g) + ' · ' + r0(f.kcal * x.g / 100) + ' ккал</span></span>' +
          '<button class="icon-btn" data-act="extra-del" data-i="' + i + '" aria-label="Удалить">' + icon('close') + '</button></div>';
      }), 'compact');
    }
    return { title: 'Что съел?', body: b };
  };

  function extraResults() {
    const F = fm();
    const q = ui.extraSearch.trim().toLowerCase();
    let found = q ? NF.allFoods(S.customFoods).filter((f) => f.name.toLowerCase().indexOf(q) >= 0).slice(0, 6) : [];
    if (ui.extraPick && F[ui.extraPick] && found.indexOf(F[ui.extraPick]) < 0) found = [F[ui.extraPick]].concat(found);
    if (q && !found.length) return '<p class="muted small">Ничего не нашлось. Отсканируй штрихкод или добавь продукт в «Еда → Холодильник».</p>';
    if (!found.length) {
      // пока ничего не ищут — быстрые варианты
      const quick = ['banana', 'bread', 'peanuts', 'cottage5', 'eggs', 'milk', 'apple', 'cheese'].filter((id) => F[id]);
      return '<p class="label">Часто едят</p><div class="pick">' + quick.map((id) => '<button class="pill" data-act="extra-pick" data-id="' + id + '">' + esc(shortName(F[id])) + '</button>').join('') + '</div>';
    }
    return found.map((f) => {
      const open = ui.extraPick === f.id;
      const inStock = (S.inventory[f.id] || 0) > 0;
      return '<div class="pick-card' + (open ? ' on' : '') + '"><button class="pick-head" data-act="extra-pick" data-id="' + esc(f.id) + '"><span>' + esc(f.name) + '</span><span class="muted small">' + f.kcal + ' ккал на 100 ' + (LIQUID[f.id] ? 'мл' : 'г') + (inStock ? ' · есть дома' : '') + '</span></button>' +
        (open ? '<div class="add-row"><input id="extra-qty" class="input num-in" type="number" inputmode="decimal" min="0" placeholder="' + (f.perUnit ? '1' : '100') + '">' +
          '<select id="extra-unit" class="input">' + (f.perUnit ? '<option value="unit">' + esc(f.unit) + '</option>' : '') + '<option value="g">' + (LIQUID[f.id] ? 'мл' : 'г') + '</option></select>' +
          '<button class="btn primary small" data-act="extra-add" data-id="' + esc(f.id) + '">Записать</button></div>' +
          (inStock ? '<label class="check small"><input type="checkbox" id="extra-stock" checked> списать из холодильника</label>' : '') : '') + '</div>';
    }).join('');
  }

  // ── шторка: вода ──
  SHEETS.water = () => {
    const T = targets();
    const train = isTrainDay(todayStr());
    const l = (ml) => (ml / 1000).toFixed(1).replace('.', ',');
    return {
      title: 'Вода',
      body: '<p class="big-line"><b class="num">' + l(train ? T.waterTrain : T.water) + ' л</b> сегодня' + (train ? ', с учётом тренировки' : '') + '</p>' +
        '<p class="muted">Около 35 мл на килограмм веса — вместе с чаем, супом и молоком.</p>' +
        '<ul class="dots">' +
        '<li><b>Жара</b> от +28 °C или сильно потеешь — добавь 0,5–1 л.</li>' +
        '<li><b>Перелёт</b> — ещё стакан (около 250 мл) на каждый час в самолёте: воздух в салоне сухой.</li>' +
        '<li><b>Ориентир</b> — светлая моча цвета соломы. Тёмная — пей больше.</li>' +
        '<li>Стакан после подъёма, по стакану между приёмами пищи, бутылка на тренировку.</li>' +
        '<li>Чай и кофе считаются, алкоголь — нет.</li>' +
        (S.lowAppetite ? '<li>Не пей много прямо перед едой: вода займёт место в желудке.</li>' : '') + '</ul>',
    };
  };

  // ── шторка: сон ──
  SHEETS.sleep = () => {
    const e = sleepEntry(todayStr());
    const q = ui.sleepQ || (e ? e.q : 3);
    return {
      title: 'Как спал',
      body: '<div class="grid2"><label>Лёг<input id="sl-bed" class="input" type="time" value="' + esc(e ? e.bed : S.sleep.bed) + '"></label>' +
        '<label>Проснулся<input id="sl-wake" class="input" type="time" value="' + esc(e ? e.wake : S.sleep.wake) + '"></label></div>' +
        '<p class="label">Качество сна</p><div class="days q">' + [1, 2, 3, 4, 5].map((n) => '<button class="day' + (q === n ? ' on' : '') + '" data-act="sleep-q" data-q="' + n + '">' + n + '</button>').join('') + '</div>' +
        '<button class="btn primary wide" data-act="sleep-save">' + (e ? 'Обновить' : 'Сохранить') + '</button>' +
        '<p class="hint">От времени подъёма строится расписание еды на день. График сна — во вкладке «Прогресс».</p>',
    };
  };

  SHEETS.jetlag = () => ({ title: 'Смена часового пояса', body: jetlagTips(S.tzNotice ? S.tzNotice.diff : null) + (S.tzNotice ? '<button class="btn primary wide" data-act="tz-ok">Понятно</button>' : '') });

  SHEETS.appetite = () => ({
    title: 'Когда не хочется есть',
    body: '<div class="row-toggle"><span><b>Режим «Нет аппетита»</b><span class="muted small">6 приёмов поменьше, калорийные блюда, жидкие калории</span></span>' +
      '<label class="switch"><input type="checkbox" id="low-appetite" data-bind="low-appetite"' + (S.lowAppetite ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span class="sr">Режим «Нет аппетита»</span></label></div>' +
      '<ul class="dots">' +
      '<li>Ешь по расписанию, а не по голоду: на наборе голод часто не успевает появиться. Включи напоминания.</li>' +
      '<li>Пей калории: коктейль, молоко или кефир даются легче, чем тарелка еды той же калорийности.</li>' +
      '<li>Не пей воду прямо перед едой и во время неё — пей между приёмами.</li>' +
      '<li>Добавляй калории без объёма: чайная ложка масла в кашу или гарнир — около 45 ккал, столовая ложка арахисовой пасты — около 90, горсть орехов (30 г) — около 180.</li>' +
      '<li>Начинай с белка и гарнира, овощи — в конце: клетчатка быстро даёт сытость.</li>' +
      '<li>Держи под рукой перекусы без готовки: орехи, сухофрукты, сыр, питьевой йогурт.</li>' +
      '<li>Если аппетита нет неделями, вес падает, есть тошнота или боль в животе — покажись врачу.</li></ul>',
  });

  // ── шторка «+»: всё, что записываешь, — в одном месте ──
  SHEETS.add = () => ({
    title: 'Добавить',
    body: '<div class="tiles">' +
      '<button class="tile" data-act="open-sheet" data-sheet="eat">' + icon('meal') + '<span>Съел что-то</span><small>вне плана</small></button>' +
      '<button class="tile" data-act="open-sheet" data-sheet="stock-add">' + icon('fridge') + '<span>Купил продукты</span><small>в холодильник</small></button>' +
      '<button class="tile" data-act="scan-open" data-mode="stock">' + icon('barcode') + '<span>Штрихкод</span><small>в холодильник</small></button>' +
      '<button class="tile" data-act="open-sheet" data-sheet="weight">' + icon('scale') + '<span>Вес</span><small>утром натощак</small></button>' +
      '<button class="tile" data-act="open-sheet" data-sheet="sleep">' + icon('moon') + '<span>Сон</span><small>как спал</small></button>' +
      '<button class="tile" data-act="open-sheet" data-sheet="measure">' + icon('ruler') + '<span>Замеры</span><small>раз в 2 недели</small></button>' +
      '</div>',
  });


  // ───────────────── «Еда»: холодильник · рецепты · покупки ─────────────────
  function renderFood() {
    let html = screenHead('Еда');
    html += seg('seg-food', [['fridge', 'Холодильник'], ['recipes', 'Рецепты'], ['shop', 'Покупки']], ui.foodSeg, 'fseg');
    if (ui.foodSeg === 'recipes') html += renderRecipes();
    else if (ui.foodSeg === 'shop') html += renderShop();
    else html += renderFridge();
    return html;
  }

  function expText(id) {
    const d = daysLeft(id);
    if (d == null) return '';
    if (d < 0) return '<span class="exp bad">просрочено</span>';
    if (d === 0) return '<span class="exp bad">съесть сегодня</span>';
    if (d === 1) return '<span class="exp soon">до завтра</span>';
    if (d === 2) return '<span class="exp soon">ещё 2 дня</span>';
    return '<span class="exp">до ' + esc(fmtDate(S.expiry[id], { day: 'numeric', month: 'short' })) + '</span>';
  }

  function renderFridge() {
    const F = fm();
    let html = '<div class="tiles three">' +
      '<button class="tile" data-act="open-sheet" data-sheet="stock-add">' + icon('plus') + '<span>Добавить</span></button>' +
      '<button class="tile" data-act="scan-open" data-mode="stock">' + icon('barcode') + '<span>Штрихкод</span></button>' +
      '<button class="tile" data-act="open-sheet" data-sheet="plate">' + icon('plate') + '<span>Тарелка</span></button>' +
      '</div>';
    const ids = Object.keys(S.inventory).filter((id) => F[id]);
    const expired = ids.filter((id) => daysLeft(id) != null && daysLeft(id) < 0);
    const soon = ids.filter((id) => daysLeft(id) != null && daysLeft(id) >= 0 && daysLeft(id) <= 2);
    if (expired.length) html += noticeHtml({ level: 'danger', text: 'Просрочено: ' + expired.map((id) => shortName(F[id])).join(', ') + '. В меню не попадёт.', act: 'drop-expired', label: 'Убрать' });
    else if (soon.length) html += noticeHtml({ level: 'warn', text: 'Скоро испортится: ' + soon.map((id) => shortName(F[id])).join(', ') + '. Это уже стоит в меню первым. Мясо и рыбу можно заморозить.' });
    if (S.demoInventory) html += noticeHtml({ level: 'info', text: 'Это пример, чтобы показать, как всё работает. Замени на то, что лежит дома.', act: 'clear-demo', label: 'Очистить' });
    if (!ids.length) {
      return html + emptyState('Холодильник пуст', 'Добавь продукты поиском или по штрихкоду. Меню на день соберётся из того, что есть, а недостающее попадёт в покупки.');
    }
    const groups = {};
    ids.forEach((id) => { const c = F[id].cat; (groups[c] = groups[c] || []).push(id); });
    Object.keys(NF.CAT_LABEL).forEach((cat) => {
      if (!groups[cat]) return;
      const rows = groups[cat].sort((a, b) => F[a].name.localeCompare(F[b].name, 'ru')).map((id) => row({
        title: esc(F[id].name), sub: [qtyLabel(F[id], S.inventory[id]), expText(id)].filter(Boolean).join(' · '),
        act: 'open-sheet', data: { sheet: 'stock-item', id: id }, cls: daysLeft(id) != null && daysLeft(id) < 0 ? 'bad' : '',
      }));
      html += section(NF.CAT_LABEL[cat], list(rows));
    });
    return html;
  }

  // ── шторка: добавить в холодильник ──
  SHEETS['stock-add'] = () => {
    let b = '<div class="search-row"><input id="food-search" class="input" type="search" autocomplete="off" placeholder="Гречка, яйца, творог…" value="' + esc(ui.search) + '" aria-label="Найти продукт" data-autofocus>' + scanButton('stock') + '</div>' +
      '<div id="search-results">' + searchResults() + '</div>';
    b += ui.customOpen ? customFoodForm() : '<button class="link" data-act="custom-toggle">Нет в списке? Добавить свой продукт с КБЖУ с упаковки</button>';
    return { title: 'В холодильник', body: b };
  };

  function searchResults() {
    const q = ui.search.trim().toLowerCase();
    if (!q) return '<p class="muted small">Начни вводить название. Можно и по штрихкоду — кнопка справа.</p>';
    const found = NF.allFoods(S.customFoods).filter((f) => f.name.toLowerCase().indexOf(q) >= 0).slice(0, 8);
    if (!found.length) return '<p class="muted small">Ничего не нашлось. Добавь свой продукт ниже.</p>';
    return found.map((f) => {
      const open = ui.addFood === f.id;
      return '<div class="pick-card' + (open ? ' on' : '') + '"><button class="pick-head" data-act="pick-food" data-id="' + esc(f.id) + '"><span>' + esc(f.name) + '</span><span class="muted small">' + f.kcal + ' ккал · Б ' + f.p + ' Ж ' + f.f + ' У ' + f.c + '</span></button>' +
        (open ? '<div class="add-row"><input id="add-qty" class="input num-in" type="number" inputmode="decimal" min="0" placeholder="' + (f.perUnit ? '1' : '500') + '">' +
          '<select id="add-unit" class="input">' + (f.perUnit ? '<option value="unit">' + esc(f.unit) + '</option>' : '') + '<option value="g">' + (LIQUID[f.id] ? 'мл' : 'г') + '</option>' + (f.perUnit ? '' : '<option value="kg">' + (LIQUID[f.id] ? 'л' : 'кг') + '</option>') + '</select>' +
          '<button class="btn primary small" data-act="add-food" data-id="' + esc(f.id) + '">Добавить</button></div>' +
          '<label class="exp-row">Годен до<input id="add-exp" class="input" type="date" value="' + esc(suggestExpiry(f.id)) + '"><span class="muted small">' + (NF.SHELF[f.id] ? 'обычно ' + NF.SHELF[f.id] + ' ' + plural(NF.SHELF[f.id], 'день', 'дня', 'дней') + ' в холодильнике' : 'хранится долго — можно не указывать') + '</span></label>' : '') + '</div>';
    }).join('');
  }

  function customFoodForm() {
    return '<div class="form-block"><p class="label">Свой продукт — значения на 100 г с упаковки</p>' +
      '<input id="cf-name" class="input" placeholder="Название">' +
      '<div class="grid4"><label>ккал<input id="cf-kcal" class="input" type="number" inputmode="decimal"></label><label>Б<input id="cf-p" class="input" type="number" inputmode="decimal"></label><label>Ж<input id="cf-f" class="input" type="number" inputmode="decimal"></label><label>У<input id="cf-c" class="input" type="number" inputmode="decimal"></label></div>' +
      '<div class="grid2"><label>Категория<select id="cf-cat" class="input">' + Object.keys(NF.CAT_LABEL).map((k) => '<option value="' + k + '">' + NF.CAT_LABEL[k] + '</option>').join('') + '</select></label>' +
      '<label>Сколько дома, г<input id="cf-qty" class="input" type="number" inputmode="numeric"></label></div>' +
      '<button class="btn primary wide" data-act="custom-add">Сохранить продукт</button><button class="link" data-act="custom-toggle">Отмена</button></div>';
  }

  // ── шторка: продукт в холодильнике ──
  SHEETS['stock-item'] = (p) => {
    const F = fm();
    const f = F[p.id];
    if (!f || S.inventory[p.id] == null) return null;
    const unit = LIQUID[p.id] ? 'мл' : 'г';
    const step = f.perUnit || (S.inventory[p.id] >= 500 ? 100 : 50);
    return {
      title: f.name,
      body: '<p class="muted small">' + f.kcal + ' ккал · Б ' + f.p + ' · Ж ' + f.f + ' · У ' + f.c + ' на 100 ' + unit + (f.en ? ' · ' + esc(f.en) : '') + '</p>' +
        '<p class="label">Сколько дома</p><div class="stepper"><button class="icon-btn round" data-act="stock-step" data-id="' + esc(p.id) + '" data-d="-' + step + '" aria-label="Меньше">−</button>' +
        '<input id="stock-qty" class="input num-in" type="number" inputmode="numeric" min="0" value="' + r0(S.inventory[p.id]) + '" aria-label="Количество, ' + unit + '"><span class="unit">' + unit + '</span>' +
        '<button class="icon-btn round" data-act="stock-step" data-id="' + esc(p.id) + '" data-d="' + step + '" aria-label="Больше">+</button></div>' +
        '<label>Годен до<input id="stock-exp" class="input" type="date" value="' + esc(S.expiry[p.id] || '') + '"></label>' +
        '<button class="btn primary wide" data-act="stock-save" data-id="' + esc(p.id) + '">Сохранить</button>' +
        '<div class="sheet-actions two"><button class="btn soft" data-act="cook-with" data-id="' + esc(p.id) + '">Рецепты с ним</button>' +
        '<button class="btn soft danger-text" data-act="inv-del" data-id="' + esc(p.id) + '">Убрать</button></div>',
    };
  };

  // ── шторка: «Собрать тарелку» — сколько граммов съесть ──
  SHEETS.plate = () => {
    const F = fm();
    const T = targets();
    if (!T) return { title: 'Тарелка', body: '<p>Сначала заполни профиль.</p>' };
    const target = NF.targetFor(T, NF.MEAL_SHARE[ui.calcMeal]);
    const pool = Object.keys(S.inventory).filter((id) => F[id]);
    let b = '<p class="muted small">Выбери продукты — посчитаю граммы, чтобы закрыть норму на этот приём.</p>' +
      seg('seg-calc', NF.MEAL_ORDER.map((t) => [t, NF.MEAL_LABEL[t]]), ui.calcMeal, 'calc-meal') +
      '<p class="small">Цель: ' + macroLine(target) + '</p>' +
      '<label class="check"><input type="checkbox" id="calc-stock" data-bind="calc-stock"' + (ui.calcStock ? ' checked' : '') + '> не больше, чем есть дома</label>' +
      '<div class="pick">' + pool.map((id) => '<button class="pill' + (ui.calcSel.indexOf(id) >= 0 ? ' on' : '') + '" data-act="calc-toggle" data-id="' + esc(id) + '">' + esc(shortName(F[id])) + '</button>').join('') + '</div>';
    const sel = ui.calcSel.filter((id) => F[id]);
    if (sel.length) {
      const res = NF.portionCalc(sel, target, S.inventory, F, ui.calcStock);
      const d = res.macros.kcal - target.kcal;
      b += '<h4 class="sub-h">Сколько съесть</h4>' + list(res.items.map((it) => row({ title: esc(F[it.id].name), trail: '<b class="num">' + qtyLabel(F[it.id], it.g) + '</b>' })), 'compact') + macroLine(res.macros) +
        (Math.abs(d) > target.kcal * 0.12 ? '<p class="note n-warn">' + (d < 0 ? 'До нормы не хватает ' + r0(-d) + ' ккал: добавь орехи, масло, хлеб или банан.' : 'Получается больше нормы — убери самый калорийный продукт.') + '</p>' : '') +
        (res.macros.p < target.p * 0.75 ? '<p class="note n-warn">Мало белка: добавь яйца, творог, мясо или рыбу.</p>' : '');
    }
    return { title: 'Собрать тарелку', body: b };
  };

  // ── рецепты ──
  function renderRecipes() {
    const filters = [['all', 'Все'], ['b', 'Завтрак'], ['l', 'Обед и ужин'], ['s', 'Перекус']];
    const times = [[10, 'до 10 мин'], [20, 'до 20 мин'], [40, 'до 40 мин']];
    return '<div class="rec-head">' +
      '<div class="search-field">' + icon('search') + '<input id="rec-search" class="input" type="search" autocomplete="off" placeholder="Блюдо или продукт" value="' + esc(ui.recQuery) + '" aria-label="Поиск рецептов"></div>' +
      '<div class="pick scroll-row">' + filters.map((f) => '<button class="pill' + (ui.recFilter === f[0] ? ' on' : '') + '" data-act="rec-filter" data-f="' + f[0] + '">' + f[1] + '</button>').join('') +
      '<span class="pick-sep" aria-hidden="true"></span>' +
      times.map((t) => '<button class="pill' + (ui.recTime === t[0] ? ' on' : '') + '" data-act="rec-time" data-t="' + t[0] + '" aria-pressed="' + (ui.recTime === t[0]) + '">' + t[1] + '</button>').join('') +
      '<button class="pill' + (ui.recNoCook ? ' on' : '') + '" data-act="rec-nocook" aria-pressed="' + ui.recNoCook + '">без готовки</button></div>' +
      '</div><div id="rec-results">' + recipeResults() + '</div>';
  }

  function recipeResults() {
    const F = fm();
    const inv = usableInventory();
    const q = ui.recQuery.trim().toLowerCase();
    const urg = urgencyMap();
    const states = NF.RECIPES.filter((r) => {
      if (ui.recFilter === 'l') { if (r.meals.indexOf('l') < 0 && r.meals.indexOf('d') < 0) return false; }
      else if (ui.recFilter !== 'all' && r.meals.indexOf(ui.recFilter) < 0) return false;
      if (ui.recTime && r.min > ui.recTime) return false;
      if (ui.recNoCook && r.tags.indexOf('nocook') < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && !r.ing.some((i) => F[i[0]] && F[i[0]].name.toLowerCase().indexOf(q) >= 0)) return false;
      return true;
    }).map((r) => recipeState(r, inv, F));
    const rank = (st) => st.subs.reduce((sum, x) => sum + (x.title ? 2 : 0.3), 0) -
      st.r.ing.reduce((mx, i) => Math.max(mx, (inv[i[0]] || 0) > 0 ? (urg[i[0]] || 0) : 0), 0) * 3;
    states.sort((a, b) => rank(a) - rank(b) || a.r.min - b.r.min);
    const g = { now: [], one: [], few: [], rest: [] };
    states.forEach((st) => g[st.group].push(st));
    if (!states.length) return emptyState('Ничего не нашлось', 'Сними фильтры или поищи в интернете.', webLinks('рецепт ' + (q || 'из того что есть')));
    let html = '<p class="rec-summary"><b class="num">' + g.now.length + '</b> ' + plural(g.now.length, 'блюдо', 'блюда', 'блюд') + ' можно приготовить из того, что есть' +
      (g.one.length ? ', ещё <b class="num">' + g.one.length + '</b> — если докупить один продукт' : '') + '.</p>';
    const LIMIT = 6;
    const sectionHtml = (title, arr, id, collapsed) => {
      if (!arr.length) return '';
      const rows = (a) => a.map((st) => recipeRow(st, F, inv));
      if (collapsed) return '<details class="rec-group" id="' + id + '"><summary>' + title + ' · ' + arr.length + '</summary>' + list(rows(arr)) + '</details>';
      const all = ui.recMore[id] || arr.length <= LIMIT + 2;
      return section(title + ' · ' + arr.length, list(rows(all ? arr : arr.slice(0, LIMIT))) +
        (all ? '' : '<button class="btn soft wide more-btn" data-act="rec-more" data-g="' + id + '">Показать ещё ' + (arr.length - LIMIT) + '</button>'));
    };
    html += sectionHtml('Можно сейчас', g.now, 'recg-now', false);
    html += sectionHtml('Нет одного продукта', g.one, 'recg-one', false);
    html += sectionHtml('Нет 2–3 продуктов', g.few, 'recg-few', true);
    html += sectionHtml('Остальные', g.rest, 'recg-rest', true);
    const names = stockNames(inv, F);
    if (names.length) {
      html += '<div class="web-card"><p><b>Хочется нового?</b> Поищи рецепты по своим продуктам: ' + esc(names.join(', ')) + '.</p><div class="pick">' + webLinks('рецепт ' + names.join(' ')) + '</div></div>';
    }
    return html;
  }

  function recipeRow(st, F, inv) {
    const r = st.r;
    const fit = recipeFit(r, F, inv);
    const kcal = fit ? r0(fit.macros.kcal) : r0(NF.macrosOf(r.ing.filter((i) => !i[2]).map((i) => ({ id: i[0], g: i[1] })), F).kcal);
    const tag = ['nocook', 'blender', 'night', 'oven'].find((t) => r.tags.indexOf(t) >= 0);
    const shownSubs = st.subs.filter((x) => x.title || !(F[x.from].cat === F[x.to].cat && (F[x.from].cat === 'fat' || F[x.from].cat === 'veg')));
    const sub = [r.min + ' мин · ' + kcal + ' ккал' + (tag ? ' · ' + esc(NF.TAG_LABEL[tag]) : '')];
    if (st.missing.length) sub.push('<span class="miss-line">нет: ' + st.missing.map((id) => esc(shortName(F[id]))).join(', ') + '</span>');
    if (shownSubs.length) sub.push('<span class="sub-line">' + (shownSubs.some((x) => x.title) ? 'другой главный продукт: ' : 'замена: ') + shownSubs.map((x) => esc(shortName(F[x.from])) + ' → ' + esc(shortName(F[x.to]))).join(', ') + '</span>');
    return row({ title: esc(r.name), sub: sub.join('<br>'), act: 'open-sheet', data: { sheet: 'recipe', id: r.id }, id: 'rec-' + r.id });
  }

  // ── шторка: рецепт ──
  SHEETS.recipe = (p) => {
    const r = recipeById(p.id);
    if (!r) return null;
    const F = fm();
    const inv = usableInventory();
    const fit = recipeFit(r, F, inv);
    const type = recMealType(r);
    let b = '<p class="muted small">' + r.meals.split('').map((t) => NF.MEAL_LABEL[t]).join(', ') + ' · ' + r.min + ' мин' + (r.tags.length ? ' · ' + r.tags.map((t) => NF.TAG_LABEL[t]).join(', ') : '') + '</p>';
    if (fit) {
      b += '<h4 class="sub-h">Порция под твою норму на ' + NF.MEAL_LABEL[type].toLowerCase() + '</h4>' + list(fit.items.map((it) => {
        const f = F[it.id];
        const miss = fit.missing.find((x) => x.id === it.id);
        return row({
          title: esc(f.name), sub: [it.sub ? '<span class="sub-tag">вместо: ' + esc(shortName(F[it.sub])) + '</span>' : '', miss ? '<span class="tag-miss">нет дома</span>' : ''].join(' ').trim(),
          trail: '<span class="num">' + qtyLabel(f, it.g) + '</span>', cls: miss ? 'lack' : '',
        });
      }), 'compact') + macroLine(fit.macros);
      if (fit.skipped.length) b += '<p class="hint">Можно без: ' + fit.skipped.map((id) => esc(shortName(F[id]))).join(', ') + ' (нет дома).</p>';
    }
    b += '<h4 class="sub-h">Как готовить</h4><ol class="steps-list">' + r.steps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>';
    let slots = [];
    if (S.profile) {
      const plan = getPlan(todayStr());
      slots = plan.meals.map((m, i) => [i, m]).filter((x) => !x[1].eaten && r.meals.indexOf(x[1].type) >= 0);
    }
    if (slots.length) b += '<h4 class="sub-h">Поставить на сегодня</h4><div class="pick">' + slots.map((x) => '<button class="pill" data-act="rec-pin" data-id="' + r.id + '" data-i="' + x[0] + '">' + esc(mealLabel(x[1])) + ' · ' + x[1].time + '</button>').join('') + '</div>';
    b += '<div class="sheet-actions">' + (fit && fit.missing.length ? '<button class="btn soft wide" data-act="rec-shop" data-id="' + r.id + '">' + icon('cart') + 'Недостающее — в покупки</button>' : '') + '</div>' +
      '<div class="rec-web"><span class="muted small">Похожие рецепты:</span>' + webLinks('рецепт ' + r.name) + '</div>';
    return { title: r.name, body: b };
  };

  // ── покупки ──
  function renderShop() {
    const T = targets();
    if (!T) return emptyState('Сначала заполни профиль', '');
    const F = fm();
    const items = shopList();
    let html = seg('seg-shop', [[3, 'На 3 дня'], [7, 'На неделю']], ui.shopDays, 'shop-days', 'small');
    if (!items.length) return html + emptyState('Всё есть', 'На ' + ui.shopDays + ' ' + plural(ui.shopDays, 'день', 'дня', 'дней') + ' продуктов хватает.');
    html += '<p class="hint">По меню на ближайшие дни, за вычетом того, что есть дома. Английские названия — для магазинов в других странах.</p>';
    html += list(items.map((it) => {
      const f = F[it.id];
      const on = !!ui.shopChecked[it.id];
      return '<label class="row check-row' + (on ? ' on' : '') + '"><input type="checkbox" id="shop-' + esc(it.id) + '" data-bind="shop" data-id="' + esc(it.id) + '" data-g="' + it.g + '"' + (on ? ' checked' : '') + '>' +
        '<span class="row-main"><span class="row-title">' + esc(f.name) + (it.manual ? ' <span class="tag">из рецепта</span>' : '') + '</span>' + (f.en ? '<span class="row-sub">' + esc(f.en) + '</span>' : '') + '</span>' +
        '<span class="row-trail num">' + qtyLabel(f, it.g) + '</span></label>';
    }));
    html += '<div class="sheet-actions"><button class="btn primary wide" data-act="shop-apply">Купил — в холодильник</button><button class="btn soft wide" data-act="shop-copy">Скопировать список</button></div>' +
      (Object.keys(S.shopExtra || {}).length ? '<button class="link" data-act="shop-clear-extra">Убрать добавленное из рецептов</button>' : '');
    return html;
  }


  // ───────────────── «Тренировка» ─────────────────
  function currentProgram() { return NF.buildProgram(S.equip, S.level, S.train.days.length || 3); }

  function renderTrain() {
    if (!S.profile) return renderOnboarding();
    const program = currentProgram();
    const idx = S.workouts.length % program.length;
    const w = (S.draft && program.find((p) => p.key === S.draft.key)) || program[idx];
    const draft = S.draft && S.draft.key === w.key ? S.draft : null;
    const eq = S.equip;
    const today = todayStr();
    const doneToday = S.workouts.some((x) => x.date === today);
    const eyebrow = draft ? 'Идёт тренировка' : doneToday ? 'Сегодня уже потренировался ✓' : isTrainDay(today) ? 'Сегодня в ' + S.train.time : 'Сегодня день отдыха';
    let html = screenHead('Тренировка', eyebrow);

    html += '<section class="hero-card' + (draft ? ' live' : '') + '"><p class="eyebrow">' + (draft ? 'сейчас' : 'следующая') + '</p>' +
      '<h2 class="hero-title">' + esc(w.title) + '</h2>' +
      '<p class="muted">' + w.items.length + ' упражнений · около ' + workoutMinutes(w) + ' мин</p>' +
      '<div class="days-mini">' + program.map((p) => '<span class="' + (p.key === w.key ? 'on' : '') + '">' + esc(p.title.replace('Фулбоди ', '')) + '</span>').join('') + '</div>' +
      (draft ? '<label class="check small"><input type="checkbox" id="auto-rest" data-bind="auto-rest"' + (S.autoRest ? ' checked' : '') + '> таймер отдыха после каждого подхода</label>'
        : '<button class="btn primary wide" data-act="w-start" data-k="' + w.key + '">Начать тренировку</button>') +
      '</section>';

    if (!draft) {
      if (!S.workouts.length) html += '<p class="hint">Первая тренировка: подбирай темп так, чтобы 1–2 повтора оставались в запасе. Записывай повторения честно — по ним приложение решает, когда усложнять.</p>';
      html += section('Упражнения', list(
        [row({ title: 'Разминка', sub: '7–10 минут', lead: icon('clock'), act: 'open-sheet', data: { sheet: 'warmup' } })]
          .concat(w.items.map((it, k) => {
            const ex = exById(it.id);
            const pr = NF.progression(it, S.workouts, eq);
            return row({
              title: esc(ex.name),
              sub: esc(NF.SLOT_LABEL[it.slot].split(' — ')[0]) + ' · ' + it.sets + ' × ' + it.lo + '–' + it.hi + ' ' + it.unit + (ex.uni ? ' на сторону' : '') + (pr.status === 'up' ? ' · <span class="up">пора усложнять</span>' : ''),
              lead: '<span class="num">' + (k + 1) + '</span>', act: 'open-sheet', data: { sheet: 'exercise', id: it.id, k: w.key },
            });
          }))
          .concat([row({ title: 'Заминка', sub: 'растяжка 2–3 минуты', lead: icon('leaf'), act: 'open-sheet', data: { sheet: 'cooldown' } })])
      ));
    } else {
      html += '<div class="ex-live">' + w.items.map((it) => exerciseLive(it, draft)).join('') + '</div>';
      html += '<div class="sheet-actions"><button class="btn primary wide" data-act="w-finish">Завершить тренировку</button><button class="btn soft wide" data-act="w-cancel">Отменить</button></div>';
    }

    html += section('Инвентарь и расписание', list([row({
      title: (eq.db ? eq.db + ' ' + plural(eq.db, 'гантель', 'гантели', 'гантелей') + ' по ' + fmtKg(eq.dbKg) + ' кг' : 'Без гантелей') + (eq.bar ? ' · турник' : '') + (eq.bench ? ' · скамья' : '') + (eq.band ? ' · резинка' : ''),
      sub: WEEK.filter((d) => S.train.days.indexOf(d[0]) >= 0).map((d) => d[1]).join(', ') + ' в ' + esc(S.train.time) + ' · ' + (S.level === 'intermediate' ? 'средний уровень' : 'новичок'),
      lead: icon('dumbbell'), act: 'open-sheet', data: { sheet: 'equipment' },
    })]));

    if (S.workouts.length) {
      html += section('История', list(S.workouts.slice(-6).reverse().map((h) => {
        const vol = Object.keys(h.sets).reduce((s, k) => s + h.sets[k].reduce((a, b) => a + (b || 0), 0), 0);
        return row({ title: esc(h.title), sub: esc(fmtDate(h.date, { day: 'numeric', month: 'long' })), trail: '<span class="num muted">' + vol + ' повт.</span>' });
      })));
    }
    return html;
  }

  /** Упражнение во время тренировки: подходы прямо на экране. */
  function exerciseLive(it, draft) {
    const ex = exById(it.id);
    const vals = draft.sets[it.id] || [];
    const timed = ex.kind === 'time';
    const done = vals.filter((v) => v > 0).length;
    return '<article class="ex' + (done >= it.sets ? ' complete' : '') + '"><div class="ex-head"><div><p class="eyebrow">' + esc(NF.SLOT_LABEL[it.slot]) + '</p><h3>' + esc(ex.name) + '</h3></div>' +
      '<button class="icon-btn round" data-act="open-sheet" data-sheet="exercise" data-id="' + it.id + '" data-k="' + draft.key + '" aria-label="Техника">' + icon('info') + '</button></div>' +
      '<p class="ex-rx"><b class="num">' + it.sets + ' × ' + it.lo + '–' + it.hi + '</b> ' + it.unit + (ex.uni ? ' на сторону' : '') + ' · отдых ' + it.rest + ' с</p>' +
      (it.tempo ? '<p class="tempo">' + esc(it.tempo) + '</p>' : '') +
      '<div class="sets">' + Array.from({ length: it.sets }, (_, si) => '<div class="set' + (vals[si] > 0 ? ' done' : '') + '"><span class="small muted">' + (si + 1) + '</span><input class="input num-in" type="number" inputmode="numeric" min="0" max="300" id="set-' + it.id + '-' + si + '" data-bind="set" data-id="' + it.id + '" data-i="' + si + '" value="' + (vals[si] != null ? vals[si] : '') + '" placeholder="' + (timed ? it.lo : it.hi) + '" aria-label="Подход ' + (si + 1) + ', ' + it.unit + '">' +
        (timed && !(vals[si] > 0) ? '<button class="icon-btn play" data-act="work-start" data-id="' + it.id + '" data-i="' + si + '" data-s="' + it.lo + '" aria-label="Засечь ' + it.lo + ' секунд">▶</button>' : '') + '</div>').join('') + '</div>' +
      '<div class="set-foot"><span class="small muted">' + done + ' из ' + it.sets + ' подходов</span><button class="btn small soft" data-act="rest-start" data-id="' + it.id + '">Отдых ' + it.rest + ' с</button></div></article>';
  }

  // ── шторки тренировки ──
  SHEETS.exercise = (p) => {
    const program = currentProgram();
    const w = program.find((x) => x.key === p.k) || program[0];
    const it = w.items.find((x) => x.id === p.id);
    const ex = exById(p.id);
    if (!ex) return null;
    const pr = it ? NF.progression(it, S.workouts, S.equip) : null;
    return {
      title: ex.name,
      body: (it ? '<p class="big-line"><b class="num">' + it.sets + ' × ' + it.lo + '–' + it.hi + '</b> ' + it.unit + (ex.uni ? ' на сторону' : '') + '</p><p class="muted small">Отдых между подходами ' + it.rest + ' с</p>' : '') +
        (it && it.tempo ? '<p class="tempo">' + esc(it.tempo) + '</p>' : '') +
        '<h4 class="sub-h">Как делать</h4><p>' + esc(ex.tips) + '</p>' +
        '<p class="muted small">Работают: ' + esc(ex.muscles) + '.</p>' +
        (pr && pr.status !== 'new' ? '<h4 class="sub-h">Прогресс</h4><p class="prog prog-' + pr.status + '">' + esc(pr.text) + '</p>' : '') +
        '<h4 class="sub-h">Когда станет легко</h4><p>' + esc(ex.harder) + '.</p>',
    };
  };
  SHEETS.warmup = () => ({ title: 'Разминка · 7–10 мин', body: '<ul class="dots">' + NF.WARMUP.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' });
  SHEETS.cooldown = () => ({ title: 'Заминка', body: '<ul class="dots">' + NF.COOLDOWN.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' });

  SHEETS.equipment = () => {
    const eq = S.equip;
    return {
      title: 'Инвентарь и расписание',
      body: '<div class="grid2"><label>Гантелей<select id="eq-db" class="input" data-bind="eq-db"><option value="0"' + (eq.db === 0 ? ' selected' : '') + '>нет</option><option value="1"' + (eq.db === 1 ? ' selected' : '') + '>1</option><option value="2"' + (eq.db === 2 ? ' selected' : '') + '>2</option></select></label>' +
        '<label>Вес гантели, кг<input id="eq-kg" class="input" type="number" inputmode="decimal" min="1" max="60" step="0.5" data-bind="eq-kg" value="' + eq.dbKg + '"></label></div>' +
        '<div class="checks">' + [['adjustable', 'Гантель разборная'], ['bar', 'Турник'], ['bench', 'Скамья'], ['band', 'Резинка-эспандер']].map((x) =>
          '<label class="check"><input type="checkbox" id="eq-' + x[0] + '" data-bind="eq-flag" data-k="' + x[0] + '"' + (eq[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>').join('') + '</div>' +
        '<p class="label">Дни тренировок</p><div class="days">' + WEEK.map((d) => '<button class="day' + (S.train.days.indexOf(d[0]) >= 0 ? ' on' : '') + '" data-act="day" data-d="' + d[0] + '">' + d[1] + '</button>').join('') + '</div>' +
        '<div class="grid2"><label>Время<input id="tr-time" class="input" type="time" data-bind="tr-time" value="' + esc(S.train.time) + '"></label>' +
        '<label>Уровень<select id="tr-level" class="input" data-bind="level"><option value="beginner"' + (S.level === 'beginner' ? ' selected' : '') + '>Новичок (до 1 года)</option><option value="intermediate"' + (S.level === 'intermediate' ? ' selected' : '') + '>Средний</option></select></label></div>' +
        '<p class="hint">' + (S.train.days.length >= 4 ? 'Сплит «верх/низ»: каждая мышца 2 раза в неделю.' : 'Фулбоди: всё тело за тренировку, между тренировками минимум день отдыха.') +
        (S.train.days.length > 5 ? ' Больше 5 тренировок в неделю мешают восстановлению при наборе массы.' : '') + '</p>',
    };
  };


  function reportCard() {
    const off = ui.reportWeek;
    const r = weekReportFor(off);
    const title = off === 0 ? 'Эта неделя' : off === -1 ? 'Прошлая неделя' : fmtDate(r.start, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(r.end, { day: 'numeric', month: 'short' });
    const maxK = Math.max.apply(null, r.days.map((d) => Math.max(d.kcal, d.target))) * 1.08;
    const tgt = r.days[0].target;
    let html = '<section class="panel report" id="report"><div class="split"><h2 class="sec-title">' + esc(title) + '</h2><div class="pager">' +
      '<button class="icon-btn" data-act="report-week" data-d="-1" aria-label="Предыдущая неделя"' + (off <= -4 ? ' disabled' : '') + '>' + icon('back') + '</button>' +
      '<button class="icon-btn" data-act="report-week" data-d="1" aria-label="Следующая неделя"' + (off >= 0 ? ' disabled' : '') + '>' + icon('chevron') + '</button></div></div>' +
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
    html += '<div class="advice"><p class="eyebrow">Главное на следующую неделю</p>' + r.advice.map((a, i) => '<p class="note n-' + a.level + (i ? ' minor' : '') + '">' + esc(a.text) + '</p>').join('') + '</div>';
    return html + '</section>';
  }


  function profileForm(first) {
    const p = ui.profileDraft || S.profile || S.draftProfile;
    const opt = (v, cur, label) => '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>';
    const v = (x) => (x == null || isNaN(x) ? '' : x);
    return '<form class="form" id="profile-form" novalidate>' +
      (first ? '<p class="muted small">Поля заполнены примером. Замени на свои данные.</p>' : '') +
      '<div class="grid2"><label>Пол<select id="pf-sex" class="input">' + opt('m', p.sex, 'Мужской') + opt('f', p.sex, 'Женский') + '</select></label>' +
      '<label>Возраст<input id="pf-age" class="input" type="number" inputmode="numeric" min="12" max="90" value="' + v(p.age) + '"></label></div>' +
      '<div class="grid3"><label>Рост, см<input id="pf-height" class="input" type="number" inputmode="numeric" value="' + v(p.height) + '"></label>' +
      '<label>Вес, кг<input id="pf-weight" class="input" type="number" inputmode="decimal" step="0.1" value="' + v(p.weight) + '"></label>' +
      '<label>Цель, кг<input id="pf-target" class="input" type="number" inputmode="decimal" step="0.1" value="' + v(p.target) + '"></label></div>' +
      '<label>Активность<select id="pf-activity" class="input">' + NF.ACTIVITY.map((a) => opt(a.v, p.activity, a.label)).join('') + '</select></label>' +
      '<label>Темп набора<select id="pf-pace" class="input">' + Object.keys(NF.PACE).map((k) => opt(k, p.pace, NF.PACE[k].label)).join('') + '</select></label>' +
      (ui.errors.length ? '<div class="note n-danger">' + ui.errors.map(esc).join('<br>') + '</div>' : '') +
      '<button class="btn primary wide" type="submit">' + (first ? 'Рассчитать мою программу' : 'Сохранить') + '</button></form>';
  }


  function remindersBody() {
    const R = S.reminders;
    const st = notifState();
    const date = todayStr();
    const evs = R.enabled ? todaysEvents(date) : [];
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const opt = (k, label) => '<label class="check"><input type="checkbox" data-bind="rem" data-k="' + k + '" id="rem-' + k + '"' + (R[k] ? ' checked' : '') + '> ' + label + '</label>';
    let html = '';
    if (NA) {
      html += '<div class="split"><span class="h3">Уведомления</span>' +
        '<label class="switch"><input type="checkbox" id="rem-enabled" data-bind="rem-enabled"' + (R.enabled ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span class="sr">Включить</span></label></div>' +
        '<p class="hint">Приходят, даже когда NovaFit закрыт, и после перезагрузки телефона. Напоминания ставятся на 7 дней вперёд и обновляются при каждом открытии приложения.</p>';
      if (st === 'denied') html += '<p class="note n-warn">Уведомления для NovaFit выключены. Включи: Настройки → Приложения → NovaFit → Уведомления.</p>';
      let exact = true; try { exact = NA.exactAlarms(); } catch (e) { exact = true; }
      if (R.enabled && !exact) html += '<div class="note n-info"><span>Сейчас напоминания могут приходить с опозданием на несколько минут. Разреши «Будильники и напоминания», чтобы они приходили минута в минуту.</span><button class="btn small" data-act="alarm-settings">Разрешить</button></div>';
    }
    html += '<p class="small">' + (NA ? 'Можно также добавить события в календарь телефона.' : 'Самый надёжный способ — <b>добавить напоминания в календарь телефона</b>. Они сработают, даже если NovaFit закрыт.') + '</p>' +
      (window.__NF_EMBED
        ? '<p class="note n-info">В этом превью скачивание файлов недоступно. Кнопка «Добавить в календарь» работает в установленном приложении (ссылка из GitHub Pages, «На экран Домой»).</p>'
        : '<button class="btn primary wide" data-act="ics">Добавить в календарь телефона</button>' +
          '<p class="hint">Скачается файл <code>novafit.ics</code>. Открой его: iPhone предложит «Добавить все», на Android откроется Google Календарь. Если поменяешь режим сна или дни тренировок, скачай файл заново.</p>');
    if (!NA) html += '<hr class="sep"><div class="split"><span class="h3">Уведомления в приложении</span>' +
      '<label class="switch"><input type="checkbox" id="rem-enabled" data-bind="rem-enabled"' + (R.enabled ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span class="sr">Включить</span></label></div>';
    if (NA) { /* состояние показано выше */ }
    else if (st === 'unsupported') html += '<p class="note n-info">Здесь системные уведомления недоступны. Пока приложение открыто, напоминания будут всплывать внутри него. Для фоновых используй календарь.</p>';
    else if (st === 'denied') html += '<p class="note n-warn">Уведомления запрещены в настройках браузера. Разреши их для NovaFit в настройках телефона или используй календарь.</p>';
    if (!NA) html += '<p class="hint">Работают, пока NovaFit открыт или свёрнут недавно. Телефон может «усыпить» приложение в фоне, поэтому для гарантии используй календарь.</p>';
    html += '<div class="checks">' + opt('meals', 'Приёмы пищи') + opt('train', 'Тренировка (за час)') + opt('sleep', 'Отбой (за 30 мин)') + opt('weigh', 'Взвешивание (пн, чт)') + opt('measure', 'Замеры (раз в 2 нед.)') + '</div>' +
      '<label>За сколько минут до еды<select id="rem-lead" class="input" data-bind="rem-lead">' + [0, 5, 10, 15, 30].map((v) => '<option value="' + v + '"' + (R.lead === v ? ' selected' : '') + '>' + (v ? v + ' мин' : 'в момент приёма') + '</option>').join('') + '</select></label>';
    if (R.enabled) {
      html += '<h4 class="sub-h">Сегодня</h4><ul class="sched">' + (evs.length ? evs.map((e) => {
        const past = NF.toMin(e.at) < nowM;
        return '<li class="' + (past ? 'past' : '') + '"><span class="num">' + e.at + '</span><span>' + esc(e.title) + '</span><span class="muted small">' + (S.remFired[date] && S.remFired[date][e.key] ? 'показано' : past ? 'прошло' : '') + '</span></li>';
      }).join('') : '<li><span></span><span class="muted">На сегодня больше нет</span><span></span></li>') + '</ul>' +
        '<button class="btn small soft" data-act="rem-test">Проверить уведомление</button>';
    }
    return html;
  }


  function sourcesBody() {
    return '<div class="prose">' +
      '<p><b>Калории.</b> Базовый обмен по формуле Миффлина — Сан Жеора × коэффициент активности. Сверху профицит 200–500 ккал, чтобы прибавлять 0,25–0,5 % массы тела в неделю. Быстрее не надо: лишнее уходит в жир, а не в мышцы (Iraki et al., 2019; позиция ISSN).</p>' +
      '<p><b>Белок</b> 1,6–2,2 г на кг веса. Выше 2,2 г/кг дополнительной пользы для мышц нет (метаанализ Morton et al., 2018). Приложение никогда не превышает этот потолок.</p>' +
      '<p><b>Жиры</b> 25–30 % калорий, но не меньше 0,8 г/кг: это нужно для гормонов. <b>Углеводы</b> занимают остальное и дают энергию на тренировки.</p>' +
      '<p><b>Сон</b> 7–9 часов (подросткам 8–10). При недосыпе при той же еде набирается больше жира и меньше мышц.</p>' +
      '<p><b>Добавки.</b> Достаточно обычной еды. Сывороточный протеин — это просто еда в порошке. Креатин моногидрат 3–5 г в день — самая изученная добавка для взрослых здоровых людей. Больше 5 г пользы не даёт, загрузочные фазы не нужны. До 18 лет, при болезнях почек или при приёме лекарств — только после консультации врача. Никаких «гормональных» и «жиросжигающих» препаратов.</p>' +
      '<p><b>Когда идти к врачу.</b> ИМТ ниже 16; вес падает без причины; есть хронические болезни (почки, печень, диабет, ЖКТ); после еды бывают отёки, сердцебиение или боль.</p>' +
      '<p class="muted">NovaFit не ставит диагнозов и не заменяет врача или диетолога.</p></div>';
  }

  function dataBody() {
    return '<p class="small muted">Всё хранится только на этом устройстве. Сделай копию, чтобы перенести данные на другой телефон.</p>' +
      '<div class="row-btns"><button class="btn soft small" data-act="export">Скопировать данные</button><button class="btn soft small" data-act="import-toggle">Вставить данные</button></div>' +
      (ui.importOpen ? '<textarea id="import-text" class="input" rows="4" placeholder="Вставь сюда скопированные данные"></textarea><button class="btn primary small" data-act="import">Загрузить</button>' : '') +
      (ui.confirmReset ? '<div class="note n-danger"><span>Удалить все данные без возможности восстановления?</span><div class="row-btns"><button class="btn small danger" data-act="reset-yes">Удалить</button><button class="btn small ghost" data-act="reset-no">Отмена</button></div></div>'
        : '<button class="link danger-text" data-act="reset">Сбросить всё</button>');
  }


  // ───────────────── «Прогресс» ─────────────────
  function renderProgress() {
    if (!S.profile) return renderOnboarding();
    const T = targets();
    const lastW = S.weights.length ? S.weights[S.weights.length - 1].kg : S.profile.weight;
    const start = S.startWeight || S.profile.weight;
    const prog = Math.max(0, Math.min(1, (lastW - start) / Math.max(0.1, S.profile.target - start)));
    const gained = lastW - start;
    let html = screenHead('Прогресс');

    // цель
    html += '<section class="goal-card"><div class="goal-nums"><div><span class="goal-big num">' + fmtKg(lastW) + '</span><span class="goal-unit">кг</span></div>' +
      '<div class="goal-target"><span class="muted small">цель</span><b class="num">' + fmtKg(S.profile.target) + ' кг</b></div></div>' +
      '<div class="bar-track goal"><div class="bar-fill" data-k="goal" data-w="' + (prog * 100).toFixed(1) + '" style="width:' + (prog * 100).toFixed(1) + '%"></div></div>' +
      '<p class="muted small">' + (gained > 0.05 ? '+' + fmtKg(gained) + ' кг с начала · ' : 'старт ' + fmtKg(start) + ' кг · ') + 'ещё ~' + T.weeks + ' ' + plural(T.weeks, 'неделя', 'недели', 'недель') + ' в темпе +' + String(T.weekly).replace('.', ',') + ' кг/нед</p>' +
      weightChart() +
      '<button class="btn primary wide" data-act="open-sheet" data-sheet="weight">' + icon('scale') + 'Записать вес</button>' +
      (S.adaptMsg ? '<p class="note n-info">' + esc(S.adaptMsg) + '</p>' : '') + '</section>';

    html += reportCard();
    html += section('Сон', sleepPanel(), '<button class="link small" data-act="open-sheet" data-sheet="sleep">Отметить</button>');
    html += section('Замеры', measuresPanel(), '<button class="link small" data-act="open-sheet" data-sheet="measure">Записать</button>', 'measures');
    html += section('Моя норма', normPanel(T), '<button class="link small" data-act="open-sheet" data-sheet="sources">Как считается</button>');
    return html;
  }

  function sleepPanel() {
    const date = todayStr();
    const log = S.sleep.log;
    const last7 = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(date, -i); last7.push({ date: d, e: log.find((x) => x.date === d) }); }
    const durs = last7.filter((x) => x.e).map((x) => NF.sleepMinutes(x.e.bed, x.e.wake));
    const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
    const teen = S.profile && S.profile.age < 18;
    const need = teen ? [480, 600] : [420, 540];
    const maxH = 11 * 60;
    let html = '<div class="panel"><p class="panel-lead">' + (avg ? 'В среднем <b class="num">' + fmtDur(r0(avg)) + '</b> за неделю' : 'Пока нет записей сна') + '<span class="muted small"> · нужно ' + need[0] / 60 + '–' + need[1] / 60 + ' ч</span></p>' +
      '<div class="sleep-chart" role="img" aria-label="Длительность сна за 7 дней">' +
      '<div class="guide" style="bottom:calc(20px + (100% - 20px) * ' + (need[0] / maxH).toFixed(3) + ')"><span>' + need[0] / 60 + ' ч</span></div>' +
      last7.map((x, j) => {
        const m = x.e ? NF.sleepMinutes(x.e.bed, x.e.wake) : 0;
        const cls = !x.e ? 'none' : m < need[0] ? 'low' : 'ok';
        return '<div class="sbar" style="--j:' + j + '"><div class="sbar-area"><div class="sbar-fill ' + cls + '" style="height:' + (x.e ? Math.max(4, Math.min(m, maxH) / maxH * 100) : 4).toFixed(1) + '%" title="' + (x.e ? fmtDur(m) : 'нет записи') + '"></div></div><span class="small muted">' + esc(fmtDate(x.date, { weekday: 'short' })) + '</span></div>';
      }).join('') + '</div>';
    if (avg != null && avg < need[0]) html += '<p class="note n-warn">Меньше ' + need[0] / 60 + ' часов сна мешает набирать именно мышцы, а не жир. Попробуй ложиться на 30 минут раньше.</p>';
    return html + '</div>';
  }

  function measuresPanel() {
    const ms = S.measures.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = ms[ms.length - 1];
    const ins = NF.measureInsight(ms, S.weights);
    const due = !last || NF.daysBetween(last.date, todayStr()) >= 14;
    let html = '<div class="panel">';
    if (ms.length) {
      html += '<div class="mtable" role="table"><div class="mrow head" role="row"><span>' + esc(fmtDate(last.date, { day: 'numeric', month: 'short' })) + '</span><span>сейчас</span><span>с начала</span></div>' +
        NF.MEASURES.map((m) => {
          const cur = last[m.k], d = ins.deltas ? ins.deltas[m.k] : null;
          return '<div class="mrow" role="row"><span>' + m.label + '</span><span class="num">' + (cur != null ? String(cur).replace('.', ',') + ' см' : '—') + '</span><span class="num ' + (d == null || ms.length < 2 ? '' : d > 0 ? (m.k === 'waist' ? 'up-waist' : 'up') : '') + '">' + (d == null || ms.length < 2 ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '') + String(Math.abs(d)).replace('.', ',')) + '</span></div>';
        }).join('') + '</div>';
    }
    html += '<p class="note n-' + ins.verdict.level + '">' + esc(ins.verdict.text) + '</p>';
    if (due) html += '<button class="btn soft wide" data-act="open-sheet" data-sheet="measure">' + icon('ruler') + (last ? 'Пора обновить замеры' : 'Сделать первые замеры') + '</button>';
    return html + '</div>';
  }

  function normPanel(T) {
    return '<div class="panel"><p class="norm-kcal"><span class="num">' + fmtNum(T.kcal) + '</span> ккал в день</p>' +
      '<div class="tgrid"><div><b class="num">' + T.protein + ' г</b><span>белок · ' + String(T.proteinPerKg).replace('.', ',') + ' г/кг</span></div><div><b class="num">' + T.fat + ' г</b><span>жиры</span></div><div><b class="num">' + T.carbs + ' г</b><span>углеводы</span></div></div>' +
      '<p class="muted small">Расход ' + fmtNum(T.tdee) + ' ккал + профицит ' + T.surplus + (T.adjust ? (T.adjust > 0 ? ' + ' : ' − ') + Math.abs(T.adjust) + ' (подстройка по весу)' : '') + '. ИМТ ' + String(T.bmi).replace('.', ',') + ' → ' + String(T.targetBmi).replace('.', ',') + ' на цели.</p>' +
      warningsBlock(T.warnings) + '</div>';
  }

  // ── шторки прогресса ──
  SHEETS.weight = () => ({
    title: 'Записать вес',
    body: '<div class="big-input"><input id="w-kg" class="input" type="number" inputmode="decimal" step="0.1" placeholder="' + fmtKg(S.profile ? S.profile.weight : 60) + '" aria-label="Вес, кг" data-autofocus><span>кг</span></div>' +
      '<button class="btn primary wide" data-act="w-add">Сохранить</button>' +
      '<p class="hint">Взвешивайся 2–3 раза в неделю утром натощак, после туалета. Раз в неделю NovaFit сравнит средний вес с прошлой неделей и сам поправит калории на ±100 ккал (в сумме не больше ±300).</p>',
  });

  SHEETS.measure = () => {
    const ms = S.measures.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = ms[ms.length - 1];
    return {
      title: 'Замеры тела',
      body: '<div class="grid2">' + NF.MEASURES.map((m) => '<label>' + m.label + ', см<input id="ms-' + m.k + '" class="input" type="number" inputmode="decimal" step="0.1" min="10" max="250" placeholder="' + (last && last[m.k] != null ? String(last[m.k]) : '') + '"></label>').join('') + '</div>' +
        '<button class="btn primary wide" data-act="measure-save">Сохранить замеры</button>' +
        '<h4 class="sub-h">Как мерить, чтобы цифры были честными</h4><ul class="dots small">' +
        '<li>Утром, натощак, до еды и тренировки. Раз в 2 недели в один и тот же день.</li>' +
        NF.MEASURES.map((m) => '<li><b>' + m.label + ':</b> ' + esc(m.how.toLowerCase()) + '.</li>').join('') +
        '<li>Лента горизонтально, прилегает, но не врезается в кожу.</li></ul>',
    };
  };

  SHEETS.sources = () => ({ title: 'Откуда цифры и что безопасно', body: sourcesBody() });


  // ───────────────── настройки ─────────────────
  function renderSettings() {
    if (!S.profile) return renderOnboarding();
    const p = S.profile;
    const R = S.reminders;
    const eq = S.equip;
    let html = screenHead('Настройки', null, true);
    html += section('Я', list([
      row({ title: 'Мои данные', sub: 'рост ' + p.height + ' см · вес ' + fmtKg(p.weight) + ' → цель ' + fmtKg(p.target) + ' кг', lead: icon('user'), act: 'open-sheet', data: { sheet: 'profile' } }),
      row({ title: 'Режим сна', sub: 'подъём ' + esc(S.sleep.wake) + ' · отбой ' + esc(S.sleep.bed), lead: icon('moon'), act: 'open-sheet', data: { sheet: 'schedule' } }),
      row({ title: 'Тренировки', sub: (eq.db ? eq.db + ' ' + plural(eq.db, 'гантель', 'гантели', 'гантелей') + ' по ' + fmtKg(eq.dbKg) + ' кг' : 'без гантелей') + ' · ' + S.train.days.length + ' раза в неделю', lead: icon('dumbbell'), act: 'open-sheet', data: { sheet: 'equipment' } }),
    ]));
    html += section('Питание', list([
      '<div class="row"><span class="row-lead">' + icon('leaf') + '</span><span class="row-main"><span class="row-title">Режим «Нет аппетита»</span><span class="row-sub">6 приёмов поменьше, калорийные блюда</span></span>' +
        '<label class="switch"><input type="checkbox" id="low-appetite" data-bind="low-appetite"' + (S.lowAppetite ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span class="sr">Режим «Нет аппетита»</span></label></div>',
      row({ title: 'Как съедать норму без аппетита', lead: icon('info'), act: 'open-sheet', data: { sheet: 'appetite' } }),
    ]));
    html += section('Приложение', list([
      row({ title: 'Напоминания', sub: R.enabled ? 'включены' : 'выключены', lead: icon('bell'), act: 'open-sheet', data: { sheet: 'reminders' }, id: 'reminders' }),
      row({ title: 'Данные', sub: 'копия, перенос, сброс', lead: icon('data'), act: 'open-sheet', data: { sheet: 'data' } }),
      row({ title: 'Откуда цифры и что безопасно', lead: icon('book'), act: 'open-sheet', data: { sheet: 'sources' } }),
    ]));
    html += '<p class="foot muted small">NovaFit 2.0 · все данные хранятся только на этом телефоне. Приложение не заменяет врача или диетолога.</p>';
    return html;
  }

  SHEETS.profile = () => ({ title: 'Мои данные', body: profileForm(false) });
  SHEETS.reminders = () => ({ title: 'Напоминания', body: remindersBody() });
  SHEETS.data = () => ({ title: 'Данные', body: dataBody() });
  SHEETS.schedule = () => ({
    title: 'Режим сна',
    body: '<div class="grid2"><label>Подъём<input id="sl-def-wake" class="input" type="time" data-bind="sleep-def" data-k="wake" value="' + esc(S.sleep.wake) + '"></label>' +
      '<label>Отбой<input id="sl-def-bed" class="input" type="time" data-bind="sleep-def" data-k="bed" value="' + esc(S.sleep.bed) + '"></label></div>' +
      '<p class="muted small">Сон по режиму: ' + fmtDur(NF.sleepMinutes(S.sleep.bed, S.sleep.wake)) + (S.profile && S.profile.age < 18 ? ' (в твоём возрасте нужно 8–10 ч)' : ' (взрослым нужно 7–9 ч)') + '.</p>' +
      '<p class="hint">От подъёма и отбоя строится расписание еды: завтрак через 40 минут после подъёма, ужин за 3 часа до сна. Если отметил сон за сегодня, берётся фактическое время подъёма. В поездках всё идёт по местному времени.</p>' +
      '<h4 class="sub-h">Перелёт и смена часового пояса</h4>' + jetlagTips(null),
  });

  // ───────────────── знакомство ─────────────────
  function renderOnboarding() {
    return '<section class="onboard">' +
      '<p class="brand">Nova<span>Fit</span></p>' +
      '<h1 class="display">Набор массы без перегибов</h1>' +
      '<p class="lead">Рост, вес и цель — и NovaFit посчитает безопасную норму, соберёт меню из того, что есть дома, распишет день от подъёма до сна и составит тренировки под твой инвентарь.</p>' +
      '<ul class="onboard-points"><li>' + icon('meal') + 'Меню из твоих продуктов</li><li>' + icon('dumbbell') + 'Тренировки даже с одной гантелью</li><li>' + icon('chart') + 'Норма сама подстраивается по весу</li></ul>' +
      '</section>' + '<section class="panel">' + profileForm(true) + '</section>';
  }

  /** Перекус перед тренировкой (за 0–2,5 ч до неё) — помечаем тегом. */
  function preTrainIndex(plan) {
    const tt = NF.toMin(S.train.time);
    if (tt == null) return -1;
    let idx = -1;
    plan.meals.forEach((m, i) => { const t = NF.toMin(m.time); if (m.type === 's' && t < tt && tt - t <= 150) idx = i; });
    return idx;
  }
  // ── часовой пояс: в поездках еда, сон и напоминания идут по местному времени ──
  function checkTimezone() {
    let tz = 'local';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch (e) { /* ignore */ }
    const off = new Date().getTimezoneOffset();
    if (S.lastOffset != null && S.lastOffset !== off) {
      S.tzNotice = { tz: tz, diff: (S.lastOffset - off) / 60, date: todayStr() };
    }
    S.lastTz = tz; S.lastOffset = off;
  }

  function jetlagTips(diff) {
    return '<ul class="dots small">' +
      '<li>С первого дня живи по местным часам: ешь и ложись по местному времени, даже если не хочется.</li>' +
      '<li>Утром — 20–30 минут дневного света на улице, вечером — приглушённый свет и меньше экрана.</li>' +
      (diff == null ? '<li>Летел на восток — ложись чуть раньше, на запад — продержись бодрым до местного вечера.</li>'
        : diff > 0 ? '<li>Ты летел на восток: первые вечера ложись чуть раньше и не отсыпайся утром допоздна.</li>'
          : '<li>Ты летел на запад: продержись бодрым до местного вечера, утром вставай по будильнику.</li>') +
      '<li>Если днём очень хочется спать — не больше 20–30 минут.</li>' +
      '<li>Кофеин — только до обеда по местному времени.</li>' +
      '<li>Первые 1–2 дня тренируйся полегче: сон и восстановление ещё не наладились.</li></ul>';
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

  // ───────── «Что приготовить» ─────────
  function shortName(f) { return f ? f.name.split(' (')[0].split(' / ')[0].toLowerCase() : ''; }

  function webLinks(query) {
    const q = encodeURIComponent(query);
    return '<a class="pill link-out" href="https://www.google.com/search?q=' + q + '" target="_blank" rel="noopener">Google</a>' +
      '<a class="pill link-out" href="https://www.youtube.com/results?search_query=' + q + '" target="_blank" rel="noopener">YouTube</a>';
  }

  /** Состояние рецепта по запасам: чего нет, что заменяется. */
  function recipeState(r, inv, F) {
    const rs = NF.resolveRecipe(r, inv, F, false);
    const missing = rs.ings.filter((i) => i.missing).map((i) => i.food.id);
    const subs = rs.ings.filter((i) => i.sub).map((i) => ({ from: i.sub, to: i.food.id, title: NF.isTitleIngredient(r, i.sub, F) }));
    const group = missing.length === 0 ? 'now' : missing.length === 1 ? 'one' : missing.length <= 3 ? 'few' : 'rest';
    return { r: r, missing: missing, subs: subs, skipped: rs.skipped, group: group };
  }

  function recMealType(r) {
    if (ui.recFilter === 'b' || ui.recFilter === 's') return ui.recFilter;
    if (ui.recFilter === 'l') return r.meals.indexOf('l') >= 0 ? 'l' : 'd';
    return r.meals[0];
  }

  function recipeFit(r, F, inv) {
    const T = targets();
    if (!T) return null;
    return NF.fitRecipe(r, NF.targetFor(T, NF.MEAL_SHARE[recMealType(r)]), inv, F, false, { dense: !!S.lowAppetite });
  }

  function stockNames(inv, F) {
    const urg = urgencyMap();
    const skip = { tomato_paste: 1, onion: 1, honey: 1 };
    return Object.keys(inv).filter((id) => F[id] && !F[id].noplan && !skip[id] && F[id].cat !== 'fat' && inv[id] >= 50)
      .sort((a, b) => (urg[b] || 0) - (urg[a] || 0) || inv[b] - inv[a]).slice(0, 4).map((id) => shortName(F[id]));
  }

  function shopList() {
    const T = targets();
    const F = fm();
    const list = NF.shoppingList(todayStr(), ui.shopDays, T, scheduleFor(todayStr()), usableInventory(), F, recentPenalty(todayStr()), { dense: !!S.lowAppetite });
    Object.keys(S.shopExtra || {}).forEach((id) => {
      if (!F[id]) return;
      const it = list.find((x) => x.id === id);
      if (it) { it.g = Math.max(it.g, S.shopExtra[id]); it.manual = true; }
      else list.push({ id: id, g: S.shopExtra[id], manual: true });
    });
    return list;
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

  function weekReportFor(offset) {
    const start = addDays(NF.weekStart(todayStr()), 7 * offset);
    return NF.weekReport({
      start: start, today: todayStr(), plans: S.plans, extras: S.extras, weights: S.weights, sleepLog: S.sleep.log,
      workouts: S.workouts, trainDays: S.train.days, profile: S.profile, targets: targets(), fm: fm(), measures: S.measures,
    });
  }

  // ── напоминания ──
  // В Android-приложении (APK) системные функции даёт мост window.NovaAndroid.
  const NA = window.NovaAndroid || null;

  function notifState() {
    if (NA) { try { return NA.notifState(); } catch (e) { return 'unsupported'; } }
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // default | granted | denied
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
      meals: plan.meals.map((m) => ({ type: m.type, label: mealLabel(m), time: m.time, eaten: m.eaten, title: m.recipeId && recipeById(m.recipeId) ? recipeById(m.recipeId).name : 'Тарелка из твоих продуктов' })),
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
          meals: scheduleFor(date).meals.map((m) => ({ type: m.type, label: m.label, time: m.time, eaten: false, title: 'Блюдо и граммовки — в NovaFit' })),
          bed: S.sleep.bed, wake: S.sleep.wake, trainTime: isTrainDay(date) ? S.train.time : null,
          lead: S.reminders.lead, opts: S.reminders, measureDue: !lastM || NF.daysBetween(lastM, date) >= 14,
        });
        evs.forEach((e, i) => {
          const at = new Date(date + 'T' + e.at + ':00').getTime();
          if (at > nowMs + 30000) list.push({ id: 1000 + d * 20 + i, at: at, date: date, time: e.at, title: e.title, body: e.body });
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
      schedRest: NF.mealSchedule(S.sleep.wake, S.sleep.bed, null, S.lowAppetite ? 'six' : 'four'), schedTrain: NF.mealSchedule(S.sleep.wake, S.sleep.bed, S.train.time, S.lowAppetite ? 'six' : 'four'),
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
    // пока таймер на экране, у страницы запас снизу — чтобы плашка не закрывала кнопки
    document.body.classList.toggle('timer-on', !!S.timer);
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

  // ───────────────── сканер штрихкодов ─────────────────
  let scanCam = null;
  const BARCODE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path d="M3 6v12M6 6v12M9.5 6v12M12 6v12M15.5 6v12M18 6v12M21 6v12"/></svg>';

  function scanButton(mode) {
    return '<button class="btn small ghost scan-btn" data-act="scan-open" data-mode="' + mode + '" aria-label="Сканировать штрихкод">' + BARCODE_ICON + '<span>Штрихкод</span></button>';
  }

  function openScanner(mode) {
    ui.scan = { mode: mode, phase: 'camera', code: '', prod: null };
    let el = document.getElementById('scanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scanner'; el.className = 'scanner';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Сканер штрихкода');
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="scan-sheet">' +
      '<div class="scan-top"><h2 class="sheet-title">' + (mode === 'extra' ? 'Что съел — по штрихкоду' : 'Продукт по штрихкоду') + '</h2><button class="icon-btn round" data-act="scan-close" aria-label="Закрыть">' + icon('close') + '</button></div>' +
      '<div class="scan-view" id="scan-view"><video id="scan-video" playsinline muted></video><div class="scan-frame" aria-hidden="true"><span class="scan-line"></span></div></div>' +
      '<p class="scan-msg" id="scan-msg" role="status">Включаю камеру… Наведи её на штрихкод на упаковке.</p>' +
      '<div class="add-row scan-manual"><input id="scan-code" class="input" inputmode="numeric" pattern="[0-9]*" maxlength="14" autocomplete="off" placeholder="Или введи цифры под штрихкодом" aria-label="Цифры штрихкода"><button class="btn small" data-act="scan-find">Найти</button></div>' +
      '<div id="scan-result" class="scan-result"></div>' +
      '<p class="scan-credit small muted">Данные о товарах — из открытой базы Open Food Facts (лицензия ODbL). Работает в любой стране, но не все товары там есть: тогда введи КБЖУ с упаковки, и NovaFit запомнит товар.</p>' +
      '</div>';
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    startScanCamera();
  }

  function setScanMsg(t) { const m = document.getElementById('scan-msg'); if (m) m.textContent = t; }

  async function startScanCamera() {
    if (window.__NF_EMBED) {
      // в превью-ссылке камера и запросы в интернет запрещены
      const view = document.getElementById('scan-view');
      if (view) view.hidden = true;
      const manual = document.querySelector('.scan-manual');
      if (manual) manual.hidden = true;
      setScanMsg('В этом превью камера и поиск по базе товаров недоступны — сканер работает в установленном приложении. Здесь можно добавить товар вручную, по КБЖУ с упаковки.');
      ui.scan.code = 'manual' + Date.now();
      ui.scan.phase = 'manual';
      renderScanResult();
      return;
    }
    const video = document.getElementById('scan-video');
    try {
      scanCam = await NF.Scanner.startCamera(video, (code) => {
        scanCam = null;
        if (!ui.scan || ui.scan.manual) return; // уже вводят цифры вручную
        vibrate([60]); onScanCode(code);
      });
      // закрыли сканер или начали вводить цифры, пока включалась камера
      if (!ui.scan || ui.scan.manual) { stopScanCamera(); return; }
      setScanMsg('Наведи камеру на штрихкод. Держи телефон ровно, в 10–20 см от упаковки.');
    } catch (e) {
      const view = document.getElementById('scan-view');
      if (view) view.hidden = true;
      setScanMsg(e.message === 'denied' ? 'Нет доступа к камере. Разреши камеру для NovaFit в настройках или введи цифры штрихкода вручную.'
        : e.message === 'nodecoder' ? 'Не получилось включить распознавание. Введи цифры штрихкода вручную.'
          : 'Камера недоступна. Введи цифры штрихкода вручную — они напечатаны под полосками.');
    }
  }

  function stopScanCamera() { if (scanCam) { try { scanCam.stop(); } catch (e) { /* ignore */ } scanCam = null; } }

  function closeScanner() {
    stopScanCamera();
    ui.scan = null;
    const el = document.getElementById('scanner');
    if (el) { el.classList.remove('show'); setTimeout(() => { if (!ui.scan) { el.hidden = true; el.innerHTML = ''; } }, 260); }
  }

  async function onScanCode(code) {
    code = String(code || '').replace(/\D/g, '');
    if (!ui.scan) return;
    if (!NF.Scanner.validCode(code)) { setScanMsg('Такого штрихкода не бывает — проверь цифры.'); return; }
    stopScanCamera();
    const view = document.getElementById('scan-view');
    if (view) view.hidden = true;
    const input = document.getElementById('scan-code');
    if (input) input.value = code;
    ui.scan.code = code;
    const F = fm();
    const known = S.barcodes[code];
    if (known && F[known]) { ui.scan.phase = 'known'; ui.scan.foodId = known; setScanMsg('Этот товар уже знаком.'); renderScanResult(); return; }
    ui.scan.phase = 'loading';
    setScanMsg('Штрихкод ' + code + '. Ищу товар в мировой базе…');
    renderScanResult();
    const res = await NF.Scanner.lookup(code);
    if (!ui.scan || ui.scan.code !== code) return; // закрыли или отсканировали другое
    if (res.status === 'ok') {
      const prod = NF.Scanner.parseProduct(res.raw, code, F);
      ui.scan.prod = prod;
      ui.scan.phase = prod.hasMacros ? 'found' : 'manual';
      ui.scan.reason = prod.hasMacros ? null : 'nomacros';
      ui.scan.choice = prod.base ? 'base' : 'custom';
      setScanMsg(prod.hasMacros ? 'Нашёл.' : 'Товар есть в базе, но без КБЖУ.');
    } else {
      ui.scan.phase = 'manual'; ui.scan.reason = res.status; ui.scan.prod = null;
      setScanMsg(res.status === 'notfound' ? 'Этого товара нет в базе Open Food Facts.' : res.status === 'offline' ? 'Нет интернета: в базе не поискать.' : 'Не получилось связаться с базой товаров.');
    }
    renderScanResult();
  }

  function scanQtyField(defG) {
    const extra = ui.scan.mode === 'extra';
    return '<label>' + (extra ? 'Сколько съел, г или мл' : 'Сколько дома, г или мл') +
      '<input id="scan-qty" class="input" type="number" inputmode="decimal" min="1" value="' + (defG ? r0(defG) : '') + '" placeholder="' + (extra ? '100' : '500') + '"></label>';
  }

  function scanExpField(suggestDays) {
    if (ui.scan.mode === 'extra') return '';
    const v = suggestDays ? addDays(todayStr(), suggestDays) : '';
    return '<label>Годен до (необязательно)<input id="scan-exp" class="input" type="date" value="' + v + '"></label>';
  }

  function scanStockToggle(foodId) {
    if (ui.scan.mode !== 'extra' || !foodId || !(S.inventory[foodId] > 0)) return '';
    return '<label class="check small"><input type="checkbox" id="scan-from-stock" checked> списать из запасов</label>';
  }

  function renderScanResult() {
    const box = document.getElementById('scan-result');
    const sc = ui.scan;
    if (!box || !sc) return;
    const F = fm();
    let html = '';
    if (sc.phase === 'loading') {
      html = '<p class="scan-loading">Ищу…</p>';
    } else if (sc.phase === 'known') {
      const f = F[sc.foodId];
      html = '<div class="scan-card"><p class="scan-name">' + esc(f.name) + '</p>' + macroLine({ kcal: f.kcal, p: f.p, f: f.f, c: f.c }) + ' <span class="small muted">на 100 г</span>' +
        '<div class="grid2">' + scanQtyField(sc.mode === 'extra' ? 100 : null) + scanExpField(NF.SHELF[f.id] || null) + '</div>' + scanStockToggle(f.id) +
        '<button class="btn primary wide" data-act="scan-save">' + (sc.mode === 'extra' ? 'Записать, что съел' : 'Добавить в запасы') + '</button></div>';
    } else if (sc.phase === 'found') {
      const p = sc.prod;
      const base = p.base ? F[p.base] : null;
      const fullName = p.name + (p.brand && p.name.indexOf(p.brand) < 0 ? ' · ' + p.brand : '');
      html = '<div class="scan-card"><p class="scan-name">' + esc(p.name || 'Без названия') + (p.brand ? ' <span class="muted">· ' + esc(p.brand) + '</span>' : '') + '</p>' +
        macroLine({ kcal: p.kcal, p: p.p, f: p.f, c: p.c }) + ' <span class="small muted">на 100 г</span>' +
        (p.noplan ? '<p class="hint">Это сладкое или снек: запишется в «съел» и в калькулятор, но в автоматическое меню не попадёт.</p>' : '') +
        (base ? '<div class="scan-choice"><label class="check"><input type="radio" name="scan-choice" value="base"' + (sc.choice === 'base' ? ' checked' : '') + '> Как «' + esc(base.name) + '» — будет участвовать в рецептах</label>' +
          '<label class="check"><input type="radio" name="scan-choice" value="custom"' + (sc.choice === 'custom' ? ' checked' : '') + '> Как отдельный продукт</label></div>' : '') +
        '<label>Название<input id="scan-name" class="input" value="' + esc(fullName) + '"></label>' +
        '<div class="grid2">' + scanQtyField(sc.mode === 'extra' ? 100 : p.qty) + scanExpField(base ? (NF.SHELF[base.id] || null) : p.shelf) + '</div>' + scanStockToggle(base ? base.id : 'b' + p.code) +
        '<button class="btn primary wide" data-act="scan-save">' + (sc.mode === 'extra' ? 'Записать, что съел' : 'Добавить в запасы') + '</button></div>';
    } else if (sc.phase === 'manual') {
      const p = sc.prod;
      html = '<div class="scan-card"><p class="small">Введи данные с упаковки (на 100 г) — я запомню товар по штрихкоду, и в следующий раз он найдётся даже без интернета.</p>' +
        '<label>Название<input id="scan-name" class="input" value="' + esc(p && p.name ? p.name : '') + '" placeholder="Например: Йогурт питьевой"></label>' +
        '<div class="grid4"><label>ккал<input id="scan-kcal" class="input" type="number" inputmode="decimal"></label><label>Б<input id="scan-p" class="input" type="number" inputmode="decimal"></label><label>Ж<input id="scan-f" class="input" type="number" inputmode="decimal"></label><label>У<input id="scan-c" class="input" type="number" inputmode="decimal"></label></div>' +
        '<label>Категория<select id="scan-cat" class="input">' + Object.keys(NF.CAT_LABEL).map((k) => '<option value="' + k + '">' + NF.CAT_LABEL[k] + '</option>').join('') + '</select></label>' +
        '<div class="grid2">' + scanQtyField(sc.mode === 'extra' ? 100 : null) + scanExpField(null) + '</div>' +
        '<button class="btn primary wide" data-act="scan-save">' + (sc.mode === 'extra' ? 'Записать, что съел' : 'Добавить в запасы') + '</button></div>';
    }
    box.innerHTML = html;
  }

  /** Сохранить отсканированный товар как свой продукт (id по штрихкоду — без дублей). */
  function upsertScanned(prod, name) {
    const food = NF.Scanner.customFromScan(prod, name);
    const i = S.customFoods.findIndex((f) => f.id === food.id);
    if (i >= 0) S.customFoods[i] = food; else S.customFoods.push(food);
    return food.id;
  }

  function saveScan() {
    const sc = ui.scan;
    if (!sc) return;
    const g = num('scan-qty');
    if (!(g > 0 && g <= 20000)) { toast('Укажи количество в граммах'); return; }
    let foodId = null;
    if (sc.phase === 'known') foodId = sc.foodId;
    else if (sc.phase === 'found') {
      const ch = document.querySelector('input[name="scan-choice"]:checked');
      if (ch && ch.value === 'base' && sc.prod.base) foodId = sc.prod.base;
      else foodId = upsertScanned(sc.prod, val('scan-name').trim() || sc.prod.name);
    } else if (sc.phase === 'manual') {
      const kcal = num('scan-kcal'), p = num('scan-p'), f = num('scan-f'), c = num('scan-c');
      const name = val('scan-name').trim();
      if (!name || !(kcal >= 0) || !(p >= 0) || !(f >= 0) || !(c >= 0)) { toast('Заполни название и КБЖУ на 100 г'); return; }
      if (Math.abs(p * 4 + f * 9 + c * 4 - kcal) > Math.max(40, kcal * 0.25)) { toast('КБЖУ не сходятся с калориями. Проверь цифры на упаковке.'); return; }
      foodId = upsertScanned({ code: sc.code, name: name, brand: '', kcal: kcal, p: p, f: f, c: c, cat: val('scan-cat') || 'carb', noplan: false }, name);
    } else return;
    if (NF.Scanner.validCode(sc.code)) S.barcodes[sc.code] = foodId;
    const F = fm();
    const food = F[foodId];
    const date = todayStr();
    if (sc.mode === 'extra') {
      const fromStock = !!(document.getElementById('scan-from-stock') || {}).checked;
      const now = new Date();
      (S.extras[date] = S.extras[date] || []).push({ id: foodId, g: Math.round(g), t: NF.fromMin(now.getHours() * 60 + now.getMinutes()), stock: fromStock });
      if (fromStock) changeInventory(foodId, -g);
      rebuildPlan(date);
      save(); closeScanner(); render();
      toast(shortName(food) + ': +' + r0(food.kcal * g / 100) + ' ккал. План пересчитан', 3500);
    } else {
      setExpiryOnAdd(foodId, val('scan-exp'));
      changeInventory(foodId, g);
      S.demoInventory = false;
      save(); closeScanner(); render();
      toast(food.name + ': +' + r0(g) + ' г в запасах', 3500);
    }
  }

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


  // ───────────────── рендер ─────────────────
  const SCREENS = { today: renderToday, food: renderFood, train: renderTrain, progress: renderProgress, settings: renderSettings };

  function render() {
    const view = document.getElementById('view');
    const tab = SCREENS[S.tab] ? S.tab : 'today';
    const screen = tab + (tab === 'food' ? ':' + ui.foodSeg : '');
    const prevTab = lastScreen && lastScreen.split(':')[0];
    const entering = screen !== lastScreen;
    lastScreen = screen;
    const openIds = entering ? [] : Array.from(view.querySelectorAll('details[open][id]')).map((d) => d.id);
    view.innerHTML = SCREENS[tab]();
    openIds.forEach((id) => { const d = document.getElementById(id); if (d) d.open = true; });
    document.body.classList.toggle('onboarding', !S.profile);
    if (entering && motionOK()) {
      // новый экран — блоки появляются по очереди; смена сегмента — только содержимое под ним
      let kids = Array.from(view.children);
      if (prevTab === tab) { const sg = view.querySelector('.seg'); if (sg) kids = kids.slice(kids.indexOf(sg) + 1); }
      kids.forEach((c, i) => { c.style.setProperty('--i', Math.min(i, 8)); c.classList.add('enter'); });
    }
    const navTab = tab === 'settings' ? ui.prevTab : tab;
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const on = b.dataset.tab === navTab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    animateValues(entering && prevTab !== tab);
    placeThumbs();
    placeNavIndicator();
    if (ui.sheet) renderSheet(false);
    ui.justEaten = null; ui.justSwapped = null;
    keepAwake(!!S.draft && tab === 'train');
    scheduleReminders();
  }
  window.addEventListener('resize', () => { placeNavIndicator(); document.querySelectorAll('.seg[data-k]').forEach((x) => { delete prevVals[x.dataset.k]; }); placeThumbs(); });

  function num(id) { const el = document.getElementById(id); return el ? parseFloat(String(el.value).replace(',', '.')) : NaN; }
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  function goTab(tab) {
    if (tab !== 'settings') ui.prevTab = tab;
    S.tab = tab;
    closeSheet();
    save(); render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }


  // ───────────────── действия ─────────────────
  const SHEET_RESET = {
    eat: () => { ui.extraSearch = ''; ui.extraPick = null; },
    'stock-add': () => { ui.search = ''; ui.addFood = null; ui.customOpen = false; },
    sleep: () => { ui.sleepQ = null; },
    data: () => { ui.importOpen = false; ui.confirmReset = false; },
    profile: () => { ui.errors = []; ui.profileDraft = null; },
  };

  const ACTIONS = {
    // навигация
    tab(el) { goTab(el.dataset.tab); },
    'open-settings'() { goTab('settings'); },
    back() { goTab(ui.prevTab || 'today'); },
    add() { openSheet('add'); },
    'open-sheet'(el) {
      const name = el.dataset.sheet;
      const params = {};
      Object.keys(el.dataset).forEach((k) => { if (k !== 'act' && k !== 'sheet') params[k] = el.dataset[k]; });
      if (SHEET_RESET[name]) SHEET_RESET[name]();
      openSheet(name, params);
    },
    'sheet-close'() { closeSheet(); },
    fseg(el) { ui.foodSeg = el.dataset.v; render(); },
    'go-fridge'() { ui.foodSeg = 'fridge'; goTab('food'); },

    // сегодня
    rebuild() { rebuildPlan(todayStr()); render(); toast('Меню пересобрано из того, что есть'); },
    eat(el) {
      const plan = getPlan(todayStr()); const i = +el.dataset.i; const m = plan.meals[i];
      if (!m || m.eaten) return;
      m.eaten = true; ui.justEaten = i;
      m.items.forEach((it) => { if (S.inventory[it.id] != null) changeInventory(it.id, -it.g); });
      plan.invVersion = S.invVersion; save(); closeSheet(); render();
      toast(mealLabel(m) + ' — записал. Продукты списаны из холодильника');
    },
    uneat(el) {
      const plan = getPlan(todayStr()); const m = plan.meals[+el.dataset.i];
      if (!m || !m.eaten) return;
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
      const rec = plan.meals[i].recipeId ? recipeById(plan.meals[i].recipeId) : null;
      toast('Другое блюдо: ' + (rec ? rec.name : 'тарелка из твоих продуктов'));
    },
    'extra-pick'(el) {
      ui.extraPick = ui.extraPick === el.dataset.id ? null : el.dataset.id;
      const box = document.getElementById('extra-results');
      if (box) box.innerHTML = extraResults();
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
      ui.extraPick = null; ui.extraSearch = '';
      rebuildPlan(date);
      const left = targets().kcal - eatenMacros(getPlan(date)).kcal;
      save(); closeSheet(); render();
      toast(shortName(f) + ': +' + r0(f.kcal * g / 100) + ' ккал. ' + (left > 0 ? 'Меню пересчитано, осталось ' + r0(left) + ' ккал' : 'Норма на сегодня закрыта'), 3500);
    },
    'extra-del'(el) {
      const date = todayStr(); const xs = extrasFor(date); const x = xs[+el.dataset.i];
      if (!x) return;
      xs.splice(+el.dataset.i, 1);
      if (x.stock) changeInventory(x.id, x.g);
      rebuildPlan(date); save(); render(); toast('Удалено, меню пересчитано');
    },
    'tz-ok'() { S.tzNotice = null; save(); closeSheet(); render(); },
    'sleep-q'(el) {
      // без перерисовки шторки, чтобы не сбросить введённое время
      ui.sleepQ = +el.dataset.q;
      el.parentNode.querySelectorAll('.day').forEach((x) => x.classList.toggle('on', x === el));
    },
    'sleep-save'() {
      const bed = val('sl-bed'), wake = val('sl-wake');
      if (NF.toMin(bed) == null || NF.toMin(wake) == null) { toast('Укажи время'); return; }
      const date = todayStr(); const e = sleepEntry(date);
      const q = ui.sleepQ || (e ? e.q : 3);
      if (e) Object.assign(e, { bed: bed, wake: wake, q: q }); else S.sleep.log.push({ date: date, bed: bed, wake: wake, q: q });
      S.sleep.log = S.sleep.log.slice(-120);
      // расписание еды завязано на подъём — переносим время в плане
      const plan = S.plans[date];
      if (plan) { const sc = scheduleFor(date); plan.meals.forEach((m, i) => { if (sc.meals[i] && !m.eaten) m.time = sc.meals[i].time; }); }
      save(); closeSheet(); render(); toast('Сон записан: ' + fmtDur(NF.sleepMinutes(bed, wake)));
    },

    // холодильник
    'pick-food'(el) {
      ui.addFood = ui.addFood === el.dataset.id ? null : el.dataset.id;
      document.getElementById('search-results').innerHTML = searchResults();
      const q = document.getElementById('add-qty'); if (q) q.focus();
    },
    'add-food'(el) {
      const f = fm()[el.dataset.id]; const q = num('add-qty'); const u = val('add-unit');
      if (!(q > 0)) { toast('Укажи количество'); return; }
      const g = u === 'unit' ? q * f.perUnit : u === 'kg' ? q * 1000 : q;
      S.demoInventory = false;
      setExpiryOnAdd(f.id, val('add-exp'));
      changeInventory(f.id, g); ui.addFood = null; ui.search = '';
      save(); render();
      const inp = document.getElementById('food-search'); if (inp) inp.focus();
      toast(f.name + ': +' + r0(g) + (LIQUID[f.id] ? ' мл' : ' г') + '. Можно добавить ещё');
    },
    'custom-toggle'() { ui.customOpen = !ui.customOpen; renderSheet(false); },
    'custom-add'() {
      const name = val('cf-name').trim(); const kcal = num('cf-kcal'), p = num('cf-p'), f = num('cf-f'), c = num('cf-c');
      if (!name || !(kcal >= 0) || !(p >= 0) || !(f >= 0) || !(c >= 0)) { toast('Заполни название и КБЖУ на 100 г'); return; }
      if (Math.abs(p * 4 + f * 9 + c * 4 - kcal) > Math.max(40, kcal * 0.25)) { toast('КБЖУ не сходятся с калориями. Проверь цифры на упаковке.'); return; }
      const cat = val('cf-cat');
      const id = 'c_' + Date.now().toString(36);
      S.customFoods.push({ id: id, name: name, kcal: kcal, p: p, f: f, c: c, cat: cat, maxMeal: cat === 'fat' ? 40 : cat === 'veg' ? 300 : 250, unit: null, perUnit: null, custom: true });
      const q = num('cf-qty'); if (q > 0) changeInventory(id, q);
      S.demoInventory = false; ui.customOpen = false; save(); closeSheet(); render(); toast('Продукт добавлен');
    },
    'clear-demo'() { S.inventory = {}; S.expiry = {}; S.demoInventory = false; S.invVersion++; save(); render(); toast('Пример убран. Добавь свои продукты'); },
    'stock-step'(el) {
      const inp = document.getElementById('stock-qty');
      if (inp) inp.value = Math.max(0, Math.round((parseFloat(inp.value) || 0) + +el.dataset.d));
    },
    'stock-save'(el) {
      const id = el.dataset.id;
      const qty = num('stock-qty'); const exp = val('stock-exp');
      if (!(qty >= 0)) { toast('Укажи количество'); return; }
      changeInventory(id, qty - (S.inventory[id] || 0));
      if (S.inventory[id] != null) { if (exp) S.expiry[id] = exp; else delete S.expiry[id]; }
      S.demoInventory = false; S.invVersion++; save(); closeSheet(); render(); toast('Сохранено');
    },
    'inv-del'(el) { delete S.inventory[el.dataset.id]; delete S.expiry[el.dataset.id]; S.invVersion++; save(); closeSheet(); render(); toast('Убрано из холодильника'); },
    'cook-with'(el) { const f = fm()[el.dataset.id]; ui.recQuery = shortName(f); ui.recMore = {}; ui.foodSeg = 'recipes'; closeSheet(); render(); },
    'drop-expired'() {
      Object.keys(S.inventory).forEach((id) => { const d = daysLeft(id); if (d != null && d < 0) { delete S.inventory[id]; delete S.expiry[id]; } });
      S.invVersion++; rebuildPlan(todayStr()); save(); render(); toast('Просроченное убрано, меню пересобрано');
    },
    'calc-meal'(el) { ui.calcMeal = el.dataset.v; renderSheet(false); },
    'calc-toggle'(el) { const id = el.dataset.id; const i = ui.calcSel.indexOf(id); if (i >= 0) ui.calcSel.splice(i, 1); else ui.calcSel.push(id); renderSheet(false); },

    // рецепты
    'rec-filter'(el) { ui.recFilter = el.dataset.f; ui.recMore = {}; render(); },
    'rec-time'(el) { const t = +el.dataset.t; ui.recTime = ui.recTime === t ? 0 : t; ui.recMore = {}; render(); },
    'rec-nocook'() { ui.recNoCook = !ui.recNoCook; ui.recMore = {}; render(); },
    'rec-more'(el) { ui.recMore[el.dataset.g] = true; render(); },
    'rec-pin'(el) {
      const date = todayStr(); const plan = getPlan(date); const i = +el.dataset.i;
      const inv = usableInventory();
      plan.meals.forEach((m, j) => { if (j !== i && !m.eaten) m.items.forEach((it) => { if (inv[it.id] != null) inv[it.id] = Math.max(0, inv[it.id] - it.g); }); });
      const meal = NF.pinRecipe(plan, i, el.dataset.id, targets(), scheduleFor(date), inv, fm(), planOpts(date));
      if (!meal) return;
      plan.meals[i] = meal; ui.justSwapped = i; save(); closeSheet(); render();
      toast('«' + recipeById(el.dataset.id).name + '» — ' + mealLabel(meal).toLowerCase() + ' в ' + meal.time, 3500);
    },
    'rec-shop'(el) {
      const r = recipeById(el.dataset.id); const F = fm();
      const fit = recipeFit(r, F, usableInventory());
      if (!fit || !fit.missing.length) return;
      S.shopExtra = S.shopExtra || {};
      fit.missing.forEach((it) => { S.shopExtra[it.id] = (S.shopExtra[it.id] || 0) + Math.ceil(it.g / 10) * 10; });
      save(); render();
      toast('В покупки: ' + fit.missing.map((it) => shortName(F[it.id])).join(', '));
    },

    // покупки
    'shop-days'(el) { ui.shopDays = +(el.dataset.v || el.dataset.d); ui.shopChecked = {}; render(); },
    'shop-apply'() {
      const ids = Object.keys(ui.shopChecked); if (!ids.length) { toast('Отметь, что купил'); return; }
      ids.forEach((id) => { changeInventory(id, ui.shopChecked[id]); if (S.shopExtra) delete S.shopExtra[id]; });
      S.demoInventory = false; ui.shopChecked = {}; save(); render(); toast('В холодильник: ' + ids.length + ' ' + plural(ids.length, 'продукт', 'продукта', 'продуктов'));
    },
    'shop-copy'() {
      const F = fm();
      const text = 'Покупки NovaFit:\n' + shopList().map((it) => '— ' + F[it.id].name + (F[it.id].en ? ' (' + F[it.id].en + ')' : '') + ': ' + qtyLabel(F[it.id], it.g)).join('\n');
      const done = () => toast('Список скопирован');
      if (NA) { let ok = false; try { ok = NA.copy(text); } catch (e) { ok = false; } if (ok) { done(); return; } }
      try { navigator.clipboard.writeText(text).then(done, () => toast('Не получилось скопировать')); } catch (e) { toast('Не получилось скопировать'); }
    },
    'shop-clear-extra'() { S.shopExtra = {}; save(); render(); },

    // сканер
    'scan-open'(el) { closeSheet(); openScanner(el.dataset.mode || 'stock'); },
    'scan-close'() { closeScanner(); },
    'scan-find'() { const c = val('scan-code').replace(/\D/g, ''); if (!c) { toast('Введи цифры штрихкода'); return; } onScanCode(c); },
    'scan-save'() { saveScan(); },

    // тренировка
    day(el) {
      const d = +el.dataset.d; const i = S.train.days.indexOf(d);
      if (i >= 0) { if (S.train.days.length <= 2) { toast('Минимум 2 тренировки в неделю'); return; } S.train.days.splice(i, 1); } else S.train.days.push(d);
      S.draft = null; save(); render();
    },
    'w-start'(el) { ensureAudio(); S.draft = { key: el.dataset.k, date: todayStr(), sets: {} }; save(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); toast('Поехали! Экран не погаснет до конца тренировки'); },
    'w-cancel'() { S.draft = null; S.timer = null; save(); runTimer(); render(); },
    'w-finish'() {
      const program = currentProgram(); const w = program.find((p) => p.key === S.draft.key);
      const filled = Object.keys(S.draft.sets).some((k) => S.draft.sets[k].some((v) => v > 0));
      if (!filled) { toast('Впиши повторения хотя бы в один подход'); return; }
      S.workouts.push({ date: todayStr(), key: w.key, title: w.title, sets: S.draft.sets });
      S.draft = null; S.timer = null; save(); runTimer(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); toast('Тренировка записана. Отдыхай и ешь по плану');
    },
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

    // прогресс
    'report-week'(el) { ui.reportWeek = Math.max(-4, Math.min(0, ui.reportWeek + +el.dataset.d)); render(); },
    'w-add'() {
      const kg = num('w-kg'); if (!(kg >= 30 && kg <= 250)) { toast('Вес от 30 до 250 кг'); return; }
      const date = todayStr(); const ex = S.weights.find((w) => w.date === date);
      if (ex) ex.kg = kg; else S.weights.push({ date: date, kg: kg });
      S.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
      S.profile.weight = kg;
      runAdaptation(); save(); closeSheet(); render();
      toast(kg >= S.profile.target ? 'Цель достигнута! Поставь новую в настройках' : 'Вес записан: ' + fmtKg(kg) + ' кг');
    },
    'measure-save'() {
      const rec = { date: todayStr() };
      let n = 0, bad = false;
      NF.MEASURES.forEach((m) => { const v = num('ms-' + m.k); if (!isNaN(v)) { if (v < 10 || v > 250) bad = true; rec[m.k] = Math.round(v * 10) / 10; n++; } });
      if (bad) { toast('Значения от 10 до 250 см'); return; }
      if (!n) { toast('Впиши хотя бы талию'); return; }
      const ex = S.measures.find((m) => m.date === rec.date);
      if (ex) Object.assign(ex, rec); else S.measures.push(rec);
      S.measures.sort((a, b) => (a.date < b.date ? -1 : 1));
      save(); closeSheet(); render();
      toast('Замеры сохранены. Следующие — через 2 недели');
    },

    // напоминания и данные
    ics() { downloadICS(); },
    'alarm-settings'() { try { NA.openAlarmSettings(); } catch (e) { /* ignore */ } },
    'rem-test'() { askPermission().then(() => { notify('Проверка NovaFit', 'Так будут выглядеть напоминания', 'nf-test', true); render(); }); },
    export() {
      const text = JSON.stringify(S);
      const done = () => toast('Данные скопированы');
      if (NA) { let ok = false; try { ok = NA.copy(text); } catch (e) { ok = false; } if (ok) done(); else fallbackCopy(text); return; }
      try { navigator.clipboard.writeText(text).then(done, () => { fallbackCopy(text); }); } catch (e) { fallbackCopy(text); }
    },
    'import-toggle'() { ui.importOpen = !ui.importOpen; renderSheet(false); },
    import() {
      try {
        const obj = JSON.parse(val('import-text'));
        if (!obj || obj.v !== 1) throw new Error('bad');
        S = Object.assign(defaults(), obj); ui.importOpen = false; save(); closeSheet(); render(); toast('Данные загружены');
      } catch (e) { toast('Это не данные NovaFit. Скопируй их заново.'); }
    },
    reset() { ui.confirmReset = true; renderSheet(false); },
    'reset-no'() { ui.confirmReset = false; renderSheet(false); },
    'reset-yes'() { S = defaults(); ui.confirmReset = false; closeSheet(); goTab('today'); toast('Все данные удалены'); },
  };

  function fallbackCopy(text) {
    ui.importOpen = true;
    if (ui.sheet && ui.sheet.name === 'data') renderSheet(false); else openSheet('data');
    const ta = document.getElementById('import-text');
    if (ta) { ta.value = text; ta.select(); }
    toast('Выделил данные: скопируй их вручную');
  }

  // ───────────────── события ─────────────────
  // начал вводить цифры штрихкода вручную — камеру выключаем, чтобы она не перебила ввод
  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.id === 'scan-code' && ui.scan) {
      ui.scan.manual = true;
      stopScanCamera();
      const view = document.getElementById('scan-view');
      if (view) view.hidden = true;
      setScanMsg('Введи цифры под штрихкодом и нажми «Найти».');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'scan-code') { e.preventDefault(); ACTIONS['scan-find'](); }
    if (e.key === 'Escape') { if (ui.scan) closeScanner(); else if (ui.sheet) closeSheet(); }
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'rec-search') {
      ui.recQuery = el.value; ui.recMore = {};
      const box = document.getElementById('rec-results');
      if (box) box.innerHTML = recipeResults();
      return;
    }
    if (el.id === 'extra-search') {
      ui.extraSearch = el.value; ui.extraPick = null;
      const box = document.getElementById('extra-results');
      if (box) box.innerHTML = extraResults();
      return;
    }
    if (el.id === 'food-search') {
      ui.search = el.value; ui.addFood = null;
      const box = document.getElementById('search-results');
      if (box) box.innerHTML = searchResults();
      return;
    }
    if (el.dataset.bind === 'set') {
      const id = el.dataset.id, i = +el.dataset.i;
      const arr = (S.draft.sets[id] = S.draft.sets[id] || []);
      const v = parseInt(el.value, 10);
      arr[i] = isNaN(v) ? null : Math.max(0, Math.min(300, v));
      save();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target; const b = el.dataset.bind;
    if (!b) return;
    if (b === 'calc-stock') { ui.calcStock = el.checked; renderSheet(false); }
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
      // счётчик подходов в карточке упражнения — без перерисовки экрана
      const card = el.closest('.ex'); const itc = currentWorkoutItem(el.dataset.id);
      if (card && itc) {
        const n = (S.draft.sets[itc.id] || []).filter((x) => x > 0).length;
        const cnt = card.querySelector('.set-foot .muted'); if (cnt) cnt.textContent = n + ' из ' + itc.sets + ' подходов';
        card.classList.toggle('complete', n >= itc.sets);
      }
    }
    else if (b === 'auto-rest') { S.autoRest = el.checked; save(); }
    else if (b === 'low-appetite') {
      S.lowAppetite = el.checked;
      if (S.profile) rebuildForMode();
      save(); render();
      toast(S.lowAppetite ? 'Режим «Нет аппетита»: 6 приёмов поменьше, меню пересобрано' : 'Обычный режим: 4 приёма пищи');
    }
    else if (b === 'rem-enabled') {
      const on = el.checked;
      (on ? askPermission() : Promise.resolve()).then(() => {
        S.reminders.enabled = on; save(); render();
        toast(on ? (notifState() === 'granted' ? 'Напоминания включены' : 'Напоминания будут внутри приложения') : 'Напоминания выключены');
      });
    }
    else if (b === 'rem') { S.reminders[el.dataset.k] = el.checked; save(); render(); }
    else if (b === 'rem-lead') { S.reminders.lead = +el.value; save(); render(); }
    else if (b === 'shop') { if (el.checked) ui.shopChecked[el.dataset.id] = +el.dataset.g; else delete ui.shopChecked[el.dataset.id]; el.closest('.check-row').classList.toggle('on', el.checked); }
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
    if (ui.errors.length) { ui.profileDraft = p; render(); return; } // введённое остаётся в полях
    ui.profileDraft = null;
    const first = !S.profile;
    S.profile = p;
    if (first) { S.startWeight = p.weight; S.weights = [{ date: todayStr(), kg: p.weight }]; S.tab = 'today'; ui.prevTab = 'today'; }
    else {
      const ex = S.weights.find((w) => w.date === todayStr());
      if (ex) ex.kg = p.weight; else if (!S.weights.length || S.weights[S.weights.length - 1].kg !== p.weight) S.weights.push({ date: todayStr(), kg: p.weight });
    }
    save(); closeSheet(); render(); window.scrollTo({ top: 0, behavior: 'instant' });
    toast(first ? 'Готово! Вот твой день' : 'Сохранено');
  });

  // ───────────────── старт ─────────────────
  checkTimezone();
  if (S.profile) runAdaptation();
  if (S.tab !== 'settings') ui.prevTab = S.tab;
  save();
  render();
  if (S.timer) runTimer();
  // вернулись в приложение: догоняем таймер и напоминания, обновляем «сейчас»
  // (если открыта шторка или идёт ввод — не перерисовываем, чтобы не потерять введённое)
  function onReturn() {
    if (S.timer) runTimer();
    const a = document.activeElement;
    if (!ui.sheet && !ui.scan && !(a && a.matches && a.matches('input, select, textarea'))) render(); else scheduleReminders();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onReturn(); });
  // раз в 5 минут обновляем отметку «сейчас» в ленте дня
  setInterval(() => {
    const a = document.activeElement;
    if (!document.hidden && S.tab === 'today' && !ui.sheet && !ui.scan && !(a && a.matches && a.matches('input, select, textarea'))) render();
  }, 5 * 60000);

  // Android: кнопка «Назад» и возврат в приложение
  window.__nfBack = () => {
    if (ui.scan) { closeScanner(); return true; }
    if (ui.sheet) { closeSheet(); return true; }
    if (S.tab === 'settings') { goTab(ui.prevTab || 'today'); return true; }
    if (S.tab !== 'today') { goTab('today'); return true; }
    return false;
  };
  window.__nfResume = onReturn;

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__NF_EMBED && !NA) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
  }
})();

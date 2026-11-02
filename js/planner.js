/* NovaFit — планировщик питания.
 *  • расписание приёмов пищи по сну;
 *  • подбор граммовок под норму БЖУ (решатель с ограничениями);
 *  • выбор рецептов из того, что есть дома, с приоритетом «доесть остатки»;
 *  • список покупок по нехватке на ближайшие дни.
 */
(function (g) {
  const NF = (g.NF = g.NF || {});

  const MEAL_SHARE = { b: 0.25, l: 0.30, s: 0.15, d: 0.30 };
  const MEAL_ORDER = ['b', 'l', 's', 'd'];

  // ───────── время ─────────
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    return (+m[1] % 24) * 60 + (+m[2] % 60);
  }
  function fromMin(n) {
    n = ((Math.round(n) % 1440) + 1440) % 1440;
    const h = Math.floor(n / 60), m = n % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function sleepMinutes(bed, wake) {
    const b = toMin(bed), w = toMin(wake);
    if (b == null || w == null) return null;
    return (w - b + 1440) % 1440 || 1440;
  }
  function roundTo5(n) { return Math.round(n / 5) * 5; }

  /**
   * Расписание: завтрак через ~40 мин после подъёма, ужин за 3 часа до сна
   * (поздняя еда ухудшает сон), обед и перекус между ними. Если задано время
   * тренировки — перекус ставим за 1,5 ч до неё.
   */
  function mealSchedule(wake, bed, trainTime) {
    const W = toMin(wake) != null ? toMin(wake) : 450;
    let B = toMin(bed) != null ? toMin(bed) : 1410;
    if (B <= W) B += 1440;
    const b = W + 40;
    let d = B - 180;
    if (d - b < 6 * 60) d = Math.min(B - 90, b + 6 * 60); // короткий день — ужин не раньше чем через 6 ч после завтрака
    let l = b + (d - b) * 0.42;
    let s = b + (d - b) * 0.72;
    let note = null;
    let T = toMin(trainTime);
    if (T != null) {
      if (T < W) T += 1440;
      if (T > W && T < B) {
        const pre = T - 90;
        if (pre > l + 120 && pre < d - 45) { s = pre; note = 'Перекус за 1,5 ч до тренировки, ужин после неё.'; }
        else if (T < l) note = 'Тренировка утром: завтрак лёгкий, полноценный обед сразу после.';
        else note = 'Постарайся поесть в течение 1–2 часов после тренировки.';
      }
    }
    l = roundTo5(l); s = roundTo5(s);
    return {
      meals: [
        { type: 'b', time: fromMin(roundTo5(b)), share: MEAL_SHARE.b },
        { type: 'l', time: fromMin(l), share: MEAL_SHARE.l },
        { type: 's', time: fromMin(s), share: MEAL_SHARE.s },
        { type: 'd', time: fromMin(roundTo5(d)), share: MEAL_SHARE.d },
      ],
      note: note,
    };
  }

  // ───────── продукты ─────────
  function allFoods(custom) { return NF.FOODS.concat(custom || []); }
  function foodMap(custom) {
    const m = {};
    allFoods(custom).forEach(function (f) { m[f.id] = f; });
    return m;
  }

  function roundFood(food, grams) {
    if (grams <= 0) return 0;
    if (food.perUnit && (food.unit === 'шт' || food.unit === 'ломтик' || food.unit === 'лист' || food.unit === 'банка')) {
      // половинки допускаем для хлеба/лаваша/банок, яйца — только целые
      const step = food.unit === 'шт' ? 1 : 0.5;
      const units = Math.max(step, Math.round(grams / food.perUnit / step) * step);
      return Math.round(units * food.perUnit);
    }
    if (grams < 30) return Math.max(1, Math.round(grams));
    return roundTo5(grams);
  }

  function macrosOf(items, fm) {
    const t = { kcal: 0, p: 0, f: 0, c: 0 };
    items.forEach(function (it) {
      const f = fm[it.id];
      if (!f) return;
      const k = it.g / 100;
      t.kcal += f.kcal * k; t.p += f.p * k; t.f += f.f * k; t.c += f.c * k;
    });
    return t;
  }

  /**
   * Решатель порций: минимизирует взвешенную относительную ошибку по
   * ккал/Б/Ж/У с границами lo ≤ x ≤ hi (координатный спуск, задача выпуклая).
   * vars: [{food, lo, hi, x0, reg}]
   */
  function solve(vars, target) {
    const keys = ['kcal', 'p', 'f', 'c'];
    const W = { kcal: 2.0, p: 1.5, f: 0.8, c: 0.8 };
    const T = {};
    keys.forEach(function (k) { T[k] = Math.max(1, target[k]); });
    const x = vars.map(function (v) { return Math.min(v.hi, Math.max(v.lo, v.x0 != null ? v.x0 : (v.lo + v.hi) / 2)); });
    const A = vars.map(function (v) { return { kcal: v.food.kcal / 100, p: v.food.p / 100, f: v.food.f / 100, c: v.food.c / 100 }; });
    const sum = {};
    function recompute() {
      keys.forEach(function (k) { sum[k] = 0; });
      x.forEach(function (xi, i) { keys.forEach(function (k) { sum[k] += A[i][k] * xi; }); });
    }
    recompute();
    for (let iter = 0; iter < 300; iter++) {
      let moved = 0;
      for (let i = 0; i < x.length; i++) {
        const v = vars[i];
        let grad = 0, hess = 0;
        keys.forEach(function (k) {
          const w = W[k] / (T[k] * T[k]);
          grad += 2 * w * A[i][k] * (sum[k] - T[k]);
          hess += 2 * w * A[i][k] * A[i][k];
        });
        if (v.reg && v.x0) {
          const r = v.reg / (v.x0 * v.x0);
          grad += 2 * r * (x[i] - v.x0);
          hess += 2 * r;
        }
        if (hess <= 0) continue;
        const nx = Math.min(v.hi, Math.max(v.lo, x[i] - grad / hess));
        const d = nx - x[i];
        if (d !== 0) {
          keys.forEach(function (k) { sum[k] += A[i][k] * d; });
          x[i] = nx;
          moved += Math.abs(d);
        }
      }
      if (moved < 0.05) break;
    }
    return x;
  }

  function fitError(m, target) {
    function rel(a, b) { return b > 0 ? (a - b) / b : 0; }
    return 2 * Math.pow(rel(m.kcal, target.kcal), 2) + 1.5 * Math.pow(rel(m.p, target.p), 2) +
      0.8 * Math.pow(rel(m.f, target.f), 2) + 0.8 * Math.pow(rel(m.c, target.c), 2);
  }

  // ───────── рецепт под цель ─────────
  /**
   * inv — {id: граммы}. mode 'stock' — граммовки не больше запаса,
   * нехватка уходит в missing.
   */
  // Мелкие добавки: если их нет дома, блюдо можно приготовить и без них.
  const MINOR = { sunflower_oil: 1, olive_oil: 1, butter: 1, honey: 1, tomato_paste: 1, smetana: 1, onion: 1, raisins: 1 };

  function fitRecipe(recipe, target, inv, fm, strict) {
    const ings = [];
    const skipped = [];
    recipe.ing.forEach(function (row) {
      const f = fm[row[0]];
      if (!f) return;
      const opt = !!row[2];
      const have = inv[row[0]] || 0;
      if (opt && have < row[1] * 0.6) return; // необязательное — только если есть
      if (!strict && MINOR[row[0]] && have < row[1] * 0.6) { skipped.push(row[0]); return; }
      ings.push({ food: f, base: row[1], opt: opt, have: have });
    });
    const baseItems = ings.map(function (i) { return { id: i.food.id, g: i.base }; });
    const baseM = macrosOf(baseItems, fm);
    const s = Math.min(2.2, Math.max(0.6, target.kcal / Math.max(1, baseM.kcal)));

    const vars = ings.map(function (i) {
      let lo, hi;
      if (i.food.cat === 'veg') { lo = i.base * 0.5; hi = i.base * 1.6; }
      else { lo = i.base * 0.6; hi = i.base * 2.2; }
      hi = Math.min(hi, Math.max(i.food.maxMeal, i.base));
      if (i.food.id === 'eggs') hi = Math.min(hi, 220); // до 4 яиц за приём
      lo = Math.min(lo, hi);
      return { food: i.food, lo: lo, hi: hi, x0: Math.min(hi, Math.max(lo, i.base * s)), reg: 0.15 };
    });
    const x = solve(vars, target);
    const items = [];
    const missing = [];
    vars.forEach(function (v, i) {
      const gr = roundFood(v.food, x[i]);
      if (gr <= 0) return;
      items.push({ id: v.food.id, g: gr });
      const have = inv[v.food.id] || 0;
      if (have < gr) missing.push({ id: v.food.id, g: gr - have });
    });
    const m = macrosOf(items, fm);
    return { recipeId: recipe.id, items: items, missing: missing, skipped: skipped, macros: m, err: fitError(m, target) };
  }

  /** «Тарелка» из того, что лежит дома, если ни один рецепт не собирается. */
  function plateFromStock(type, target, inv, fm, rng, urgency) {
    urgency = urgency || {};
    const avail = Object.keys(inv).filter(function (id) { return fm[id] && inv[id] >= 20; }).map(function (id) { return fm[id]; });
    if (!avail.length) return null;
    function weight(f) { return (inv[f.id] || 0) * (1 + rng() * 0.3) * (1 + (urgency[f.id] || 0) * 4); }
    function byStock(a, b) { return weight(b) - weight(a); }
    function pick(pred) { return avail.filter(pred).sort(byStock)[0]; }
    const light = type === 'b' || type === 's';
    const chosen = [];
    const prot = pick(function (f) { return f.p * 4 / Math.max(1, f.kcal) > 0.35 && (light || f.cat === 'protein' || f.cat === 'dairy'); });
    if (prot) chosen.push(prot);
    const carb = pick(function (f) { return (f.cat === 'carb' || (light && f.cat === 'fruit')) && chosen.indexOf(f) < 0; });
    if (carb) chosen.push(carb);
    const fat = pick(function (f) { return f.cat === 'fat' && chosen.indexOf(f) < 0; });
    if (fat) chosen.push(fat);
    if (!light) {
      const veg = pick(function (f) { return f.cat === 'veg' && f.id !== 'tomato_paste' && chosen.indexOf(f) < 0; });
      if (veg) chosen.push(veg);
    }
    if (!chosen.length) return null;
    const vars = chosen.map(function (f) {
      const hi = Math.min(f.maxMeal, inv[f.id] || 0);
      // в тарелке всегда есть нормальная порция белка и гарнира/овощей
      let lo = 0;
      if (f === prot) lo = Math.min(hi, light ? 40 : 80);
      else if (f.cat === 'veg') lo = Math.min(hi, 100);
      return { food: f, lo: lo, hi: hi, x0: hi / 2 };
    });
    const x = solve(vars, target);
    const items = [];
    // крошечные порции («3 г курицы», «1 г масла») не предлагаем
    vars.forEach(function (v, i) { const gr = Math.min(roundFood(v.food, x[i]), v.hi); if (gr >= (v.food.cat === 'fat' ? 5 : 15)) items.push({ id: v.food.id, g: gr }); });
    if (!items.length) return null;
    const m = macrosOf(items, fm);
    return { recipeId: null, items: items, missing: [], skipped: [], macros: m, err: fitError(m, target) };
  }

  /**
   * Добавка к блюду: если после подгонки не хватает калорий (обычно углеводов),
   * докладываем один продукт из запасов (хлеб, банан, крупа, орехи…).
   */
  function topUp(res, type, target, inv, fm) {
    if (!res || res.macros.kcal >= target.kcal * 0.92) return res;
    const have = {};
    res.items.forEach(function (it) { have[it.id] = 1; });
    const light = type === 'b' || type === 's';
    const ok = light ? { carb: 1, fruit: 1, fat: 1, dairy: 1 } : { carb: 1, fruit: 1, fat: 1, veg: 0 };
    let best = null;
    Object.keys(inv).forEach(function (id) {
      const f = fm[id];
      if (!f || have[id] || !ok[f.cat] || inv[id] < 20 || f.kcal < 50) return;
      if (f.id === 'sunflower_oil' || f.id === 'olive_oil') return; // масло ложкой не едят
      if (!light && (f.id === 'oats' || f.id === 'honey')) return;
      const deficit = target.kcal - res.macros.kcal;
      let gr = Math.min(f.maxMeal, inv[id], (deficit / f.kcal) * 100);
      gr = roundFood(f, gr);
      if (gr > inv[id]) gr = roundFood(f, inv[id] * 0.9);
      if (gr < 10) return;
      const items = res.items.concat([{ id: id, g: gr }]);
      const m = macrosOf(items, fm);
      const e = fitError(m, target);
      if (e < res.err - 0.005 && (!best || e < best.err)) best = { items: items, macros: m, err: e, extra: id };
    });
    if (!best) return res;
    return Object.assign({}, res, best);
  }

  /** Выбор блюда на приём пищи. */
  function pickMeal(type, target, inv, fm, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const avoid = opts.avoid || {};
    const cands = NF.RECIPES.filter(function (r) { return r.meals.indexOf(type) >= 0; }).map(function (r) {
      const res = fitRecipe(r, target, inv, fm, opts.strict);
      const missKcal = res.missing.reduce(function (s, it) { return s + (fm[it.id].kcal * it.g) / 100; }, 0);
      const missShare = missKcal / Math.max(1, res.macros.kcal);
      // «доедаем остатки»: бонус за долю ингредиентов, которые уже есть
      const usedHome = res.items.filter(function (it) { return (inv[it.id] || 0) > 0; }).length / Math.max(1, res.items.length);
      // срочность: блюдо с продуктом, который скоро испортится, поднимается в выборе
      const urg = opts.urgency ? res.items.reduce(function (mx, it) { return Math.max(mx, (opts.urgency[it.id] || 0) * ((inv[it.id] || 0) > 0 ? 1 : 0)); }, 0) : 0;
      res.score = res.err + res.missing.length * 0.35 + missShare * 1.5 - usedHome * 0.25 - urg * 0.9 + (avoid[r.id] || 0) + rng() * 0.12;
      return res;
    });
    cands.sort(function (a, b) { return a.score - b.score; });
    let best = cands[0];
    if (best && best.missing.length && !opts.allowMissing) {
      const plate = plateFromStock(type, target, inv, fm, rng, opts.urgency);
      if (plate && (plate.err < 0.3 || plate.err < best.err + 0.1)) best = plate;
    }
    return topUp(best, type, target, inv, fm);
  }

  // ───────── генератор ─────────
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function targetFor(daily, share) {
    return { kcal: daily.kcal * share, p: daily.protein * share, f: daily.fat * share, c: daily.carbs * share };
  }

  function subtract(inv, items) {
    items.forEach(function (it) { if (inv[it.id] != null) inv[it.id] = Math.max(0, inv[it.id] - it.g); });
  }

  function mealFromRes(type, time, res, light) {
    return {
      type: type, time: time, recipeId: res ? res.recipeId : null, items: res ? res.items : [],
      missing: res ? res.missing : [], skipped: res ? res.skipped : [], extra: res ? res.extra || null : null,
      light: !!light, eaten: false,
    };
  }

  /**
   * Общий раскладчик: распределяет ОСТАТОК дневной нормы по несъеденным
   * приёмам. Каждый следующий приём получает долю от того, что осталось,
   * поэтому недобор/перебор одного блюда (или еда вне плана) компенсируется.
   * inv изменяется (резервирует продукты) — передавай копию.
   * opt: { strict, urgency: {id: 0..1}, extraMacros: {kcal,p,f,c}, keep: [meal|null] }
   */
  function planMeals(date, daily, schedule, inv, fm, recent, seed, opt) {
    opt = opt || {};
    const rng = mulberry32(hashStr(date + ':' + (seed || 0)));
    const avoid = Object.assign({}, recent || {});
    const keep = opt.keep || [];
    const ex = opt.extraMacros || { kcal: 0, p: 0, f: 0, c: 0 };
    const left = { kcal: daily.kcal - ex.kcal, protein: daily.protein - ex.p, fat: daily.fat - ex.f, carbs: daily.carbs - ex.c };
    keep.forEach(function (m) {
      if (!m) return;
      const mm = macrosOf(m.items, fm);
      left.kcal -= mm.kcal; left.protein -= mm.p; left.fat -= mm.f; left.carbs -= mm.c;
      if (m.recipeId) avoid[m.recipeId] = (avoid[m.recipeId] || 0) + 1.5;
    });
    let shareLeft = schedule.meals.reduce(function (s, m, i) { return s + (keep[i] ? 0 : m.share); }, 0);
    const meals = schedule.meals.map(function (slot, i) {
      if (keep[i]) return keep[i];
      const k = Math.min(1, slot.share / Math.max(0.01, shareLeft));
      const base = targetFor(daily, slot.share);
      // норма на день уже почти закрыта — даём лёгкий приём, но не пропуск
      const light = left.kcal * k < base.kcal * 0.5;
      // Нижние границы по макросам: если еда вне плана «съела» почти все жиры,
      // цель 2–3 г жира на приём сделала бы любой нормальный рецепт «ошибкой».
      // Небольшой перебор одного макроса за день безопасен, развал меню — нет.
      const t = light
        ? { kcal: Math.max(150, left.kcal * k), p: Math.max(10, base.p * 0.5, Math.min(base.p, left.protein * k)), f: Math.max(3, base.f * 0.3, Math.min(base.f, left.fat * k)), c: Math.max(15, Math.min(base.c, left.carbs * k)) }
        : { kcal: Math.min(base.kcal * 1.6, left.kcal * k), p: Math.max(base.p * 0.7, Math.min(base.p * 1.6, left.protein * k)), f: Math.max(base.f * 0.5, Math.min(base.f * 1.6, left.fat * k)), c: Math.max(base.c * 0.5, Math.min(base.c * 1.6, left.carbs * k)) };
      shareLeft -= slot.share;
      const res = pickMeal(slot.type, t, inv, fm, { rng: rng, avoid: avoid, strict: opt.strict, urgency: opt.urgency });
      if (res && res.recipeId) avoid[res.recipeId] = (avoid[res.recipeId] || 0) + 1.5;
      if (res) {
        subtract(inv, res.items);
        left.kcal -= res.macros.kcal; left.protein -= res.macros.p; left.fat -= res.macros.f; left.carbs -= res.macros.c;
      }
      return mealFromRes(slot.type, slot.time, res, light);
    });
    return { date: date, meals: meals, seed: seed || 0 };
  }

  /** План дня с нуля. */
  function planDay(date, daily, schedule, inv, fm, recent, seed, strict, opt) {
    return planMeals(date, daily, schedule, inv, fm, recent, seed, Object.assign({}, opt || {}, { strict: strict }));
  }

  /**
   * Пересобрать несъеденные приёмы с учётом съеденного и еды вне плана.
   * Съеденные приёмы сохраняются как есть.
   */
  function planRest(plan, daily, schedule, inv, fm, recent, seed, opt) {
    const keep = plan.meals.map(function (m) { return m.eaten ? m : null; });
    const res = planMeals(plan.date, daily, schedule, inv, fm, recent, seed, Object.assign({}, opt || {}, { keep: keep }));
    // время приёмов берём из текущего расписания, у съеденных — фактическое
    res.meals.forEach(function (m, i) { if (!m.eaten && schedule.meals[i]) m.time = schedule.meals[i].time; });
    return res;
  }

  function replanMeal(plan, idx, daily, schedule, inv, fm, recent, seed, opt) {
    opt = opt || {};
    const ex = opt.extraMacros || { kcal: 0, p: 0, f: 0, c: 0 };
    const rng = mulberry32(hashStr(plan.date + ':' + idx + ':' + seed));
    const avoid = Object.assign({}, recent || {});
    plan.meals.forEach(function (m, i) { if (i !== idx && m.recipeId) avoid[m.recipeId] = (avoid[m.recipeId] || 0) + 1.5; });
    const cur = plan.meals[idx];
    if (cur.recipeId) avoid[cur.recipeId] = (avoid[cur.recipeId] || 0) + 3;
    const slot = schedule.meals[idx];
    // цель = остаток дня после остальных приёмов (в разумных пределах от доли)
    const base = targetFor(daily, slot.share);
    const others = macrosOf([].concat.apply([], plan.meals.filter(function (_, i) { return i !== idx; }).map(function (m) { return m.items; })), fm);
    const rest = { kcal: daily.kcal - others.kcal - ex.kcal, p: daily.protein - others.p - ex.p, f: daily.fat - others.f - ex.f, c: daily.carbs - others.c - ex.c };
    const t = {};
    const light = rest.kcal < base.kcal * 0.5;
    ['kcal', 'p', 'f', 'c'].forEach(function (k) { t[k] = Math.min(base[k] * 1.5, Math.max(light ? (k === 'kcal' ? 0 : base[k] * 0.3) : base[k] * 0.6, rest[k])); });
    t.kcal = Math.max(150, t.kcal); t.p = Math.max(10, t.p); t.f = Math.max(3, t.f); t.c = Math.max(15, t.c);
    const res = pickMeal(slot.type, t, inv, fm, { rng: rng, avoid: avoid, urgency: opt.urgency });
    return mealFromRes(slot.type, cur.time, res, light);
  }

  /** Список покупок: прогоняем план на N дней по виртуальному складу. */
  function shoppingList(startDate, days, daily, schedule, inventory, fm, recent) {
    const inv = Object.assign({}, inventory);
    const need = {};
    const rec = Object.assign({}, recent || {});
    for (let d = 0; d < days; d++) {
      const date = new Date(new Date(startDate + 'T12:00:00').getTime() + d * 864e5).toISOString().slice(0, 10);
      const plan = planDay(date, daily, schedule, inv, fm, rec, 0, true);
      plan.meals.forEach(function (m) {
        m.missing.forEach(function (it) { need[it.id] = (need[it.id] || 0) + it.g; });
        if (m.recipeId) rec[m.recipeId] = (rec[m.recipeId] || 0) + 1;
      });
    }
    return Object.keys(need).map(function (id) {
      const f = fm[id];
      // округляем до удобной упаковки
      let gr = need[id];
      if (f.perUnit) gr = Math.ceil(gr / f.perUnit) * f.perUnit;
      else gr = gr < 100 ? Math.ceil(gr / 10) * 10 : Math.ceil(gr / 50) * 50;
      return { id: id, g: gr };
    }).sort(function (a, b) { return fm[a.id].cat < fm[b.id].cat ? -1 : fm[a.id].cat > fm[b.id].cat ? 1 : b.g - a.g; });
  }

  /** Калькулятор: сколько граммов выбранных продуктов съесть на приём. */
  function portionCalc(ids, target, inv, fm, limitToStock) {
    const vars = ids.map(function (id) {
      const f = fm[id];
      let hi = f.maxMeal;
      if (limitToStock) hi = Math.min(hi, inv[id] || 0);
      return { food: f, lo: 0, hi: hi, x0: hi / 3 };
    }).filter(function (v) { return v.hi > 0; });
    const x = solve(vars, target);
    const items = vars.map(function (v, i) { return { id: v.food.id, g: Math.min(v.hi, roundFood(v.food, x[i])) }; }).filter(function (it) { return it.g > 0; });
    return { items: items, macros: macrosOf(items, fm) };
  }

  NF.MEAL_SHARE = MEAL_SHARE;
  NF.MEAL_ORDER = MEAL_ORDER;
  NF.toMin = toMin;
  NF.fromMin = fromMin;
  NF.sleepMinutes = sleepMinutes;
  NF.mealSchedule = mealSchedule;
  NF.foodMap = foodMap;
  NF.allFoods = allFoods;
  NF.roundFood = roundFood;
  NF.macrosOf = macrosOf;
  NF.solve = solve;
  NF.fitRecipe = fitRecipe;
  NF.pickMeal = pickMeal;
  NF.planDay = planDay;
  NF.planRest = planRest;
  NF.replanMeal = replanMeal;
  NF.shoppingList = shoppingList;
  NF.portionCalc = portionCalc;
  NF.targetFor = targetFor;
})(typeof window !== 'undefined' ? window : globalThis);

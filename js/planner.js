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

  function slotAt(type, min, share, label) { return { type: type, time: fromMin(roundTo5(min)), share: share, label: label }; }

  /**
   * Расписание: завтрак через ~40 мин после подъёма, ужин за 3 часа до сна
   * (поздняя еда ухудшает сон), обед и перекус между ними. Если задано время
   * тренировки — перекус ставим за 1,5 ч до неё.
   * mode 'six' (режим «нет аппетита»): 6 приёмов поменьше — завтрак, перекус,
   * обед, перекус, ужин и белковый перекус за 1–1,5 ч до сна.
   */
  function mealSchedule(wake, bed, trainTime, mode) {
    const W = toMin(wake) != null ? toMin(wake) : 450;
    let B = toMin(bed) != null ? toMin(bed) : 1410;
    if (B <= W) B += 1440;
    const b = W + 40;
    let d = B - 180;
    if (d - b < 6 * 60) d = Math.min(B - 90, b + 6 * 60); // короткий день — ужин не раньше чем через 6 ч после завтрака
    let note = null;
    let T = toMin(trainTime);
    if (T != null) { if (T < W) T += 1440; if (!(T > W && T < B)) T = null; }

    if (mode === 'six') {
      const s1 = b + (d - b) * 0.25, l = b + (d - b) * 0.5;
      let s2 = b + (d - b) * 0.78;
      let late = Math.max(d + 60, B - 75);
      if (late > B - 30) late = null; // слишком близко ко сну — без позднего перекуса
      if (T != null) {
        const pre = T - 90;
        if (pre > l + 90 && pre < d - 45) { s2 = pre; note = 'Перекус за 1,5 ч до тренировки, ужин после неё.'; }
        else if (T < l) note = 'Тренировка утром: завтрак лёгкий, полноценный обед сразу после.';
        else note = 'Постарайся поесть в течение 1–2 часов после тренировки.';
      }
      const meals = [
        slotAt('b', b, 0.20, 'Завтрак'), slotAt('s', s1, 0.12, 'Перекус'), slotAt('l', l, 0.23, 'Обед'),
        slotAt('s', s2, 0.13, 'Перекус'), slotAt('d', d, 0.20, 'Ужин'),
      ];
      if (late != null) { const n = slotAt('s', late, 0.12, 'Перед сном'); n.night = true; meals.push(n); }
      const total = meals.reduce(function (sum, m) { return sum + m.share; }, 0);
      meals.forEach(function (m) { m.share = m.share / total; });
      return { meals: meals, note: note, mode: 'six' };
    }

    let l = b + (d - b) * 0.42;
    let sn = b + (d - b) * 0.72;
    if (T != null) {
      const pre = T - 90;
      if (pre > l + 120 && pre < d - 45) { sn = pre; note = 'Перекус за 1,5 ч до тренировки, ужин после неё.'; }
      else if (T < l) note = 'Тренировка утром: завтрак лёгкий, полноценный обед сразу после.';
      else note = 'Постарайся поесть в течение 1–2 часов после тренировки.';
    }
    return {
      meals: [
        slotAt('b', b, MEAL_SHARE.b, 'Завтрак'),
        slotAt('l', l, MEAL_SHARE.l, 'Обед'),
        slotAt('s', sn, MEAL_SHARE.s, 'Перекус'),
        slotAt('d', d, MEAL_SHARE.d, 'Ужин'),
      ],
      note: note,
      mode: 'four',
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
  // Мелкие добавки: если их нет дома, блюдо можно приготовить и без них.
  const MINOR = { sunflower_oil: 1, olive_oil: 1, butter: 1, honey: 1, tomato_paste: 1, smetana: 1, onion: 1, raisins: 1 };

  /** Граммы замены: белковые продукты пересчитываем по белку, остальные — по калориям. */
  function subGrams(base, from, to) {
    let g;
    const sameKind = (from.cat === 'veg' && to.cat === 'veg') || (from.cat === 'fruit' && to.cat === 'fruit');
    const kcalRatio = Math.max(from.kcal, to.kcal) / Math.max(1, Math.min(from.kcal, to.kcal));
    if (sameKind && kcalRatio < 2) g = base;
    else if ((from.cat === 'protein' || from.cat === 'dairy') && from.p >= 8 && to.p >= 5) g = base * from.p / to.p;
    else g = base * from.kcal / Math.max(1, to.kcal);
    return Math.max(base * 0.5, Math.min(base * 2.5, g));
  }

  /**
   * Что из рецепта есть дома: сам продукт, его замена (NF.SUBS) или нехватка.
   * ings: [{food, base, opt, sub: id заменённого продукта | null, missing}], skipped: [id].
   * strict (список покупок): мелкие добавки не пропускаются, а покупаются.
   */
  function resolveRecipe(recipe, inv, fm, strict) {
    const used = {};
    recipe.ing.forEach(function (row) { used[row[0]] = 1; });
    const ings = [], skipped = [];
    recipe.ing.forEach(function (row) {
      const f = fm[row[0]];
      if (!f) return;
      const base = row[1], opt = !!row[2];
      if ((inv[f.id] || 0) >= base * 0.6) { ings.push({ food: f, base: base, opt: opt, sub: null, missing: false }); return; }
      if (opt) return; // необязательное — только если есть
      const subs = (NF.SUBS && NF.SUBS[f.id]) || [];
      for (let i = 0; i < subs.length; i++) {
        const sf = fm[subs[i]];
        if (!sf || used[sf.id]) continue;
        const sb = subGrams(base, f, sf);
        if ((inv[sf.id] || 0) >= sb * 0.6) {
          used[sf.id] = 1;
          ings.push({ food: sf, base: sb, opt: false, sub: f.id, missing: false });
          return;
        }
      }
      if (!strict && MINOR[f.id]) { skipped.push(f.id); return; }
      ings.push({ food: f, base: base, opt: false, sub: null, missing: true });
    });
    return { ings: ings, skipped: skipped };
  }

  /**
   * Подогнать рецепт под цель приёма пищи. inv — {id: граммы} (то, что есть дома);
   * нехватка уходит в missing, замены — в subs. opt.dense — режим «нет аппетита»
   * (меньше овощей: они занимают место в желудке).
   */
  function fitRecipe(recipe, target, inv, fm, strict, opt) {
    opt = opt || {};
    const rs = resolveRecipe(recipe, inv, fm, strict);
    const baseM = macrosOf(rs.ings.map(function (i) { return { id: i.food.id, g: i.base }; }), fm);
    const s = Math.min(2.2, Math.max(0.6, target.kcal / Math.max(1, baseM.kcal)));
    const vars = rs.ings.map(function (i) {
      let lo, hi;
      if (i.food.cat === 'veg') { lo = i.base * (opt.dense ? 0.4 : 0.5); hi = i.base * (opt.dense ? 1.0 : 1.6); }
      else { lo = i.base * 0.6; hi = i.base * 2.2; }
      hi = Math.min(hi, Math.max(i.food.maxMeal, i.base));
      if (i.food.id === 'eggs') hi = Math.min(hi, 220); // до 4 яиц за приём
      lo = Math.min(lo, hi);
      return { food: i.food, lo: lo, hi: hi, x0: Math.min(hi, Math.max(lo, i.base * s)), reg: 0.15, ing: i };
    });
    const x = solve(vars, target);
    const items = [], missing = [], subs = [];
    vars.forEach(function (v, k) {
      const gr = roundFood(v.food, x[k]);
      if (gr <= 0) return;
      const it = { id: v.food.id, g: gr };
      if (v.ing.sub) { it.sub = v.ing.sub; subs.push({ from: v.ing.sub, to: v.food.id }); }
      items.push(it);
      const have = inv[v.food.id] || 0;
      if (have < gr) missing.push({ id: v.food.id, g: gr - have });
    });
    const m = macrosOf(items, fm);
    return { recipeId: recipe.id, items: items, missing: missing, skipped: rs.skipped, subs: subs, macros: m, err: fitError(m, target) };
  }

  /** «Тарелка» из того, что лежит дома, если ни один рецепт не собирается. */
  function plateFromStock(type, target, inv, fm, rng, urgency, night) {
    urgency = urgency || {};
    const avail = Object.keys(inv).filter(function (id) { return fm[id] && !fm[id].noplan && inv[id] >= 20; }).map(function (id) { return fm[id]; });
    if (!avail.length) return null;
    function weight(f) { return (inv[f.id] || 0) * (1 + rng() * 0.3) * (1 + (urgency[f.id] || 0) * 4); }
    function byStock(a, b) { return weight(b) - weight(a); }
    function pick(pred) { return avail.filter(pred).sort(byStock)[0]; }
    const light = type === 'b' || type === 's';
    const chosen = [];
    const isProt = function (f) { return f.p * 4 / Math.max(1, f.kcal) > 0.35 && (light || f.cat === 'protein' || f.cat === 'dairy'); };
    // перед сном — молочный белок (творог, кефир, йогурт): он усваивается медленно
    const prot = (night && pick(function (f) { return isProt(f) && f.cat === 'dairy'; })) || pick(isProt);
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
    return { recipeId: null, items: items, missing: [], skipped: [], subs: [], macros: m, err: fitError(m, target) };
  }

  /**
   * Добавка к блюду: если после подгонки не хватает калорий (обычно углеводов),
   * докладываем один продукт из запасов (хлеб, банан, крупа, орехи…).
   * dense (режим «нет аппетита»): только плотные добавки без объёма — орехи,
   * арахисовая паста, сыр, сухофрукты, а к обеду и ужину — ложка масла в гарнир.
   */
  // Продукты, которые нужно варить/запекать: добавкой «как есть» не годятся.
  const NEEDS_COOK = { buckwheat: 1, rice: 1, pasta: 1, bulgur: 1, quinoa: 1, couscous: 1, rice_noodles: 1, lentils: 1, chickpeas: 1, potato: 1, sweet_potato: 1 };

  function topUp(res, type, target, inv, fm, dense) {
    if (!res || res.macros.kcal >= target.kcal * 0.92) return res;
    const have = {};
    res.items.forEach(function (it) { have[it.id] = 1; });
    const light = type === 'b' || type === 's';
    const ok = light ? { carb: 1, fruit: 1, fat: 1, dairy: 1 } : { carb: 1, fruit: 1, fat: 1, veg: 0, dairy: dense ? 1 : 0 };
    let best = null;
    Object.keys(inv).forEach(function (id) {
      const f = fm[id];
      if (!f || f.noplan || have[id] || !ok[f.cat] || inv[id] < 20 || f.kcal < 50) return;
      const oil = f.id === 'sunflower_oil' || f.id === 'olive_oil' || f.id === 'butter';
      if (oil && !(dense && !light)) return; // масло ложкой не едят — только в гарнир в режиме «нет аппетита»
      if (dense && f.kcal < 270) return;
      if (!light && (f.id === 'oats' || f.id === 'honey')) return;
      const cook = !!NEEDS_COOK[f.id];
      if (cook && light) return; // сухую крупу к бутерброду не добавишь
      const deficit = target.kcal - res.macros.kcal;
      const cap = oil ? 15 : f.maxMeal;
      let gr = Math.min(cap, inv[id], (deficit / f.kcal) * 100);
      gr = roundFood(f, gr);
      if (gr > inv[id]) gr = roundFood(f, inv[id] * 0.9);
      if (gr < (oil ? 5 : cook ? (f.kcal > 200 ? 40 : 120) : 10)) return; // гарнир — так гарнир
      const items = res.items.concat([{ id: id, g: gr }]);
      const m = macrosOf(items, fm);
      const e = fitError(m, target);
      if (e < res.err - 0.005 && (!best || e < best.err)) best = { items: items, macros: m, err: e, extra: id, extraDense: !!dense };
    });
    if (!best) return res;
    return Object.assign({}, res, best);
  }

  function hasTag(r, t) { return !!(r.tags && r.tags.indexOf(t) >= 0); }

  /**
   * Продукт «из названия» блюда: заменить его — значит приготовить другое блюдо
   * («Лосось с рисом» из курицы). Такие замены допустимы, но в автоплане
   * идут в самый конец; на экране рецептов они помечаются.
   */
  // Как главный продукт называют в названиях блюд (основы слов).
  const TITLE_ALIASES = {
    fish_white: ['рыб'], salmon: ['рыб', 'лосос'], tuna_can: ['тунц', 'тунец'], shrimp: ['кревет'],
    chicken_breast: ['кур'], chicken_thigh: ['кур'], turkey: ['индейк'], beef: ['говяд', 'бефстроганов', 'гуляш'],
    pork: ['свин'], minced_beef: ['фарш', 'котлет', 'тефтел', 'болоньез'], eggs: ['яйц', 'омлет', 'скрэмбл', 'яичн', 'шакшук'],
    cottage5: ['творог', 'сырник', 'запеканк'], cottage9: ['творог', 'сырник', 'запеканк'], cheese: ['сыр'],
    mozzarella: ['моцарелл', 'капрезе', 'пицц'], tofu: ['тофу'],
  };

  function isTitleIngredient(recipe, foodId, fm) {
    const f = fm[foodId];
    if (!f) return false;
    const title = recipe.name.toLowerCase().replace(/ё/g, 'е');
    const words = f.name.toLowerCase().replace(/ё/g, 'е').replace(/\(.*?\)/g, ' ').split(/[^a-zа-я]+/).filter(function (w) { return w.length >= 3; });
    // первое значимое слово названия продукта (+ варианты через «/»)
    const keys = [words[0]].concat(f.name.indexOf('/') >= 0 ? words.slice(1) : []);
    // основа слова без окончания: «перец» → «пер» (найдёт «перцы»), «гречка» → «греч»
    if (keys.some(function (w) { return w && title.indexOf(w.slice(0, w.length <= 5 ? 3 : 4)) >= 0; })) return true;
    return (TITLE_ALIASES[foodId] || []).some(function (a) { return title.indexOf(a) >= 0; });
  }

  /** Выбор блюда на приём пищи. */
  function pickMeal(type, target, inv, fm, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const avoid = opts.avoid || {};
    const cands = NF.RECIPES.filter(function (r) { return r.meals.indexOf(type) >= 0; }).map(function (r) {
      const res = fitRecipe(r, target, inv, fm, opts.strict, { dense: opts.dense });
      const missKcal = res.missing.reduce(function (s, it) { return s + (fm[it.id].kcal * it.g) / 100; }, 0);
      const missShare = missKcal / Math.max(1, res.macros.kcal);
      // «доедаем остатки»: бонус за долю ингредиентов, которые уже есть
      const usedHome = res.items.filter(function (it) { return (inv[it.id] || 0) > 0; }).length / Math.max(1, res.items.length);
      // срочность: блюдо с продуктом, который скоро испортится, поднимается в выборе
      const urg = opts.urgency ? res.items.reduce(function (mx, it) { return Math.max(mx, (opts.urgency[it.id] || 0) * ((inv[it.id] || 0) > 0 ? 1 : 0)); }, 0) : 0;
      let bonus = 0;
      if (opts.dense) {
        // «нет аппетита»: больше калорий в меньшем объёме, на перекус — жидкие калории
        const grams = res.items.reduce(function (sum, it) { return sum + it.g; }, 0);
        const density = res.macros.kcal / Math.max(1, grams);
        bonus += 0.35 * Math.max(0, Math.min(1, (density - 1.0) / 1.5));
        if (type === 's' && hasTag(r, 'liquid')) bonus += 0.2;
      }
      if (opts.night) bonus += hasTag(r, 'night') ? 0.5 : -0.3;
      // замена продукта из названия («Рыба с рисом» из курицы) — другое блюдо: только если иначе никак;
      // штраф сильнее бонуса за скоропортящееся, поэтому сначала берутся «честные» рецепты
      const subPenalty = res.subs.reduce(function (sum, sb) { return sum + (isTitleIngredient(r, sb.from, fm) ? 1.2 : 0.08); }, 0);
      res.score = res.err + res.missing.length * 0.35 + missShare * 1.5 - usedHome * 0.25 - urg * 0.9 +
        subPenalty - bonus + (avoid[r.id] || 0) + rng() * 0.12;
      return res;
    });
    cands.sort(function (a, b) { return a.score - b.score; });
    let best = cands[0];
    if (best && best.missing.length && !opts.allowMissing) {
      const plate = plateFromStock(type, target, inv, fm, rng, opts.urgency, opts.night);
      if (plate && (plate.err < 0.3 || plate.err < best.err + 0.1)) best = plate;
    }
    return topUp(best, type, target, inv, fm, opts.dense);
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

  function mealFromRes(slot, time, res, light) {
    return {
      type: slot.type, time: time, label: slot.label || NF.MEAL_LABEL[slot.type], night: !!slot.night,
      recipeId: res ? res.recipeId : null, items: res ? res.items : [],
      missing: res ? res.missing : [], skipped: res ? res.skipped : [],
      extra: res ? res.extra || null : null, extraDense: !!(res && res.extraDense),
      light: !!light, eaten: false,
    };
  }

  function recipeById(id) {
    for (let i = 0; i < NF.RECIPES.length; i++) if (NF.RECIPES[i].id === id) return NF.RECIPES[i];
    return null;
  }

  /**
   * Общий раскладчик: распределяет ОСТАТОК дневной нормы по несъеденным
   * приёмам. Каждый следующий приём получает долю от того, что осталось,
   * поэтому недобор/перебор одного блюда (или еда вне плана) компенсируется.
   * inv изменяется (резервирует продукты) — передавай копию.
   * opt: { strict, urgency: {id: 0..1}, extraMacros: {kcal,p,f,c}, keep: [meal|null],
   *        pinned: {индекс: id рецепта}, dense }
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
      const pinRec = opt.pinned && opt.pinned[i] ? recipeById(opt.pinned[i]) : null;
      const res = pinRec
        ? fitRecipe(pinRec, t, inv, fm, opt.strict, { dense: opt.dense })
        : pickMeal(slot.type, t, inv, fm, { rng: rng, avoid: avoid, strict: opt.strict, urgency: opt.urgency, dense: opt.dense, night: slot.night });
      if (res && res.recipeId) avoid[res.recipeId] = (avoid[res.recipeId] || 0) + 1.5;
      if (res) {
        subtract(inv, res.items);
        left.kcal -= res.macros.kcal; left.protein -= res.macros.p; left.fat -= res.macros.f; left.carbs -= res.macros.c;
      }
      const meal = mealFromRes(slot, slot.time, res, light);
      if (pinRec) meal.pinned = true;
      return meal;
    });
    return { date: date, meals: meals, seed: seed || 0, mode: schedule.mode || 'four' };
  }

  /** План дня с нуля. */
  function planDay(date, daily, schedule, inv, fm, recent, seed, strict, opt) {
    return planMeals(date, daily, schedule, inv, fm, recent, seed, Object.assign({}, opt || {}, { strict: strict }));
  }

  /**
   * Пересобрать несъеденные приёмы с учётом съеденного и еды вне плана.
   * Съеденные приёмы сохраняются как есть, закреплённые рецепты — подгоняются заново.
   */
  function planRest(plan, daily, schedule, inv, fm, recent, seed, opt) {
    const same = plan.meals.length === schedule.meals.length;
    const keep = same ? plan.meals.map(function (m) { return m.eaten ? m : null; }) : [];
    const pinned = {};
    if (same) plan.meals.forEach(function (m, i) { if (!m.eaten && m.pinned && m.recipeId) pinned[i] = m.recipeId; });
    const res = planMeals(plan.date, daily, schedule, inv, fm, recent, seed, Object.assign({}, opt || {}, { keep: keep, pinned: pinned }));
    // время приёмов берём из текущего расписания, у съеденных — фактическое
    res.meals.forEach(function (m, i) { if (!m.eaten && schedule.meals[i]) m.time = schedule.meals[i].time; });
    return res;
  }

  /** Цель одного приёма = остаток дня после остальных приёмов (в разумных пределах от доли). */
  function slotTarget(plan, idx, daily, schedule, fm, opt) {
    const ex = (opt && opt.extraMacros) || { kcal: 0, p: 0, f: 0, c: 0 };
    const slot = schedule.meals[idx];
    const base = targetFor(daily, slot.share);
    const others = macrosOf([].concat.apply([], plan.meals.filter(function (_, i) { return i !== idx; }).map(function (m) { return m.items; })), fm);
    const rest = { kcal: daily.kcal - others.kcal - ex.kcal, p: daily.protein - others.p - ex.p, f: daily.fat - others.f - ex.f, c: daily.carbs - others.c - ex.c };
    const t = {};
    const light = rest.kcal < base.kcal * 0.5;
    ['kcal', 'p', 'f', 'c'].forEach(function (k) { t[k] = Math.min(base[k] * 1.5, Math.max(light ? (k === 'kcal' ? 0 : base[k] * 0.3) : base[k] * 0.6, rest[k])); });
    t.kcal = Math.max(150, t.kcal); t.p = Math.max(10, t.p); t.f = Math.max(3, t.f); t.c = Math.max(15, t.c);
    return { t: t, light: light, slot: slot };
  }

  function replanMeal(plan, idx, daily, schedule, inv, fm, recent, seed, opt) {
    opt = opt || {};
    const rng = mulberry32(hashStr(plan.date + ':' + idx + ':' + seed));
    const avoid = Object.assign({}, recent || {});
    plan.meals.forEach(function (m, i) { if (i !== idx && m.recipeId) avoid[m.recipeId] = (avoid[m.recipeId] || 0) + 1.5; });
    const cur = plan.meals[idx];
    if (cur.recipeId) avoid[cur.recipeId] = (avoid[cur.recipeId] || 0) + 3;
    const st = slotTarget(plan, idx, daily, schedule, fm, opt);
    const res = pickMeal(st.slot.type, st.t, inv, fm, { rng: rng, avoid: avoid, urgency: opt.urgency, dense: opt.dense, night: st.slot.night });
    return mealFromRes(st.slot, cur.time, res, st.light);
  }

  /** Поставить выбранный рецепт на приём пищи (граммовки — под остаток нормы). */
  function pinRecipe(plan, idx, recipeId, daily, schedule, inv, fm, opt) {
    opt = opt || {};
    const r = recipeById(recipeId);
    if (!r) return null;
    const st = slotTarget(plan, idx, daily, schedule, fm, opt);
    const res = fitRecipe(r, st.t, inv, fm, false, { dense: opt.dense });
    const meal = mealFromRes(st.slot, plan.meals[idx].time, res, st.light);
    meal.pinned = true;
    return meal;
  }

  /** Список покупок: прогоняем план на N дней по виртуальному складу. */
  function shoppingList(startDate, days, daily, schedule, inventory, fm, recent, opt) {
    const inv = Object.assign({}, inventory);
    const need = {};
    const rec = Object.assign({}, recent || {});
    for (let d = 0; d < days; d++) {
      const date = new Date(new Date(startDate + 'T12:00:00').getTime() + d * 864e5).toISOString().slice(0, 10);
      const plan = planDay(date, daily, schedule, inv, fm, rec, 0, true, opt);
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
  NF.resolveRecipe = resolveRecipe;
  NF.isTitleIngredient = isTitleIngredient;
  NF.subGrams = subGrams;
  NF.pinRecipe = pinRecipe;
  NF.slotTarget = slotTarget;
  NF.pickMeal = pickMeal;
  NF.planDay = planDay;
  NF.planRest = planRest;
  NF.replanMeal = replanMeal;
  NF.shoppingList = shoppingList;
  NF.portionCalc = portionCalc;
  NF.targetFor = targetFor;
})(typeof window !== 'undefined' ? window : globalThis);

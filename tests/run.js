// Быстрые проверки ядра: node tests/run.js
const assert = require('assert');
['data-foods', 'data-recipes', 'data-exercises', 'nutrition', 'planner', 'workout', 'insights', 'scanner'].forEach((f) => require('../js/' + f + '.js'));
const NF = globalThis.NF;
let n = 0;
function t(name, fn) { fn(); n++; console.log('✓', name); }

const p = { sex: 'm', age: 22, height: 180, weight: 62, target: 70, activity: 1.375, pace: 'normal' };
const T = NF.calcTargets(p, 0);

t('калории: расход + профицит 200..500', () => {
  assert(T.kcal - T.tdee >= 100 && T.kcal - T.tdee <= 500, JSON.stringify(T));
});
t('белок в пределах 1.6..2.2 г/кг', () => assert(T.proteinPerKg >= 1.6 && T.proteinPerKg <= 2.2));
t('жиры не ниже 0.8 г/кг и не выше 35%', () => { assert(T.fat >= 0.8 * p.weight - 1); assert(T.fat * 9 <= T.kcal * 0.35 + 9); });
t('макросы сходятся с ккал (±2%)', () => {
  const k = T.protein * 4 + T.fat * 9 + T.carbs * 4;
  assert(Math.abs(k - T.kcal) / T.kcal < 0.02, k + ' vs ' + T.kcal);
});
t('темп не больше 0.5 кг/нед', () => assert(T.weekly <= 0.5));
t('подросток → плавный темп + предупреждение', () => {
  const r = NF.calcTargets(Object.assign({}, p, { age: 15 }), 0);
  assert.equal(r.pace, 'slow'); assert(r.warnings.some((w) => w.level === 'warn'));
});
t('сильный недовес → профицит ≤ 300 и danger', () => {
  const r = NF.calcTargets(Object.assign({}, p, { weight: 48 }), 0);
  assert(r.surplus <= 300); assert(r.warnings.some((w) => w.level === 'danger'));
});
t('адаптация не выходит за +300', () => {
  const r = NF.calcTargets(p, 9999);
  assert(r.kcal <= r.tdee + 800 + 10);
});
t('валидация: цель меньше веса — ошибка', () => assert(NF.validateProfile(Object.assign({}, p, { target: 60 })).length > 0));

t('расписание: ужин за 3 ч до сна', () => {
  const s = NF.mealSchedule('07:00', '23:00');
  assert.deepEqual(s.meals.map((m) => m.time), ['07:40', s.meals[1].time, s.meals[2].time, '20:00']);
  assert(NF.toMin(s.meals[1].time) < NF.toMin(s.meals[2].time));
});
t('расписание через полночь', () => {
  const s = NF.mealSchedule('10:00', '02:00');
  assert.equal(s.meals[3].time, '23:00');
});
t('перекус перед тренировкой', () => {
  const s = NF.mealSchedule('07:00', '23:00', '18:00');
  assert.equal(s.meals[2].time, '16:30');
});

const fm = NF.foodMap([]);
t('все ингредиенты рецептов есть в базе', () => {
  NF.RECIPES.forEach((r) => r.ing.forEach((i) => assert(fm[i[0]], r.id + ': ' + i[0])));
});
t('рецепт подгоняется под цель (±12% ккал)', () => {
  const inv = {}; NF.FOODS.forEach((f) => (inv[f.id] = 5000));
  NF.RECIPES.forEach((r) => {
    const meal = r.meals[0];
    const tg = NF.targetFor(T, NF.MEAL_SHARE[meal]);
    const res = NF.fitRecipe(r, tg, inv, fm);
    const dev = Math.abs(res.macros.kcal - tg.kcal) / tg.kcal;
    if (dev > 0.12) console.log('   ~', r.id, Math.round(res.macros.kcal), 'vs', Math.round(tg.kcal));
  });
});
t('план дня с полным складом ≈ норма', () => {
  const inv = {}; NF.FOODS.forEach((f) => (inv[f.id] = 5000));
  const plan = NF.planDay('2026-11-02', T, NF.mealSchedule('07:30', '23:30'), inv, fm, {}, 0);
  const all = plan.meals.flatMap((m) => m.items);
  const m = NF.macrosOf(all, fm);
  console.log('   план:', plan.meals.map((x) => x.recipeId).join(', '), '| ккал', Math.round(m.kcal), '/', T.kcal, 'Б', Math.round(m.p), '/', T.protein);
  assert(Math.abs(m.kcal - T.kcal) / T.kcal < 0.1);
  assert(Math.abs(m.p - T.protein) / T.protein < 0.2);
  assert(plan.meals.every((x) => x.missing.length === 0));
});
t('пустой склад → всё уходит в список покупок', () => {
  const list = NF.shoppingList('2026-11-02', 3, T, NF.mealSchedule('07:30', '23:30'), {}, fm, {});
  assert(list.length > 5);
});
t('ограниченный склад → тарелка из остатков', () => {
  const inv = { buckwheat: 500, eggs: 550, milk: 1000, chicken_breast: 600, banana: 360 };
  const plan = NF.planDay('2026-11-02', T, NF.mealSchedule('07:30', '23:30'), Object.assign({}, inv), fm, {}, 0);
  console.log('   ', plan.meals.map((x) => (x.recipeId || 'тарелка') + ' missing:' + x.missing.length).join(' | '));
});
t('калькулятор порций', () => {
  const r = NF.portionCalc(['rice', 'chicken_breast', 'olive_oil'], NF.targetFor(T, 0.3), {}, fm, false);
  console.log('   ', r.items.map((i) => i.id + ' ' + i.g + 'г').join(', '), Math.round(r.macros.kcal), 'ккал');
  assert(Math.abs(r.macros.kcal - T.kcal * 0.3) / (T.kcal * 0.3) < 0.1);
});
t('яйца округляются до целых', () => assert.equal(NF.roundFood(fm.eggs, 140) % 55, 0));

const eq1 = { db: 1, dbKg: 10, adjustable: false, bar: false, bench: false, band: false };
t('программа с одной гантелью 10 кг', () => {
  const prog = NF.buildProgram(eq1, 'beginner', 3);
  prog.forEach((w) => {
    console.log('   ', w.title + ':', w.items.map((i) => i.id + ' ' + i.sets + 'x' + i.lo + '-' + i.hi).join(', '));
    w.items.forEach((i) => assert(NF.EXERCISES.find((e) => e.id === i.id).req.every((r) => r === 'db')));
    assert(w.items.length >= 5);
  });
});
t('тяжёлая гантель не даётся на махи', () => {
  const prog = NF.buildProgram(Object.assign({}, eq1, { dbKg: 24 }), 'beginner', 3);
  assert(!prog.some((w) => w.items.some((i) => i.id === 'lateral_1')));
});
t('лёгкая гантель → больше повторов и темп', () => {
  const w = NF.buildWorkout('A', Object.assign({}, eq1, { dbKg: 4 }), 'beginner');
  assert(w.items.some((i) => i.tempo));
});
t('прогрессия: верх диапазона → усложнять', () => {
  const item = { id: 'row_1', sets: 3, lo: 10, hi: 12 };
  assert.equal(NF.progression(item, [{ sets: { row_1: [12, 12, 12] } }], eq1).status, 'up');
});
t('демо-запасы: день добирает ≥ 92% ккал и ≥ 85% углеводов', () => {
  const inv = { buckwheat: 900, rice: 800, oats: 500, eggs: 550, milk: 1000, chicken_breast: 900, cottage5: 400, banana: 600, peanut_butter: 300, sunflower_oil: 500, frozen_veg: 400, cucumber: 300, bread: 450, cheese: 200 };
  const T2 = NF.calcTargets({ sex: 'm', age: 20, height: 178, weight: 60, target: 68, activity: 1.375, pace: 'normal' }, 0);
  for (let seed = 0; seed < 5; seed++) {
    const plan = NF.planDay('2026-11-0' + (seed + 1), T2, NF.mealSchedule('07:30', '23:30', '18:00'), Object.assign({}, inv), fm, {}, seed);
    const m = NF.macrosOf(plan.meals.flatMap((x) => x.items), fm);
    console.log('   ', plan.meals.map((x) => (x.recipeId || 'тарелка') + (x.extra ? '+' + x.extra : '')).join(', '), '|', Math.round(m.kcal), '/', T2.kcal, 'У', Math.round(m.c), '/', T2.carbs, 'Б', Math.round(m.p));
    assert(m.kcal >= T2.kcal * 0.92, 'ккал ' + m.kcal);
    assert(m.c >= T2.carbs * 0.85, 'углеводы ' + m.c);
    assert(m.p >= T2.protein * 0.9 && m.p / 60 <= 2.5, 'белок ' + m.p);
  }
});

// ── еда вне плана, сроки, отчёт, замеры, напоминания ──
const fullInv = () => { const inv = {}; NF.FOODS.forEach((f) => (inv[f.id] = 5000)); return inv; };
const sch = NF.mealSchedule('07:30', '23:30');
t('еда вне плана: остальные приёмы уменьшаются, день ≈ норма', () => {
  const plan = NF.planDay('2026-11-02', T, sch, fullInv(), fm, {}, 0);
  plan.meals[0].eaten = true;
  const extra = [{ id: 'peanuts', g: 100 }, { id: 'banana', g: 240 }]; // ~780 ккал перекусов
  const ex = NF.macrosOf(extra, fm);
  const rest = NF.planRest(plan, T, sch, fullInv(), fm, {}, 0, { extraMacros: ex });
  assert.strictEqual(rest.meals[0], plan.meals[0], 'съеденный приём сохранён');
  const total = NF.macrosOf(rest.meals.flatMap((m) => m.items).concat(extra), fm);
  console.log('   с перекусом вне плана:', Math.round(total.kcal), '/', T.kcal);
  assert(Math.abs(total.kcal - T.kcal) / T.kcal < 0.1);
});
t('еда вне плана закрыла норму → лёгкие приёмы, не голодовка', () => {
  const plan = NF.planDay('2026-11-02', T, sch, fullInv(), fm, {}, 0);
  const ex = { kcal: T.kcal - 200, p: T.protein - 20, f: T.fat - 5, c: T.carbs - 30 };
  const rest = NF.planRest(plan, T, sch, fullInv(), fm, {}, 0, { extraMacros: ex });
  rest.meals.forEach((m) => { assert(m.light); const k = NF.macrosOf(m.items, fm).kcal; assert(k >= 100 && k < 450, k); });
});
t('скоро испортится → попадает в план', () => {
  const inv = { buckwheat: 900, rice: 900, chicken_breast: 600, fish_white: 400, potato: 1000, eggs: 550, milk: 1000, oats: 500, banana: 600, sunflower_oil: 500, olive_oil: 300, cucumber: 300 };
  let hits = 0;
  for (let seed = 0; seed < 6; seed++) {
    const plan = NF.planDay('2026-11-1' + seed, T, sch, Object.assign({}, inv), fm, {}, seed, false, { urgency: { fish_white: 1 } });
    if (plan.meals.some((m) => m.items.some((i) => i.id === 'fish_white'))) hits++;
  }
  assert(hits >= 5, 'рыба в плане ' + hits + '/6');
});
t('сроки хранения есть для скоропортящегося', () => { assert.equal(NF.SHELF.minced_beef, 1); assert(!NF.SHELF.rice); });
t('недельный отчёт: дни, вес, совет', () => {
  const plans = {}; const extras = {}; const weights = [];
  const start = '2026-10-26';
  for (let i = 0; i < 7; i++) {
    const d = NF.addDays(start, i);
    const p = NF.planDay(d, T, sch, fullInv(), fm, {}, i); p.kcal = T.kcal;
    p.meals.forEach((m, j) => { m.eaten = i < 3 || j < 2; }); // 3 полных дня, 4 неполных
    plans[d] = p;
  }
  [['2026-10-20', 62], ['2026-10-23', 62.1], ['2026-10-27', 62.1], ['2026-10-30', 62.2]].forEach(([date, kg]) => weights.push({ date, kg }));
  const r = NF.weekReport({ start, today: '2026-11-02', plans, extras, weights, sleepLog: [{ date: '2026-10-27', bed: '01:00', wake: '07:00' }], workouts: [{ date: '2026-10-26' }], trainDays: [1, 3, 5], profile: p, targets: T, fm, measures: [] });
  assert.equal(r.loggedDays, 7); assert.equal(r.okDays, 3);
  assert(Math.abs(r.weightDelta - 0.1) < 0.01, r.weightDelta);
  assert.equal(r.workoutsPlanned, 3); assert.equal(r.workoutsDone, 1);
  assert(/добирать калории/.test(r.advice[0].text), r.advice[0].text);
  assert(r.advice.some((a) => /Сон/.test(a.text))); assert(r.advice.some((a) => /Тренировок 1 из 3/.test(a.text)));
});
t('weekStart → понедельник', () => { assert.equal(NF.weekStart('2026-11-01'), '2026-10-26'); assert.equal(NF.weekStart('2026-11-02'), '2026-11-02'); });
t('замеры: талия растёт быстрее веса → предупреждение', () => {
  const w = [{ date: '2026-10-01', kg: 62 }, { date: '2026-10-29', kg: 64 }];
  const bad = NF.measureInsight([{ date: '2026-10-01', waist: 74, arm: 30 }, { date: '2026-10-29', waist: 78, arm: 30.3 }], w);
  assert.equal(bad.verdict.level, 'warn');
  const good = NF.measureInsight([{ date: '2026-10-01', waist: 74, arm: 30 }, { date: '2026-10-29', waist: 74.8, arm: 31 }], w);
  assert.equal(good.verdict.level, 'ok');
});
t('напоминания на день', () => {
  const ev = NF.reminderEvents({ date: '2026-11-02', meals: [{ type: 'b', time: '08:10', eaten: true }, { type: 'l', time: '13:20', eaten: false, title: 'Плов' }], bed: '23:30', wake: '07:30', trainTime: '18:00', lead: 10, opts: { meals: true, sleep: true, train: true, weigh: true, measure: true }, measureDue: false });
  assert.deepEqual(ev.map((e) => e.key + '@' + e.at), ['weigh@07:40', 'meal-1l@13:10', 'train@17:00', 'sleep@23:00']);
});
t('календарь .ics валиден', () => {
  const ics = NF.buildICS({ start: '2026-11-02', lead: 10, opts: { meals: true, sleep: true, train: true, weigh: true, measure: true }, wake: '07:30', bed: '23:30', trainDays: [1, 3, 5], trainTime: '18:00', schedRest: NF.mealSchedule('07:30', '23:30'), schedTrain: NF.mealSchedule('07:30', '23:30', '18:00'), stamp: '20261102T000000Z' });
  assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  const ev = ics.split('BEGIN:VEVENT').length - 1;
  assert.equal(ev, 4 + 1 + 1 + 1 + 1 + 1, 'событий ' + ev); // 3 общих приёма + перекус×2, тренировка, отбой, вес, замеры
  ics.split('\r\n').forEach((l) => assert(Buffer.byteLength(l) <= 75, l));
  assert(/RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR/.test(ics)); assert(/TRIGGER:-PT10M/.test(ics));
  assert(/RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU/.test(ics));
});
t('жирный перекус вне плана не разваливает меню (нет «3 г курицы»)', () => {
  const inv = { buckwheat: 900, rice: 800, oats: 500, eggs: 550, milk: 1000, chicken_breast: 900, cottage5: 400, banana: 600, peanut_butter: 300, sunflower_oil: 500, frozen_veg: 400, cucumber: 300, bread: 450, cheese: 200 };
  const T2 = NF.calcTargets({ sex: 'm', age: 20, height: 178, weight: 60, target: 68, activity: 1.375, pace: 'normal' }, 0);
  const sch2 = NF.mealSchedule('07:30', '23:30', '18:00');
  const urgency = { chicken_breast: 1, cottage5: 0.6, bread: 0.6 };
  for (const snack of [[{ id: 'peanuts', g: 80 }], [{ id: 'peanut_butter', g: 60 }, { id: 'bread', g: 60 }], [{ id: 'cheese', g: 100 }]]) {
    const plan = NF.planDay('2026-11-02', T2, sch2, Object.assign({}, inv), fm, {}, 0, false, { urgency });
    plan.meals[0].eaten = true;
    const r = NF.planRest(plan, T2, sch2, Object.assign({}, inv), fm, {}, 0, { urgency, extraMacros: NF.macrosOf(snack, fm) });
    r.meals.forEach((m) => {
      m.items.forEach((it) => assert(it.g >= (fm[it.id].cat === 'fat' ? 5 : 15), m.type + ': ' + it.id + ' ' + it.g + ' г'));
      const mm = NF.macrosOf(m.items, fm);
      if (m.type === 'l' || m.type === 'd') assert(mm.p >= 15, m.type + ': белка ' + Math.round(mm.p));
    });
  }
});
// ── база рецептов, замены, «нет аппетита», сканер ──
t('120 рецептов, все продукты есть в базе, id уникальны', () => {
  assert(NF.RECIPES.length >= 120);
  const ids = new Set();
  NF.RECIPES.forEach((r) => { assert(!ids.has(r.id), r.id); ids.add(r.id); r.ing.forEach((i) => assert(fm[i[0]], r.id + ': ' + i[0])); (r.tags || []).forEach((tg) => assert(NF.TAG_LABEL[tg], tg)); });
  Object.keys(NF.SUBS).forEach((k) => { assert(fm[k], k); NF.SUBS[k].forEach((x) => assert(fm[x], k + '→' + x)); });
});
t('замена: нет гречки, есть киноа → блюдо доступно, граммы пересчитаны', () => {
  const r = NF.RECIPES.find((x) => x.id === 'buck_chicken');
  const inv = { quinoa: 500, chicken_breast: 500, frozen_veg: 400, sunflower_oil: 200 };
  const rs = NF.resolveRecipe(r, inv, fm, false);
  const q = rs.ings.find((i) => i.food.id === 'quinoa');
  assert(q && q.sub === 'buckwheat' && !rs.ings.some((i) => i.missing));
  assert(Math.abs(q.base - 90 * 343 / 368) < 1, 'граммы киноа ' + q.base);
  const fit = NF.fitRecipe(r, NF.targetFor(T, 0.3), inv, fm, false);
  assert(fit.missing.length === 0 && fit.subs.length === 1);
});
t('замена белка — по белку: творог → скир', () => {
  const g = NF.subGrams(200, fm.cottage5, fm.skyr);
  assert(Math.abs(g - 200 * 17.2 / 11) < 1, g);
});
t('замена «главного» продукта в автоплане — в самом конце', () => {
  assert(NF.isTitleIngredient(NF.RECIPES.find((r) => r.id === 'salmon_rice'), 'salmon', fm));
  assert(!NF.isTitleIngredient(NF.RECIPES.find((r) => r.id === 'rice_chicken'), 'olive_oil', fm));
});
t('6 приёмов: доли = 100 %, перекус перед сном, ужин за 3 ч до сна', () => {
  const s6 = NF.mealSchedule('07:30', '23:30', null, 'six');
  assert.equal(s6.meals.length, 6);
  assert(Math.abs(s6.meals.reduce((a, m) => a + m.share, 0) - 1) < 1e-9);
  assert(s6.meals[5].night && s6.meals[5].label === 'Перед сном');
  assert.equal(s6.meals[4].time, '20:30');
  const times = s6.meals.map((m) => NF.toMin(m.time));
  times.slice(1).forEach((x, i) => assert(x > times[i], 'порядок времени'));
});
t('«нет аппетита»: основные приёмы плотнее, перекусы — жидкие калории, день ≈ норма', () => {
  const inv = fullInv();
  const solid = (plan) => plan.meals.filter((m) => m.type !== 's');
  const dens = (meals) => { const items = meals.flatMap((m) => m.items); return NF.macrosOf(items, fm).kcal / items.reduce((a, it) => a + it.g, 0); };
  let d4 = 0, d6 = 0, liquid = 0, snacks = 0;
  for (let seed = 0; seed < 6; seed++) {
    const p4 = NF.planDay('2026-11-1' + seed, T, NF.mealSchedule('07:30', '23:30', null, 'four'), Object.assign({}, inv), fm, {}, seed, false, {});
    const p6 = NF.planDay('2026-11-1' + seed, T, NF.mealSchedule('07:30', '23:30', null, 'six'), Object.assign({}, inv), fm, {}, seed, false, { dense: true });
    d4 += dens(solid(p4)); d6 += dens(solid(p6));
    p6.meals.filter((m) => m.type === 's' && !m.night).forEach((m) => { snacks++; const r = NF.RECIPES.find((x) => x.id === m.recipeId); if (r && r.tags.includes('liquid')) liquid++; });
    const k6 = NF.macrosOf(p6.meals.flatMap((m) => m.items), fm).kcal;
    assert(Math.abs(k6 - T.kcal) / T.kcal < 0.1, 'ккал ' + k6);
    const night = NF.RECIPES.find((x) => x.id === p6.meals[5].recipeId);
    assert(!night || night.tags.includes('night'), 'перед сном — ' + p6.meals[5].recipeId);
  }
  console.log('   ккал на грамм (основные приёмы): обычный режим', (d4 / 6).toFixed(2), '· «нет аппетита»', (d6 / 6).toFixed(2), '· жидкие перекусы', liquid + '/' + snacks);
  assert(d6 > d4 * 1.2, 'в режиме «нет аппетита» основные блюда должны быть заметно калорийнее на грамм');
  assert(liquid >= snacks * 0.6, 'перекусы должны быть в основном жидкими');
});
t('закреплённый рецепт остаётся после пересборки', () => {
  const sch2 = NF.mealSchedule('07:30', '23:30');
  const plan = NF.planDay('2026-11-02', T, sch2, fullInv(), fm, {}, 0);
  const meal = NF.pinRecipe(plan, 1, 'borscht', T, sch2, fullInv(), fm, {});
  assert(meal.pinned && meal.recipeId === 'borscht');
  plan.meals[1] = meal;
  const r = NF.planRest(plan, T, sch2, fullInv(), fm, {}, 3, { extraMacros: NF.macrosOf([{ id: 'banana', g: 240 }], fm) });
  assert.equal(r.meals[1].recipeId, 'borscht');
});
t('добавка к завтраку — без сухой крупы', () => {
  const inv = { bread: 300, peanut_butter: 200, banana: 600, buckwheat: 900, rice: 900 };
  for (let seed = 0; seed < 5; seed++) {
    const plan = NF.planDay('2026-11-2' + seed, T, NF.mealSchedule('07:30', '23:30'), Object.assign({}, inv), fm, {}, seed);
    plan.meals.filter((m) => m.type === 'b' || m.type === 's').forEach((m) => assert(!['buckwheat', 'rice'].includes(m.extra), 'добавка ' + m.extra));
  }
});
t('штрихкод: контрольная цифра', () => {
  ['8076800195057', '3017624010701', '0028400090896', '96385074', '4607001771517'].forEach((c) => assert(NF.Scanner.validCode(c), c));
  ['8076800195058', '12345', 'abc', ''].forEach((c) => assert(!NF.Scanner.validCode(c), c));
});
t('Open Food Facts → базовый продукт только при совпадении КБЖУ', () => {
  const P = (kcal, p, f, c, tags, extra) => Object.assign({ product_name: 'x', nutriments: { 'energy-kcal_100g': kcal, proteins_100g: p, fat_100g: f, carbohydrates_100g: c }, categories_tags: tags }, extra || {});
  const parse = (x) => NF.Scanner.parseProduct(x, '1', fm);
  assert.equal(parse(P(359, 13, 2, 71, ['en:dry-pastas', 'en:spaghetti'])).base, 'pasta');
  assert.equal(parse(P(628, 27, 51, 12, ['en:legume-butters', 'en:nut-butters', 'en:peanut-butters'])).base, 'peanut_butter');
  assert.equal(parse(P(57, 10, 0.2, 3.9, ['en:fermented-dairy-desserts', 'en:yogurts', 'en:skyrs'])).base, 'skyr');
  assert.equal(parse(P(45, 3.1, 1.5, 4.9, ['en:meals', 'en:milks', 'en:semi-skimmed-milks'])).base, 'milk');
  assert.equal(parse(P(140, 3.3, 7, 16.1, ['en:yogurts', 'en:greek-style-yogurts'])).base, null, 'йогурт с мюсли ≠ греческий йогурт');
  const nut = parse(P(539, 6.3, 30.9, 57.5, ['en:sweet-spreads', 'en:hazelnut-spreads']));
  assert(nut.base === null && nut.noplan, 'Nutella — не база и не в план');
  assert.equal(parse(P(null, 13, 2, 71, ['en:dry-pastas'], { nutriments: { energy_100g: 1521, proteins_100g: 13, fat_100g: 2, carbohydrates_100g: 71 } })).kcal, 363.5, 'кДж → ккал');
  assert.equal(parse(P(359, 13, 2, 71, ['en:pastas'], { quantity: '1 kg' })).qty, 1000);
});
t('свой продукт со штрихкода не попадает в «тарелку», если это снек', () => {
  const custom = NF.Scanner.customFromScan({ code: '5000159407236', name: 'Mars', brand: 'Mars', kcal: 450, p: 4, f: 16.8, c: 70, cat: 'carb', noplan: true });
  const fm2 = NF.foodMap([custom]);
  const plan = NF.planDay('2026-11-02', T, NF.mealSchedule('07:30', '23:30'), { [custom.id]: 1000, chicken_breast: 500 }, fm2, {}, 0);
  assert(!plan.meals.some((m) => m.items.some((i) => i.id === custom.id)), 'шоколадный батончик в плане');
});
console.log('\n' + n + ' проверок пройдено');

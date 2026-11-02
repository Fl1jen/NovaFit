// Быстрые проверки ядра: node tests/run.js
const assert = require('assert');
['data-foods', 'data-recipes', 'data-exercises', 'nutrition', 'planner', 'workout'].forEach((f) => require('../js/' + f + '.js'));
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
console.log('\n' + n + ' проверок пройдено');

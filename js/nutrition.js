/* NovaFit — расчёт нормы для безопасного набора веса.
 *
 * На чём основано (см. вкладку «Профиль → Откуда цифры»):
 *  • Базовый обмен — формула Миффлина — Сан Жеора (1990), самая точная из
 *    простых формул для здоровых взрослых.
 *  • Профицит: +250…+500 ккал к расходу, темп набора 0,25–0,5 % массы тела
 *    в неделю (Iraki et al., 2019, J Funct Morphol Kinesiol; ISSN). Быстрее —
 *    растёт в основном жир, а не мышцы. Профицит больше 500 ккал не даём.
 *  • Белок: 1,6–2,2 г/кг (метаанализ Morton et al., 2018, BJSM; ISSN Position
 *    Stand, Jäger 2017). Выше 2,2 г/кг пользы для мышц нет — потолок жёсткий.
 *  • Жиры: 25–30 % калорий, но не меньше 0,8 г/кг (гормональное здоровье).
 *  • Углеводы — всё остальное (топливо для тренировок).
 *  • Вода ≈ 35 мл/кг + 0,5 л в день тренировки (EFSA).
 *  • Клетчатка 14 г на 1000 ккал (IOM).
 */
(function (g) {
  const NF = (g.NF = g.NF || {});

  const ACTIVITY = [
    { v: 1.2, label: 'Сидячая работа, почти без движения' },
    { v: 1.375, label: 'Лёгкая активность: тренировки 1–3 раза в неделю' },
    { v: 1.55, label: 'Средняя: тренировки 3–5 раз или работа на ногах' },
    { v: 1.725, label: 'Высокая: физический труд + тренировки' },
  ];

  const PACE = {
    slow: { rate: 0.0025, label: 'Плавно — 0,25 % веса в неделю (минимум жира)' },
    normal: { rate: 0.005, label: 'Стандарт — 0,5 % веса в неделю' },
  };

  const LIMITS = {
    surplusMin: 200, surplusMax: 500,          // ккал/день сверх расхода
    weeklyMin: 0.15, weeklyMax: 0.5,           // кг/неделю
    proteinMin: 1.6, proteinMax: 2.2,          // г/кг
    fatMinPerKg: 0.8, fatShareMax: 0.35,
    adjustStep: 100, adjustMax: 300,           // адаптация по весам
  };

  function bmi(weight, heightCm) {
    const h = heightCm / 100;
    return weight / (h * h);
  }

  function validateProfile(p) {
    const errors = [];
    if (!(p.age >= 12 && p.age <= 90)) errors.push('Возраст: от 12 до 90 лет.');
    if (!(p.height >= 120 && p.height <= 230)) errors.push('Рост: от 120 до 230 см.');
    if (!(p.weight >= 30 && p.weight <= 250)) errors.push('Вес: от 30 до 250 кг.');
    if (!(p.target > p.weight)) errors.push('Цель должна быть больше текущего веса: приложение рассчитано на набор массы.');
    if (p.target - p.weight > 40) errors.push('Разница больше 40 кг. Поставь промежуточную цель, например +5–10 кг.');
    return errors;
  }

  /** Главный расчёт. adjust — поправка ккал от адаптации по весу. */
  function calcTargets(p, adjust) {
    adjust = adjust || 0;
    const warnings = [];
    const isMale = p.sex !== 'f';
    const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (isMale ? 5 : -161);
    const tdee = bmr * (p.activity || 1.375);
    const curBmi = bmi(p.weight, p.height);
    const targetBmi = bmi(p.target, p.height);

    let paceKey = PACE[p.pace] ? p.pace : 'normal';
    let surplusMax = LIMITS.surplusMax;

    if (p.age < 18) {
      paceKey = 'slow';
      warnings.push({ level: 'warn', text: 'До 18 лет организм ещё растёт: используем плавный темп. Перед стартом покажи план педиатру или спортивному врачу. Не используй спортпит, кроме обычного протеина.' });
    }
    if (curBmi < 16) {
      surplusMax = 300;
      warnings.push({ level: 'danger', text: 'ИМТ ' + curBmi.toFixed(1) + ': это выраженный дефицит массы тела. Сначала обратись к врачу: при резком увеличении питания возможен рефидинг-синдром. Профицит ограничен 300 ккал.' });
    } else if (curBmi < 18.5) {
      warnings.push({ level: 'info', text: 'ИМТ ' + curBmi.toFixed(1) + ': недовес. Набор оправдан. Если вес падает без причины, проверься у врача (щитовидная железа, ЖКТ).' });
    } else if (curBmi >= 25) {
      warnings.push({ level: 'warn', text: 'ИМТ ' + curBmi.toFixed(1) + ': избыточная масса. Набор на профиците добавит в основном жир. Подумай о рекомпозиции: питание на уровне расхода плюс силовые.' });
    }
    if (targetBmi > 27) {
      warnings.push({ level: 'warn', text: 'Цель даст ИМТ ' + targetBmi.toFixed(1) + '. Для большинства людей без многолетнего стажа это будет лишний жир. Лучше поставить промежуточную цель.' });
    }

    let weekly = p.weight * PACE[paceKey].rate;
    weekly = Math.min(LIMITS.weeklyMax, Math.max(LIMITS.weeklyMin, weekly));
    // 1 кг смешанной ткани (мышцы + немного жира) ≈ 5500–7700 ккал; берём ~7000.
    let surplus = (weekly * 7000) / 7;
    surplus = Math.min(surplusMax, Math.max(LIMITS.surplusMin, surplus));

    const adj = Math.max(-LIMITS.adjustMax, Math.min(LIMITS.adjustMax, adjust));
    // Итог никогда не превышает расход + 500 + адаптация, и не ниже расхода + 100.
    let kcal = tdee + surplus + adj;
    kcal = Math.max(tdee + 100, Math.min(tdee + LIMITS.surplusMax + LIMITS.adjustMax, kcal));
    kcal = Math.round(kcal / 10) * 10;

    // При ИМТ > 27 белок считаем от «целевой» массы (ИМТ 25), чтобы не завышать.
    const refWeight = curBmi > 27 ? 25 * Math.pow(p.height / 100, 2) : p.weight;
    const protPerKg = p.age < 18 ? 1.6 : 1.8;
    let protein = Math.round(refWeight * Math.min(LIMITS.proteinMax, Math.max(LIMITS.proteinMin, protPerKg)));

    let fat = Math.max(LIMITS.fatMinPerKg * p.weight, (kcal * 0.27) / 9);
    fat = Math.min(fat, (kcal * LIMITS.fatShareMax) / 9);
    fat = Math.round(fat);

    let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
    if (carbs < 2 * p.weight) {
      // Теоретически недостижимо при профиците, но страхуемся.
      carbs = Math.round(2 * p.weight);
    }

    const gain = p.target - p.weight;
    const weeks = Math.ceil(gain / weekly);

    return {
      bmr: Math.round(bmr), tdee: Math.round(tdee), surplus: Math.round(surplus), adjust: adj,
      kcal, protein, fat, carbs,
      proteinPerKg: +(protein / p.weight).toFixed(2),
      fiber: Math.round((kcal / 1000) * 14),
      water: Math.round((p.weight * 35) / 50) * 50,
      waterTrain: Math.round((p.weight * 35 + 500) / 50) * 50,
      weekly: +weekly.toFixed(2), weeks, pace: paceKey,
      bmi: +curBmi.toFixed(1), targetBmi: +targetBmi.toFixed(1),
      warnings,
    };
  }

  /** Скользящее среднее за 7 дней на дату (по имеющимся записям). */
  function weeklyAverage(weights, endDate) {
    const end = new Date(endDate + 'T12:00:00').getTime();
    const start = end - 6.5 * 864e5;
    const pts = weights.filter(function (w) {
      const t = new Date(w.date + 'T12:00:00').getTime();
      return t >= start && t <= end + 1;
    });
    if (pts.length < 2) return null;
    return pts.reduce(function (s, w) { return s + w.kg; }, 0) / pts.length;
  }

  /**
   * Адаптация раз в неделю: сравниваем средний вес последних 7 дней
   * с предыдущими 7. Если прибавка меньше половины плана — +100 ккал,
   * если больше полутора планов — −100 ккал. Суммарно не больше ±300.
   */
  function adaptCalories(weights, plannedWeekly, today, currentAdjust, lastAdjustDate) {
    if (lastAdjustDate) {
      const days = (new Date(today) - new Date(lastAdjustDate)) / 864e5;
      if (days < 7) return { adjust: currentAdjust, changed: false, reason: null };
    }
    const prevEnd = new Date(new Date(today + 'T12:00:00').getTime() - 7 * 864e5).toISOString().slice(0, 10);
    const cur = weeklyAverage(weights, today);
    const prev = weeklyAverage(weights, prevEnd);
    if (cur == null || prev == null) return { adjust: currentAdjust, changed: false, reason: 'Нужно хотя бы 2 взвешивания за каждую из двух последних недель.' };
    const rate = cur - prev;
    let next = currentAdjust;
    let reason;
    if (rate < plannedWeekly * 0.5) {
      next = Math.min(LIMITS.adjustMax, currentAdjust + LIMITS.adjustStep);
      reason = 'За неделю +' + rate.toFixed(2) + ' кг при плане +' + plannedWeekly + ' кг. Добавляю 100 ккал.';
    } else if (rate > plannedWeekly * 1.5 && rate > 0.3) {
      next = Math.max(-LIMITS.adjustMax, currentAdjust - LIMITS.adjustStep);
      reason = 'За неделю +' + rate.toFixed(2) + ' кг: слишком быстро, растёт жир. Убираю 100 ккал.';
    } else {
      reason = 'Темп в норме (' + (rate >= 0 ? '+' : '') + rate.toFixed(2) + ' кг/нед). Калории без изменений.';
    }
    return { adjust: next, changed: next !== currentAdjust, reason: reason, rate: rate };
  }

  NF.ACTIVITY = ACTIVITY;
  NF.PACE = PACE;
  NF.LIMITS = LIMITS;
  NF.bmi = bmi;
  NF.validateProfile = validateProfile;
  NF.calcTargets = calcTargets;
  NF.weeklyAverage = weeklyAverage;
  NF.adaptCalories = adaptCalories;
})(typeof window !== 'undefined' ? window : globalThis);

/* NovaFit — генератор программы тренировок под инвентарь.
 * Принципы (ACSM Position Stand 2009 по прогрессии нагрузок; Schoenfeld 2017):
 *  • 10+ рабочих подходов на мышцу в неделю для гипертрофии;
 *  • каждая мышца 2 раза в неделю;
 *  • двойная прогрессия: сначала повторения до верха диапазона, потом
 *    усложнение. С одной гантелью без смены веса усложняем через
 *    подходы, темп, паузы и более тяжёлые вариации (одна рука/нога).
 */
(function (g) {
  const NF = (g.NF = g.NF || {});

  const TEMPLATES = {
    A: { title: 'Фулбоди A', slots: [['squat', 0], ['hpush', 0], ['hpull', 0], ['hinge', 0], ['side', 0], ['core', 0]] },
    B: { title: 'Фулбоди B', slots: [['lunge', 0], ['vpush', 0], ['vpull', 0], ['glute', 0], ['bi', 0], ['tri', 0], ['core', 1]] },
    C: { title: 'Фулбоди C', slots: [['squat', 1], ['hpush', 1], ['hpull', 0], ['hinge', 1], ['calves', 0], ['side', 0], ['core', 0]] },
    U1: { title: 'Верх 1', slots: [['hpush', 0], ['hpull', 0], ['vpush', 0], ['vpull', 0], ['side', 0], ['bi', 0], ['tri', 0]] },
    L1: { title: 'Низ 1', slots: [['squat', 0], ['hinge', 0], ['lunge', 0], ['glute', 0], ['calves', 0], ['core', 0]] },
    U2: { title: 'Верх 2', slots: [['hpush', 1], ['hpull', 0], ['vpush', 1], ['vpull', 1], ['side', 0], ['bi', 0], ['tri', 1]] },
    L2: { title: 'Низ 2', slots: [['squat', 1], ['hinge', 1], ['lunge', 1], ['glute', 1], ['calves', 0], ['core', 1]] },
  };

  const COMPOUND = { squat: 1, lunge: 1, hinge: 1, glute: 1, hpush: 1, vpush: 1, hpull: 1, vpull: 1 };

  function hasEquip(ex, eq) {
    return ex.req.every(function (r) {
      if (r === 'db') return eq.db > 0;
      return !!eq[r];
    });
  }

  /** Насколько упражнение подходит под имеющуюся гантель (меньше — лучше). */
  function suitability(ex, eq) {
    if (!ex.kg) return ex.kind === 'bw' || ex.kind === 'time' ? 1.0 : 0.5; // свой вес — запасной вариант
    const kg = eq.dbKg || 0;
    if (kg > ex.kg[1] && !eq.adjustable) return Infinity; // слишком тяжело — небезопасно
    if (kg >= ex.kg[0]) return 0;
    return 0.3 + (ex.kg[0] - kg) / Math.max(1, ex.kg[0]); // легковато — подойдёт, но хуже
  }

  function candidates(slot, eq) {
    return NF.EXERCISES.filter(function (ex) { return ex.slot === slot && hasEquip(ex, eq); })
      .map(function (ex) { return { ex: ex, s: suitability(ex, eq) }; })
      .filter(function (c) { return isFinite(c.s); })
      .sort(function (a, b) { return a.s - b.s; });
  }

  /** Подбор подходов/повторений. Лёгкая гантель → больше повторений + медленный темп. */
  function prescribe(ex, eq, level) {
    const compound = !!COMPOUND[ex.slot];
    let sets = level === 'intermediate' ? (compound ? 4 : 3) : 3;
    let lo = ex.reps[0], hi = ex.reps[1];
    let tempo = null;
    if (ex.kg && !eq.adjustable && eq.dbKg < ex.kg[0]) {
      lo = Math.min(lo + 5, 20); hi = Math.min(hi + 8, 25);
      tempo = '3 секунды вниз, пауза 1 секунда: компенсируем лёгкую гантель';
    }
    const rest = ex.slot === 'core' ? 45 : compound ? 90 : 60;
    return { sets: sets, lo: lo, hi: hi, tempo: tempo, rest: rest, unit: ex.kind === 'time' ? 'сек' : 'повт.' };
  }

  function splitFor(daysPerWeek) {
    if (daysPerWeek >= 4) return ['U1', 'L1', 'U2', 'L2'];
    if (daysPerWeek === 3) return ['A', 'B', 'C'];
    return ['A', 'B'];
  }

  function buildWorkout(key, eq, level) {
    const tpl = TEMPLATES[key];
    const used = {};
    const items = [];
    tpl.slots.forEach(function (sv) {
      const list = candidates(sv[0], eq).filter(function (c) { return !used[c.ex.id]; });
      if (!list.length) return;
      // вариант 1 = второе по пригодности упражнение (если не сильно хуже)
      let c = list[0];
      if (sv[1] === 1 && list[1] && list[1].s <= list[0].s + 1.1) c = list[1];
      used[c.ex.id] = 1;
      items.push(Object.assign({ id: c.ex.id, slot: sv[0] }, prescribe(c.ex, eq, level)));
    });
    return { key: key, title: tpl.title, items: items };
  }

  function buildProgram(eq, level, daysPerWeek) {
    const keys = splitFor(daysPerWeek);
    return keys.map(function (k) { return buildWorkout(k, eq, level); });
  }

  /** Рекомендация по прогрессии на основе последнего выполнения. */
  function progression(item, history, eq) {
    const ex = NF.EXERCISES.find(function (e) { return e.id === item.id; });
    const last = [];
    for (let i = history.length - 1; i >= 0 && last.length < 2; i--) {
      const s = history[i].sets && history[i].sets[item.id];
      if (s && s.length) last.push(s);
    }
    if (!last.length) return { status: 'new', text: 'Первый раз: подбери темп так, чтобы 1–2 повтора оставались в запасе.' };
    const reps = last[0];
    const allTop = reps.length >= item.sets && reps.every(function (r) { return r >= item.hi; });
    const anyLow = reps.some(function (r) { return r < item.lo; });
    if (allTop) {
      let how;
      if (eq.adjustable) how = 'добавь 1–2 кг';
      else if (item.sets < 5 && ex.slot !== 'core') how = 'добавь подход (до 5) или переходи к усложнению: ' + ex.harder.toLowerCase();
      else how = ex.harder;
      return { status: 'up', text: 'Верх диапазона во всех подходах. Пора усложнять: ' + how + '.' };
    }
    if (anyLow && last[1] && last[1].some(function (r) { return r < item.lo; })) {
      return { status: 'hold', text: 'Две тренировки ниже диапазона. Отдохни подольше между подходами, проверь сон и калории.' };
    }
    const sum = reps.reduce(function (a, b) { return a + b; }, 0);
    return { status: 'keep', text: 'Прошлый раз: ' + reps.join(' / ') + ' (всего ' + sum + '). Цель: +1 повтор хотя бы в одном подходе.' };
  }

  const WARMUP = [
    '3–5 минут: ходьба на месте, джампинг-джеки или скакалка',
    'Вращения в плечах, тазе, коленях: по 10 в каждую сторону',
    '10 приседаний без веса и 5–10 отжиманий от дивана',
    'Первое упражнение: 1 разминочный подход на 50 % усилия',
  ];
  const COOLDOWN = [
    'Растяжка груди в дверном проёме: 30 секунд',
    'Растяжка квадрицепса и задней поверхности бедра: по 30 секунд',
    'Медленное дыхание лёжа: 1 минута',
  ];

  NF.TEMPLATES = TEMPLATES;
  NF.buildProgram = buildProgram;
  NF.buildWorkout = buildWorkout;
  NF.splitFor = splitFor;
  NF.progression = progression;
  NF.exerciseCandidates = candidates;
  NF.WARMUP = WARMUP;
  NF.COOLDOWN = COOLDOWN;
})(typeof window !== 'undefined' ? window : globalThis);

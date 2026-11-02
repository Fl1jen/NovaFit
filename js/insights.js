/* NovaFit — аналитика и напоминания (чистые функции, без DOM).
 *  • weekReport   — недельный отчёт и главный совет;
 *  • measureInsight — что говорят замеры тела;
 *  • reminderEvents — напоминания на день;
 *  • buildICS     — файл календаря с повторяющимися напоминаниями.
 */
(function (g) {
  const NF = (g.NF = g.NF || {});

  function addDays(date, n) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + n);
    const z = (x) => (x < 10 ? '0' : '') + x;
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function weekday(date) { return new Date(date + 'T12:00:00').getDay(); }
  /** Понедельник недели, в которую входит дата. */
  function weekStart(date) { const wd = weekday(date); return addDays(date, wd === 0 ? -6 : 1 - wd); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

  /** Что съедено за день: отмеченные приёмы + еда вне плана. */
  function dayIntake(plan, extras, fm) {
    const items = [];
    let n = 0;
    if (plan) plan.meals.forEach((m) => { if (m.eaten) { n++; items.push.apply(items, m.items); } });
    (extras || []).forEach((x) => { n++; items.push(x); });
    return { macros: NF.macrosOf(items, fm), logged: n > 0 };
  }

  /**
   * Недельный отчёт. d = { start, today, plans, extras, weights, sleepLog,
   * workouts, trainDays, profile, targets, fm, measures }
   */
  function weekReport(d) {
    const T = d.targets;
    const end = addDays(d.start, 6);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(d.start, i);
      if (date > d.today) { days.push({ date: date, status: 'future', kcal: 0, p: 0, target: T.kcal }); continue; }
      const plan = d.plans[date];
      const intake = dayIntake(plan, d.extras[date], d.fm);
      const target = plan && plan.kcal ? plan.kcal : T.kcal;
      let status = 'none';
      if (intake.logged) status = intake.macros.kcal >= target * 0.9 ? 'ok' : 'low';
      days.push({ date: date, status: status, kcal: Math.round(intake.macros.kcal), p: Math.round(intake.macros.p), target: target });
    }
    const past = days.filter((x) => x.status !== 'future');
    const logged = days.filter((x) => x.status === 'ok' || x.status === 'low');
    const okDays = days.filter((x) => x.status === 'ok').length;
    const avgKcal = avg(logged.map((x) => x.kcal));
    const avgP = avg(logged.map((x) => x.p));
    const avgTarget = avg(logged.map((x) => x.target));

    // вес: средний за неделю против среднего за прошлую (это сглаживает колебания воды)
    const inRange = (a, b) => d.weights.filter((w) => w.date >= a && w.date <= b).map((w) => w.kg);
    const wk = inRange(d.start, end), prev = inRange(addDays(d.start, -7), addDays(d.start, -1));
    let weightDelta = null, weightBasis = null;
    if (wk.length && prev.length) { weightDelta = avg(wk) - avg(prev); weightBasis = 'avg'; }
    else if (wk.length >= 2) { weightDelta = wk[wk.length - 1] - wk[0]; weightBasis = 'range'; }

    const teen = d.profile.age < 18;
    const sleepNeed = teen ? 480 : 420;
    const sl = d.sleepLog.filter((e) => e.date >= d.start && e.date <= end).map((e) => NF.sleepMinutes(e.bed, e.wake));
    const sleepAvg = avg(sl);
    const sleepShort = sl.filter((m) => m < sleepNeed).length;

    const workoutsDone = d.workouts.filter((w) => w.date >= d.start && w.date <= end).length;
    const workoutsPlanned = past.filter((x) => d.trainDays.indexOf(weekday(x.date)) >= 0).length;
    const measured = (d.measures || []).some((m) => m.date >= d.start && m.date <= end);

    // советы — от самого важного
    const advice = [];
    const plan = T.weekly;
    const complete = d.today > end; // неделя закончилась
    if (past.length >= 3 && logged.length < Math.ceil(past.length / 2)) {
      advice.push({ level: 'warn', text: 'Отмечено только ' + logged.length + ' из ' + past.length + ' дней. Нажимай «Съел» и добавляй еду вне плана, иначе отчёт и автоподстройка калорий работают вслепую.' });
    }
    if (weightDelta != null && complete && weightDelta < plan * 0.5) {
      if (logged.length && okDays < logged.length * 0.7) {
        advice.push({ level: 'warn', text: 'Вес почти не растёт (' + fmtKg(weightDelta) + ' при плане +' + plan + ' кг), и норма закрыта только в ' + okDays + ' ' + plural(okDays, 'день', 'дня', 'дней') + '. Главное сейчас — добирать калории: гейнер-коктейль на перекус, орехи и арахисовая паста, масло в гарнир.' });
      } else {
        advice.push({ level: 'info', text: 'Норму закрываешь, но вес растёт медленно (' + fmtKg(weightDelta) + '). Значит, расход выше расчётного. Автоподстройка добавит +100 ккал, ничего менять не нужно.' });
      }
    }
    if (weightDelta != null && complete && weightDelta > Math.max(0.3, plan * 1.5)) {
      advice.push({ level: 'warn', text: 'Слишком быстро: ' + fmtKg(weightDelta) + ' за неделю при плане +' + plan + ' кг. Лишнее уходит в жир. Автоподстройка уберёт 100 ккал. Если повторится, переключи темп на «Плавно».' });
    }
    if (avgP != null && avgP < d.targets.protein * 0.85) {
      advice.push({ level: 'warn', text: 'Белка в среднем ' + Math.round(avgP) + ' г из ' + d.targets.protein + ' г. Без белка калории идут в жир. Добавь творог, яйца или протеин на перекус.' });
    }
    if (sleepAvg != null && sleepAvg < sleepNeed) {
      advice.push({ level: 'warn', text: 'Сон в среднем ' + fmtDur(sleepAvg) + '. Недосып снижает долю мышц в наборе. Ложись на 30 минут раньше.' });
    }
    if (workoutsPlanned >= 2 && workoutsDone < workoutsPlanned - 1) {
      advice.push({ level: 'warn', text: 'Тренировок ' + workoutsDone + ' из ' + workoutsPlanned + '. Без нагрузки профицит калорий превращается в жир, а не в мышцы. Если не успеваешь, оставь 2 дня в неделю, но не пропускай их.' });
    }
    if (!advice.length) {
      advice.push({ level: 'ok', text: logged.length ? 'Хорошая неделя: калории, сон и тренировки в норме. Продолжай в том же ритме.' : 'Неделя только началась. Отмечай еду, сон и тренировки, и здесь появится разбор.' });
    }

    return {
      start: d.start, end: end, complete: complete, days: days,
      loggedDays: logged.length, pastDays: past.length, okDays: okDays,
      avgKcal: avgKcal, avgTarget: avgTarget, avgP: avgP, proteinTarget: d.targets.protein,
      weightDelta: weightDelta, weightBasis: weightBasis, plannedWeekly: plan,
      sleepAvg: sleepAvg, sleepShort: sleepShort, sleepNights: sl.length, sleepNeed: sleepNeed,
      workoutsDone: workoutsDone, workoutsPlanned: workoutsPlanned, measured: measured,
      advice: advice,
    };
  }

  function fmtKg(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2).replace('.', ',') + ' кг'; }
  function fmtDur(min) { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h + ' ч' + (m ? ' ' + m + ' мин' : ''); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }

  // ───────── замеры ─────────
  const MEASURES = [
    { k: 'waist', label: 'Талия', how: 'На уровне пупка, живот расслаблен, на выдохе' },
    { k: 'chest', label: 'Грудь', how: 'По самой широкой части, через соски, руки опущены' },
    { k: 'arm', label: 'Бицепс', how: 'Самая широкая часть плеча, рука напряжена и согнута' },
    { k: 'thigh', label: 'Бедро', how: 'Самая широкая часть, стоя, нога расслаблена' },
  ];

  function weightNear(weights, date) {
    let best = null, bd = 8;
    weights.forEach((w) => { const dd = Math.abs(daysBetween(w.date, date)); if (dd < bd) { bd = dd; best = w.kg; } });
    return best;
  }

  /**
   * Сравнение первого и последнего замера. Ориентир (не точная наука):
   * при наборе мышц талия растёт заметно медленнее веса, примерно до 1 см на
   * каждый набранный кг. Если талия растёт быстрее, набирается много жира.
   */
  function measureInsight(measures, weights) {
    const ms = (measures || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (ms.length < 2) return { verdict: { level: 'info', text: 'Сделай замеры сейчас и повтори через 2 недели. По разнице станет видно, что растёт: мышцы или жир.' } };
    const first = ms[0], last = ms[ms.length - 1];
    const deltas = {};
    MEASURES.forEach((m) => { if (first[m.k] != null && last[m.k] != null) deltas[m.k] = +(last[m.k] - first[m.k]).toFixed(1); });
    const w0 = weightNear(weights, first.date), w1 = weightNear(weights, last.date);
    const dW = w0 != null && w1 != null ? +(w1 - w0).toFixed(1) : null;
    const days = daysBetween(first.date, last.date);
    let verdict;
    if (days < 10) verdict = { level: 'info', text: 'Между замерами меньше 10 дней: разница пока в пределах погрешности сантиметра.' };
    else if (dW == null || deltas.waist == null) verdict = { level: 'info', text: 'Для вывода нужны вес и талия на даты замеров.' };
    else if (dW < 1) verdict = { level: 'info', text: 'С первого замера вес изменился на ' + dW.toString().replace('.', ',') + ' кг. Для вывода нужна прибавка хотя бы 1 кг.' };
    else {
      const ratio = deltas.waist / dW;
      const armUp = deltas.arm != null && deltas.arm > 0;
      if (ratio <= 0.7) verdict = { level: 'ok', text: 'Отлично: +' + dW + ' кг, а талия +' + deltas.waist + ' см. Набираешь в основном мышцы' + (armUp ? ', бицепс растёт' : '') + '.' };
      else if (ratio <= 1.3) verdict = { level: 'ok', text: 'Нормальный набор: на каждый килограмм талия прибавляет около ' + ratio.toFixed(1).replace('.', ',') + ' см. Жира немного, это ожидаемо.' };
      else verdict = { level: 'warn', text: 'Талия растёт быстро: ' + ratio.toFixed(1).replace('.', ',') + ' см на каждый набранный кг. Похоже, растёт в основном жир. Переключи темп на «Плавно» в профиле и проверь, что не пропускаешь тренировки.' };
    }
    return { first: first, last: last, deltas: deltas, dW: dW, days: days, verdict: verdict };
  }

  // ───────── напоминания ─────────
  /**
   * События на дату. ctx = { date, meals:[{type,time,eaten,title}], bed, wake,
   * trainTime|null, lead, opts:{meals,sleep,train,weigh,measure}, measureDue }
   */
  function reminderEvents(ctx) {
    const ev = [];
    const at = (hhmm, minus) => NF.fromMin(NF.toMin(hhmm) - (minus || 0));
    const o = ctx.opts;
    if (o.meals) ctx.meals.forEach((m) => {
      if (m.eaten) return;
      ev.push({ key: 'meal-' + m.type, at: at(m.time, ctx.lead), title: NF.MEAL_LABEL[m.type] + ' в ' + m.time, body: m.title || 'Открой NovaFit: там блюдо и граммовки' });
    });
    if (o.train && ctx.trainTime) ev.push({ key: 'train', at: at(ctx.trainTime, 60), title: 'Тренировка через час', body: 'Перекус был? Подготовь воду и гантель.' });
    if (o.sleep) ev.push({ key: 'sleep', at: at(ctx.bed, 30), title: 'Через 30 минут отбой', body: 'Отложи телефон, проветри комнату. Сон — это время роста мышц.' });
    const wd = weekday(ctx.date);
    if (o.weigh && (wd === 1 || wd === 4)) ev.push({ key: 'weigh', at: at(ctx.wake, -10), title: 'Взвешивание', body: 'Утром натощак, после туалета. Запиши вес в профиле.' });
    if (o.measure && ctx.measureDue) ev.push({ key: 'measure', at: at(ctx.wake, -20), title: 'Пора сделать замеры', body: 'Талия, грудь, бицепс, бедро: прошло 2 недели.' });
    return ev.sort((a, b) => (a.at < b.at ? -1 : 1));
  }

  // ───────── календарь (.ics) ─────────
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  /** Перенос длинных строк по 75 байт (RFC 5545), не разрывая символы. */
  function fold(line) {
    const out = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
      const b = unescape(encodeURIComponent(ch)).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function icsDate(date, hhmm) { return date.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00'; }
  function firstOnDays(start, days) { for (let i = 0; i < 7; i++) { const d = addDays(start, i); if (days.indexOf(weekday(d)) >= 0) return d; } return start; }

  /**
   * c = { start, lead, opts, wake, bed, trainDays, trainTime, schedRest, schedTrain, stamp }
   * schedRest/schedTrain — расписания еды (NF.mealSchedule) для дней без и с тренировкой.
   */
  function buildICS(c) {
    const all = [0, 1, 2, 3, 4, 5, 6];
    const rest = all.filter((d) => c.trainDays.indexOf(d) < 0);
    const events = [];
    let uid = 0;
    function add(title, body, days, time, durMin, alarmMin, interval) {
      if (!days.length) return;
      const dstart = firstOnDays(c.start, days);
      const endMin = NF.toMin(time) + durMin;
      const endDate = endMin >= 1440 ? addDays(dstart, 1) : dstart;
      const rrule = days.length === 7 && !interval ? 'RRULE:FREQ=DAILY' : 'RRULE:FREQ=WEEKLY' + (interval ? ';INTERVAL=' + interval : '') + ';BYDAY=' + days.map((d) => BYDAY[d]).join(',');
      events.push([
        'BEGIN:VEVENT',
        'UID:novafit-' + (++uid) + '-' + c.start.replace(/-/g, '') + '@novafit.app',
        'DTSTAMP:' + c.stamp,
        'DTSTART:' + icsDate(dstart, time),
        'DTEND:' + icsDate(endDate, NF.fromMin(endMin)),
        rrule,
        'SUMMARY:' + icsEsc(title),
        'DESCRIPTION:' + icsEsc(body),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(title), 'TRIGGER:-PT' + alarmMin + 'M', 'END:VALARM',
        'END:VEVENT',
      ].map(fold).join('\r\n'));
    }
    const o = c.opts;
    if (o.meals) {
      // одинаковые по времени приёмы в днях с тренировкой и без объединяем
      c.schedRest.meals.forEach((m, i) => {
        const mt = c.schedTrain.meals[i];
        const body = 'Блюдо и граммовки в NovaFit.';
        if (mt.time === m.time) add(NF.MEAL_LABEL[m.type] + ' · NovaFit', body, all, m.time, 30, c.lead);
        else {
          add(NF.MEAL_LABEL[m.type] + ' · NovaFit', body, rest, m.time, 30, c.lead);
          add(NF.MEAL_LABEL[mt.type] + ' · NovaFit', body + ' Сегодня тренировка.', c.trainDays, mt.time, 30, c.lead);
        }
      });
    }
    if (o.train && c.trainTime) add('Тренировка · NovaFit', 'Программа и подходы в NovaFit. Разминка 7–10 минут.', c.trainDays, c.trainTime, 60, 60);
    if (o.sleep) add('Отбой · NovaFit', 'Отложи телефон, проветри комнату.', all, c.bed, 15, 30);
    if (o.weigh) add('Взвешивание · NovaFit', 'Натощак, после туалета. Запиши вес в профиле.', [1, 4], NF.fromMin(NF.toMin(c.wake) + 10), 10, 0);
    if (o.measure) add('Замеры тела · NovaFit', 'Талия, грудь, бицепс, бедро.', [0], NF.fromMin(NF.toMin(c.wake) + 30), 10, 0, 2);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NovaFit//RU', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:NovaFit'].join('\r\n') + '\r\n' + events.join('\r\n') + '\r\nEND:VCALENDAR\r\n';
  }

  NF.addDays = addDays;
  NF.weekStart = weekStart;
  NF.daysBetween = daysBetween;
  NF.dayIntake = dayIntake;
  NF.weekReport = weekReport;
  NF.MEASURES = MEASURES;
  NF.measureInsight = measureInsight;
  NF.reminderEvents = reminderEvents;
  NF.buildICS = buildICS;
})(typeof window !== 'undefined' ? window : globalThis);

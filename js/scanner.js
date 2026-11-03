/* NovaFit — сканер штрихкодов.
 *  • камера: встроенный BarcodeDetector (Android Chrome) или ZXing (js/vendor,
 *    грузится только при первом сканировании);
 *  • поиск товара в мировой базе Open Food Facts (world.openfoodfacts.org,
 *    данные под лицензией ODbL) — работает в любой стране;
 *  • привязка к базовому продукту NovaFit по категории И по КБЖУ, чтобы
 *    отсканированные макароны участвовали в рецептах, а «греческий йогурт
 *    с мюсли» не считался обычным йогуртом.
 * Логика без DOM (parseProduct, matchBase, validCode) проверяется в тестах.
 */
(function (g) {
  const NF = (g.NF = g.NF || {});

  const OFF_FIELDS = 'code,product_name,product_name_ru,product_name_en,generic_name,brands,quantity,product_quantity,product_quantity_unit,nutriments,categories_tags';

  // ───────── штрихкод ─────────
  /** EAN-8, UPC-A (12), EAN-13, GTIN-14 с проверкой контрольной цифры. */
  function validCode(code) {
    code = String(code || '').trim();
    if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
    const d = code.split('').map(Number);
    const check = d.pop();
    let sum = 0;
    d.reverse().forEach(function (x, i) { sum += x * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }

  // ───────── категории Open Food Facts → базовые продукты ─────────
  // Порядок важен: более частные правила раньше («peanut-butters» раньше «butters»).
  const RULES = [
    [/peanut-butter/, 'peanut_butter'],
    [/whey|protein-powder/, 'protein_powder'],
    [/skyr/, 'skyr'],
    [/greek-style-yog|greek-yog/, 'yogurt'],
    [/cottage-chees/, 'cottage_cheese'],
    [/quark|tvorog|curd-chees|fromages?-blancs?$/, 'cottage5'],
    [/kefir/, 'kefir'],
    [/sour-cream|smetana|creme-fraiche/, 'smetana'],
    [/mozzarella/, 'mozzarella'],
    [/feta/, 'feta'],
    [/hummus/, 'hummus'],
    [/dark-chocolate/, 'dark_chocolate'],
    [/rice-noodle|rice-vermicelli/, 'rice_noodles'],
    [/couscous/, 'couscous'],
    [/quinoa/, 'quinoa'],
    [/bulgur/, 'bulgur'],
    [/buckwheat/, 'buckwheat'],
    [/granola|muesli/, 'granola'],
    [/rolled-oats|oat-flakes|porridge-oats|^oats$|oatmeal/, 'oats'],
    [/tortilla|^wraps$/, 'tortilla'],
    [/pita|lavash|flatbread/, 'lavash'],
    [/pasta|spaghetti|penne|fusilli|macaroni|tagliatelle/, 'pasta'],
    [/basmati|jasmine-rice|long-grain-rice|parboiled-rice|white-rice|^rices$/, 'rice'],
    [/^breads$|sliced-bread|wholemeal-bread|whole-wheat-bread|rye-bread|wholegrain-bread/, 'bread'],
    [/chicken-eggs|^eggs$/, 'eggs'],
    [/whole-milk/, 'milk_whole'],
    [/semi-skimmed-milk|^milks$|cow-milk|uht-milk|pasteuri[sz]ed-milk/, 'milk'],
    [/^butters$|salted-butter|unsalted-butter|dairy-butter|sweet-cream-butter/, 'butter'],
    [/olive-oil/, 'olive_oil'],
    [/sunflower-oil|vegetable-oil|rapeseed-oil|canola-oil/, 'sunflower_oil'],
    [/hard-chees|cheddar|gouda|emmental|edam|parmigiano|parmesan/, 'cheese'],
    [/^peanuts$|roasted-peanuts/, 'peanuts'],
    [/^almonds$|whole-almonds/, 'almonds'],
    [/^walnuts$|walnut-kernels/, 'walnuts'],
    [/cashew/, 'cashews'],
    [/^raisins$|sultanas/, 'raisins'],
    [/dried-apricot/, 'dried_apricots'],
    [/^dates$|medjool|deglet/, 'dates'],
    [/^honeys$|^honey$/, 'honey'],
    [/tuna/, 'tuna_can'],
    [/chickpea/, 'chickpeas_can'],
    [/lentil/, 'lentils'],
    [/kidney-beans|black-beans|white-beans|canned-beans|^beans$/, 'beans_can'],
    [/sweet-corn|canned-corn/, 'corn_can'],
    [/tomato-paste|tomato-concentrate/, 'tomato_paste'],
    [/chopped-tomatoes|peeled-tomatoes|canned-tomatoes|passata/, 'canned_tomatoes'],
    [/frozen-mixed-vegetables|frozen-vegetable-mix|^frozen-vegetables$/, 'frozen_veg'],
    [/broccoli/, 'broccoli'],
    [/spinach/, 'spinach'],
    [/frozen-berries|frozen-red-fruits|frozen-mixed-berries/, 'frozen_berries'],
    [/tofu/, 'tofu'],
    [/shrimp|prawn/, 'shrimp'],
    [/chicken-breast/, 'chicken_breast'],
    [/chicken-thigh/, 'chicken_thigh'],
    [/turkey-breast|turkey-fillet|^turkey$/, 'turkey'],
    [/minced-beef|ground-beef|beef-mince/, 'minced_beef'],
    [/salmon/, 'salmon'],
    [/^cod$|cod-fillet|hake|pollock|white-fish|tilapia/, 'fish_white'],
    [/pork-tenderloin|pork-loin|^pork$/, 'pork'],
    [/beef-steak|^beef$|lean-beef/, 'beef'],
    [/sweet-potato/, 'sweet_potato'],
    [/^potatoes$|fresh-potatoes/, 'potato'],
    [/^bananas$/, 'banana'],
    [/^apples$/, 'apple'],
    [/avocado/, 'avocado'],
    [/mushroom/, 'mushrooms'],
  ];
  // Переработанное и сладкое не привязываем к базовым продуктам.
  const NOT_BASE = /confectioner|candy|candies|chocolate-bar|biscuit|cookie|cake|crisps|chips|salty-snack|sweet-spread|juice|soft-drink|soda|ice-cream|syrup|^jams$|flavou?red|sweetened|ready-meal|pizza|sandwich|cereal-bar/;
  // Такое можно записать в «съел», но в автоматический план не ставим.
  const NO_PLAN = /confectioner|candy|candies|chocolate-bar|biscuit|cookie|cake|crisps|chips|salty-snack|sweet-spread|soft-drink|soda|ice-cream|^sweets$|energy-drink|alcoholic/;

  function tagCore(t) { return String(t).replace(/^[a-z]{2}:/, ''); }

  function macrosClose(base, m) {
    if (m.kcal == null || m.p == null) return false;
    const kOk = Math.abs(m.kcal - base.kcal) <= Math.max(25, base.kcal * 0.3);
    const pOk = Math.abs(m.p - base.p) <= Math.max(4, base.p * 0.4);
    const fOk = m.f == null || Math.abs(m.f - base.f) <= Math.max(4, base.f * 0.5);
    return kOk && pOk && fOk;
  }

  /**
   * Базовый продукт по категориям (от самой частной к общей) и КБЖУ.
   * {id} — подходит; {id: null, cat} — категория понятна, но КБЖУ другие.
   */
  function matchBase(tags, m, fm) {
    tags = (tags || []).map(tagCore);
    if (tags.some(function (t) { return NOT_BASE.test(t); })) return { id: null, cat: null };
    for (let i = tags.length - 1; i >= 0; i--) {
      for (let k = 0; k < RULES.length; k++) {
        if (!RULES[k][0].test(tags[i])) continue;
        const base = fm[RULES[k][1]];
        if (!base) return { id: null, cat: null };
        return macrosClose(base, m) ? { id: base.id, cat: base.cat } : { id: null, cat: base.cat };
      }
    }
    return { id: null, cat: null };
  }

  function inferCat(m, tags) {
    const t = (tags || []).map(tagCore).join(' ');
    if (/dair|milk|yog|chees|kefir|quark|skyr/.test(t)) return 'dairy';
    const k = Math.max(1, m.kcal || 0);
    if ((m.p || 0) * 4 / k >= 0.4) return 'protein';
    if ((m.f || 0) * 9 / k >= 0.55) return 'fat';
    if (/fruit/.test(t)) return 'fruit';
    if (k < 70) return /vegetable/.test(t) ? 'veg' : 'fruit';
    return 'carb';
  }

  function maxMealFor(cat, kcal) {
    if (cat === 'protein') return 250;
    if (cat === 'dairy') return kcal > 250 ? 80 : 300;
    if (cat === 'fat') return 40;
    if (cat === 'veg') return 300;
    if (cat === 'fruit') return kcal > 200 ? 60 : 300;
    return kcal > 300 ? 120 : 300;
  }

  const SHELF_BY_CAT = { protein: 2, dairy: 7, veg: 5, fruit: 5 };

  function num(x) { const v = parseFloat(x); return isFinite(v) ? v : null; }
  function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }
  function clean(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length >= 2 ? s : ''; }

  /** Ответ Open Food Facts → продукт NovaFit (на 100 г). */
  function parseProduct(p, code, fm) {
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal == null && num(n.energy_100g) != null) kcal = num(n.energy_100g) / 4.184; // energy_100g — в кДж
    const m = { kcal: kcal, p: num(n.proteins_100g), f: num(n.fat_100g), c: num(n.carbohydrates_100g) };
    const tags = p.categories_tags || [];
    const name = clean(p.product_name_ru) || clean(p.product_name) || clean(p.product_name_en) || clean(p.generic_name);
    const brand = clean(String(p.brands || '').split(',')[0]);
    let qty = null;
    const unit = String(p.product_quantity_unit || 'g').toLowerCase();
    if (num(p.product_quantity) != null && /^(g|ml|г|мл)$/.test(unit)) qty = Math.round(num(p.product_quantity));
    if (!qty && p.quantity) {
      const q = /([\d.,]+)\s*(kg|g|l|ml|cl|кг|г|л|мл)\b/i.exec(String(p.quantity));
      if (q) {
        let v = parseFloat(q[1].replace(',', '.'));
        const u = q[2].toLowerCase();
        if (u === 'kg' || u === 'кг' || u === 'l' || u === 'л') v *= 1000;
        if (u === 'cl') v *= 10;
        qty = Math.round(v);
      }
    }
    if (qty && (qty < 5 || qty > 20000)) qty = null;
    const hasMacros = m.kcal != null && m.p != null && m.f != null && m.c != null;
    const match = hasMacros ? matchBase(tags, m, fm) : { id: null, cat: null };
    const cat = match.cat || (hasMacros ? inferCat(m, tags) : 'carb');
    const core = tags.map(tagCore);
    return {
      code: code, name: name, brand: brand,
      kcal: r1(m.kcal), p: r1(m.p), f: r1(m.f), c: r1(m.c), hasMacros: hasMacros,
      qty: qty, base: match.id, cat: cat,
      noplan: core.some(function (t) { return NO_PLAN.test(t); }),
      shelf: SHELF_BY_CAT[cat] || null,
    };
  }

  /** Продукт NovaFit из отсканированного товара (свой продукт со штрихкодом). */
  function customFromScan(prod, name) {
    const kcal = prod.kcal || 0;
    return {
      id: 'b' + prod.code, name: name || prod.name || ('Товар ' + prod.code), kcal: kcal, p: prod.p || 0, f: prod.f || 0, c: prod.c || 0,
      cat: prod.cat, maxMeal: maxMealFor(prod.cat, kcal), unit: null, perUnit: null, custom: true,
      barcode: prod.code, brand: prod.brand || '', noplan: !!prod.noplan,
    };
  }

  // ───────── Open Food Facts ─────────
  async function lookup(code, timeoutMs) {
    const codes = code.length === 12 ? ['0' + code, code] : [code]; // UPC-A хранится как EAN-13 с нулём
    for (let i = 0; i < codes.length; i++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 9000);
      try {
        const res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + codes[i] + '.json?fields=' + OFF_FIELDS, {
          signal: ctrl ? ctrl.signal : undefined,
          headers: { 'X-User-Agent': 'NovaFit/1.1 (personal fitness app)' },
        });
        if (res.status === 404) continue;
        if (!res.ok) return { status: 'error' };
        const j = await res.json();
        if (!j || j.status !== 1 || !j.product) continue;
        return { status: 'ok', raw: j.product, code: codes[i] };
      } catch (e) {
        return { status: (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'error' };
      } finally { clearTimeout(t); }
    }
    return { status: 'notfound' };
  }

  // ───────── камера ─────────
  let zxPromise = null, zxReader = null;
  function loadZXing() {
    if (g.ZXing) return Promise.resolve(g.ZXing);
    if (zxPromise) return zxPromise;
    zxPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'js/vendor/zxing.min.js';
      s.onload = function () { g.ZXing ? resolve(g.ZXing) : reject(new Error('zxing')); };
      s.onerror = function () { zxPromise = null; reject(new Error('zxing')); };
      document.head.appendChild(s);
    });
    return zxPromise;
  }

  /** Распознать штрихкод на canvas через ZXing. */
  function decodeCanvas(canvas) {
    const ZX = g.ZXing;
    if (!ZX) return null;
    if (!zxReader) {
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E]);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      zxReader = new ZX.MultiFormatReader();
      zxReader.setHints(hints);
    }
    try {
      const src = new ZX.HTMLCanvasElementLuminanceSource(canvas);
      return zxReader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(src))).getText();
    } catch (e) { return null; } finally { try { zxReader.reset(); } catch (e2) { /* ignore */ } }
  }

  /**
   * Включить камеру и искать штрихкод. onCode(code) вызывается, когда один и
   * тот же код распознан дважды подряд (защита от ошибочного чтения).
   * Возвращает { stop() }. Ошибки: 'nocamera' | 'denied' | 'nodecoder'.
   */
  async function startCamera(video, onCode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocamera');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      throw new Error(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'nocamera');
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    try { await video.play(); } catch (e) { /* автоплей без звука обычно разрешён */ }

    let detector = null;
    if ('BarcodeDetector' in g) {
      try {
        const fmts = await g.BarcodeDetector.getSupportedFormats();
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(function (f) { return fmts.indexOf(f) >= 0; });
        if (want.length) detector = new g.BarcodeDetector({ formats: want });
      } catch (e) { detector = null; }
    }
    if (!detector) {
      try { await loadZXing(); } catch (e) { stream.getTracks().forEach(function (t) { t.stop(); }); throw new Error('nodecoder'); }
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let last = null, hits = 0, stopped = false, busy = false, timer = null;
    function stop() {
      stopped = true;
      clearTimeout(timer);
      stream.getTracks().forEach(function (t) { t.stop(); });
      video.srcObject = null;
    }
    async function tick() {
      if (stopped) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        try {
          let code = null;
          if (detector) {
            const r = await detector.detect(video);
            if (r && r.length) code = r[0].rawValue;
          } else {
            // средняя полоса кадра — там рамка; уменьшаем для скорости
            const vw = video.videoWidth, vh = video.videoHeight;
            const w = Math.min(vw, 960), h = Math.round((vh * 0.5) * (w / vw));
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, vh * 0.25, vw, vh * 0.5, 0, 0, w, h);
            code = decodeCanvas(canvas);
          }
          if (code && validCode(code)) {
            hits = code === last ? hits + 1 : 1;
            last = code;
            if (hits >= 2) { stop(); onCode(code); return; }
          }
        } catch (e) { /* следующий кадр */ } finally { busy = false; }
      }
      timer = setTimeout(tick, detector ? 120 : 160);
    }
    tick();
    return { stop: stop };
  }

  NF.Scanner = {
    validCode: validCode, matchBase: matchBase, parseProduct: parseProduct, customFromScan: customFromScan,
    lookup: lookup, startCamera: startCamera, decodeCanvas: decodeCanvas, loadZXing: loadZXing, RULES: RULES,
  };
})(typeof window !== 'undefined' ? window : globalThis);

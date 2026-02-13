// SVG Measure — v5
// Изменения по просьбе:
// 1) Теперь корректно считаем размеры/расстояния для элементов с transform:
//    считаем bbox в координатах SVG-канвы (root) через getBBox() + getCTM().
// 2) Учитываем толщину обводки в расчётах расстояний/отступов (stroke считаем OUTSIDE):
//    outerBBox = geomBBox расширенный на strokeWidth (в SVG units) со всех сторон.
// 3) Показываем stroke-width (если есть) в правой панели.

const fileInput = document.getElementById('fileInput');
const clearBtn = document.getElementById('clearBtn');

const dropZone = document.getElementById('dropZone');
const svgHost = document.getElementById('svgHost');
const overlay = document.getElementById('overlay');

const fillText = document.getElementById('fillText');
const strokeText = document.getElementById('strokeText');
const fillSwatch = document.getElementById('fillSwatch');
const strokeSwatch = document.getElementById('strokeSwatch');
const strokeWidthText = document.getElementById('strokeWidthText');

let svgRoot = null;
let intrinsic = { width: 0, height: 0 };

/** @type {Array<SVGGraphicsElement>} */
let selected = [];

// el -> saved real colors/stroke width before highlight
const restoreMap = new WeakMap();

/* -------------------- Загрузка SVG -------------------- */

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await loadSvgFile(file);
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  await loadSvgFile(file);
});

async function loadSvgFile(file){
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg){
    alert('Не удалось прочитать SVG. Проверьте файл.');
    return;
  }

  svgHost.querySelectorAll('svg').forEach(n => n.remove());
  overlay.innerHTML = '';
  selected = [];
  resetColorsUI();

  const imported = document.importNode(svg, true);
  imported.querySelectorAll('script').forEach(s => s.remove());

  // 1:1 размер по viewBox (если есть)
  const vb = imported.viewBox?.baseVal;
  if (vb && vb.width && vb.height){
    intrinsic.width = vb.width;
    intrinsic.height = vb.height;
  } else {
    intrinsic.width = parseFloat(imported.getAttribute('width') || '0') || 1000;
    intrinsic.height = parseFloat(imported.getAttribute('height') || '0') || 800;
  }

  if (!imported.getAttribute('viewBox')){
    imported.setAttribute('viewBox', `0 0 ${intrinsic.width} ${intrinsic.height}`);
  }

  // Визуально подгоняем под размер окна (100%), но координаты остаются исходными
  imported.setAttribute('width', '100%');
  imported.setAttribute('height', '100%');
  imported.style.width = '100%';
  imported.style.height = '100%';
  imported.style.maxWidth = '100%';
  imported.style.maxHeight = '100%';
  imported.style.transform = '';

  svgHost.insertBefore(imported, overlay);
  svgRoot = imported;

  updateHintVisibility();
  hookSelection();

  applyFitToHost();
  updateAll();
}

function updateHintVisibility(){
  const hint = dropZone.querySelector('.hint');
  if (!hint) return;
  hint.style.display = svgRoot ? 'none' : 'grid';
}

function applyFitToHost(){
  if (!svgRoot) return;
  // SVG должен масштабироваться визуально, но измерения остаются в исходных SVG units.
  // Используем нативное масштабирование через viewBox + width/height 100%.
  svgRoot.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  svgRoot.setAttribute('width', '100%');
  svgRoot.setAttribute('height', '100%');
  svgRoot.style.transform = '';
}

/* -------------------- Выделение -------------------- */

function hookSelection(){
  if (!svgRoot) return;

  svgRoot.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof SVGElement)) return;
    if (target === svgRoot) return;
    if (typeof target.getBBox !== 'function') return;

    const el = /** @type {SVGGraphicsElement} */ (target);

    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!multi){
      clearSelection();
      addToSelection(el);
    } else {
      if (selected.includes(el)) removeFromSelection(el);
      else addToSelection(el);
    }

    updateAll();
  }, { passive: true });
}

function addToSelection(el){
  selected.push(el);
  applyHighlight(el, true);
}

function removeFromSelection(el){
  selected = selected.filter(x => x !== el);
  applyHighlight(el, false);
}

function clearSelection(){
  selected.forEach(el => applyHighlight(el, false));
  selected = [];
  overlay.innerHTML = '';
  resetColorsUI();
}

clearBtn.addEventListener('click', () => { clearSelection(); updateAll(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){ clearSelection(); updateAll(); }
});

/* -------------------- Подсветка и реальные стили -------------------- */

function applyHighlight(el, on){
  if (on){
    if (!restoreMap.has(el)){
      const cs = getComputedStyle(el);
      restoreMap.set(el, {
        realFill: cs.fill || el.getAttribute('fill') || 'none',
        realStroke: cs.stroke || el.getAttribute('stroke') || 'none',
        // сохраняем исходную толщину (как видит браузер ДО подсветки)
        realStrokeWidthCss: cs.strokeWidth || el.getAttribute('stroke-width') || '0',
        strokeWidthAttr: el.getAttribute('stroke-width'),
        strokeAttr: el.getAttribute('stroke'),
      });
    }
    el.classList.add('svg-selected');
    // Подсветка: меняем только цвет обводки, НЕ трогаем толщину (чтобы не путать измерения/панель)
    el.setAttribute('stroke', '#F4A12D');
  } else {
    const prev = restoreMap.get(el);
    el.classList.remove('svg-selected');
    if (prev){
      setOrRemove(el, 'stroke', prev.strokeAttr);
      // stroke-width не меняли — восстанавливать не нужно
    } else {
      el.removeAttribute('stroke');
    }
  }
}

function setOrRemove(el, attr, val){
  if (val === null || val === undefined) el.removeAttribute(attr);
  else el.setAttribute(attr, val);
}

/* -------------------- Геометрия в координатах SVG root -------------------- */

function getViewBoxInfo(){
  if (!svgRoot) return { minX: 0, minY: 0, width: intrinsic.width, height: intrinsic.height };
  const vb = svgRoot.viewBox?.baseVal;
  if (vb && vb.width && vb.height){
    return { minX: vb.x, minY: vb.y, width: vb.width, height: vb.height };
  }
  return { minX: 0, minY: 0, width: intrinsic.width, height: intrinsic.height };
}

function mulPoint(m, x, y){
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** bbox без stroke в локальных координатах -> bbox в координатах root (учитывая transform) */
function getTransformedBBoxRoot(el){
  // Берём bbox как даёт браузер (в некоторых случаях он включает stroke).
  // Дальше мы скорректируем размеры/позицию, вычитая толщину обводки.
  const b = el.getBBox();

  const m = el.getCTM();
  if (!m){
    return { left: b.x, top: b.y, width: b.width, height: b.height, right: b.x + b.width, bottom: b.y + b.height };
  }

  const p1 = mulPoint(m, b.x, b.y);
  const p2 = mulPoint(m, b.x + b.width, b.y);
  const p3 = mulPoint(m, b.x + b.width, b.y + b.height);
  const p4 = mulPoint(m, b.x, b.y + b.height);

  const xs = [p1.x, p2.x, p3.x, p4.x];
  const ys = [p1.y, p2.y, p3.y, p4.y];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY, right: maxX, bottom: maxY };
}

/** эффективная толщина stroke в SVG units (root), если stroke нет — 0 */
function getStrokeWidthRoot(el){
  const saved = restoreMap.get(el);
  const stroke = saved?.realStroke ?? 'none';
  if (stroke === 'none' || stroke === 'transparent') return 0;

  // 1) если есть атрибут stroke-width — это user units (то, что обычно нужно, например 7)
  const attr = saved?.strokeWidthAttr ?? el.getAttribute('stroke-width');
  if (attr !== null && attr !== undefined){
    const w = parseFloat(attr);
    return isFinite(w) ? w : 0;
  }

  // 2) иначе берём сохранённый computed strokeWidth (до подсветки) и переводим в user units
  const cssVal = saved?.realStrokeWidthCss ?? getComputedStyle(el).strokeWidth ?? '0';
  const px = parseFloat(cssVal) || 0;

  // Сколько px в одной SVG-unit на экране:
  const mRoot = svgRoot?.getScreenCTM();
  const pxPerUnit = mRoot ? Math.hypot(mRoot.a, mRoot.b) : 1;
  return pxPerUnit ? (px / pxPerUnit) : 0;
}

/** расширяем bbox на strokeWidth (stroke считаем OUTSIDE) */

function adjustRectByStroke(b, strokeW){
  // Пользователь просит: "вычитай толщину обводки из размера".
  // Если bbox включает stroke так, что outer = inner + strokeW,
  // то inner = outer - strokeW, а позиция сдвигается внутрь на strokeW/2.
  const sw = strokeW || 0;
  const inset = sw / 2;
  const w = Math.max(0, b.width - sw);
  const h = Math.max(0, b.height - sw);
  const left = b.left + inset;
  const top = b.top + inset;
  return { left, top, width: w, height: h, right: left + w, bottom: top + h };
}
function expandBBox(b, strokeW){
  // SVG stroke по умолчанию центрируется на контуре (половина наружу, половина внутрь).
  // Поэтому outerBBox = bbox, расширенный на strokeWidth/2.
  const t = (strokeW || 0) / 2;
  return {
    left: b.left - t,
    top: b.top - t,
    width: b.width + 2*t,
    height: b.height + 2*t,
    right: b.right + t,
    bottom: b.bottom + t
  };
}

function centerOfRect(r){
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
}

function rectEdgeDistance(r1, r2){
  const dx = Math.max(0, Math.max(r1.left - r2.right, r2.left - r1.right));
  const dy = Math.max(0, Math.max(r1.top - r2.bottom, r2.top - r1.bottom));
  return Math.sqrt(dx*dx + dy*dy);
}

function fmtPx(n){
  if (!isFinite(n)) return '—';
  return `${Math.round(n)}px`;
}

/* -------------------- Отрисовка линий -------------------- */

function svgToClient(x, y){
  const pt = svgRoot.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const m = svgRoot.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p2 = pt.matrixTransform(m);
  return { x: p2.x, y: p2.y };
}

function clientToOverlay(xClient, yClient){
  const hostRect = svgHost.getBoundingClientRect();
  const inset = 12;
  return {
    x: xClient - hostRect.left - inset + svgHost.scrollLeft,
    y: yClient - hostRect.top - inset + svgHost.scrollTop
  };
}

function clearOverlay(){ overlay.innerHTML = ''; }

function addLineSvg(x1, y1, x2, y2, labelText){
  const c1 = svgToClient(x1, y1);
  const c2 = svgToClient(x2, y2);

  const p1 = clientToOverlay(c1.x, c1.y);
  const p2 = clientToOverlay(c2.x, c2.y);

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  const line = document.createElement('div');
  line.className = 'measure-line';
  line.style.left = `${p1.x}px`;
  line.style.top = `${p1.y}px`;
  line.style.width = `${len}px`;
  line.style.transform = `rotate(${angle}deg)`;

  const dot1 = document.createElement('div');
  dot1.className = 'measure-dot';
  dot1.style.left = `${p1.x}px`;
  dot1.style.top = `${p1.y}px`;

  const dot2 = document.createElement('div');
  dot2.className = 'measure-dot';
  dot2.style.left = `${p2.x}px`;
  dot2.style.top = `${p2.y}px`;

  const label = document.createElement('div');
  label.className = 'measure-label';
  label.textContent = labelText;
  label.style.left = `${(p1.x + p2.x)/2}px`;
  label.style.top = `${(p1.y + p2.y)/2}px`;

  overlay.appendChild(line);
  overlay.appendChild(dot1);
  overlay.appendChild(dot2);
  overlay.appendChild(label);
}

function addSizeLabel(bGeom){
  const x = bGeom.left + bGeom.width/2;
  const y = bGeom.bottom;
  const c = svgToClient(x, y);
  const p = clientToOverlay(c.x, c.y);

  const label = document.createElement('div');
  label.className = 'measure-label';
  // Размер по геометрии (без stroke)
  label.textContent = `${fmtPx(bGeom.width)} × ${fmtPx(bGeom.height)}`;

  label.style.left = `${p.x}px`;
  label.style.top = `${p.y + 14}px`;
  overlay.appendChild(label);
}

function addOffsetsToEdges(bGeom){
  const vb = getViewBoxInfo();
  const leftOffset = bGeom.left - vb.minX;
  const topOffset = bGeom.top - vb.minY;

  const yMid = bGeom.top + bGeom.height/2;
  addLineSvg(vb.minX, yMid, bGeom.left, yMid, fmtPx(leftOffset));

  const xMid = bGeom.left + bGeom.width/2;
  addLineSvg(xMid, vb.minY, xMid, bGeom.top, fmtPx(topOffset));
}

function addPairDistance(b1, b2){
  const separatedX = b1.right < b2.left || b2.right < b1.left;
  const separatedY = b1.bottom < b2.top || b2.bottom < b1.top;

  if (separatedX){
    const leftRect = b1.left < b2.left ? b1 : b2;
    const rightRect = leftRect === b1 ? b2 : b1;
    const x1 = leftRect.right;
    const x2 = rightRect.left;
    const y = (Math.max(leftRect.top, rightRect.top) + Math.min(leftRect.bottom, rightRect.bottom)) / 2;
    addLineSvg(x1, y, x2, y, fmtPx(Math.max(0, x2 - x1)));
    return;
  }

  if (separatedY){
    const topRect = b1.top < b2.top ? b1 : b2;
    const bottomRect = topRect === b1 ? b2 : b1;
    const y1 = topRect.bottom;
    const y2 = bottomRect.top;
    const x = (Math.max(topRect.left, bottomRect.left) + Math.min(topRect.right, bottomRect.right)) / 2;
    addLineSvg(x, y1, x, y2, fmtPx(Math.max(0, y2 - y1)));
    return;
  }

  const c1 = centerOfRect(b1);
  const c2 = centerOfRect(b2);
  addLineSvg(c1.x, c1.y, c2.x, c2.y, '0px');
}

/* -------------------- Цвета и stroke width панель -------------------- */

function normalizeColor(val){
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  if (v.startsWith('url(') || v === 'currentcolor') return null;

  const test = new Option().style;
  test.color = '';
  test.color = v;
  if (test.color === '') return null;
  return v;
}

function resetColorsUI(){
  fillText.textContent = '—';
  strokeText.textContent = '—';
  strokeWidthText.textContent = '—';
  fillText.classList.add('muted');
  strokeText.classList.add('muted');
  strokeWidthText.classList.add('muted');

  const bg = 'repeating-linear-gradient(45deg, #fff, #fff 4px, #eee 4px, #eee 8px)';
  fillSwatch.style.background = bg;
  strokeSwatch.style.background = bg;
}

function updateColorsUI(){
  if (selected.length < 1){
    resetColorsUI();
    return;
  }
  const saved = restoreMap.get(selected[0]);
  const fill = saved?.realFill ?? 'none';
  const stroke = saved?.realStroke ?? 'none';

  fillText.textContent = fill;
  strokeText.textContent = stroke;
  fillText.classList.remove('muted');
  strokeText.classList.remove('muted');

  const f = normalizeColor(fill);
  const s = normalizeColor(stroke);
  const bg = 'repeating-linear-gradient(45deg, #fff, #fff 4px, #eee 4px, #eee 8px)';
  fillSwatch.style.background = f ? f : bg;
  strokeSwatch.style.background = s ? s : bg;

  const sw = getStrokeWidthRoot(selected[0]);
  strokeWidthText.textContent = sw > 0 ? fmtPx(sw) : '—';
  strokeWidthText.classList.toggle('muted', !(sw > 0));
}

/* -------------------- Главный апдейт -------------------- */

function updateAll(){
  clearOverlay();
  updateColorsUI();
  if (!svgRoot) return;

  applyFitToHost();

  if (selected.length >= 1){
    const bRaw = getTransformedBBoxRoot(selected[0]);
    const sw = getStrokeWidthRoot(selected[0]);
    // В соответствии с запросом: вычитаем толщину обводки из размера, и считаем всё по "итоговому" прямоугольнику
    const b = adjustRectByStroke(bRaw, sw);
    addSizeLabel(b);
    addOffsetsToEdges(b);
  }

  if (selected.length >= 2){
    const bRaw1 = getTransformedBBoxRoot(selected[0]);
    const sw1 = getStrokeWidthRoot(selected[0]);
    const b1 = adjustRectByStroke(bRaw1, sw1);

    const bRaw2 = getTransformedBBoxRoot(selected[1]);
    const sw2 = getStrokeWidthRoot(selected[1]);
    const b2 = adjustRectByStroke(bRaw2, sw2);

    addPairDistance(b1, b2);
  }
}

/* события */
svgHost.addEventListener('scroll', () => { if (selected.length) updateAll(); }, { passive: true });
window.addEventListener('resize', () => { if (svgRoot) updateAll(); }, { passive: true });

updateHintVisibility();
resetColorsUI();

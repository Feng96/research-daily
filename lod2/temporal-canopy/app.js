'use strict';

const PREVIOUS = 'previous_points';
const CURRENT = 'new_points';
const METHODS = {
  [PREVIOUS]: { label: '上一轮模型 · 纯点云', subtitle: '纯点云 · 贴树屋面微调' },
  [CURRENT]: { label: '本轮模型 · 纯点云', subtitle: '纯点云 · 树冠缺测训练' },
  new_naive_image: { label: '本轮模型 · 直接影像降权', subtitle: '影像对照 · 直接降权' },
  new_gated_image: { label: '本轮模型 · 影像条件门控', subtitle: '影像对照 · 通过检查后降权' },
};
const STATUS = {
  insufficient_distinct_returns: '不同位置的候选回波过少',
  collinear_returns: '候选回波近共线',
  no_roof_candidates: '未找到候选屋面',
  no_valid_partition: '屋面分区未通过检查',
  roof_plane_lacks_observations: '候选屋面的观测支撑不足',
  geometry_quality_rejection: '几何检查未通过',
};
const $ = id => document.getElementById(id);
const previousCanvas = $('previousDrawing');
const currentCanvas = $('drawing');
const query = new URLSearchParams(location.search);
const state = {
  index: null, data: null, selected: null, raster: null, view: 'compare',
  azimuth: -.58, elevation: .57, zoom: 1, top: false, image: false,
  pending: 0, error: '',
};

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function currentArm() {
  return $('method').value || CURRENT;
}

function currentDetailsArm() {
  return state.view === 'previous' ? PREVIOUS : currentArm();
}

function requestPaint() {
  if (!state.pending) state.pending = requestAnimationFrame(paint);
}

function addOption(select, value, label) {
  select.add(new Option(label, value));
}

function fact(text, value) {
  const cell = document.createElement('div');
  const key = document.createElement('span');
  const result = document.createElement('strong');
  key.textContent = text;
  result.textContent = value;
  cell.append(key, result);
  $('facts').append(cell);
}

function visiblePoints(data, arm, display) {
  if (display === 'none') return [];
  const points = [];
  const comparison = data.compared_probabilities?.[arm];
  const bit = state.index.method_labels[arm].candidate_bit;
  for (let i = 0; i < data.points.length; i += 6) {
    const [x, y, z, membership, klass, roofProbability] = data.points.slice(i, i + 6);
    if (display === 'context' || membership & bit) {
      const code = comparison?.[i / 6];
      points.push({
        xyz: [x / 100, y / 100, z / 100],
        klass: code == null ? klass : Math.floor(code / 101),
        roofProbability: code == null ? roofProbability : code % 101,
      });
    }
  }
  return points;
}

function sameGeometry(data, first, second) {
  const mesh = data.variants[first]?.mesh;
  return mesh != null && mesh === data.variants[second]?.mesh;
}

function paneStatus(data, arm) {
  const variant = data.variants[arm];
  const messages = [];
  if (variant?.mesh == null) messages.push(STATUS[variant?.status] || '此方法没有可预览的屋面');
  if (arm === 'new_gated_image' && sameGeometry(data, arm, CURRENT)) {
    messages.push('此建筑的屋面与本轮纯点云一致');
  }
  if (state.image && data.image) {
    messages.push('NAIP ' + data.image.dates.join('、') + ' · ' + number.format(data.image.native_gsd_m) + ' m/像元');
  }
  return messages.join(' · ');
}

function updatePanel() {
  const data = state.data;
  const arm = currentArm();
  $('previousPane').hidden = state.view === 'current';
  $('currentPane').hidden = state.view === 'previous';
  $('panes').classList.toggle('single', state.view !== 'compare');
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  $('currentVariant').textContent = METHODS[arm].subtitle;
  $('methodDetails').textContent = state.index?.method_labels[arm]?.description || '';
  $('image').disabled = !state.raster;
  $('location').hidden = !data;
  $('facts').replaceChildren();

  const showPoints = $('points').value !== 'none';
  $('togglePoints').setAttribute('aria-pressed', String(showPoints));
  $('togglePoints').textContent = showPoints ? '隐藏点云' : '显示点云';
  $('pointLegend').hidden = !showPoints;
  const showSupport = $('support').checked && state.top && $('mode').value !== 'none';
  $('supportLegend').hidden = !showSupport;
  $('overlayLegend').hidden = !showPoints && !showSupport;

  const oldStatus = data ? paneStatus(data, PREVIOUS) : (state.error || '正在载入建筑');
  const newStatus = data ? paneStatus(data, arm) : (state.error || '正在载入建筑');
  for (const [id, label] of [['previousStatus', oldStatus], ['status', newStatus]]) {
    $(id).textContent = label;
    $(id).hidden = !label;
  }
  if (!data) return requestPaint();

  const notes = data.variants[currentDetailsArm()]?.field_notes || [];
  fact('显示的数据', METHODS[currentDetailsArm()].label);
  for (const [label, value] of [...(data.scene_notes || []), ...notes]) fact(label, value);
  const coords = data.location.map(value => value.toFixed(6));
  $('coordinate').textContent = coords.join(', ');
  $('copy').textContent = '复制坐标';
  $('street').href = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + coords.join(',');
  const prior = new URL(state.index.previous_experiment, location.href);
  prior.search = new URLSearchParams({
    block: state.selected.block, building: state.selected.id,
    method: state.index.previous_method, mode: $('mode').value,
  });
  $('previous').href = prior;
  requestPaint();
}

function shapePath(ctx, points, close = false) {
  ctx.beginPath();
  points.forEach((point, i) => i ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
  if (close) ctx.closePath();
}

function brush(ctx, xy, project, color, dash, filling) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash(dash);
  for (const ring of xy) {
    const p = [];
    for (let i = 0; i < ring.length; i += 2) p.push(project(ring[i], ring[i + 1], 0));
    shapePath(ctx, p, true);
    if (filling) { ctx.fillStyle = filling; ctx.fill(); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function paint() {
  state.pending = 0;
  const data = state.data;
  const extent = data?.outline.reduce((max, ring) => Math.max(max, ...ring.map(Math.abs)), 8) || 8;
  const arm = currentArm();
  const maximumZ = [PREVIOUS, arm].reduce((max, name) => {
    const mesh = data?.meshes[data.variants[name]?.mesh];
    return mesh?.xyz.reduce((peak, z, index) => index % 3 === 2 ? Math.max(peak, z) : peak, max) || max;
  }, extent / 2);
  if (state.view !== 'current') draw(previousCanvas, PREVIOUS, extent, maximumZ);
  if (state.view !== 'previous') draw(currentCanvas, arm, extent, maximumZ);
}

function draw(canvas, arm, extent, maximumZ) {
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const density = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * density) || canvas.height !== Math.round(height * density)) {
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
  }
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.fillStyle = '#e9f2f0';
  ctx.fillRect(0, 0, width, height);
  if (!state.data || !width || !height) {
    canvas.dataset.triangles = '0';
    canvas.dataset.points = '0';
    return;
  }
  const data = state.data;
  const m = data.variants[arm];
  const mesh = data.meshes[m?.mesh];
  const mode = $('mode').value;
  const scale = Math.min(width, height) * .38 * state.zoom / Math.max(extent, state.top ? 0 : .64 * maximumZ);
  const a = state.top ? 0 : state.azimuth;
  const e = state.top ? Math.PI / 2 : state.elevation;
  const [cosA, sinA, cosE, sinE] = [Math.cos(a), Math.sin(a), Math.cos(e), Math.sin(e)];
  const focusZ = state.top ? 0 : maximumZ * .45;
  const project = (x, y, z) => {
    const down = sinA * x + cosA * y;
    return [width / 2 + scale * (cosA * x - sinA * y),
      height / 2 - scale * (sinE * down + cosE * (z - focusZ)),
      cosE * down - sinE * z];
  };
  const image = state.image && state.raster?.complete && state.raster?.naturalWidth;
  if (image) {
    const [left, bottom, right, top] = data.image.bounds;
    const tl = project(left, top, 0);
    const br = project(right, bottom, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.raster, tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
  } else {
    const gridSize = Math.max(20, Math.ceil(extent * 2 / 5) * 5);
    ctx.strokeStyle = '#ccdcda';
    ctx.lineWidth = 1;
    for (let line = -gridSize; line <= gridSize; line += 5) {
      shapePath(ctx, [project(line, -gridSize, 0), project(line, gridSize, 0)]);
      ctx.stroke();
      shapePath(ctx, [project(-gridSize, line, 0), project(gridSize, line, 0)]);
      ctx.stroke();
    }
  }
  if (!state.top) {
    brush(ctx, data.outline, project, '#263a44', [5, 4]);
    if (data.offset.some(offset => offset !== 0)) brush(ctx, data.registered_outline, project, '#037452', [3, 3]);
  }
  const primitives = [];
  const positions = [];
  if (mesh && mode !== 'none') {
    for (let i = 0; i < mesh.xyz.length; i += 3) positions.push(project(...mesh.xyz.slice(i, i + 3)));
    if (mode !== 'wire') {
      for (let i = 0; i < mesh.faces.length; i += 4) {
        const [kind, a, b, c] = mesh.faces.slice(i, i + 4);
        if (mode !== 'building' && kind !== 0) continue;
        const triangle = [positions[a], positions[b], positions[c]];
        const depth = triangle.reduce((sum, v) => sum + v[2], 0) / 3;
        const p = mesh.xyz.slice(a * 3, a * 3 + 3);
        const u = mesh.xyz.slice(b * 3, b * 3 + 3).map((value, j) => value - p[j]);
        const v = mesh.xyz.slice(c * 3, c * 3 + 3).map((value, j) => value - p[j]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const diffuse = Math.min(1, Math.abs(.27 * cross[0] - .44 * cross[1] + .84 * cross[2]) / Math.max(Math.hypot(...cross), .0001));
        const color = [[28, 105, 101], [136, 167, 166], [169, 188, 187]][kind].map(value => Math.round(value * (.75 + .25 * diffuse)));
        primitives.push({ kind: 'face', points: triangle, depth, color: 'rgba(' + color.join(',') + ',' + (image ? .25 : .88) + ')' });
      }
    }
    for (let i = 0; i < mesh.edges.length; i += 3) {
      const [kind, a, b] = mesh.edges.slice(i, i + 3);
      if (kind !== 0 && mode !== 'building') continue;
      primitives.push({ kind: 'edge', points: [positions[a], positions[b]],
        depth: (positions[a][2] + positions[b][2]) / 2 - .001, color: kind === 0 ? '#164d48' : '#567572' });
    }
  }
  for (const p of visiblePoints(data, arm, $('points').value)) {
    const projected = project(...p.xyz);
    primitives.push({ kind: 'point', point: projected, depth: projected[2] - .07,
      color: ['#cf6322', '#228441', '#55718e'][p.klass], radius: p.klass === 0 ? 1.6 + .009 * p.roofProbability : 1.55 });
  }
  primitives.sort((a, b) => b.depth - a.depth);
  for (const item of primitives) {
    if (item.kind === 'point') {
      ctx.fillStyle = item.color;
      ctx.globalAlpha = .83;
      ctx.beginPath();
      ctx.arc(item.point[0], item.point[1], item.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      shapePath(ctx, item.points, item.kind === 'face');
      if (item.kind === 'face') {
        ctx.fillStyle = item.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = mode === 'wire' ? 1.8 : .9;
        ctx.stroke();
      }
    }
  }
  if (state.top) {
    if ($('support').checked && mode !== 'none') {
      if (m?.weak_support?.length) brush(ctx, m.weak_support, project, '#a74c0d', [2, 4], '#ffab3826');
      if (m?.canopy_supported?.length) brush(ctx, m.canopy_supported, project, '#086c9e', [4, 3], '#5bbbff63');
      if (m?.canopy_inferred?.length) brush(ctx, m.canopy_inferred, project, '#a74c0d', [4, 3], '#ffab3860');
    }
    brush(ctx, data.outline, project, image ? '#eff7f6' : '#263a44', [5, 4]);
    if (data.offset.some(offset => offset !== 0)) brush(ctx, data.registered_outline, project, image ? '#59f1bc' : '#037452', [3, 3]);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#304740';
  ctx.fillStyle = '#304740';
  ctx.font = '11px system-ui';
  const meters = scale > 7 ? (scale > 35 ? 2 : 5) : 10;
  ctx.fillText(meters + ' m', 13, height - 12);
  const x0 = 13;
  const y0 = height - 20;
  shapePath(ctx, [[x0, y0 - 4], [x0, y0], [x0 + scale * meters, y0], [x0 + scale * meters, y0 - 4]]);
  ctx.stroke();
  canvas.dataset.triangles = String(primitives.filter(p => p.kind === 'face').length);
  canvas.dataset.points = String(primitives.filter(p => p.kind === 'point').length);
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path + ' returned ' + response.status);
  return response.json();
}

function shareState() {
  const url = new URL(location.href);
  url.search = new URLSearchParams({
    block: $('block').value, building: $('building').value,
    method: state.view === 'previous' ? PREVIOUS : currentArm(),
    mode: $('mode').value, view: state.view,
  });
  if (state.top) url.searchParams.set('top', '1');
  if (state.image) url.searchParams.set('image', '1');
  if ($('support').checked) url.searchParams.set('support', '1');
  if ($('points').value !== 'none') url.searchParams.set('points', $('points').value);
  history.replaceState(null, '', url);
}

function setBlock(block, preferred) {
  $('block').value = block;
  const select = $('building');
  select.replaceChildren();
  const buildings = state.index.buildings.filter(row => row.block === block);
  for (const row of buildings) addOption(select, row.id, row.caption);
  if (buildings.some(row => row.id === preferred)) select.value = preferred;
}

async function selectBuilding() {
  const row = state.index.buildings.find(row => row.block === $('block').value && row.id === $('building').value);
  if (!row) return;
  state.selected = row;
  state.data = state.raster = null;
  state.error = '';
  state.zoom = 1;
  updatePanel();
  shareState();
  try {
    const data = await json(row.data);
    if (state.selected !== row) return;
    state.data = data;
    for (const option of $('method').options) option.disabled = !data.variants[option.value];
    if (!data.variants[currentArm()]) $('method').value = CURRENT;
    if (data.image) {
      state.raster = new Image();
      state.raster.onload = requestPaint;
      state.raster.onerror = () => {
        if (state.selected !== row) return;
        state.raster = null;
        state.image = false;
        setTop(state.top);
      };
      state.raster.src = data.image.url;
    } else {
      state.image = false;
    }
    setTop(state.top);
  } catch (error) {
    if (state.selected !== row) return;
    state.error = '建筑数据载入失败，请刷新或选择另一栋。';
    updatePanel();
    console.error(error);
  }
}

function setTop(top) {
  state.top = top;
  if (!top) state.image = false;
  $('top').textContent = top ? '回到三维' : '俯视';
  $('top').setAttribute('aria-pressed', String(top));
  $('image').setAttribute('aria-pressed', String(state.image));
  updatePanel();
  if (state.index) shareState();
}

function transformView() {
  updatePanel();
  shareState();
}

function zoom(factor) {
  state.zoom = Math.min(6, Math.max(.33, state.zoom * factor));
  requestPaint();
}

async function init() {
  try {
    state.index = await json('index.json');
    $('cohort').textContent = state.index.cohort_description;
    for (const block of state.index.blocks) addOption($('block'), block.id, block.label + ' · ' + block.count);
    for (const arm of state.index.arms) {
      if (arm !== PREVIOUS) addOption($('method'), arm, METHODS[arm].label);
      const row = $('armResults').insertRow();
      row.insertCell().textContent = METHODS[arm].label;
      row.insertCell().textContent = (state.index.status_counts[arm].roof_generated || 0) + ' / ' + state.index.count;
    }
    const arm = query.get('method');
    const view = query.get('view');
    state.view = ['compare', 'previous', 'current'].includes(view) ? view : (arm === PREVIOUS ? 'previous' : 'compare');
    if (state.index.arms.includes(arm) && arm !== PREVIOUS) $('method').value = arm;
    if (currentArm() !== CURRENT && state.view !== 'previous') $('opticalDetails').open = true;
    if (Array.from($('mode').options).some(item => item.value === query.get('mode'))) $('mode').value = query.get('mode');
    if (['fit', 'context'].includes(query.get('points'))) $('points').value = query.get('points');
    $('support').checked = query.get('support') === '1';
    state.image = query.get('image') === '1';
    state.top = state.image || $('support').checked || query.get('top') === '1';
    const block = state.index.blocks.some(item => item.id === query.get('block')) ? query.get('block') : state.index.default_block;
    setBlock(block, query.get('building') || state.index.default_building);
    await selectBuilding();
  } catch (error) {
    state.error = '实验数据载入失败，请刷新页面。';
    updatePanel();
    console.error(error);
  }
}

$('block').addEventListener('change', () => {
  setBlock($('block').value);
  selectBuilding();
});
$('building').addEventListener('change', selectBuilding);
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    transformView();
  });
}
$('method').addEventListener('change', () => {
  if (state.view === 'previous') state.view = 'compare';
  transformView();
});
$('mode').addEventListener('change', transformView);
$('points').addEventListener('change', transformView);
$('support').addEventListener('change', () => setTop($('support').checked || state.top));
$('togglePoints').addEventListener('click', () => {
  $('points').value = $('points').value === 'none' ? 'fit' : 'none';
  transformView();
});
$('top').addEventListener('click', () => setTop(!state.top));
$('image').addEventListener('click', () => {
  state.image = !state.image;
  setTop(state.image || state.top);
});
$('zoomIn').addEventListener('click', () => zoom(1.23));
$('zoomOut').addEventListener('click', () => zoom(1 / 1.23));
$('resetView').addEventListener('click', () => {
  state.azimuth = -.58;
  state.elevation = .57;
  state.zoom = 1;
  setTop(false);
});
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('coordinate').textContent);
    $('copy').textContent = '已复制';
  } catch {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents($('coordinate'));
    selection.removeAllRanges();
    selection.addRange(range);
    $('copy').textContent = '已选中坐标';
  }
});

const observer = new ResizeObserver(requestPaint);
for (const canvas of [previousCanvas, currentCanvas]) {
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  let pointer = null;
  canvas.addEventListener('pointerdown', event => {
    pointer = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer) return;
    const dx = event.clientX - pointer[0];
    const dy = event.clientY - pointer[1];
    pointer = [event.clientX, event.clientY];
    if (dx === 0 && dy === 0) return;
    if (state.top) setTop(false);
    state.azimuth += dx * .012;
    state.elevation = Math.min(1.46, Math.max(.12, state.elevation + dy * .009));
    requestPaint();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, () => { pointer = null; });
  }
  observer.observe(canvas);
}

$('results').addEventListener('toggle', async event => {
  const target = event.currentTarget;
  if (!target.open || target.dataset.loaded) return;
  target.dataset.loaded = 'yes';
  try {
    const summary = await json('summary.json');
    for (const note of summary.findings || []) {
      const item = document.createElement('li');
      item.textContent = note;
      $('summaryNotes').append(item);
    }
    for (const sample of summary.cases || []) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const url = new URL(location.href);
      url.search = new URLSearchParams({ block: sample.block, building: sample.id, method: sample.method, mode: 'roof' });
      if (sample.label.startsWith('俯视')) url.searchParams.set('support', '1');
      link.href = url;
      link.textContent = sample.label;
      item.append(link);
      $('summaryCases').append(item);
    }
    $('summaryNotes').hidden = !$('summaryNotes').childElementCount;
    $('summaryCases').hidden = !$('summaryCases').childElementCount;
  } catch {
    delete target.dataset.loaded;
  }
});

init();

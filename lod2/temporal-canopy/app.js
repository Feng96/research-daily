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
const referenceCanvas = $('referenceDrawing');
const dataVersion = '20261125-reference';
const query = new URLSearchParams(location.search);
const state = {
  index: null, data: null, selected: null, selection: 0, raster: null, activeImage: null,
  references: null, aerial: {}, referenceError: false, showReference: true, view: 'compare',
  azimuth: -.58, elevation: .57, zoom: 1, top: true, image: true,
  pending: 0, error: '',
};

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function currentArm() {
  return $('method').value || CURRENT;
}

function currentDetailsArm() {
  return state.view === 'previous' ? PREVIOUS : currentArm();
}

function buildingKey(row = state.selected) {
  return row ? `${row.block}/${row.id}` : '';
}

function roofReference() {
  return state.references?.[buildingKey()] ?? null;
}

function rasterReady() {
  return Boolean(state.raster?.complete && state.raster.naturalWidth);
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
  return messages.join(' · ');
}

function setLabel(id, label) {
  $(id).textContent = label;
  $(id).hidden = !label;
}

function updateReference(reference, arm) {
  const aerialOnly = state.view === 'aerial';
  const count = (reference?.points?.length ?? 0) / 3;
  const kind = { survey: '独立 LiDAR 屋面复测', manual: '人工核查屋面点' }[reference?.sourceType];
  const unscored = state.referenceError ? '参考数据载入失败' : '这栋暂无独立屋面复测';
  const source = count ? `${kind} · ${number.format(count)} 点` : (state.data ? unscored : '正在加载参考');
  $('referenceTitle').textContent = aerialOnly ? '原始航片' : '屋面参考（GT）';
  setLabel('referenceSource', aerialOnly ? (state.activeImage?.source || '航片') : source);
  const officialNote = state.top ? '紫色 · 官方屋面原始平面投影' : '官方屋面平面投影可切到俯视查看';
  setLabel('referenceNote', !aerialOnly && reference?.official ? officialNote : '');
  setLabel('referenceStatus', !aerialOnly && state.data && !count && !(state.top && reference?.official) ? unscored : '');
  for (const [id, key] of [['previousScore', PREVIOUS], ['currentScore', arm]]) {
    const score = reference?.metrics?.[key];
    const label = reference?.sourceType === 'manual' ? '人工核查' : '实测命中';
    setLabel(id, score?.observations ? `${label} ${number.format(score.within_tolerance)} / ${number.format(score.observations)}` : '');
  }
  $('toggleReference').disabled = aerialOnly || !count;
  $('toggleReference').setAttribute('aria-pressed', String(!aerialOnly && count > 0 && state.showReference));
  return !aerialOnly && count > 0 && state.showReference;
}

function updatePanel() {
  const data = state.data;
  const arm = currentArm();
  const aerialOnly = state.view === 'aerial';
  const hasRaster = rasterReady();
  $('previousPane').hidden = state.view !== 'compare' && state.view !== 'previous';
  $('currentPane').hidden = state.view !== 'compare' && state.view !== 'current';
  $('referencePane').hidden = state.view !== 'compare' && !aerialOnly;
  $('panes').classList.toggle('single', state.view !== 'compare');
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  $('currentVariant').textContent = METHODS[arm].subtitle;
  $('methodDetails').textContent = state.index?.method_labels[arm]?.description || '';
  $('image').disabled = !hasRaster || aerialOnly;
  $('aerialView').disabled = !hasRaster;
  $('top').disabled = aerialOnly;
  $('togglePoints').disabled = aerialOnly;
  $('top').textContent = state.top ? '切到三维' : '切到俯视';
  $('top').setAttribute('aria-pressed', String(state.top));
  $('image').setAttribute('aria-pressed', String(state.image && hasRaster));
  const image = state.activeImage;
  const imageLabel = hasRaster ? `${image.source} · ${image.dates.join('、')} · ${number.format(image.native_gsd_m)} 米/像元`
    : (state.error || (data && !image ? '这栋的航片暂不可用' : '正在加载航片'));
  setLabel('imageInfo', imageLabel);
  $('location').hidden = !data;
  $('facts').replaceChildren();

  const showPoints = !aerialOnly && $('points').value !== 'none';
  $('togglePoints').setAttribute('aria-pressed', String(showPoints));
  $('togglePoints').textContent = showPoints ? '隐藏点云' : '显示点云';
  $('pointLegend').hidden = !showPoints;
  const showSupport = !aerialOnly && $('support').checked && state.top && $('mode').value !== 'none';
  $('supportLegend').hidden = !showSupport;
  const showReference = updateReference(data ? roofReference() : null, arm);
  $('roofReferenceLegend').hidden = !showReference;
  $('overlayLegend').hidden = !showPoints && !showSupport && !showReference;

  const oldStatus = data ? paneStatus(data, PREVIOUS) : (state.error || '正在载入建筑');
  const newStatus = data ? paneStatus(data, arm) : (state.error || '正在载入建筑');
  for (const [id, label] of [['previousStatus', oldStatus], ['status', newStatus]]) {
    setLabel(id, label);
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

function drawAerial(ctx, raster, bounds, project) {
  const [left, bottom, right, top] = bounds;
  const nw = project(left, top, 0);
  const ne = project(right, top, 0);
  const sw = project(left, bottom, 0);
  ctx.save();
  ctx.transform((ne[0] - nw[0]) / raster.naturalWidth, (ne[1] - nw[1]) / raster.naturalWidth,
    (sw[0] - nw[0]) / raster.naturalHeight, (sw[1] - nw[1]) / raster.naturalHeight, nw[0], nw[1]);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster, 0, 0);
  ctx.restore();
}

function paint() {
  state.pending = 0;
  const data = state.data;
  const extent = data?.outline.reduce((max, ring) => Math.max(max, ...ring.map(Math.abs)), 8) || 8;
  const arm = currentArm();
  const reference = roofReference();
  const meshes = [data?.meshes[data?.variants[PREVIOUS]?.mesh], data?.meshes[data?.variants[arm]?.mesh]];
  const maximumZ = meshes.reduce((max, mesh) => {
    return mesh?.xyz.reduce((peak, z, index) => index % 3 === 2 ? Math.max(peak, z) : peak, max) || max;
  }, extent / 2);
  if (!$('previousPane').hidden) draw(previousCanvas, PREVIOUS, extent, maximumZ, reference);
  if (!$('currentPane').hidden) draw(currentCanvas, arm, extent, maximumZ, reference);
  if (!$('referencePane').hidden) draw(referenceCanvas, null, extent, maximumZ, reference);
}

function draw(canvas, arm, extent, maximumZ, reference) {
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
  canvas.dataset.aerialSource = '';
  canvas.dataset.referencePoints = '0';
  if (!state.data || !width || !height) {
    canvas.dataset.triangles = '0';
    canvas.dataset.points = '0';
    return;
  }
  const data = state.data;
  const aerialOnly = state.view === 'aerial';
  const isReference = arm === null;
  const m = data.variants[arm];
  const mesh = isReference ? (state.top ? reference?.official : null) : data.meshes[m?.mesh];
  const mode = aerialOnly ? 'none' : $('mode').value;
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
  const image = state.image && rasterReady();
  if (image) {
    drawAerial(ctx, state.raster, state.activeImage.bounds, project);
    canvas.dataset.aerialSource = state.activeImage.source;
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
  if (!state.top && !aerialOnly) {
    brush(ctx, data.outline, project, image ? '#eff7f6' : '#263a44', [5, 4]);
    if (data.offset.some(offset => offset !== 0)) brush(ctx, data.registered_outline, project, image ? '#59f1bc' : '#037452', [3, 3]);
  }
  const primitives = [];
  const positions = [];
  if (mesh && mode !== 'none') {
    for (let i = 0; i < mesh.xyz.length; i += 3) {
      positions.push(project(mesh.xyz[i], mesh.xyz[i + 1], isReference ? 0 : mesh.xyz[i + 2]));
    }
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
        const palette = isReference ? [[129, 63, 160], [136, 167, 166], [169, 188, 187]] : [[28, 105, 101], [136, 167, 166], [169, 188, 187]];
        const color = palette[kind].map(value => Math.round(value * (.75 + .25 * diffuse)));
        const alpha = image && state.top ? .34 : .88;
        primitives.push({ kind: 'face', points: triangle, depth, color: `rgba(${color.join(',')},${alpha})` });
      }
    }
    for (let i = 0; i < mesh.edges.length; i += 3) {
      const [kind, a, b] = mesh.edges.slice(i, i + 3);
      if (kind !== 0 && mode !== 'building') continue;
      const color = isReference ? (image ? '#e5a1ff' : '#70258d') : (image ? '#77e5d5' : '#164d48');
      primitives.push({ kind: 'edge', points: [positions[a], positions[b]],
        depth: (positions[a][2] + positions[b][2]) / 2 - .001, color: kind === 0 ? color : '#567572' });
    }
  }
  for (const p of isReference ? [] : visiblePoints(data, arm, $('points').value)) {
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
  if (state.top && !aerialOnly) {
    if ($('support').checked && mode !== 'none') {
      if (m?.weak_support?.length) brush(ctx, m.weak_support, project, '#a74c0d', [2, 4], '#ffab3826');
      if (m?.canopy_supported?.length) brush(ctx, m.canopy_supported, project, '#086c9e', [4, 3], '#5bbbff63');
      if (m?.canopy_inferred?.length) brush(ctx, m.canopy_inferred, project, '#a74c0d', [4, 3], '#ffab3860');
    }
    brush(ctx, data.outline, project, image ? '#eff7f6' : '#263a44', [5, 4]);
    if (data.offset.some(offset => offset !== 0)) brush(ctx, data.registered_outline, project, image ? '#59f1bc' : '#037452', [3, 3]);
  }
  if (!aerialOnly && state.showReference && reference?.points?.length) {
    ctx.fillStyle = '#ffe287';
    ctx.strokeStyle = '#3b2c20';
    ctx.lineWidth = .8;
    for (let i = 0; i < reference.points.length; i += 3) {
      const point = project(...reference.points.slice(i, i + 3));
      ctx.beginPath();
      ctx.arc(point[0], point[1], 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    canvas.dataset.referencePoints = String(reference.points.length / 3);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#304740';
  ctx.fillStyle = '#304740';
  ctx.font = '11px system-ui';
  const meters = scale > 7 ? (scale > 35 ? 2 : 5) : 10;
  if (image) {
    ctx.fillStyle = '#ffffffe8';
    ctx.fillRect(7, height - 30, Math.max(35, scale * meters + 13), 24);
    ctx.fillStyle = '#304740';
  }
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
    mode: $('mode').value, view: state.view, top: state.top ? '1' : '0', image: state.image ? '1' : '0',
  });
  if (!state.showReference) url.searchParams.set('gt', '0');
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

function loadBackdrop(options, attempt) {
  const image = options[0] || null;
  state.activeImage = image;
  state.raster = null;
  if (!image) return updatePanel();
  const raster = new Image();
  state.raster = raster;
  raster.onload = () => {
    if (state.selection === attempt) updatePanel();
  };
  raster.onerror = () => {
    if (state.selection === attempt) loadBackdrop(options.slice(1), attempt);
  };
  raster.src = image.url;
  updatePanel();
}

async function selectBuilding() {
  const row = state.index.buildings.find(row => row.block === $('block').value && row.id === $('building').value);
  if (!row) return;
  state.selected = row;
  const attempt = ++state.selection;
  state.data = state.raster = state.activeImage = null;
  state.error = '';
  state.zoom = 1;
  updatePanel();
  shareState();
  try {
    const data = await json(row.data);
    if (state.selection !== attempt) return;
    state.data = data;
    for (const option of $('method').options) option.disabled = !data.variants[option.value];
    if (!data.variants[currentArm()]) $('method').value = CURRENT;
    const preferred = state.aerial[buildingKey(row)];
    const fallback = data.image && { ...data.image, source: 'USDA NAIP' };
    loadBackdrop([preferred, fallback].filter(Boolean), attempt);
    shareState();
  } catch (error) {
    if (state.selection !== attempt) return;
    state.error = '建筑数据载入失败，请刷新或选择另一栋。';
    updatePanel();
    console.error(error);
  }
}

function setTop(top) {
  state.top = top;
  transformView();
}

function transformView() {
  updatePanel();
  if (state.index) shareState();
}

function zoom(factor) {
  state.zoom = Math.min(6, Math.max(.33, state.zoom * factor));
  requestPaint();
}

async function init() {
  try {
    const [index, imagery, references] = await Promise.all([
      json('index.json'),
      json('aerial.json?v=' + dataVersion).catch(() => null),
      json('reference.json?v=' + dataVersion).catch(() => null),
    ]);
    state.index = index;
    state.aerial = imagery?.buildings || {};
    state.references = references?.buildings || null;
    state.referenceError = !state.references;
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
    state.view = ['compare', 'previous', 'current', 'aerial'].includes(view) ? view : (arm === PREVIOUS ? 'previous' : 'compare');
    if (state.index.arms.includes(arm) && arm !== PREVIOUS) $('method').value = arm;
    if (currentArm() !== CURRENT && state.view !== 'previous') $('opticalDetails').open = true;
    if (Array.from($('mode').options).some(item => item.value === query.get('mode'))) $('mode').value = query.get('mode');
    if (['fit', 'context'].includes(query.get('points'))) $('points').value = query.get('points');
    $('support').checked = query.get('support') === '1';
    state.image = state.view === 'aerial' || query.get('image') !== '0';
    state.top = state.view === 'aerial' || $('support').checked || query.get('top') !== '0';
    state.showReference = query.get('gt') !== '0';
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
    if (state.view === 'aerial') {
      state.top = true;
      state.image = true;
    }
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
  transformView();
});
$('toggleReference').addEventListener('click', () => {
  state.showReference = !state.showReference;
  transformView();
});
$('zoomIn').addEventListener('click', () => zoom(1.23));
$('zoomOut').addEventListener('click', () => zoom(1 / 1.23));
$('resetView').addEventListener('click', () => {
  state.azimuth = -.58;
  state.elevation = .57;
  state.zoom = 1;
  setTop(true);
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
for (const canvas of [previousCanvas, currentCanvas, referenceCanvas]) {
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
    if (!pointer || state.view === 'aerial') return;
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

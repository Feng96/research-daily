'use strict';

const METHOD = {
  old_crop: { label: '01 · 原足迹硬裁', description: '只取原始 OSM 足迹内的候选点。' },
  old_filter: { label: '02 · 旧融合硬筛', description: '在原足迹候选点中重放旧融合筛点，删除被排除的回波。' },
  buffer: { label: '03 · 足迹周边取点', description: '允许周边回波参与拟合，同时检查相邻建筑的点归属。' },
  align: { label: '04 · 周边取点＋街区配准', description: '仅应用在留出建筑上通过复核的街区平移。' },
  point_weight: { label: '05 · 加入 DL 点权重', description: '用点云模型估计屋面、植被及其他回波的概率，以屋面概率给候选点加权。' },
  point_weight_naip: { label: '06 · 点权重＋NAIP', description: '在 DL 点权重上加入通过时相和空间检查的 NAIP 近红外植被证据。' },
  density_richmond: { label: '稀疏增强 · Richmond', description: '训练时抽稀点云并重新计算局部特征，让模型看到点间距和覆盖变化。' },
  density_cross_domain: { label: '稀疏增强 · 两地联合', description: '用 Richmond 和 Vaihingen 的点云联合训练，使用同样的抽稀增强。' },
};
const STATUS = {
  roof_generated: '已生成屋面',
  insufficient_distinct_returns: '不同位置的候选回波过少',
  collinear_returns: '候选回波近共线',
  no_roof_candidates: '未找到候选屋面',
  no_valid_partition: '屋面分区未通过检查',
  roof_plane_lacks_observations: '候选屋面的观测支撑不足',
  geometry_quality_rejection: '几何检查未通过',
};
const pointBit = { old_crop: 1, old_filter: 2, buffer: 4, align: 8, point_weight: 8, point_weight_naip: 8,
  density_richmond: 8, density_cross_domain: 8 };
const qualityGroup = { old_crop: 'baseline', buffer: 'buffer', align: 'registered', point_weight: 'registered', point_weight_naip: 'registered',
  density_richmond: 'registered', density_cross_domain: 'registered' };
const $ = id => document.getElementById(id);
const canvas = $('drawing');
const ctx = canvas.getContext('2d');
const query = new URLSearchParams(location.search);
const state = { index: null, data: null, selected: null, active: null, previous: null, raster: null,
  azimuth: -.58, elevation: .57, zoom: 1, top: false, image: false, pending: 0, error: '' };
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

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

function percent(fraction) {
  return fraction == null ? '—' : number.format(100 * Math.min(fraction, 1)) + '%';
}

function sameGeometry(data, first, second) {
  return data.variants[first]?.mesh != null && data.variants[first].mesh === data.variants[second]?.mesh;
}

function visiblePoints(data, arm, display) {
  const points = [];
  if (display === 'none') return points;
  const comparison = data.compared_probabilities?.[arm];
  const bit = methodInfo(arm)?.candidate_bit ?? pointBit[arm];
  for (let i = 0; i < data.points.length; i += 6) {
    const [x, y, z, membership, klass, roofProbability] = data.points.slice(i, i + 6);
    if (display === 'context' || membership & bit) {
      const code = comparison?.[i / 6];
      points.push({ xyz: [x / 100, y / 100, z / 100], klass: code == null ? klass : Math.floor(code / 101),
        roofProbability: code == null ? roofProbability : code % 101 });
    }
  }
  return points;
}

function updatePanel() {
  const data = state.data;
  const arm = $('method').value;
  $('methodDetails').textContent = methodInfo(arm)?.description || '';
  $('facts').replaceChildren();
  $('registeredKey').hidden = true;
  $('supportKey').hidden = true;
  $('location').hidden = !data;
  $('image').disabled = !data?.image;
  $('status').hidden = false;
  if (!data) {
    $('status').textContent = state.error || '正在载入建筑';
    $('pointNote').textContent = '';
    return requestPaint();
  }
  const variant = data.variants[arm];
  const chosen = data.meshes[variant?.mesh];
  const blocked = !chosen;
  for (const option of $('mode').options) {
    if (option.value !== 'none') option.disabled = blocked || (option.value === 'building' && !chosen?.faces.some((value, i) => i % 4 === 0 && value === 1));
  }
  const shifted = data.offset.some(offset => offset !== 0);
  $('registeredKey').hidden = !shifted;
  $('supportKey').hidden = !variant?.unsupported?.length || !state.top || $('mode').value === 'none';
  const mode = $('mode').value;
  const meshStatus = blocked ? (variant?.preview_missing ? '此模型的屋面无法预览' : STATUS[variant?.status] || '本方法暂无结果') : '';
  const compare = !blocked && state.previous && state.previous !== arm && sameGeometry(data, arm, state.previous)
    ? '与刚才的方法生成相同的预览几何' : '';
  const shared = !blocked && mode === 'building' && $('mode').selectedOptions[0]?.disabled ? '此结果只有屋面，当前只绘制屋面' : '';
  const imageNote = state.image && data.image ? 'NAIP ' + data.image.dates.join('、') + ' · ' + number.format(data.image.native_gsd_m) + ' m/像元' : '';
  const overlay = [meshStatus, compare, shared, imageNote].filter(Boolean).join(' · ');
  $('status').textContent = overlay;
  $('status').hidden = !overlay;

  const shown = visiblePoints(data, arm, $('points').value).length;
  const total = $('points').value === 'fit' ? variant?.selected_points : data.point_total;
  const showCloud = $('points').value !== 'none';
  const modelColor = data.compared_probabilities ? '点色来源 · ' + (methodInfo(arm)?.point_color ||
    (data.compared_probabilities[arm] ? methodInfo(arm).label : '原 Richmond 模型')) + '。' : '点的颜色来自模型的语义概率。';
  $('pointNote').textContent = showCloud
    ? '当前显示 ' + number.format(shown) + (total == null ? '' : ' / ' + number.format(total)) + ' 个回波。' + modelColor
    : '';
  const quality = data.quality[methodInfo(arm)?.quality_group || qualityGroup[arm]] || {};
  fact('拟合候选点', number.format(variant?.selected_points ?? 0));
  fact('原足迹外候选点', number.format(variant?.points_outside_original ?? 0));
  fact('候选点覆盖', percent(quality.observed_fraction));
  fact('最大缺测区', quality.maximum_gap_m2 == null ? '—' : number.format(quality.maximum_gap_m2) + ' m²');
  fact('点间距中位数', quality.building_local_xy_spacing_median_m == null ? '—' : number.format(quality.building_local_xy_spacing_median_m) + ' m');
  fact('多源 ID 覆盖代理', percent(quality.repeat_source_coverage_fraction));
  fact('保留局部结构', variant?.status === 'roof_generated' ? number.format(variant.local_applied) : '—');
  const low = variant?.low_confidence_covered_area_m2;
  fact(arm === 'point_weight_naip' ? 'NAIP 支持的植被点' : '屋面低支撑区', arm === 'point_weight_naip'
    ? number.format(variant.optically_corroborated_points ?? 0) : low == null ? '—' : number.format(low) + ' m²');

  const coords = data.location.map(value => value.toFixed(6)).join(', ');
  $('coordinate').textContent = coords;
  $('copy').textContent = '复制坐标';
  $('street').href = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + data.location.join(',');
  const priorPage = state.index.previous_experiment || (state.index.added_count ? '../point-workflow/' : null);
  const previous = new URL(priorPage || '../', location.href);
  previous.search = new URLSearchParams(priorPage ? {
    block: state.selected.block, building: state.selected.id, method: state.index.previous_method || 'point_weight', mode: 'building',
  } : {
    experiment: 'structure', split: 'pilot', block: state.selected.block, building: state.selected.id,
    group: 'R_DL', points: '1', modelMode: 'building',
  });
  $('previous').href = previous;
  $('previous').hidden = state.selected.cohort === 'added' || state.selected.cohort === 'holdout';
  requestPaint();
}

function shapePath(points, close = false) {
  ctx.beginPath();
  points.forEach((point, i) => i ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
  if (close) ctx.closePath();
}

function brush(xy, project, color, dash, filling) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash(dash);
  for (const ring of xy) {
    const p = [];
    for (let i = 0; i < ring.length; i += 2) p.push(project(ring[i], ring[i + 1], 0));
    shapePath(p, true);
    if (filling) { ctx.fillStyle = filling; ctx.fill(); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function paint() {
  state.pending = 0;
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
  if (!state.data || !width || !height) return;
  const data = state.data;
  const arm = $('method').value;
  const m = data.variants[arm];
  const mesh = data.meshes[m?.mesh];
  const mode = $('mode').value;
  const extent = data.outline.reduce((max, ring) => Math.max(max, ...ring.map(Math.abs)), 8);
  const maximumZ = mesh?.xyz?.reduce((max, value, i) => i % 3 === 2 ? Math.max(max, value) : max, 0) || extent / 2;
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
      shapePath([project(line, -gridSize, 0), project(line, gridSize, 0)]);
      ctx.stroke();
      shapePath([project(-gridSize, line, 0), project(gridSize, line, 0)]);
      ctx.stroke();
    }
  }
  if (!state.top) {
    brush(data.outline, project, '#263a44', [5, 4]);
    if (data.offset.some(offset => offset !== 0)) brush(data.registered_outline, project, '#037452', [3, 3]);
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
      shapePath(item.points, item.kind === 'face');
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
    if (m?.unsupported?.length && mode !== 'none') brush(m.unsupported, project, '#a74c0d', [4, 3], '#ffab3833');
    brush(data.outline, project, image ? '#eff7f6' : '#263a44', [5, 4]);
    if (data.offset.some(offset => offset !== 0)) brush(data.registered_outline, project, image ? '#59f1bc' : '#037452', [3, 3]);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#304740';
  ctx.fillStyle = '#304740';
  ctx.font = '11px system-ui';
  const meters = scale > 7 ? (scale > 35 ? 2 : 5) : 10;
  ctx.fillText(meters + ' m', 13, height - 12);
  const x0 = 13;
  const y0 = height - 20;
  shapePath([[x0, y0 - 4], [x0, y0], [x0 + scale * meters, y0], [x0 + scale * meters, y0 - 4]]);
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
    block: $('block').value,
    building: $('building').value,
    method: $('method').value,
    mode: $('mode').value,
  });
  if (state.index.added_count && $('cohortFilter').value !== 'all') url.searchParams.set('cohort', $('cohortFilter').value);
  history.replaceState(null, '', url);
}

function setBlock(block, preferred) {
  $('block').value = block;
  $('building').replaceChildren();
  const cohort = $('cohortFilter').value;
  const buildings = state.index.buildings.filter(row => row.block === block && (cohort === 'all' || row.cohort === cohort));
  for (const row of buildings) addOption($('building'), row.id, row.caption);
  if (buildings.some(row => row.id === preferred)) $('building').value = preferred;
}

async function selectBuilding() {
  const row = state.index.buildings.find(row => row.block === $('block').value && row.id === $('building').value);
  state.selected = row;
  state.data = state.raster = null;
  state.previous = null;
  state.error = '';
  state.zoom = 1;
  updatePanel();
  shareState();
  try {
    const data = await json(row.data);
    if (state.selected !== row) return;
    state.data = data;
    for (const option of $('method').options) option.disabled = !data.variants[option.value];
    if (!data.variants[$('method').value]) $('method').value = Object.keys(data.variants)[0];
    state.active = $('method').value;
    if (data.image) {
      state.raster = new Image();
      state.raster.onload = requestPaint;
      state.raster.onerror = () => {
        if (state.selected !== row) return;
        state.raster = null;
        state.image = false;
        $('image').setAttribute('aria-pressed', 'false');
        $('image').disabled = true;
        requestPaint();
      };
      state.raster.src = data.image.url;
    } else {
      state.image = false;
      $('image').setAttribute('aria-pressed', 'false');
    }
    updatePanel();
    shareState();
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
}

function zoom(factor) {
  state.zoom = Math.min(6, Math.max(.33, state.zoom * factor));
  requestPaint();
}

function methodInfo(arm) {
  return state.index?.method_labels?.[arm] || METHOD[arm];
}

async function init() {
  try {
    state.index = await json('index.json');
    const hasAdded = Boolean(state.index.added_count);
    $('cohort').textContent = state.index.cohort_description || (state.index.count + ' 栋' +
      (hasAdded ? '（新增 ' + state.index.added_count + ' 栋）' : '') + ' · ' + state.index.blocks.length + ' 个街区 · 同一重建器');
    if (state.index.results_heading) $('resultsSummary').textContent = state.index.results_heading;
    $('cohortControl').hidden = $('addedHeading').hidden = !hasAdded;
    if (hasAdded && ['pilot', 'added'].includes(query.get('cohort'))) $('cohortFilter').value = query.get('cohort');
    for (const block of state.index.blocks) addOption($('block'), block.id, block.label + ' · ' + block.count);
    for (const arm of state.index.arms) {
      addOption($('method'), arm, methodInfo(arm).label);
      const row = $('armResults').insertRow();
      row.insertCell().textContent = methodInfo(arm).label;
      row.insertCell().textContent = (state.index.status_counts[arm].roof_generated || 0) + ' / ' + state.index.count;
      if (hasAdded) row.insertCell().textContent = (state.index.added_status_counts[arm].roof_generated || 0) + ' / ' + state.index.added_count;
    }
    $('method').value = state.index.arms.includes(query.get('method')) ? query.get('method') : (state.index.default_method || 'point_weight');
    if (Array.from($('mode').options).some(o => o.value === query.get('mode'))) $('mode').value = query.get('mode');
    setBlock(state.index.blocks.some(b => b.id === query.get('block')) ? query.get('block') : 'boston_g5',
      query.get('building') || 'OSM_way_407834212');
    await selectBuilding();
  } catch (error) {
    state.error = '实验数据载入失败，请刷新页面。';
    updatePanel();
    console.error(error);
  }
}

$('block').addEventListener('change', event => { setBlock(event.target.value); selectBuilding(); });
$('cohortFilter').addEventListener('change', () => { setBlock($('block').value, $('building').value); selectBuilding(); });
$('building').addEventListener('change', selectBuilding);
$('method').addEventListener('change', () => {
  state.previous = state.active;
  state.active = $('method').value;
  updatePanel();
  shareState();
});
$('mode').addEventListener('change', () => { updatePanel(); shareState(); });
$('points').addEventListener('change', updatePanel);
$('top').addEventListener('click', () => setTop(!state.top));
$('image').addEventListener('click', () => {
  state.image = !state.image;
  setTop(state.image || state.top);
});
$('zoomIn').addEventListener('click', () => zoom(1.23));
$('zoomOut').addEventListener('click', () => zoom(1 / 1.23));
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
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { pointer = null; });
new ResizeObserver(requestPaint).observe(canvas);
$('results').addEventListener('toggle', async event => {
  const target = event.currentTarget;
  if (!target.open || target.dataset.loaded) return;
  target.dataset.loaded = 'yes';
  try {
    const summary = await json('summary.json');
    const findings = Array.isArray(summary.findings) ? summary.findings.filter(note => typeof note === 'string').slice(0, 6) : [];
    for (const note of findings) {
      const item = document.createElement('li');
      item.textContent = note;
      $('summaryNotes').append(item);
    }
    $('summaryNotes').hidden = !findings.length;
    for (const sample of summary.cases || []) {
      if (!state.index.buildings.some(row => row.block === sample.block && row.id === sample.id) ||
          !state.index.arms.includes(sample.method)) continue;
      const item = document.createElement('li');
      const link = document.createElement('a');
      const url = new URL(location.href);
      url.search = new URLSearchParams({ block: sample.block, building: sample.id, method: sample.method, mode: 'roof' });
      link.href = url;
      link.textContent = sample.label;
      item.append(link);
      $('summaryCases').append(item);
    }
    $('summaryCases').hidden = !$('summaryCases').childElementCount;
    $('summaryLink').hidden = false;
  } catch {
    // The stage table also works in export previews without a science summary.
  }
});
init();

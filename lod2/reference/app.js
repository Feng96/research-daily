import * as THREE from '../vendor/three.module.js';

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-US');
const config = {
  dc: {title:'Washington, DC', region:'Georgetown', note:'235 条完整建筑记录，匹配此前抽查的 100 条屋面记录。EGID 可能对应多个建筑部分，不代表 235 个独立建筑。', date:'2005 / 2010 / 2013 混合测量来源', crs:'EPSG:26985；Z 按米预览，垂直基准未核实。', height:'各记录减去自身最小 Z，再放在平面底图上；保留记录内部的高度差。', caveat:'源记录可能包含联排建筑或多个建筑部分。与屋面表通过 EGID 关联时并非一对一。不能把数据集名称当作逐建筑测量日期。', example:'DC-56541', zoom:17.7},
};
let activeId='dc', sceneData=null, selected=null, isolated=false, basemap='satellite', rotating=false;
let loadToken=0, visibleModels=[], toastTimer, pendingHash=null;
const cache=new Map();
let positions,edges,classes,owners,baseColors;
const scene=new THREE.Scene(),camera=new THREE.Camera();
const root=new THREE.Group();scene.add(root);
scene.add(new THREE.AmbientLight(0xffffff,2));
const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-300,-200,700);scene.add(sun);
const fill=new THREE.DirectionalLight(0xc9e4ed,.6);fill.position.set(500,200,300);scene.add(fill);
const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1,metalness:0,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);root.add(mesh);
const edgeMaterial=new THREE.LineBasicMaterial({color:0x355246,transparent:true,opacity:.47,depthWrite:false});
const lines=new THREE.LineSegments(new THREE.BufferGeometry(),edgeMaterial);lines.renderOrder=1;root.add(lines);
const selectionMaterial=new THREE.LineBasicMaterial({color:0x39d6a2,transparent:true,opacity:.95,depthTest:true,depthWrite:false});
const selectedLines=new THREE.LineSegments(new THREE.BufferGeometry(),selectionMaterial);selectedLines.renderOrder=5;root.add(selectedLines);
const raycaster=new THREE.Raycaster();

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4300);}
function showLoading(message){$('loading-text').textContent=message;$('loading').hidden=false;}
function attributionLink(href,label){return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;}
const map=new maplibregl.Map({container:'map',center:[-77.064,38.908],zoom:17.6,pitch:58,bearing:-32,maxPitch:80,maxZoom:22,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true},style:{version:8,sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community'},osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:attributionLink('https://www.openstreetmap.org/copyright','© OpenStreetMap contributors')}},layers:[{id:'background',type:'background',paint:{'background-color':'#bfcbb9'}},{id:'satellite',type:'raster',source:'satellite',paint:{'raster-fade-duration':200}},{id:'osm',type:'raster',source:'osm',layout:{visibility:'none'},paint:{'raster-fade-duration':200}}]}});
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
map.addControl(new maplibregl.FullscreenControl(),'top-right');
map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-right');
let renderer,projectionReady=false, lastTileError=0;
const customLayer={id:'official-building-geometry',type:'custom',renderingMode:'3d',
  onAdd(map,gl){renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl});renderer.autoClear=false;renderer.outputColorSpace=THREE.SRGBColorSpace;},
  render(gl,args){
    if(!sceneData)return;
    const origin=maplibregl.MercatorCoordinate.fromLngLat(sceneData.anchor,0);
    const scale=origin.meterInMercatorCoordinateUnits();
    const matrix=args.defaultProjectionData?.mainMatrix||args;
    const m=new THREE.Matrix4().fromArray(matrix);
    const local=new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).scale(new THREE.Vector3(scale,-scale,scale));
    camera.projectionMatrix=m.multiply(local);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    renderer.resetState();renderer.render(scene,camera);renderer.resetState();projectionReady=true;
  }
};

async function fetchScene(id){
  if(cache.has(id))return cache.get(id);
  const responses=await Promise.all(['json','positions.bin','edges.bin','classes.bin'].map(async ext=>{const response=await fetch(`./data/${id}.${ext}.gz`);if(!response.ok)return response;const bytes=new Uint8Array(await response.arrayBuffer());return bytes[0]===31&&bytes[1]===139?new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))):new Response(bytes);}));
  for(const r of responses)if(!r.ok)throw new Error(`数据下载失败 (${r.status})`);
  const [metadata,p,e,c]=await Promise.all([responses[0].json(),responses[1].arrayBuffer(),responses[2].arrayBuffer(),responses[3].arrayBuffer()]);
  const result={metadata,positions:new Float32Array(p),edges:new Float32Array(e),classes:new Uint8Array(c)};
  cache.set(id,result);return result;
}

async function loadDataset(id,restore){
  const token=++loadToken;activeId=id;selected=null;isolated=false;projectionReady=false;
  $('selection').hidden=true;$('selection-empty').hidden=false;$('selection-tag').textContent='点击建筑';
  $('isolate-model').setAttribute('aria-pressed','false');$('isolate-model').textContent='单独显示';
  $('philly-units').hidden=id!=='philadelphia';$('z-unit').value='1';
  document.querySelectorAll('[data-dataset]').forEach(b=>b.classList.toggle('active',b.dataset.dataset===id));
  if($('model-filter').value==='detailed'&&!id.startsWith('boston'))$('model-filter').value='all';
  $('dataset-note').textContent=config[id].note;$('caption-city').textContent=config[id].title;
  showLoading(`正在加载 ${config[id].title}`);
  try{
    const data=await fetchScene(id);if(token!==loadToken)return;
    sceneData=data.metadata;positions=data.positions;edges=data.edges;classes=data.classes;
    owners=new Uint16Array(classes.length);
    for(let i=0;i<sceneData.models.length;i++){const m=sceneData.models[i];owners.fill(i,m.triStart,m.triStart+m.triCount);}
    mesh.geometry.dispose();lines.geometry.dispose();selectedLines.geometry.dispose();
    mesh.geometry=new THREE.BufferGeometry();mesh.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));mesh.geometry.computeVertexNormals();
    lines.geometry=new THREE.BufferGeometry();lines.geometry.setAttribute('position',new THREE.BufferAttribute(edges,3));
    selectedLines.geometry=new THREE.BufferGeometry();selectedLines.visible=false;
    recolor();applyFilter();applyAppearance();
    $('loading').hidden=true;$(`count-${id}`).textContent=fmt(sceneData.models.length);
    if(restore){
      map.jumpTo({center:restore.center,zoom:restore.zoom,pitch:restore.pitch,bearing:restore.bearing});
      if(restore.model)selectModel(sceneData.models.find(m=>m.id===restore.model),false);
    }else{
      const example=sceneData.models.find(m=>m.id===config[id].example);
      if(example)selectModel(example,true);else overview();
    }
    updateHash();
  }catch(error){if(token!==loadToken)return;$('loading-text').textContent='模型加载失败';$('loading').querySelector('span').textContent=error.message;toast(error.message);console.error(error);}
}

function applyFilter(){
  if(!sceneData)return;
  const filter=$('model-filter').value;
  visibleModels=sceneData.models.filter(m=>(filter!=='inclined'||m.inclinedFaces>0)&&(filter!=='detailed'||(!isNaN(+m.lod)&&+m.lod>=2))&&(!isolated||m===selected));
  const roofOnly=$('roof-only').checked;
  let vertexCount=0,edgeVertices=0;
  for(const m of visibleModels){for(let t=m.triStart;t<m.triStart+m.triCount;t++)if(!roofOnly||classes[t]!==2)vertexCount+=3;edgeVertices+=m.edgeCount*2;}
  const index=new Uint32Array(vertexCount), edgeIndex=new Uint32Array(edgeVertices);let cursor=0,ec=0;
  for(const m of visibleModels){
    for(let t=m.triStart;t<m.triStart+m.triCount;t++){if(roofOnly&&classes[t]===2)continue;index[cursor++]=t*3;index[cursor++]=t*3+1;index[cursor++]=t*3+2;}
    for(let i=m.edgeStart*2;i<(m.edgeStart+m.edgeCount)*2;i++)edgeIndex[ec++]=i;
  }
  mesh.geometry.setIndex(new THREE.BufferAttribute(index,1));lines.geometry.setIndex(new THREE.BufferAttribute(edgeIndex,1));
  $('visible-count').textContent=fmt(visibleModels.length);$('inclined-count').textContent=fmt(visibleModels.filter(m=>m.inclinedFaces>0).length);
  $('caption-count').textContent=`${fmt(visibleModels.length)} 条源模型记录${filter==='all'?'':' · 已筛选'}`;
  // Edge buffer preserves all source rings; roof-only view hides the all-face edge buffer.
  lines.visible=$('show-models').checked&&$('show-edges').checked&&!roofOnly;
  selectedLines.visible=$('show-models').checked&&!!selected&&visibleModels.includes(selected)&&!roofOnly;
  if(!visibleModels.length)toast('此筛选条件下没有模型。可切换数据集或选择“全部已加载模型”。');
  map.triggerRepaint();
}

function recolor(){
  if(!sceneData)return;
  const mode=$('color-mode').value;
  const surface=[new THREE.Color('#eee1b6'),new THREE.Color('#e5a05c'),new THREE.Color('#acc4c9')];
  const lodColors=[new THREE.Color('#a8c3cd'),new THREE.Color('#b3ca9e'),new THREE.Color('#e5a05c')];
  const neutral=new THREE.Color('#e8e9dd');
  baseColors=new Float32Array(positions.length);
  for(let t=0;t<classes.length;t++){
    const m=sceneData.models[owners[t]];
    const color=mode==='neutral'?neutral:mode==='lod'?(isNaN(+m.lod)?neutral:lodColors[+m.lod>=2?2:+m.lod>1?1:0]):surface[classes[t]];
    for(let j=0;j<3;j++){const p=t*9+j*3;baseColors[p]=color.r;baseColors[p+1]=color.g;baseColors[p+2]=color.b;}
  }
  mesh.geometry.setAttribute('color',new THREE.BufferAttribute(baseColors,3));
  const labels=mode==='surface'?[['#e5a05c','倾斜面'],['#eee1b6','近水平面'],['#acc4c9','近竖直面']]:mode==='lod'?[['#a8c3cd','LoD1'],['#b3ca9e','LoD1.5'],['#e5a05c','LoD ≥ 2'],['#e8e9dd','未标注']]:[['#e8e9dd','原始几何 · 素色']];
  $('legend').replaceChildren(...labels.map(([color,label])=>{const span=document.createElement('span');const i=document.createElement('i');i.style.background=color;span.append(i,document.createTextNode(label));return span;}));
  map.triggerRepaint();
}

function applyAppearance(){
  if(!sceneData)return;
  const alpha=+$('opacity').value/100;
  material.opacity=alpha;material.transparent=alpha<1;material.depthWrite=alpha>=.95;material.needsUpdate=true;
  $('opacity-value').textContent=`${Math.round(alpha*100)}%`;
  mesh.visible=$('show-models').checked;
  lines.visible=mesh.visible&&$('show-edges').checked&&!$('roof-only').checked;
  root.scale.z=+$('height-scale').value*(activeId==='philadelphia'?+$('z-unit').value:1);
  root.updateMatrixWorld(true);
  selectedLines.visible=mesh.visible&&!!selected&&visibleModels.includes(selected)&&!$('roof-only').checked;
  map.triggerRepaint();
}

function selectModel(model,focus=false){
  if(!model)return;
  selected=model;$('selection-empty').hidden=true;$('selection').hidden=false;$('selection-tag').textContent='已选中';
  $('selected-name').textContent=model.name;$('selected-id').textContent=model.id;
  const facts=[['源 LoD 标签',model.lod],['倾斜面 / 全部面',`${fmt(model.inclinedFaces)} / ${fmt(model.faceCount)}`],['源 Z 范围',`${model.sourceZMin.toFixed(2)} – ${model.sourceZMax.toFixed(2)}`],['源 Z 单位',model.units],['测量 / 数据日期',model.survey],['源状态',model.status],['屋顶类型字段',model.roofType],['来源',model.credit]];
  $('selected-facts').replaceChildren(...facts.flatMap(([key,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value||'—';return [dt,dd];}));
  selectedLines.geometry.dispose();selectedLines.geometry=new THREE.BufferGeometry();
  selectedLines.geometry.setAttribute('position',new THREE.BufferAttribute(edges.slice(model.edgeStart*6,(model.edgeStart+model.edgeCount)*6),3));
  selectedLines.visible=$('show-models').checked&&visibleModels.includes(model)&&!$('roof-only').checked;
  if(isolated)applyFilter();
  if(focus)focusModel(model);else map.triggerRepaint();
  updateHash();
}

function focusModel(model){
  if(!model)return;
  const b=model.bounds;
  const width=(b[1][0]-b[0][0])*111320*Math.cos(model.center[1]*Math.PI/180);
  const depth=(b[1][1]-b[0][1])*111320;
  const span=Math.max(width,depth,model.height,35);
  const zoom=Math.min(20.1,Math.max(15.8,19.3-Math.log2(span/70)));
  const sidebarVisible=!$('sidebar').hidden;
  map.easeTo({center:model.center,zoom,pitch:58,bearing:map.getBearing(),padding:{left:sidebarVisible&&innerWidth>640?360:0,right:30,top:60,bottom:60},duration:950});
}

function overview(){
  if(!visibleModels.length)return;
  const bounds=new maplibregl.LngLatBounds();for(const m of visibleModels){bounds.extend(m.bounds[0]);bounds.extend(m.bounds[1]);}
  map.fitBounds(bounds,{padding:{left:!$('sidebar').hidden&&innerWidth>640?390:45,right:80,top:150,bottom:100},pitch:45,bearing:-25,duration:900,maxZoom:18});
}

function setBasemap(id){basemap=id;map.setLayoutProperty('satellite','visibility',id==='satellite'?'visible':'none');map.setLayoutProperty('osm','visibility',id==='osm'?'visible':'none');for(const name of ['satellite','osm']){$(name).classList.toggle('active',name===id);$(name).setAttribute('aria-pressed',name===id?'true':'false');}updateHash();}
function updateHash(){if(!sceneData)return;const center=map.getCenter();const state=new URLSearchParams({data:activeId,base:basemap,lng:center.lng.toFixed(6),lat:center.lat.toFixed(6),z:map.getZoom().toFixed(2),p:map.getPitch().toFixed(1),b:map.getBearing().toFixed(1),filter:$('model-filter').value});if(selected)state.set('model',selected.id);history.replaceState(null,'','#'+state.toString());}

function sourceInfo(){
  const c=config[activeId], models=sceneData?.models||[];
  const lodCounts={};for(const m of models)lodCounts[m.lod]=(lodCounts[m.lod]||0)+1;
  const container=$('source-content');container.replaceChildren();
  const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;container.append(node);return node;};
  add('h3',`${c.title} · ${c.region}`);add('p',c.note);
  const link=add('a','打开官方数据源 ↗');link.href=sceneData?.source;link.target='_blank';link.rel='noopener noreferrer';
  add('h3','源标签分布');add('p',Object.entries(lodCounts).map(([label,n])=>`${label}: ${fmt(n)} 条`).join('；'));
  add('h3','日期与坐标');add('p',c.date);add('p',c.crs);
  add('h3','高度如何显示');add('p',c.height);
  add('h3','需注意的数据条件');add('p',c.caveat);
  add('h3','没有推测缺失的屋顶');add('p','原始面只做三角化以供浏览器渲染，保留内环；不拟合或补全屋面。边界线来自源多边形，所以源数据本身若已三角化，也会显示三角面边界。倾斜面按源坐标计算面方向（约 5°–85°），可能包含斜立面，不作屋面真实性认证。');
  const warning=add('p','此页面未加载真实地形，模型以各自地面或最低 Z 为参考放置。卫星底图使用 Esri World Imagery 合成影像，并非本实验的同期 NAIP 输入。它可帮助目视检查轮廓与结构，不能代替 NAIP＋3DEP 配准和独立精度评估。');warning.className='warning';
  add('p','地图：MapLibre GL JS 5.6.0 · 三维渲染：Three.js r169。底图与模型的版权归各自数据提供者。');
  $('source-dialog').showModal();
}

function exportModel(){
  if(!selected)return;
  const m=selected,arr=positions.subarray(m.triStart*9,(m.triStart+m.triCount)*9);
  const text=[`# Display mesh, NOT original CRS or certified GT`,`# Source ${sceneData.source}`,`# Model ${m.id}`,`# Anchor WGS84 ${sceneData.anchor.join(', ')}`,`# Local axes: X east, Y north, Z above model reference`,`# ${m.units}`,`# Source base Z ${m.sourceBase}; source coordinates unaltered in original archives`];
  for(let i=0;i<arr.length;i+=3)text.push(`v ${arr[i].toFixed(5)} ${arr[i+1].toFixed(5)} ${arr[i+2].toFixed(5)}`);
  for(let i=0;i<arr.length/3;i+=3)text.push(`f ${i+1} ${i+2} ${i+3}`);
  const url=URL.createObjectURL(new Blob([text.join('\n')+'\n'],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download=m.id+'_display.obj';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}

document.querySelectorAll('[data-dataset]').forEach(b=>b.addEventListener('click',()=>loadDataset(b.dataset.dataset)));
$('satellite').onclick=()=>setBasemap('satellite');$('osm').onclick=()=>setBasemap('osm');
$('model-filter').onchange=()=>{isolated=false;$('isolate-model').setAttribute('aria-pressed','false');$('isolate-model').textContent='单独显示';applyFilter();overview();updateHash();};
$('show-models').onchange=applyAppearance;$('show-edges').onchange=applyAppearance;$('roof-only').onchange=()=>{applyFilter();applyAppearance();};
$('opacity').oninput=applyAppearance;$('height-scale').onchange=applyAppearance;$('z-unit').onchange=()=>{applyAppearance();toast('已改变 Z 单位显示假设；这不代表单位已经核验。');};$('color-mode').onchange=recolor;
$('overview').onclick=overview;$('focus-model').onclick=()=>focusModel(selected);
$('isolate-model').onclick=()=>{isolated=!isolated;$('isolate-model').setAttribute('aria-pressed',String(isolated));$('isolate-model').textContent=isolated?'恢复全部':'单独显示';applyFilter();};
$('source-info').onclick=sourceInfo;$('close-dialog').onclick=()=>$('source-dialog').close();
$('source-dialog').addEventListener('click',e=>{if(e.target===$('source-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('example').onclick=()=>{const candidates=visibleModels.filter(m=>m.inclinedFaces>0);const m=visibleModels.find(m=>m.id===config[activeId].example)||candidates.sort((a,b)=>b.inclinedFaces-a.inclinedFaces)[0]||visibleModels[0];selectModel(m,true);};
$('find-model').onclick=()=>{const query=$('model-search').value.trim().toLowerCase();if(!query)return;const model=sceneData?.models.find(m=>m.id.toLowerCase()===query||m.name.toLowerCase()===query)||sceneData?.models.find(m=>m.id.toLowerCase().includes(query)||m.name.toLowerCase().includes(query));if(model){$('model-filter').value='all';applyFilter();selectModel(model,true);}else toast('没有找到该模型 ID 或名称。');};
$('model-search').onkeydown=e=>{if(e.key==='Enter')$('find-model').click();};
$('download-model').onclick=exportModel;
function collapsePanel(collapse){$('sidebar').hidden=collapse;$('expand').hidden=!collapse;document.body.classList.toggle('collapsed',collapse);}
$('collapse').onclick=()=>collapsePanel(true);$('expand').onclick=()=>collapsePanel(false);if(innerWidth<760)collapsePanel(true);
$('view-3d').onclick=()=>{map.easeTo({pitch:58,duration:650});$('view-3d').classList.add('active');$('view-top').classList.remove('active');};
$('view-top').onclick=()=>{map.easeTo({pitch:0,bearing:0,duration:650});$('view-top').classList.add('active');$('view-3d').classList.remove('active');};
let previousFrame=0;
function rotateFrame(time){if(!rotating)return;if(previousFrame)map.setBearing(map.getBearing()+(time-previousFrame)*.006);previousFrame=time;requestAnimationFrame(rotateFrame);}
$('rotate').onclick=()=>{rotating=!rotating;previousFrame=0;$('rotate').classList.toggle('active',rotating);if(rotating)requestAnimationFrame(rotateFrame);};
map.on('dragstart',()=>{rotating=false;$('rotate').classList.remove('active');});
$('share').onclick=async()=>{updateHash();try{await navigator.clipboard.writeText(location.href);toast('已复制当前数据、底图、视角与模型链接。');}catch{toast('当前视图已写入地址栏，可直接复制浏览器地址。');}};
map.on('moveend',updateHash);
map.on('click',event=>{
  if(!projectionReady||!mesh.visible)return;
  const canvas=map.getCanvas(),x=event.point.x/canvas.clientWidth*2-1,y=1-event.point.y/canvas.clientHeight*2;
  const inverse=camera.projectionMatrixInverse;
  const near=new THREE.Vector3(x,y,-1).applyMatrix4(inverse),far=new THREE.Vector3(x,y,1).applyMatrix4(inverse);
  raycaster.set(near,far.sub(near).normalize());root.updateMatrixWorld(true);
  const hit=raycaster.intersectObject(mesh,false)[0];if(hit)selectModel(sceneData.models[owners[Math.floor(hit.face.a/3)]],false);
});
map.on('error',event=>{if(event.error?.message&&Date.now()-lastTileError>15000){lastTileError=Date.now();toast('部分底图瓦片加载失败；可切换卫星 / OSM 重试。模型几何会继续显示。');}});
map.on('webglcontextlost',()=>toast('浏览器三维绘图上下文丢失，请刷新或开启硬件加速。'));

map.on('load',()=>{
  map.addLayer(customLayer);
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.get('base')==='osm')setBasemap('osm');
  const id=config[params.get('data')]?params.get('data'):'dc';
  if(['all','inclined','detailed'].includes(params.get('filter')))$('model-filter').value=params.get('filter');
  const nums=['lng','lat','z','p','b'].map(k=>params.has(k)?+params.get(k):NaN);
  if(nums.every(Number.isFinite))pendingHash={center:nums.slice(0,2),zoom:nums[2],pitch:nums[3],bearing:nums[4],model:params.get('model')};
  loadDataset(id,pendingHash);
});

// Read-only handles for browser verification; product state remains in the controls.
window.lod2Viewer={map,get data(){return sceneData;},get selected(){return selected;},get visibleCount(){return visibleModels.length;},get renderedTriangles(){return mesh.geometry.index?.count/3||0;},get rendererInfo(){return renderer?.info.render;}};
import * as THREE from '../vendor/three.module.js';
import {createPointCloudController} from './point_clouds.js?v=20261022-local';

const $=id=>document.getElementById(id);
const chapter=new URLSearchParams(location.search).get('chapter')||'pilot';
let GROUPS=[],LABELS={};
let visibleBuildings=[];
const BASELINES={pilot:'roofer',optimization:'baseline',overnight:'baseline',tree:'global_geo',workflow:'initial',canopy:'baseline',repair:'baseline'};
let data,selected,group='',basemap='satellite',syncing=false,temporaryHide=false;
let loadError=false,loaded=false,hashTimer,toastTimer,lastTileError=0,frameToken=0;
const mapErrors=[];
const initialHash=new URLSearchParams(location.hash.slice(1));
group=initialHash.get('group')||'';
if(['satellite','naip','osm'].includes(initialHash.get('base')))basemap=initialHash.get('base');

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5200);}
function style(){return {version:8,sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:21,attribution:'Imagery © Esri, Vantor, Earthstar Geographics and the GIS User Community'},osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'}},layers:[{id:'background',type:'background',paint:{'background-color':'#d0d9cb'}},{id:'satellite',type:'raster',source:'satellite',layout:{visibility:basemap==='satellite'?'visible':'none'},paint:{'raster-fade-duration':0}},{id:'osm',type:'raster',source:'osm',layout:{visibility:basemap==='osm'?'visible':'none'},paint:{'raster-fade-duration':0}}]};}
function createMap(container,pitch){const map=new maplibregl.Map({container,center:[-77.0718,38.9122],zoom:19.3,pitch,bearing:0,maxZoom:22,maxPitch:75,renderWorldCopies:false,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true},style:style()});map.addControl(new maplibregl.NavigationControl({showCompass:true,visualizePitch:!!pitch}),'top-right');map.addControl(new maplibregl.ScaleControl({maxWidth:80,unit:'metric'}),'bottom-left');map.on('error',e=>{mapErrors.push({map:container,message:e.error?.message||String(e.error)});if(Date.now()-lastTileError>15000&&/tile|fetch|network|HTTP/i.test(e.error?.message||'')){lastTileError=Date.now();toast('部分在线底图未加载。可切换“NAIP 2014”，该影像已随页面保存。');}});return map;}
const imageMap=createMap('image-map',0),modelMap=createMap('model-map',55);
imageMap.dragRotate.disable();imageMap.touchZoomRotate.disableRotation();imageMap.keyboard.disableRotation();
const ready=map=>new Promise(resolve=>map.isStyleLoaded()?resolve():map.once('load',resolve));
function synchronize(source,target){if(!loaded||syncing)return;syncing=true;target.jumpTo({center:source.getCenter(),zoom:source.getZoom(),bearing:source.getBearing()});syncing=false;saveHash();}
imageMap.on('move',()=>synchronize(imageMap,modelMap));modelMap.on('move',()=>synchronize(modelMap,imageMap));

const scene=new THREE.Scene(),camera=new THREE.Camera(),root=new THREE.Group();scene.add(root);
scene.add(new THREE.AmbientLight(0xffffff,1.0));
const sun=new THREE.DirectionalLight(0xffffff,1.4);sun.position.set(-250,-250,800);scene.add(sun);
const fill=new THREE.DirectionalLight(0xc6d9e9,.3);fill.position.set(300,200,300);scene.add(fill);
const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1,metalness:0,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);root.add(mesh);
const edgeMaterial=new THREE.LineBasicMaterial({color:0x3b392b,transparent:true,opacity:.75,depthWrite:false});
const edgeLines=new THREE.LineSegments(new THREE.BufferGeometry(),edgeMaterial);edgeLines.renderOrder=2;root.add(edgeLines);
const baselineLines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x42d9e4,transparent:true,opacity:.8,depthWrite:false,depthTest:false}));baselineLines.renderOrder=3;root.add(baselineLines);
const pointCloud=createPointCloudController({THREE,root,map:modelMap,chapter,getSelected:()=>selected,getGroup:()=>group,isHidden:()=>temporaryHide,toast,onChange:saveHash,onHeight:reportHeight,initialHash});
let renderer,renderCount=0;
const modelLayer={id:'experiment-roof-model',type:'custom',renderingMode:'3d',
  onAdd(map,gl){renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl});renderer.autoClear=false;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;},
  render(gl,args){if(!data||!selected)return;const anchor=maplibregl.MercatorCoordinate.fromLngLat(data.anchor,0),scale=anchor.meterInMercatorCoordinateUnits();
    const m=new THREE.Matrix4().fromArray(args.defaultProjectionData?.mainMatrix||args);
    const local=new THREE.Matrix4().makeTranslation(anchor.x,anchor.y,0).scale(new THREE.Vector3(scale,-scale,scale));
    camera.projectionMatrix=m.multiply(local);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    renderer.resetState();renderer.render(scene,camera);renderer.resetState();renderCount++;}
};
function feature(geometry,properties={}){return {type:'Feature',properties,geometry};}
function polygon(b,whichGroup){const g=whichGroup?b.groups[whichGroup]:b;return g.footprintGeometryLngLat||{type:'Polygon',coordinates:[g.footprintLngLat]};}
function selectedFeature(whichGroup){return {type:'FeatureCollection',features:selected?[feature(polygon(selected,whichGroup))]:[]};}

function addSources(map){
  map.addSource('naip',{type:'image',url:data.naip.url,coordinates:data.naip.imageCorners});
  map.addLayer({id:'naip',type:'raster',source:'naip',layout:{visibility:basemap==='naip'?'visible':'none'},paint:{'raster-fade-duration':0,'raster-resampling':'nearest'}});
}
function setupImageOverlays(){
  imageMap.addSource('buildings',{type:'geojson',data:{type:'FeatureCollection',features:data.buildings.filter(b=>$('cohort').value==='all'||b.cohort===$('cohort').value).map(b=>feature(polygon(b),{id:b.id}))}});
  imageMap.addLayer({id:'building-hit',type:'fill',source:'buildings',paint:{'fill-opacity':0,'fill-color':'#ffffff'}});
  imageMap.addSource('selected',{type:'geojson',data:selectedFeature()});
  imageMap.addLayer({id:'selected-outline-shadow',type:'line',source:'selected',paint:{'line-color':'#0e302b','line-width':4,'line-opacity':.65}});
  imageMap.addLayer({id:'selected-outline',type:'line',source:'selected',paint:{'line-color':'#f0ffea','line-width':1.5,'line-dasharray':[4,3]}});
  imageMap.on('click','building-hit',e=>{const id=e.features?.[0]?.properties?.id;const b=data.buildings.find(b=>b.id===id);if(b)selectBuilding(b,true);});
  imageMap.on('mouseenter','building-hit',()=>imageMap.getCanvas().style.cursor='pointer');
  imageMap.on('mouseleave','building-hit',()=>imageMap.getCanvas().style.cursor='');
}
function geometry(b){
  const bases=GROUPS.map(key=>b.groups[key]?.nativeGroundZ).filter(Number.isFinite);
  root.position.z=Number.isFinite(b.displayOffsetZ)?b.displayOffsetZ:(bases.length?b.ground_z-Math.min(...bases):0);
  pointCloud.sync();
  const g=b.groups[group];mesh.geometry.dispose();edgeLines.geometry.dispose();
  const warnings=[...(g?.previewWarnings||[])];if(g?.status!=='success')warnings.unshift('当前记录状态：'+(g?.status||'missing')+'；'+(g?.lodClass||g?.lod||'无声明等级'));$('geometry-warning').hidden=!warnings.length;$('geometry-warning').textContent=warnings.length?'源模型含异常面；三角化仅用于预览。'+warnings.join('；'):'';
  mesh.geometry=new THREE.BufferGeometry();edgeLines.geometry=new THREE.BufferGeometry();
  if(!g?.positions?.length){mesh.visible=false;edgeLines.visible=false;baselineLines.visible=false;baselineLines.geometry.dispose();baselineLines.geometry=new THREE.BufferGeometry();toast('该建筑在当前组没有可显示的模型。');return;}
  const positions=new Float32Array(g.positions);mesh.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));mesh.geometry.computeVertexNormals();
  if($('roof-only').checked){const indices=[];for(let t=0;t<g.roofTriangleMask.length;t++)if(g.roofTriangleMask[t])indices.push(t*3,t*3+1,t*3+2);mesh.geometry.setIndex(indices);}
  const colors=new Float32Array(positions.length);const normal=mesh.geometry.getAttribute('normal');
  for(let t=0;t<positions.length/9;t++){
    let c;if(g.roofTriangleMask[t]){const z=Math.abs(normal.getZ(t*3));c=new THREE.Color().setHSL(.105,.44,.56+.13*z);}else c=new THREE.Color('#bbc4c1');
    for(let k=0;k<3;k++){colors[t*9+k*3]=c.r;colors[t*9+k*3+1]=c.g;colors[t*9+k*3+2]=c.b;}
  }
  mesh.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  edgeLines.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array($('roof-only').checked?(g.roofEdges||[]):g.edges),3));
  // A single display reference is shared by all four groups. Keep the mesh
  // above the flat basemap without clipping low walls on this sloping site.
  // This is a display translation only; no source XYZ or height difference is fitted.
  const nativeBases=GROUPS.map(key=>b.groups[key]?.nativeGroundZ).filter(Number.isFinite);
  root.position.z=Number.isFinite(b.displayOffsetZ)?b.displayOffsetZ:(nativeBases.length?b.ground_z-Math.min(...nativeBases):0);
  baselineLines.geometry.dispose();baselineLines.geometry=new THREE.BufferGeometry();const control=b.groups[BASELINES[chapter]];if(control)baselineLines.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array($('roof-only').checked?(control.roofEdges||[]):control.edges||[]),3));
  appearance();
}
function appearance(){
  const alpha=+$('opacity').value/100;material.opacity=alpha;material.transparent=alpha<1;material.depthWrite=alpha>=.95;material.needsUpdate=true;
  $('opacity-value').textContent=Math.round(alpha*100)+'%';mesh.visible=$('models').checked&&!temporaryHide&&!!selected?.groups[group]?.positions?.length;edgeLines.visible=mesh.visible&&$('edges').checked;baselineLines.visible=!!selected&&$('baseline-overlay').checked&&!temporaryHide&&$('models').checked;
  pointCloud.appearance();saveHash();modelMap.triggerRepaint();
}
function focusBuilding(){
  if(!selected)return;
  const bounds=new maplibregl.LngLatBounds(selected.bounds[0],selected.bounds[1]);
  const rect=imageMap.getContainer().getBoundingClientRect(),padding=Math.max(46,Math.min(95,rect.height*.18));
  // Fit once on the image panel; the model panel uses the same center/scale.
  imageMap.fitBounds(bounds,{padding,maxZoom:21.3,duration:0,bearing:0});
  synchronize(imageMap,modelMap);frameAllGroups();saveHash();
}
function frameAllGroups(){
  // Fit every group's original vertices, including their display Z, so a tall
  // roof is not clipped at the top of the tilted map. Both maps keep one scale.
  const token=++frameToken;
  function check(pass){modelMap.once('render',()=>{
    if(token!==frameToken||!selected||!renderer)return;
    let ratio=0;const point=new THREE.Vector3();
    for(const key of GROUPS){const g=selected.groups[key];for(let i=0;i<g.positions.length;i+=3){
      if($('roof-only').checked&&!g.roofTriangleMask[Math.floor(i/9)])continue;
      point.set(g.positions[i],g.positions[i+1],g.positions[i+2]+root.position.z).applyMatrix4(camera.projectionMatrix);
      if(Number.isFinite(point.x)&&Number.isFinite(point.y))ratio=Math.max(ratio,Math.abs(point.x)/.84,Math.abs(point.y)/.74);
    }}
    if(ratio>1.01&&pass<4){const zoom=Math.max(16,imageMap.getZoom()-Math.min(1.8,Math.max(.12,Math.log2(ratio))));imageMap.jumpTo({zoom});synchronize(imageMap,modelMap);check(pass+1);}
  });modelMap.triggerRepaint();}
  check(0);
}
function renderMetrics(){
  if(chapter==='repair'){
    const row=selected.repair;$('metric-note').textContent='这是局部修正候选，非精度结论。原始点与输入点集相同；生成几何与实测回波分开。';
    $('metrics').replaceChildren(...GROUPS.map(key=>{const button=document.createElement('button');button.className='metric'+(key===group?' active':'');button.setAttribute('aria-pressed',String(key===group));for(const [cls,value]of [['metric-name',LABELS[key]],['metric-value',key==='baseline'?'原始重建':row.proposed_components+' 个局部候选'],['metric-sub',key==='baseline'?'保留原有平台高差':row.shell_diagnostic_passed?'壳体边诊断通过 · 真实性待查':'壳体边诊断未通过 · 不进入检查后输出']]){const span=document.createElement('span');span.className=cls;span.textContent=value;button.append(span);}button.onclick=()=>setGroup(key);return button;}));reportHeight();return;
  }

  if(chapter==='canopy'){
    const row=selected.canopy;$('metric-note').textContent='计数和最高高程是诊断信息，不是精度指标；流程 B 未复现论文原算法。';
    $('metrics').replaceChildren(...GROUPS.map(key=>{const m=row.methods[key],button=document.createElement('button');button.className='metric'+(key===group?' active':'');button.setAttribute('aria-pressed',String(key===group));for(const [cls,value]of [['metric-name',LABELS[key]],['metric-value','筛除 '+m.removed_points+' 点'],['metric-sub',m.roof_surfaces+' 片屋面 · 最高 Z '+m.maximum_roof_z_m.toFixed(3)+' m']]){const span=document.createElement('span');span.className=cls;span.textContent=value;button.append(span);}button.onclick=()=>setGroup(key);return button;}));reportHeight();return;
  }

  if(chapter==='workflow'){
    const row=selected.workflow;
    $('metric-note').textContent='阶段检查，不是精度比较；后端未触发修剪，两阶段模型相同。';
    $('metrics').replaceChildren(...GROUPS.map(key=>{const button=document.createElement('button');button.className='metric'+(key===group?' active':'');button.setAttribute('aria-pressed',String(key===group));for(const [cls,value]of [['metric-name',LABELS[key]],['metric-value',selected.groups[key].roofCount+' 片屋面'],['metric-sub',key==='initial'?'前端筛除 '+row.frontend_removed+' 点；保留 '+row.frontend_kept+' 点':'后端修剪 '+row.post_removed+' 点；不足支撑仍待核查']]){const span=document.createElement('span');span.className=cls;span.textContent=value;button.append(span);}button.onclick=()=>setGroup(key);return button;}));reportHeight();return;
  }

  const paired=$('metric-mode').value==='paired';
  $('metric-note').textContent=paired?'各方法分别与基线取同点交集；负值为误差降低。各交集可能不同，请同时看覆盖。':'全部方法在同一批点上比较；覆盖率指各方法对原留出点的覆盖。';
  $('metrics').replaceChildren(...GROUPS.map(key=>{
    const g=selected.groups[key],m=g.metrics||{},button=document.createElement('button');button.className='metric'+(key===group?' active':'');button.setAttribute('aria-pressed',String(key===group));
    const name=document.createElement('span');name.className='metric-name';name.textContent=LABELS[key];
    const value=document.createElement('span');value.className='metric-value';const x=paired?m.pairedMaeDelta:m.commonMae;value.textContent=Number.isFinite(x)?(paired?(x>0?'+':'')+(x*100).toFixed(2)+' cm':x.toFixed(3)+' m'):'—';
    const sub=document.createElement('span');sub.className='metric-sub';sub.textContent=`屋面 ${g.roofCount??'—'} 个 · 覆盖 ${Number.isFinite(m.ownCoverage)?(m.ownCoverage*100).toFixed(1)+'%':'—'} · ${paired?'成对':'全组'}同点 ${Number.isFinite(paired?m.pairedCoverage:m.commonCoverage)?((paired?m.pairedCoverage:m.commonCoverage)*100).toFixed(1)+'%':'—'}`;
    button.append(name,value,sub);button.onclick=()=>setGroup(key);return button;
  }));
  reportHeight();
}
function selectBuilding(building,focus=true){
  selected=building;$('model-title').textContent=LABELS[group]+' · '+(building.groups[group].lodClass||building.groups[group].lod||'屋面模型');$('building').value=building.id;$('selected-id').textContent=building.shortId||building.id;
  $('selected-height').textContent=chapter==='repair'?'原始回波不动 · 局部候选 · 无独立GT':chapter==='canopy'?'同一原始观测 · 原始索引保留 · 无独立GT':chapter==='workflow'?'固定流程 · 原始XYZ保留 · 高度1×':(building.cohort==='fresh60'?'新增60栋':'原60栋')+' · 跨实验统一显示基准 · 高度1×';
  imageMap.getSource('selected')?.setData(selectedFeature());geometry(building);renderMetrics();
  if(focus)focusBuilding();saveHash();
}
function setGroup(key){
  if(!GROUPS.includes(key))return;group=key;$('group-select').value=key;document.querySelectorAll('[data-group]').forEach(b=>{b.classList.toggle('active',b.dataset.group===key);b.setAttribute('aria-pressed',String(b.dataset.group===key));});
  $('model-title').textContent=LABELS[key]+' · '+(selected?.groups[key]?.lodClass||selected?.groups[key]?.lod||'屋面模型');if(selected){geometry(selected);renderMetrics();}saveHash();
}
function setBasemap(key){
  basemap=key;$('basemap').value=key;
  for(const map of [imageMap,modelMap])for(const name of ['satellite','osm','naip'])if(map.getLayer(name))map.setLayoutProperty(name,'visibility',name===key?'visible':'none');
  $('image-title').textContent={satellite:'真实卫星／航空影像',naip:'真实 NAIP 2014 · 1 米',osm:'OpenStreetMap 地图'}[key];
  $('imagery-note').textContent={satellite:'Esri 合成影像的拍摄时相未逐栋核实，可能与 2014 年建筑状态不同。',naip:'本实验原始 NAIP，目录日期 2014-09-27。原始分辨率 1 米，放大不会增加屋顶细节。',osm:'OSM 用于位置参照；查看实际屋顶，请切换卫星影像或 NAIP。'}[key];
  saveHash();
}
function footprintVisibility(){for(const id of ['selected-outline','selected-outline-shadow'])if(imageMap.getLayer(id))imageMap.setLayoutProperty(id,'visibility',$('footprint').checked?'visible':'none');$('clean-image').textContent=$('footprint').checked?'查看纯影像':'显示定位轮廓';}
function saveHash(){if(!loaded||!selected)return;clearTimeout(hashTimer);hashTimer=setTimeout(()=>{const c=imageMap.getCenter();const state={building:selected.id,group,base:basemap,cohort:$('cohort').value,lng:c.lng.toFixed(7),lat:c.lat.toFixed(7),z:imageMap.getZoom().toFixed(3),bearing:imageMap.getBearing().toFixed(2),pitch:modelMap.getPitch().toFixed(1),...pointCloud.state()};history.replaceState(null,'','#'+new URLSearchParams(state));if(parent!==window)parent.postMessage({type:'lod2-selection',chapter,...state},location.origin);},150);}
function reportHeight(){if(parent!==window)requestAnimationFrame(()=>parent.postMessage({type:'lod2-height',height:document.body.scrollHeight},location.origin));}
function filterBuildings(focus=true){
  visibleBuildings=data.buildings.filter(b=>$('cohort').value==='all'||b.cohort===$('cohort').value);
  $('building').replaceChildren(...visibleBuildings.map((b,i)=>{const option=document.createElement('option');option.value=b.id;option.textContent=`${String(i+1).padStart(2,'0')} · ${b.shortId||b.id}`;return option;}));
  imageMap.getSource('buildings')?.setData({type:'FeatureCollection',features:visibleBuildings.map(b=>feature(polygon(b),{id:b.id}))});
  const target=visibleBuildings.find(b=>b.id===selected?.id)||visibleBuildings[0];if(target)selectBuilding(target,focus);
}
function cycle(offset){if(!data)return;const index=visibleBuildings.indexOf(selected);selectBuilding(visibleBuildings[(index+offset+visibleBuildings.length)%visibleBuildings.length]);}
async function exportImage(){
  if(!selected||!loaded)return;
  try{
    imageMap.triggerRepaint();modelMap.triggerRepaint();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const a=imageMap.getCanvas(),b=modelMap.getCanvas(),w=1000,h=Math.round(w*a.height/a.width),canvas=document.createElement('canvas');canvas.width=w*2;canvas.height=h+126;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#f5f6f2';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#19392b';ctx.font='bold 24px sans-serif';ctx.fillText(`${selected.shortId||selected.id} | ${LABELS[group]}`,24,34);
    ctx.font='17px sans-serif';ctx.fillText($('image-title').textContent,24,64);ctx.fillText((selected.groups[group].lodClass||selected.groups[group].lod||selected.groups[group].status||'屋面模型')+' '+LABELS[group]+' | 高度比例 1×',w+24,64);
    ctx.drawImage(a,0,78,w,h);ctx.drawImage(b,w,78,w,h);ctx.fillStyle='#52655b';ctx.font='14px sans-serif';ctx.fillText('Imagery © Esri / NAIP / OpenStreetMap · 3DEP 2014-04-24 · NAIP 2014-09-27 · 卫星底图时相未逐栋核实',24,h+105);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG export failed');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`roof_${selected.shortId||selected.id}_${group}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch(e){toast('对照图导出失败，可使用浏览器截图。');console.error(e);}
}

$('previous').onclick=()=>cycle(-1);$('next').onclick=()=>cycle(1);$('focus').onclick=focusBuilding;
$('building').onchange=e=>{const b=data?.buildings.find(b=>b.id===e.target.value);if(b)selectBuilding(b);};
document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>setGroup(b.dataset.group));
document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{const target=data?.buildings.find(x=>x.id===b.dataset.example);if(target)selectBuilding(target);});
$('basemap').onchange=e=>setBasemap(e.target.value);$('footprint').onchange=footprintVisibility;
$('clean-image').onclick=()=>{$('footprint').checked=!$('footprint').checked;footprintVisibility();};
$('models').onchange=appearance;$('baseline-overlay').onchange=appearance;$('metric-mode').onchange=renderMetrics;$('cohort').onchange=()=>filterBuildings(true);$('group-select').onchange=e=>setGroup(e.target.value);$('edges').onchange=appearance;$('opacity').oninput=appearance;
$('roof-only').onchange=()=>{if(selected)geometry(selected);};
function setView(pitch){frameToken++;if(pitch>0)modelMap.once('moveend',()=>frameAllGroups());modelMap.easeTo({pitch,duration:450});$('view-3d').classList.toggle('active',pitch>0);$('view-top').classList.toggle('active',pitch===0);$('view-3d').setAttribute('aria-pressed',String(pitch>0));$('view-top').setAttribute('aria-pressed',String(pitch===0));}
$('view-3d').onclick=()=>setView(55);$('view-top').onclick=()=>setView(0);$('export').onclick=exportImage;
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!e.target.closest('input,select,button,textarea,a')){e.preventDefault();temporaryHide=true;appearance();}});
window.addEventListener('keyup',e=>{if(e.code==='Space'){temporaryHide=false;appearance();}});
window.addEventListener('blur',()=>{if(temporaryHide){temporaryHide=false;appearance();}});
window.addEventListener('resize',()=>{imageMap.resize();modelMap.resize();reportHeight();});

async function init(){
  try{
    const response=await fetch(chapter==='repair'?'../repair/data/viewer.json.gz':chapter==='canopy'?'../next/canopy/data/viewer.json.gz':chapter==='workflow'?'../next/data/viewer.json.gz':'../data/'+chapter+'.json.gz');if(!response.ok)throw new Error('模型数据 HTTP '+response.status);
    const bytes=new Uint8Array(await response.arrayBuffer());let jsonText;
    if(bytes[0]===31&&bytes[1]===139){if(!window.DecompressionStream)throw new Error('此浏览器不支持压缩数据，请使用新版浏览器');jsonText=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}else{jsonText=new TextDecoder().decode(bytes);}
    data=JSON.parse(jsonText);
    GROUPS=data.groupOrder;LABELS=data.groupLabels;group=GROUPS.includes(group)?group:GROUPS[0];
    data.naip.url='../data/naip2014.png';
    if(!data.buildings.length||data.buildings.length!==data.buildingCount)throw new Error('建筑分母与导出清单不一致');
    $('chapter-name').textContent={pilot:'01 · 五种重建方法',optimization:'02 · 四组输入优化',overnight:'03 · 120栋扩展复核',tree:'04 · 树冠干扰与语义迁移',workflow:'固定工作流 v0.1',canopy:'树冠清理 · 三组复核',repair:'局部屋面修正 · 8 栋验证'}[chapter]||chapter;
    $('chapter-detail').textContent=`Georgetown · ${data.buildingCount}栋 · ${GROUPS.length}组方法 · ${chapter==='tree'?'零本地标签迁移 · 待核查':'原始观测2014年'}`;
    if(chapter==='repair'){$('chapter-detail').textContent='8 栋 · 修正前 / 局部候选 · 原始点不动';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=cohort]').hidden=true;}
    if(chapter==='canopy'){$('chapter-detail').textContent='8 栋 · 3 组 · 实际原始点云 · 后端未触发修剪';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=cohort]').hidden=true;}
    if(chapter==='workflow'){$('chapter-detail').textContent='Georgetown · 8 栋流程验证 · 2 个阶段 · 无精度结论';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=group-select]').textContent='阶段';document.querySelector('label[for=cohort]').hidden=true;document.querySelector('#baseline-overlay').closest('label').lastChild.textContent='初始屋面轮廓';}
    $('group-select').replaceChildren(...GROUPS.map(key=>{const o=document.createElement('option');o.value=key;o.textContent=LABELS[key];return o;}));$('group-select').disabled=false;
    $('cohort').hidden=!['overnight','tree'].includes(chapter);$('cohort').value=['overnight','tree'].includes(chapter)&&['legacy60','fresh60'].includes(initialHash.get('cohort'))?initialHash.get('cohort'):'all';
    $('metric-mode').value=['overnight','tree'].includes(chapter)?'paired':'common';
    await Promise.all([ready(imageMap),ready(modelMap)]);for(const map of [imageMap,modelMap])addSources(map);setupImageOverlays();modelMap.addLayer(modelLayer);
    visibleBuildings=data.buildings.filter(b=>$('cohort').value==='all'||b.cohort===$('cohort').value);$('building').replaceChildren(...visibleBuildings.map((b,i)=>{const o=document.createElement('option');o.value=b.id;o.textContent=`${String(i+1).padStart(2,'0')} · ${b.shortId||b.id}`;return o;}));
    $('building').disabled=false;$('export').disabled=false;loaded=true;setGroup(group);setBasemap(basemap);
    const initial=visibleBuildings.find(b=>b.id===initialHash.get('building'))||visibleBuildings.find(b=>b.id==='usbf-v1-dc-row85141-osm-66347936')||visibleBuildings[0];
    selectBuilding(initial,true);
    const lng=+initialHash.get('lng'),lat=+initialHash.get('lat'),zoom=+initialHash.get('z');
    if(initialHash.has('lng')&&Number.isFinite(lng)&&Number.isFinite(lat)&&zoom>=14&&zoom<=22){imageMap.jumpTo({center:[lng,lat],zoom,bearing:+initialHash.get('bearing')||0});synchronize(imageMap,modelMap);}
    if(initialHash.has('pitch'))setView(Math.min(75,Math.max(0,+initialHash.get('pitch')||0)));
    $('loading').hidden=true;reportHeight();
  }catch(e){loadError=true;$('loading-text').textContent='页面数据加载失败：'+e.message;console.error(e);}
}
window.roofCompare={imageMap,modelMap,get data(){return data;},get selected(){return selected;},get group(){return group;},get loaded(){return loaded;},get error(){return loadError;},get renderCount(){return renderCount;},get renderer(){return renderer;},get mapErrors(){return mapErrors;},selectBuilding,setGroup,setBasemap,filterBuildings,get visibleBuildings(){return visibleBuildings;},get chapter(){return chapter;},pointCloud};
init();

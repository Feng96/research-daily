import * as THREE from '../vendor/three.module.js';
import {createPointCloudController} from './point_clouds.js?v=20261113-models';
import {createDiagnostics} from './diagnostics.js?v=20261120-residual';
import {OSM_REMOTE_ASSET_BASE,STRUCTURE_REMOTE_ASSET_BASE,OFFICIAL_REMOTE_ASSET_BASE,RESIDUAL_REMOTE_ASSET_BASE} from './asset-source.js?v=20261120-residual';

const $=id=>document.getElementById(id);
const chapter=new URLSearchParams(location.search).get('chapter')||'pilot';
const dataset=new URLSearchParams(location.search).get('dataset')||'us';
const structureMode=dataset==='structure';
const osmMode=dataset==='osm'||structureMode;
const referenceMode=['reference','osm','structure'].includes(dataset);
const referenceBlock=new URLSearchParams(location.search).get('block')||'boston_g5';
const trialMode=dataset==='reference'&&new URLSearchParams(location.search).get('trial')==='numerical'&&referenceBlock==='boston_g5';
if(referenceMode&&!/^(boston_g5|dc_[a-z_]+)$/.test(referenceBlock))throw Error('Unknown reference block');
const inputBlock=new URLSearchParams(location.search).get('input')==='guarded'?'guarded':'raw';
const RESIDUAL_METHODS=['R_geometry','R_DL'];
const isResidual=which=>structureMode&&RESIDUAL_METHODS.includes(which);
function residualAsset(path){
 if(location.hostname!=='feng96.github.io')return '../residual-structure/'+path;
 if(!/^https:\/\/raw\.githubusercontent\.com\/Feng96\/research-daily\/[0-9a-f]{40}\/lod2\/residual-structure\/$/.test(RESIDUAL_REMOTE_ASSET_BASE))throw Error('局部屋面试验数据版本地址无效');
 return RESIDUAL_REMOTE_ASSET_BASE+path;
}
function officialAsset(path){
 if(location.hostname!=='feng96.github.io')return '../official-reference/'+path;
 if(!/^https:\/\/raw\.githubusercontent\.com\/Feng96\/research-daily\/[0-9a-f]{40}\/lod2\/official-reference\/$/.test(OFFICIAL_REMOTE_ASSET_BASE))throw Error('官方原始模型数据版本地址无效');
 return OFFICIAL_REMOTE_ASSET_BASE+path;
}
async function compressedJSON(response){
 if(!response.ok)throw Error('模型数据 HTTP '+response.status);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]===31&&bytes[1]===139){if(!window.DecompressionStream)throw Error('此浏览器不支持压缩数据，请使用新版浏览器');return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());}
 return JSON.parse(new TextDecoder().decode(bytes));
}

// Curated mode changes the interface and method list, never source observations.
const curated=new URLSearchParams(location.search).get('curated')==='1'&&['dl','repair'].includes(chapter);
document.documentElement.classList.toggle('lod2-curated',curated);
function setupCuratedControls(){
 if(!curated)return;
 const advanced=document.createElement('details');advanced.className='curated-point-settings';
 const heading=document.createElement('summary');heading.textContent='点云选项';
 const content=document.createElement('div');content.className='curated-extra-controls';
 for(const id of ['point-size','point-through']){const label=$(id).closest('label');if(label)content.append(label)}
 advanced.append(heading,content);document.querySelector('.cloud-inspector').append(advanced);
 const display=document.createElement('details');display.className='curated-display-settings';
 const title=document.createElement('summary');title.textContent='显示选项';
 const settings=document.createElement('div');settings.className='curated-extra-controls';
 for(const id of ['baseline-overlay','opacity']){const label=$(id).closest('label');if(label)settings.append(label)}
 display.append(title,settings);document.querySelector('.model-tools').append(display);
 for(const select of [advanced,display])select.addEventListener('toggle',reportHeight);
 for(const option of [...$('point-mode').options]){
  if(!['inside','train','removed','all'].includes(option.value))option.remove();
  else option.textContent={inside:'足迹内原始点',train:'保留点',removed:'删除点',all:'周边与地面'}[option.value];
 }
 for(const option of [...$('point-color').options]){
  if(!['height','decision'].includes(option.value))option.remove();
  else option.textContent={height:'离地高度',decision:'保留／删除'}[option.value];
 }
}

let GROUPS=[],LABELS={};
let visibleBuildings=[];
const BASELINES={pilot:'roofer',optimization:'baseline',overnight:'baseline',tree:'global_geo',workflow:'initial',canopy:'baseline',repair:'baseline',paper:'initial',dl:'raw'};
let data,selected,group='',basemap='satellite',syncing=false,temporaryHide=false;
let loadError=false,loaded=false,hashTimer,toastTimer,lastTileError=0,frameToken=0;
const mapErrors=[];
const initialHash=new URLSearchParams(location.hash.slice(1));
const MODEL_MODES=['roof','building','wireframe','hidden'];
let modelMode=MODEL_MODES.includes(initialHash.get('modelMode'))?initialHash.get('modelMode'):initialHash.get('models')==='0'?'hidden':'roof';
let lastSolidMode=modelMode==='building'?'building':'roof',displayGeometry=null,geometrySource='none';
const fullModels=new Map(),fullPending=new Map(),fullErrors=new Map();
const referencePlaceholders=new WeakMap();
const residualPlaceholders=new WeakMap();
$('model-mode').value=modelMode;
if(initialHash.has('edges'))$('edges').checked=initialHash.get('edges')!=='0';
if(curated){
 if(!['height','decision'].includes(initialHash.get('pointColor')))initialHash.set('pointColor',chapter==='dl'?'decision':'height');
 if(!['inside','train','removed','all'].includes(initialHash.get('pointMode')))initialHash.set('pointMode','inside');
}
group=initialHash.get('group')||'';
if(['satellite','naip','osm'].includes(initialHash.get('base')))basemap=initialHash.get('base');else if(curated)basemap='naip';

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5200);}
function style(){return {version:8,sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:21,attribution:'Imagery © Esri, Vantor, Earthstar Geographics and the GIS User Community'},osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'}},layers:[{id:'background',type:'background',paint:{'background-color':'#d0d9cb'}},{id:'satellite',type:'raster',source:'satellite',layout:{visibility:basemap==='satellite'?'visible':'none'},paint:{'raster-fade-duration':0}},{id:'osm',type:'raster',source:'osm',layout:{visibility:basemap==='osm'?'visible':'none'},paint:{'raster-fade-duration':0}}]};}
function createMap(container,pitch){const map=new maplibregl.Map({container,center:[-77.0718,38.9122],zoom:19.3,pitch,bearing:0,maxZoom:22,maxPitch:75,renderWorldCopies:false,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true},style:style()});map.addControl(new maplibregl.NavigationControl({showCompass:true,visualizePitch:!!pitch}),'top-right');map.addControl(new maplibregl.ScaleControl({maxWidth:80,unit:'metric'}),'bottom-left');map.on('error',e=>{mapErrors.push({map:container,message:e.error?.message||String(e.error)});if(Date.now()-lastTileError>15000&&/tile|fetch|network|HTTP/i.test(e.error?.message||'')){lastTileError=Date.now();toast(referenceMode?'部分在线底图未加载。可切换“实际输入 NAIP”，该影像已随页面保存。':'部分在线底图未加载。可切换“NAIP 2014”，该影像已随页面保存。');}});return map;}
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
const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.frustumCulled=false;root.add(mesh);
const edgeMaterial=new THREE.LineBasicMaterial({color:0x3b392b,transparent:true,opacity:.75,depthWrite:false});
const edgeLines=new THREE.LineSegments(new THREE.BufferGeometry(),edgeMaterial);edgeLines.renderOrder=2;edgeLines.frustumCulled=false;root.add(edgeLines);
const baselineLines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x42d9e4,transparent:true,opacity:.8,depthWrite:false,depthTest:false}));baselineLines.renderOrder=3;root.add(baselineLines);
let diagnostics;
const pointCloud=createPointCloudController({THREE,root,map:modelMap,chapter,referenceMode,getSelected:()=>selected,getGroup:()=>structureMode?'raw':group==='precision_repair'?'raw':group,isHidden:()=>temporaryHide,toast,onChange:saveHash,onHeight:()=>{diagnostics?.update();reportHeight();},onModelMode:setModelMode,initialHash});
setupCuratedControls();
diagnostics=createDiagnostics({indexURL:structureMode?(location.hostname==='feng96.github.io'?STRUCTURE_REMOTE_ASSET_BASE+'diagnostics.json.gz':'../structure-ab/diagnostics.json.gz'):osmMode?'../osm-production/diagnostics.json.gz':undefined,extraIndexURL:structureMode?residualAsset('diagnostics.json.gz'):undefined,structureMode,getState:()=>selected?{building:selected,block:referenceBlock,referenceMode,trialMode,method:group,mode:modelMode,geometrySource,mesh,display:modelDisplay(),points:pointCloud}:null,onSelect:setGroup,onHeight:reportHeight});
if(trialMode){const note=document.createElement('p');note.className='trial-notice';note.textContent='独立控制试跑：同一份 raw 点云、地面和重建参数，仅归并足迹中的浮点数值退化；未计入原四方法主表。覆盖恢复不代表屋顶结构或闭合已正确。';document.querySelector('.toolbar').before(note);}
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
function updateOfficialOutline(){
 const geometry=selected?.groups.reference?.footprintGeometryLngLat;
 imageMap.getSource('official-reference-outline')?.setData({type:'FeatureCollection',features:osmMode&&group==='reference'&&geometry&&selected.referenceFullAvailable?[feature(geometry)]:[]});
}

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
  imageMap.addSource('official-reference-outline',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  imageMap.addLayer({id:'official-reference-outline',type:'line',source:'official-reference-outline',paint:{'line-color':'#d38a26','line-width':2.5,'line-dasharray':[2,2]}});
  imageMap.on('click','building-hit',e=>{const id=e.features?.[0]?.properties?.id;const b=data.buildings.find(b=>b.id===id);if(b)selectBuilding(b,true);});
  imageMap.on('mouseenter','building-hit',()=>imageMap.getCanvas().style.cursor='pointer');
  imageMap.on('mouseleave','building-hit',()=>imageMap.getCanvas().style.cursor='');
}
function fullKey(b=selected,which=group){return b?(isResidual(which)?'residual/':trialMode&&which==='precision_repair'?'trial/':referenceMode&&which==='reference'?'reference/':'reconstruction/')+b.id:'';}
function hydrateResidualRoofs(b,payload){
 const placeholders=residualPlaceholders.get(b);if(!placeholders||b.residualRoofLazy===false)return;
 for(const method of RESIDUAL_METHODS){
  const full=payload.groups[method],metadata=placeholders[method],positions=[];
  for(let t=0;t<full.roofTriangleMask.length;t++)if(full.roofTriangleMask[t])for(let i=t*9;i<t*9+9;i++)positions.push(full.positions[i]);
  const count=positions.length/9,edges=full.roofEdges||[];
  b.groups[method]={...metadata,positions,edges,roofEdges:edges,roofTriangleMask:Array(count).fill(1),surfaceClasses:Array(count).fill(0),triangleCount:count,roofTriangleCount:count,edgeCount:edges.length/6,nativeGroundZ:full.nativeGroundZ,roofZBounds:full.roofZBounds||metadata.roofZBounds,previewWarnings:full.previewWarnings||[],geometryAudit:{...full.geometryAudit,roofOnly:true,roofDerivedFromExactFullTriangleMask:true}};
 }
 b.residualRoofLazy=false;
}
function hydrateReferenceRoof(b,full){
  const metadata=referencePlaceholders.get(b);if(!metadata||b.referenceRoofLazy===false)return;
  const positions=[];
  for(let t=0;t<full.roofTriangleMask.length;t++)if(full.roofTriangleMask[t])for(let i=t*9;i<t*9+9;i++)positions.push(full.positions[i]);
  const n=positions.length/9,edges=full.roofEdges||[];
  b.groups.reference={...metadata,positions,edges,roofEdges:edges,roofTriangleMask:Array(n).fill(1),surfaceClasses:Array(n).fill(0),triangleCount:n,roofTriangleCount:n,edgeCount:edges.length/6,nativeGroundZ:full.nativeGroundZ,roofZBounds:full.roofZBounds||metadata.roofZBounds,previewWarnings:full.previewWarnings||metadata.previewWarnings||[],geometryAudit:{...full.geometryAudit,roofOnly:true,roofDerivedFromExactFullTriangleMask:true}};
  b.referenceRoofLazy=false;
}
function trimFullCache(){
  while(fullModels.size>6){
    const active=selected?fullKey(selected,group):'',activeReference=selected&&$('baseline-overlay').checked?fullKey(selected,'reference'):'';
    const key=[...fullModels.keys()].find(k=>k!==active&&k!==activeReference)||fullModels.keys().next().value;
    const payload=fullModels.get(key);fullModels.delete(key);
    if(key.startsWith('reference/')){
      const b=data.buildings.find(b=>b.id===payload.id),metadata=b&&referencePlaceholders.get(b);
      if(metadata){b.groups.reference=metadata;b.referenceRoofLazy=!!b.referenceFullAvailable;}
    }
    if(key.startsWith('residual/')){
      const b=data.buildings.find(b=>b.id===payload.id),metadata=b&&residualPlaceholders.get(b);
      if(metadata){for(const method of RESIDUAL_METHODS)b.groups[method]=metadata[method];b.residualRoofLazy=!!b.residualPilotCovered;}
    }
  }
}
function fullModel(b,which=group){
  if(!referenceMode)return b.groups[which];
  if(osmMode&&which==='reference'&&!b.referenceFullAvailable)return null;
  if(isResidual(which)&&!b.residualPilotCovered)return null;
  const requestedGroup=which,isReference=requestedGroup==='reference',isResidualRequest=isResidual(requestedGroup),isTrial=trialMode&&requestedGroup==='precision_repair',key=fullKey(b,requestedGroup);
  if(fullModels.has(key)){const payload=fullModels.get(key),full=payload.groups[requestedGroup];if(osmMode&&isReference)hydrateReferenceRoof(b,full);if(isResidualRequest)hydrateResidualRoofs(b,payload);return full;}
  if(!fullPending.has(key)&&!fullErrors.has(key)){
    const promise=(async()=>{
      const response=await fetch(isResidualRequest?b.residualModelUrl:osmMode?(isReference?b.referenceFullModelUrl:b.fullModelUrl):isTrial?'../model-diagnostics/repair/'+encodeURIComponent(b.id)+'.json.gz':'../'+(isReference?'reference-full-models':'full-models')+'/blocks/'+referenceBlock+'/'+encodeURIComponent(b.id)+'.json.gz');
      if(!response.ok)throw Error('完整模型 HTTP '+response.status);
      const bytes=new Uint8Array(await response.arrayBuffer());
      const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
      const payload=JSON.parse(text);
      if(payload.id!==b.id||payload.blockId!==referenceBlock||!Array.isArray(payload.anchor)||payload.anchor.some((n,i)=>Math.abs(n-data.anchor[i])>1e-9))throw Error('完整模型坐标清单不一致');
      for(const name of isResidualRequest?RESIDUAL_METHODS:isTrial?['precision_repair']:isReference?['reference']:structureMode?['raw','geometry','A_joint','B_hierarchical']:['raw','legacy_guarded','fusion','context_fusion']){
        const g=payload.groups?.[name];
        if(!g||!Array.isArray(g.positions)||g.positions.length%9||!g.positions.every(Number.isFinite)||g.roofTriangleMask?.length!==g.positions.length/9)throw Error('完整模型面数据不完整');
        if(isReference&&g.isAlgorithm!==false)throw Error('官方完整模型来源标记不一致');
      }
      fullModels.set(key,payload);
      if(osmMode&&isReference)hydrateReferenceRoof(b,payload.groups.reference);
      if(isResidualRequest)hydrateResidualRoofs(b,payload);
      trimFullCache();
    })().catch(error=>fullErrors.set(key,error.message)).finally(()=>{
      fullPending.delete(key);
      const referenceNeeded=osmMode&&isReference&&((group==='reference'&&modelMode!=='hidden')||$('baseline-overlay').checked);
      const residualNeeded=isResidualRequest&&isResidual(group)&&modelMode!=='hidden';
      if(selected?.id===b.id&&(referenceNeeded||residualNeeded||(modelMode==='building'&&fullKey()===key))){geometry(selected);frameAllGroups();reportHeight();}
    });
    fullPending.set(key,promise);
  }
  return null;
}
function modelDisplay(){
  const g=displayGeometry,mask=g?.roofTriangleMask||[],classes=g?.surfaceClasses||[];
  const n=mesh.geometry.index?mesh.geometry.index.count/3:(mesh.geometry.getAttribute('position')?.count||0)/3;
  const needsRequest=modelMode==='building'||((osmMode&&group==='reference'||isResidual(group))&&modelMode!=='hidden');
  return {mode:modelMode,requestedMode:modelMode,available:!!g?.positions?.length,loading:needsRequest&&fullPending.has(fullKey()),error:needsRequest?(fullErrors.get(fullKey())||null):null,
    triangleCount:n,roofTriangles:mask.filter(Boolean).length,wallTriangles:$('roof-only').checked?0:classes.filter(x=>x===1).length,groundTriangles:$('roof-only').checked?0:classes.filter(x=>x===2).length,
    meshVisible:mesh.visible,edgesVisible:edgeLines.visible,opacity:material.opacity,geometrySource,isAlgorithm:g?.isAlgorithm??selected?.groups[group]?.isAlgorithm,pilotCovered:!isResidual(group)||!!selected?.residualPilotCovered};
}
function modelStatus(){
  const d=modelDisplay(),name={roof:'屋顶实体面',building:'完整建筑',wireframe:'屋顶框线',hidden:'模型已隐藏'}[modelMode];
  $('model-mode').value=modelMode;
  const buildingOption=$('model-mode').querySelector('option[value=building]');
  const isReference=referenceMode&&group==='reference';
  buildingOption.disabled=false;
  if(osmMode&&isReference&&!selected?.referenceFullAvailable)buildingOption.disabled=true;
  buildingOption.textContent=isReference&&osmMode?'官方原始建筑（含墙面）':isReference?'完整建筑（官方参考）':'完整建筑';
  $('reference-building').hidden=!isReference||modelMode==='building'||(osmMode&&!selected?.referenceFullAvailable);
  $('retry-full-model').hidden=!(d.error&&!d.loading);
  $('edges').disabled=modelMode==='wireframe'||modelMode==='hidden';
  let text;
  if(modelMode==='hidden')text='模型已隐藏；可保留点云单独查看。';
  else if(isResidual(group)&&!selected?.residualPilotCovered)text='本轮试验未覆盖这栋；可切换其他方法，或选择“本轮优化样本”。';
  else if(d.loading)text=osmMode&&isReference?'正在按需加载这栋官方原始模型…':'正在加载完整建筑，暂显示屋顶面…';
  else if(d.error)text=(osmMode&&isReference?'官方模型加载失败，可重试：':'完整模型加载失败，暂显示屋顶面：')+d.error;
  else if(!d.available)text=osmMode&&isReference?'这栋 OSM 当前未关联到可显示的官方屋顶；不代表当地没有官方模型或重建失败。':'本方法未生成可显示的模型；可切换原始基线或官方参考。';
  else text=(isReference?'官方参考 · ':'')+name+' · '+d.roofTriangles.toLocaleString('zh-CN')+' 个屋顶三角面'+(modelMode==='building'?' · '+d.wallTriangles.toLocaleString('zh-CN')+' 个墙面三角形':'');
  if(modelMode==='building'&&d.available&&!d.loading&&!d.error&&!d.wallTriangles)text+=structureMode?' · 当前结果只有屋面，缺少可用墙面':' · 原生结果没有墙面，未补造';
  if(isReference&&modelMode==='roof'&&(!osmMode||selected?.referenceFullAvailable))text+=' · 当前只看屋顶，可切换含墙面的官方建筑。';
  if(isReference&&modelMode==='building'&&d.available&&!d.loading&&!d.error){
    const audit=displayGeometry?.geometryAudit||{},meta=selected?.referenceMetadata||{};
    text+=' · '+d.groundTriangles.toLocaleString('zh-CN')+' 个底面三角形';
    if(osmMode){
      text+=audit.nativeSourceWallsRetained||meta.nativeSourceWallsRetained?' · 保留官方原墙面':' · 墙面来源见记录';
      if(audit.derivedClosureWallsAdded||meta.derivedClosureWallsAdded)text+=' · 含派生补墙';
      if(audit.derivedBottomFacesAdded||meta.derivedBottomFacesAdded)text+=' · 含派生补底';
      const edgeClosed=audit.edgeClosurePassed??audit.closureAudit?.edgeClosurePassed??meta.edgeClosurePassed??displayGeometry?.edgeClosurePassed;
      if(edgeClosed===true)text+=' · 边闭合检查通过';
      else if(edgeClosed===false)text+=' · 边检查仍有开口或异常';
      text+=' · 实体闭合性未认证';
    }else text+=' · 原始官方几何；墙面类型按几何识别，未验证闭合';
  }
  if(osmMode&&selected?.displayGroundProvenance?.displayFallbackUsed)text+=' · 局部地面缺测，建筑高度需复核';
  if(structureMode&&!isReference&&group!=='raw'&&modelMode==='building'&&d.available)text+=' · 墙面和底面由屋面派生，闭合性未认证';
  const localDecision=(displayGeometry||selected?.groups[group])?.decisionMetadata;
  if(isResidual(group)&&selected?.residualPilotCovered&&d.available&&!d.loading&&!d.error){
    if(localDecision?.qualityRollback)text+=localDecision.modelStatus==='preaugmentation_refinement_rejected'?' · 候选分区未通过质量检查，保留旧主屋面':' · 几何检查未通过，保留旧主屋面';
    else if(localDecision?.noSupportedNewComponents)text+=' · 没有足够支持的新局部结构，保留旧主屋面';
    else if(Number.isFinite(localDecision?.selectedComponents))text+=' · 保留 '+localDecision.selectedComponents+' 个局部结构';
    if(localDecision?.inheritedWallGaps)text+=' · 原有墙面仍有缺口';
    if(localDecision?.inheritedInvalidSourceGeometry)text+=' · 旧主屋面本身几何无效，保留原缓存显示，未修复';
  }
  $('model-status').textContent=text;
  let residualNote=$('residual-structure-note');if(!residualNote){residualNote=document.createElement('p');residualNote.id='residual-structure-note';residualNote.className='small';$('model-status').after(residualNote);}
  residualNote.hidden=!isResidual(group);
  residualNote.textContent=group==='R_DL'?'点云残差提出局部边界，再用冻结 DL 重新判断；光学不可辨认时提供中性证据。可观测性采用规则门控，本轮未新增训练。':'点云残差提出局部边界，以几何证据选择屋面；共用既有点语义和主屋面先验，并非完全不含 DL。';
  let capNote=$('residual-cap-note');if(!capNote){capNote=document.createElement('p');capNote.id='residual-cap-note';capNote.className='small';capNote.style.color='#87501b';residualNote.after(capNote);}
  const localMeta=selected?.residualMetadata||{};capNote.hidden=!(isResidual(group)&&selected?.residualPilotCovered&&(localMeta.componentLimitReached||localMeta.unprocessedProposalGroups>0));
  if(localMeta.opticallyUnobservableComponents>0&&isResidual(group))residualNote.textContent+=' 本栋 '+localMeta.opticallyUnobservableComponents+' 个候选的光学证据记为未知。';
  capNote.textContent='候选达到处理上限'+(localMeta.unprocessedProposalGroups>0?'，仍有 '+localMeta.unprocessedProposalGroups+' 组未检查':'')+'；局部结构尚未穷尽。';
  let alignment=$('official-reference-note');if(!alignment){alignment=document.createElement('p');alignment.id='official-reference-note';alignment.className='small';alignment.style.flexBasis='100%';$('model-status').after(alignment);}
  alignment.hidden=!(osmMode&&isReference);
  alignment.textContent=selected?.referenceFullAvailable?'官方屋顶保持原始完整范围与位置，未按 OSM 裁剪或平移；可能跨多个 OSM 单元。白线为 OSM，橙线为官方屋顶范围；位置偏差保留供目视对照，绝对高度尚未核验。':'当前未关联到可显示的官方屋顶；不把关联缺失作为预测错误。';
}
function setModelMode(value){
  if(value==='solid')value=lastSolidMode;
  if(!MODEL_MODES.includes(value))return;
  // A temporary failed request must not prevent an explicit later retry.
  if(selected&&(value==='building'||((osmMode&&group==='reference'||isResidual(group))&&value!=='hidden')))fullErrors.delete(fullKey());
  modelMode=value;
  if(value==='roof'||value==='building')lastSolidMode=value;
  if(value==='wireframe')$('edges').checked=true;
  if(selected){geometry(selected);if(value==='building')frameAllGroups();}else appearance();
}
function showGeometryWarnings(warnings){
  const brief=$('geometry-warning');let details=$('geometry-warning-details');
  if(!details){details=document.createElement('details');details.id='geometry-warning-details';details.className='geometry-warning-details';const title=document.createElement('summary');title.textContent='查看几何提示';const body=document.createElement('div');body.id='geometry-warning-list';details.append(title,body);brief.after(details);details.addEventListener('toggle',reportHeight);}
  brief.hidden=!warnings.length;brief.textContent=warnings.length>1?'模型有 '+warnings.length+' 项几何提示，可展开核对。':warnings.length?'模型提示：'+warnings[0]:'';
  details.hidden=warnings.length<2;details.open=false;$('geometry-warning-list').replaceChildren(...warnings.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
}
function geometry(b){
  if(osmMode&&group==='reference'&&!b.referenceFullAvailable&&modelMode==='building'){modelMode='roof';lastSolidMode='roof';}
  const bases=GROUPS.map(key=>b.groups[key]?.nativeGroundZ).filter(Number.isFinite);
  root.position.z=Number.isFinite(b.displayOffsetZ)?b.displayOffsetZ:(bases.length?b.ground_z-Math.min(...bases):0);
  pointCloud.sync();
  if(osmMode&&b.referenceFullAvailable&&modelMode!=='hidden'&&(group==='reference'||$('baseline-overlay').checked))fullModel(b,'reference');
  if(isResidual(group)&&b.residualPilotCovered&&modelMode!=='hidden')fullModel(b,group);
  const source=b.groups[group];
  $('roof-only').checked=modelMode!=='building';
  const full=modelMode==='building'?fullModel(b):null,g=full||source;
  displayGeometry=g;geometrySource=isResidual(group)?(full?'residual-structure-model':'residual-structure-roof-preview'):full?(trialMode&&group==='precision_repair'?'numerical-footprint-repair-trial':referenceMode?(group==='reference'?(osmMode?'official-source-full-with-closure':'official-reference-full-model'):structureMode&&group!=='raw'?'structural-decoder-model':'native-full-model'):'existing-native-model'):(osmMode&&group==='reference'?'official-source-roof-preview':referenceMode?'compiled-roof-preview':'existing-native-model');
  mesh.geometry.dispose();edgeLines.geometry.dispose();
  const warnings=[...new Set([...(source?.previewWarnings||[]),...(full?.previewWarnings||[])])];if(!['success','not_covered'].includes(source?.status)&&source?.isAlgorithm!==false)warnings.unshift('当前记录状态：'+(source?.status||'missing')+'；'+(source?.lodClass||source?.lod||'无声明等级'));showGeometryWarnings(warnings);
  mesh.geometry=new THREE.BufferGeometry();edgeLines.geometry=new THREE.BufferGeometry();
  if(!g?.positions?.length){baselineLines.geometry.dispose();baselineLines.geometry=new THREE.BufferGeometry();appearance();reportHeight();return;}
  const positions=new Float32Array(g.positions);mesh.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));mesh.geometry.computeVertexNormals();
  if($('roof-only').checked){const indices=[];for(let t=0;t<g.roofTriangleMask.length;t++)if(g.roofTriangleMask[t])indices.push(t*3,t*3+1,t*3+2);mesh.geometry.setIndex(indices);}
  const colors=new Float32Array(positions.length);const normal=mesh.geometry.getAttribute('normal');
  for(let t=0;t<positions.length/9;t++){
    let c;if(g.roofTriangleMask[t]){const z=Math.abs(normal.getZ(t*3));c=new THREE.Color().setHSL(.105,.44,.56+.13*z);}else c=new THREE.Color('#bbc4c1');
    for(let k=0;k<3;k++){colors[t*9+k*3]=c.r;colors[t*9+k*3+1]=c.g;colors[t*9+k*3+2]=c.b;}
  }
  mesh.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  edgeLines.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array($('roof-only').checked?(g.roofEdges||[]):g.edges||[]),3));
  // A single display reference is shared by all four groups. Keep the mesh
  // above the flat basemap without clipping low walls on this sloping site.
  // This is a display translation only; no source XYZ or height difference is fitted.
  const nativeBases=GROUPS.map(key=>b.groups[key]?.nativeGroundZ).filter(Number.isFinite);
  root.position.z=Number.isFinite(b.displayOffsetZ)?b.displayOffsetZ:(nativeBases.length?b.ground_z-Math.min(...nativeBases):0);
  baselineLines.geometry.dispose();baselineLines.geometry=new THREE.BufferGeometry();const control=b.groups[referenceMode?'reference':BASELINES[chapter]];if(control)baselineLines.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array($('roof-only').checked?(control.roofEdges||[]):control.edges||[]),3));
  appearance();
}
function appearance(){
  const alpha=+$('opacity').value/100;material.opacity=alpha;material.transparent=alpha<1;material.depthWrite=alpha>=.95;material.needsUpdate=true;
  $('models').checked=['roof','building'].includes(modelMode);
  $('opacity-value').textContent=Math.round(alpha*100)+'%';mesh.visible=$('models').checked&&!temporaryHide&&!!displayGeometry?.positions?.length;
  edgeLines.visible=modelMode!=='hidden'&&!temporaryHide&&(modelMode==='wireframe'||$('edges').checked)&&(edgeLines.geometry.getAttribute('position')?.count||0)>0;
  baselineLines.visible=!!selected&&$('baseline-overlay').checked&&!temporaryHide&&modelMode!=='hidden';
  modelStatus();
  diagnostics?.update();
  pointCloud.appearance();saveHash();modelMap.triggerRepaint();
}
function focusBuilding(){
  if(!selected)return;
  const bounds=new maplibregl.LngLatBounds(selected.bounds[0],selected.bounds[1]);
  if(osmMode&&group==='reference'){
    const extend=coords=>{if(!Array.isArray(coords))return;if(typeof coords[0]==='number'&&typeof coords[1]==='number'){if(Number.isFinite(coords[0])&&Number.isFinite(coords[1]))bounds.extend(coords.slice(0,2));}else coords.forEach(extend);};
    extend(selected.groups.reference?.footprintGeometryLngLat?.coordinates);
  }
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
    const keys=osmMode?(group==='reference'?['reference']:GROUPS.filter(key=>key!=='reference')):GROUPS;
    for(const g of [...keys.map(key=>selected.groups[key]),...(modelMode==='building'&&displayGeometry?[displayGeometry]:[])]){for(let i=0;i<g.positions.length;i+=3){
      if($('roof-only').checked&&!g.roofTriangleMask[Math.floor(i/9)])continue;
      point.set(g.positions[i],g.positions[i+1],g.positions[i+2]+root.position.z).applyMatrix4(camera.projectionMatrix);
      if(Number.isFinite(point.x)&&Number.isFinite(point.y))ratio=Math.max(ratio,Math.abs(point.x)/.84,Math.abs(point.y)/.74);
    }}
    if(ratio>1.01&&pass<4){const zoom=Math.max(16,imageMap.getZoom()-Math.min(1.8,Math.max(.12,Math.log2(ratio))));imageMap.jumpTo({zoom});synchronize(imageMap,modelMap);check(pass+1);}
  });modelMap.triggerRepaint();}
  check(0);
}
function renderMetrics(){
  if(structureMode){
    $('metrics').replaceChildren();
    $('metric-note').textContent=isResidual(group)&&!selected.residualPilotCovered?'本轮试验未覆盖这栋；这不是算法重建失败，也未用其他方法填充。':group==='reference'?(selected.referenceFullAvailable?'官方原始屋顶未裁剪、未配准，按需读取所选建筑；墙面与补底来源见模型状态。':'未关联到可显示的官方屋顶；不据此判定预测错误。'):
      LABELS[group]+' · '+(selected.groups[group]?.roofCount??'—')+' 个屋面分区 · '+(selected.split||'划分见记录')+'；请结合原始官方屋顶、点云及影像目视比较。';
    reportHeight();return;
  }
  if(referenceMode){
    $('metrics').replaceChildren();
    const r=selected.referenceEvaluation?.[group],m=r?.metrics||r||{},fmt=(x,n=3)=>Number.isFinite(x)?x.toFixed(n):'—';
    $('metric-note').textContent=osmMode?(group==='reference'?'相交官方源对象的完整屋面；可能对应多栋 OSM，未当作逐户真值。':'OSM 足迹 · '+(selected.groups[group]?.roofCount??'—')+' 片屋面 · '+(selected.groups[group]?.status||'状态见记录')+'；固定区域评价见主页面。'):group==='reference'?'官方来源屋面参考；非实测同期真值，非本实验算法。':`屋面覆盖 ${Number.isFinite(m.roof_xy_coverage)?(100*m.roof_xy_coverage).toFixed(1)+'%':'—'} · 内部折线 F1（1 m）${fmt(m.breakline_f1_1m)} · ${r?.native_lod2?'原生 LoD2 输出':'请检查失败／回退状态'}`;
    reportHeight();return;
  }

  if(curated){
    $('metrics').replaceChildren();
    if(chapter==='dl'){
      const m=selected.dl.methods[group];
      $('metric-note').textContent='删除 '+m.removed_points+' 点 · '+m.roof_surfaces+' 片屋面 · '+(m.shell_diagnostic?'边检查通过':'边检查未通过')+'；精度仍待核查。';
    }else{
      const m=selected.repair;
      $('metric-note').textContent=group==='baseline'?'修正前的平面保护结果。':m.shell_diagnostic_passed?'局部修正候选；边检查通过，屋顶形状待核查。':'局部修正候选未通过边检查，供定位问题。';
    }
    reportHeight();return;
  }

  if(chapter==='dl'){
    const row=selected.dl;$('metric-note').textContent='筛点与重建诊断；删点和边检查不代表真实屋顶精度。青色保留、红色删除。';
    $('metrics').replaceChildren(...GROUPS.map(key=>{const m=row.methods[key],button=document.createElement('button');button.className='metric'+(key===group?' active':'');button.setAttribute('aria-pressed',String(key===group));for(const [cls,text]of [['metric-name',LABELS[key]],['metric-value','删 '+m.removed_points+' 点'],['metric-sub',m.roof_surfaces+' 片屋面 · '+(m.shell_diagnostic?'边检查通过':'边检查未通过')]]){const span=document.createElement('span');span.className=cls;span.textContent=text;button.append(span)}button.onclick=()=>setGroup(key);return button}));reportHeight();return;
  }

  if(chapter==='paper'){
    const row=selected.paper;$('metric-note').textContent='候选变化与边检查，不是屋顶精度；原始回波含树木。紫色为实际 NAIP 线／角点，仅论文组显示。';
    $('metrics').replaceChildren(...GROUPS.map(key=>{const m=row.methods[key],button=document.createElement('button');button.className='metric'+(key===group?' active':'');button.setAttribute('aria-pressed',String(key===group));const value=key==='initial'?'共同输入 '+row.input.shared_point_count+' 点':key==='paper'?'分区变化 '+m.diagnostics.changed_partition_area_m2.toFixed(2)+' m²':'重归属 '+m.reassigned_components+' 片';const sub=key==='paper'?m.image_lines+' 条线 · '+(m.quality.passed?'边检查通过':'边检查未通过'):key==='ours'?(m.quality.passed?'边检查通过':'未通过，检查后保留初始模型'):'两种修正器复用本模型';for(const [cls,text]of [['metric-name',LABELS[key]],['metric-value',value],['metric-sub',sub]]){const span=document.createElement('span');span.className=cls;span.textContent=text;button.append(span)}button.onclick=()=>setGroup(key);return button}));updatePaperCues();reportHeight();return;
  }

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
  $('selected-height').textContent=chapter==='dl'?'同一原始观测 · 固定几何后端 · 无本地GT':chapter==='paper'?'同输入／同初始模型 · 原始点不动 · 无独立GT':chapter==='repair'?'原始回波不动 · 局部候选 · 无独立GT':chapter==='canopy'?'同一原始观测 · 原始索引保留 · 无独立GT':chapter==='workflow'?'固定流程 · 原始XYZ保留 · 高度1×':(building.cohort==='fresh60'?'新增60栋':'原60栋')+' · 跨实验统一显示基准 · 高度1×';
  if(referenceMode){
    const names=building.inputDate?.NAIP||[],dates=[...new Set(names.flatMap(x=>(String(x).match(/20\d{6}/g)||[]).map(s=>s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8))))];
    const source=building.referenceMetadata?.source||{},referenceDate=source.survey_date||source.model_date||'多期／未核实';
    $('selected-height').textContent='NAIP '+(dates.join(' / ')||'日期见记录')+' · 参考 '+referenceDate+' · 给定足迹，原始Z未拟合'+(String(building.cohort).startsWith('historical')?' · 历史复核，不进主表':'');
    if(osmMode)$('selected-height').textContent='OSM 足迹输入 · NAIP '+(dates.join(' / ')||'日期见记录')+' · 3DEP 原始点 · 参考仅在重建后关联';
    if(structureMode)$('selected-height').textContent='相同 OSM 与原始观测 · '+(building.split||'划分见记录')+' · 官方屋顶原位置、未裁剪';
    if(osmMode){
      let comparison=$('footprint-comparison');if(!comparison){comparison=document.createElement('div');comparison.id='footprint-comparison';comparison.className='point-detail';document.querySelector('.location-inspector').append(comparison);}
      comparison.replaceChildren();const attribution=document.createElement('a');attribution.href='https://www.openstreetmap.org/copyright';attribution.target='_blank';attribution.rel='noopener';attribution.textContent='足迹 © OpenStreetMap contributors';comparison.append(attribution);
      const ids=building.referenceMetadata?.reference_ids||[];
      if(ids.length){const details=document.createElement('details'),title=document.createElement('summary');title.textContent='官方原始来源 · '+ids.length+' 个对象';details.append(title);const note=document.createElement('p');note.textContent='完整保留所关联源对象，可能跨多个 OSM 单元。位置关系未确认，下面链接仅供查看历史原足迹结果。';details.append(note);for(const id of ids){const a=document.createElement('a');a.href='../?'+new URLSearchParams({experiment:'reference',block:referenceBlock,building:id,group:group==='reference'?'raw':group,modelMode:'building',points:'0'})+'#visual';a.target='_top';a.textContent=id;details.append(a,document.createElement('br'));}comparison.append(details);details.addEventListener('toggle',reportHeight);}
    }
    const notes=document.querySelector('.observation-notes p');if(notes){const period=building.inputDate?.LiDAR_project||[];notes.textContent='本区域 LiDAR 项目采集区间：'+(period.join(' 至 ')||'见输入记录')+'；逐栋日期未单独核实。“高处”是距估计地面超过 2 m 的原始回波，可能包含树木。密度是回波密度，不是脉冲密度。原始分类未提供可靠的屋顶语义真值；地面类号沿用已核验的项目定义。';}
  }
  imageMap.getSource('selected')?.setData(selectedFeature());updateOfficialOutline();geometry(building);renderMetrics();
  if(focus)focusBuilding();saveHash();
}
function setGroup(key){
  if(!GROUPS.includes(key))return;const referenceTransition=osmMode&&(key==='reference'||group==='reference');group=key;$('group-select').value=key;document.querySelectorAll('[data-group]').forEach(b=>{b.classList.toggle('active',b.dataset.group===key);b.setAttribute('aria-pressed',String(b.dataset.group===key));});
  $('model-title').textContent=LABELS[key]+' · '+(selected?.groups[key]?.lodClass||selected?.groups[key]?.lod||'屋面模型');if(selected){updateOfficialOutline();geometry(selected);renderMetrics();if(referenceTransition)focusBuilding();}saveHash();
}
function setBasemap(key){
  basemap=key;$('basemap').value=key;
  for(const map of [imageMap,modelMap])for(const name of ['satellite','osm','naip'])if(map.getLayer(name))map.setLayoutProperty(name,'visibility',name===key?'visible':'none');
  $('image-title').textContent={satellite:'真实卫星／航空影像',naip:'真实 NAIP 2014 · 1 米',osm:'OpenStreetMap 地图'}[key];
  $('imagery-note').textContent={satellite:'Esri 合成影像的拍摄时相未逐栋核实，可能与 2014 年建筑状态不同。',naip:'本实验原始 NAIP，目录日期 2014-09-27。原始分辨率 1 米，放大不会增加屋顶细节。',osm:'OSM 用于位置参照；查看实际屋顶，请切换卫星影像或 NAIP。'}[key];
  if(referenceMode&&key==='naip'){$('image-title').textContent='实际输入 NAIP · 1 米';$('imagery-note').textContent='当前区域使用的真实输入影像；日期见数据记录。树冠与 LiDAR 可能不同时相。';}
  saveHash();
}

function updatePaperCues(){
 if(chapter!=='paper'||!selected||!imageMap.getLayer('selected-outline'))return;
 if(!imageMap.getSource('paper-cues')){imageMap.addSource('paper-cues',{type:'geojson',data:{type:'FeatureCollection',features:[]}});imageMap.addLayer({id:'paper-cue-lines',type:'line',source:'paper-cues',filter:['==',['get','kind'],'line'],paint:{'line-color':'#ae4fce','line-width':1.5,'line-opacity':.8}});imageMap.addLayer({id:'paper-cue-corners',type:'circle',source:'paper-cues',filter:['==',['get','kind'],'corner'],paint:{'circle-color':'#ae4fce','circle-radius':3,'circle-stroke-color':'#ffffff','circle-stroke-width':1}})}
 imageMap.getSource('paper-cues').setData(selected.paper.imageCuesGeoJSON);for(const id of ['paper-cue-lines','paper-cue-corners'])imageMap.setLayoutProperty(id,'visibility',group==='paper'&&$('footprint').checked?'visible':'none');
}

function footprintVisibility(){updatePaperCues();for(const id of ['selected-outline','selected-outline-shadow','official-reference-outline'])if(imageMap.getLayer(id))imageMap.setLayoutProperty(id,'visibility',$('footprint').checked?'visible':'none');$('clean-image').textContent=$('footprint').checked?'查看纯影像':'显示定位轮廓';}
function saveHash(){if(!loaded||!selected)return;clearTimeout(hashTimer);hashTimer=setTimeout(()=>{const c=imageMap.getCenter();const state={building:selected.id,group,base:basemap,cohort:$('cohort').value,lng:c.lng.toFixed(7),lat:c.lat.toFixed(7),z:imageMap.getZoom().toFixed(3),bearing:imageMap.getBearing().toFixed(2),pitch:modelMap.getPitch().toFixed(1),...pointCloud.state(),modelMode,edges:$('edges').checked?'1':'0',...(referenceMode?{block:referenceBlock}:{}),...(structureMode?{split:new URLSearchParams(location.search).get('split')||'test'}:{})};history.replaceState(null,'','#'+new URLSearchParams(state));if(parent!==window)parent.postMessage({type:'lod2-selection',chapter,...state,...(curated?{curated:'1'}:{}),...(referenceMode?{dataset}:{}),...(chapter==='paper'?{input:inputBlock}:{})},location.origin);},150);}
function reportHeight(){if(parent!==window)requestAnimationFrame(()=>parent.postMessage({type:'lod2-height',height:document.body.scrollHeight},location.origin));}
function filterBuildings(focus=true){
  visibleBuildings=data.buildings.filter(b=>$('cohort').value==='all'||b.cohort===$('cohort').value);
  $('building').replaceChildren(...visibleBuildings.map((b,i)=>{const option=document.createElement('option');option.value=b.id;option.textContent=`${String(i+1).padStart(2,'0')} · ${referenceMode&&String(b.cohort).startsWith("historical")?"[历史] ":""}${b.shortId||b.id}`;return option;}));
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
    ctx.drawImage(a,0,78,w,h);ctx.drawImage(b,w,78,w,h);ctx.fillStyle='#52655b';ctx.font='14px sans-serif';ctx.fillText(referenceMode?'Imagery © Esri / NAIP / OpenStreetMap · '+referenceBlock+' · 拍摄日期见区域记录 · 参考与观测可能跨年':'Imagery © Esri / NAIP / OpenStreetMap · 3DEP 2014-04-24 · NAIP 2014-09-27 · 卫星底图时相未逐栋核实',24,h+105);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG export failed');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`roof_${selected.shortId||selected.id}_${group}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch(e){toast('对照图导出失败，可使用浏览器截图。');console.error(e);}
}

$('previous').onclick=()=>cycle(-1);$('next').onclick=()=>cycle(1);$('focus').onclick=focusBuilding;
$('building').onchange=e=>{const b=data?.buildings.find(b=>b.id===e.target.value);if(b)selectBuilding(b);};
document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>setGroup(b.dataset.group));
document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{const target=data?.buildings.find(x=>x.id===b.dataset.example);if(target)selectBuilding(target);});
$('basemap').onchange=e=>setBasemap(e.target.value);$('footprint').onchange=footprintVisibility;
$('clean-image').onclick=()=>{$('footprint').checked=!$('footprint').checked;footprintVisibility();};
$('models').onchange=()=>setModelMode($('models').checked?'solid':'hidden');$('model-mode').onchange=e=>setModelMode(e.target.value);
$('models-only').onclick=()=>{$('show-points').checked=false;$('opacity').value=100;setModelMode('solid');};
$('reference-building').onclick=()=>{$('show-points').checked=false;$('opacity').value=100;setModelMode('building');};
$('retry-full-model').onclick=()=>setModelMode(modelMode);
$('baseline-overlay').onchange=()=>{if(osmMode&&selected)geometry(selected);else appearance();};$('metric-mode').onchange=renderMetrics;$('cohort').onchange=()=>filterBuildings(true);$('group-select').onchange=e=>setGroup(e.target.value);$('edges').onchange=appearance;$('opacity').oninput=appearance;
$('roof-only').onchange=()=>{if(selected)geometry(selected);};
function setView(pitch){frameToken++;if(pitch>0)modelMap.once('moveend',()=>frameAllGroups());modelMap.easeTo({pitch,duration:450});$('view-3d').classList.toggle('active',pitch>0);$('view-top').classList.toggle('active',pitch===0);$('view-3d').setAttribute('aria-pressed',String(pitch>0));$('view-top').setAttribute('aria-pressed',String(pitch===0));}
$('view-3d').onclick=()=>setView(55);$('view-top').onclick=()=>setView(0);$('export').onclick=exportImage;
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!e.target.closest('input,select,button,textarea,a')){e.preventDefault();temporaryHide=true;appearance();}});
window.addEventListener('keyup',e=>{if(e.code==='Space'){temporaryHide=false;appearance();}});
window.addEventListener('blur',()=>{if(temporaryHide){temporaryHide=false;appearance();}});
window.addEventListener('resize',()=>{imageMap.resize();modelMap.resize();reportHeight();});

async function init(){
  try{
    const response=await fetch(structureMode?(location.hostname==='feng96.github.io'?STRUCTURE_REMOTE_ASSET_BASE+'blocks/'+referenceBlock+'/viewer.json.gz':'../structure-ab/blocks/'+referenceBlock+'/viewer.json.gz'):osmMode?'../osm-production/blocks/'+referenceBlock+'/viewer.json.gz':trialMode?'../model-diagnostics/repair/scene.json.gz':referenceMode?'../reference-eval/blocks/'+referenceBlock+'/viewer.json.gz':chapter==='dl'?'../dl/data/viewer.json.gz':chapter==='paper'?'../paper/data/'+inputBlock+'/viewer.json.gz':chapter==='repair'?'../repair/data/viewer.json.gz':chapter==='canopy'?'../next/canopy/data/viewer.json.gz':chapter==='workflow'?'../next/data/viewer.json.gz':'../data/'+chapter+'.json.gz');
    data=await compressedJSON(response);
    if(osmMode){
      const overlay=await compressedJSON(await fetch(officialAsset('metadata/'+referenceBlock+'.json.gz')));
      if(!Array.isArray(overlay.anchor)||overlay.anchor.some((x,i)=>Math.abs(x-data.anchor[i])>1e-9))throw Error('官方参考与原始场景坐标框架不一致');
      const byId=new Map(overlay.buildings.map(b=>[b.id,b]));
      for(const building of data.buildings){
        const source=byId.get(building.id);if(!source)throw Error('官方原始参考索引缺失：'+building.id);
        const sourceMetadata=source.groups.reference,sourceGeometry=sourceMetadata.footprintGeometryLngLat||overlay.referenceGeometries?.[sourceMetadata.referenceGeometryKey];
        if(source.referenceFullAvailable&&!sourceGeometry)throw Error('官方原始屋顶范围索引缺失：'+building.id);
        const metadata={...sourceMetadata,footprintGeometryLngLat:sourceGeometry,positions:[],edges:[],roofEdges:[],roofTriangleMask:[],surfaceClasses:[]};
        referencePlaceholders.set(building,metadata);building.groups.reference=metadata;
        for(const key of ['referenceMetadata','referenceFullAvailable','referenceFullModelUrl','referenceSourceGeometryLngLat'])building[key]=source[key];
        building.referenceRoofLazy=!!source.referenceFullAvailable;
      }
      data.groupLabels.reference='官方原始屋顶（未裁剪）';
    }
    if(structureMode){
      const overlay=await compressedJSON(await fetch(residualAsset('metadata/'+referenceBlock+'.json.gz')));
      if(!Array.isArray(overlay.anchor)||overlay.anchor.some((x,i)=>Math.abs(x-data.anchor[i])>1e-9))throw Error('局部屋面试验坐标框架不一致');
      const byId=new Map(overlay.buildings.map(b=>[b.id,b]));
      for(const building of data.buildings){
        const item=byId.get(building.id),placeholders={};
        building.residualPilotCovered=!!item;building.residualRoofLazy=!!item;
        for(const method of RESIDUAL_METHODS){
          const metadata=item?.groups?.[method]||{isAlgorithm:true,status:'not_covered',nativeGroundZ:building.ground_z,roofZBounds:null,triangleCount:0,roofTriangleCount:0,roofCount:0,lodClass:'本轮试验未覆盖'};
          placeholders[method]={...metadata,positions:[],edges:[],roofEdges:[],roofTriangleMask:[],surfaceClasses:[]};
          building.groups[method]=placeholders[method];
        }
        residualPlaceholders.set(building,placeholders);
        if(item){
          const prefix='../residual-structure/';if(!item.modelUrl?.startsWith(prefix))throw Error('局部屋面模型路径不一致');
          building.residualModelUrl=residualAsset(item.modelUrl.slice(prefix.length));building.residualMetadata=item.metadata||{};
        }
      }
      data.groupOrder=[...data.groupOrder.filter(k=>k!=='reference'),...RESIDUAL_METHODS,'reference'];
      Object.assign(data.groupLabels,{R_geometry:'残差边界 · 几何',R_DL:'残差边界 · 冻结 DL'});
      const split=new URLSearchParams(location.search).get('split')||'test';
      data.unfilteredBuildingCount=data.buildingCount;
      data.buildings=data.buildings.filter(b=>split==='all'||split==='pilot'&&b.residualPilotCovered||b.split===split);
      data.buildingCount=data.buildings.length;data.splitView=split;
    }
    if(osmMode&&location.hostname==='feng96.github.io'){
      if(!/^https:\/\/raw\.githubusercontent\.com\/Feng96\/research-daily\/[0-9a-f]{40}\/lod2\/osm-production\/$/.test(OSM_REMOTE_ASSET_BASE))throw Error('OSM 数据版本地址无效');
      if(structureMode&&!/^https:\/\/raw\.githubusercontent\.com\/Feng96\/research-daily\/[0-9a-f]{40}\/lod2\/structure-ab\/$/.test(STRUCTURE_REMOTE_ASSET_BASE))throw Error('结构实验数据版本地址无效');
      for(const building of data.buildings)for(const key of ['pointsUrl','fullModelUrl']){
        const local=building[key],prefix=structureMode&&key==='fullModelUrl'?'../structure-ab/':'../osm-production/';
        if(!local?.startsWith(prefix))throw Error('资产路径不一致');
        building[key]=(prefix==='../structure-ab/'?STRUCTURE_REMOTE_ASSET_BASE:OSM_REMOTE_ASSET_BASE)+local.slice(prefix.length);
      }
    }
    if(osmMode)for(const building of data.buildings){
      const local=building.referenceFullModelUrl;
      if(local){const prefix='../official-reference/';if(!local.startsWith(prefix))throw Error('官方完整模型路径不一致');building.referenceFullModelUrl=officialAsset(local.slice(prefix.length));}
      if(building.referenceFullAvailable&&!building.referenceFullModelUrl)throw Error('官方完整模型缺少来源地址');
    }

    const curatedGroups=structureMode?['raw','geometry','A_joint','B_hierarchical',...RESIDUAL_METHODS,'reference']:trialMode?['raw','precision_repair','reference']:referenceMode?['raw','legacy_guarded','fusion','context_fusion','reference']:{dl:['raw','legacy_guarded','fusion','context_fusion'],repair:['baseline','candidate']}[chapter];
    GROUPS=curated?curatedGroups.filter(key=>data.groupOrder.includes(key)):data.groupOrder;
    LABELS=curated?{...data.groupLabels,raw:'原始对照',legacy_guarded:'平面保护',fusion:'光学＋点云',context_fusion:'光学＋局部邻域',baseline:'修正前',candidate:'局部修正候选'}:data.groupLabels;
    if(trialMode||structureMode)LABELS={...data.groupLabels};
    if(osmMode)LABELS.reference='官方原始屋顶（未裁剪）';
    if(curated){data.groupOrder=GROUPS;data.groupLabels=LABELS;}
    group=GROUPS.includes(group)?group:(curated&&GROUPS.includes('fusion')?'fusion':curated&&GROUPS.includes('candidate')?'candidate':GROUPS[0]);

    if(!referenceMode)data.naip.url='../data/naip2014.png';
    if(!data.buildings.length||data.buildings.length!==data.buildingCount)throw new Error('建筑分母与导出清单不一致');
    $('chapter-name').textContent={pilot:'01 · 五种重建方法',optimization:'02 · 四组输入优化',overnight:'03 · 120栋扩展复核',tree:'04 · 树冠干扰与语义迁移',workflow:'固定工作流 v0.1',canopy:'树冠清理 · 三组复核',repair:'局部屋面修正 · 8 栋验证',paper:'论文思想 · 同输入配对对照',dl:'邻域与光学可靠性 · 24 栋'}[chapter]||chapter;
    $('chapter-detail').textContent=`Georgetown · ${data.buildingCount}栋 · ${GROUPS.length}组方法 · ${chapter==='tree'?'零本地标签迁移 · 待核查':'原始观测2014年'}`;
    if(chapter==='dl'){$('chapter-detail').textContent='24 栋 · 8 种筛点策略 · 新模型固定种子20261026 · 无本地GT';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=cohort]').hidden=true;}
    if(chapter==='paper'){$('chapter-detail').textContent='8 栋 · '+(inputBlock==='raw'?'原始点':'共用筛点')+' · 同初始模型 · 无独立GT';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=cohort]').hidden=true;document.querySelector('#baseline-overlay').closest('label').lastChild.textContent='共同初始轮廓';}
    if(chapter==='repair'){$('chapter-detail').textContent='8 栋 · 修正前 / 局部候选 · 原始点不动';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=cohort]').hidden=true;}
    if(chapter==='canopy'){$('chapter-detail').textContent='8 栋 · 3 组 · 实际原始点云 · 后端未触发修剪';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=cohort]').hidden=true;}
    if(chapter==='workflow'){$('chapter-detail').textContent='Georgetown · 8 栋流程验证 · 2 个阶段 · 无精度结论';$('metric-mode').closest('label').hidden=true;document.querySelector('label[for=group-select]').textContent='阶段';document.querySelector('label[for=cohort]').hidden=true;document.querySelector('#baseline-overlay').closest('label').lastChild.textContent='初始屋面轮廓';}
    if(curated){$('chapter-name').textContent=chapter==='dl'?'最新筛点实验':'局部屋面修正';$('chapter-detail').textContent=data.buildingCount+' 栋 · '+GROUPS.length+' 种保留方法 · NAIP＋3DEP';}
    if(referenceMode){$('chapter-name').textContent='外部屋面参考对照';$('chapter-detail').textContent=referenceBlock+' · '+data.buildingCount+' 个官方记录 · 4 方法＋来源参考';document.querySelector('#baseline-overlay').closest('label').lastChild.textContent='叠加官方参考边线';$('basemap').querySelector('option[value=naip]').textContent='实际输入 NAIP';}
    if(osmMode){$('chapter-name').textContent='OSM 足迹生产';$('chapter-detail').textContent=referenceBlock+' · '+data.buildingCount+' 个 OSM 实体 · 4 方法';$('imagery-note').textContent='输入足迹来自 OSM，屋面参考仅在预测完成后关联。';}
    if(structureMode){$('chapter-name').textContent='局部屋面优化';$('chapter-detail').textContent=referenceBlock+' · '+data.splitView+' · '+data.buildingCount+' 个 OSM 单元';$('imagery-note').textContent='白线为 OSM 输入足迹；官方原始屋顶保持完整范围。新残差方法只覆盖本轮优化样本。';}
    if(trialMode){$('chapter-name').textContent='数值足迹修复 · 独立控制';$('chapter-detail').textContent='Boston 192／183／163 · 相同 raw 点与参数 · 未计入主表';}
    $('group-select').replaceChildren(...GROUPS.map(key=>{const o=document.createElement('option');o.value=key;o.textContent=LABELS[key];return o;}));$('group-select').disabled=false;
    $('cohort').hidden=!['overnight','tree'].includes(chapter);$('cohort').value=['overnight','tree'].includes(chapter)&&['legacy60','fresh60'].includes(initialHash.get('cohort'))?initialHash.get('cohort'):'all';
    $('metric-mode').value=['overnight','tree'].includes(chapter)?'paired':'common';
    await Promise.all([ready(imageMap),ready(modelMap)]);for(const map of [imageMap,modelMap])addSources(map);setupImageOverlays();modelMap.addLayer(modelLayer);
    visibleBuildings=data.buildings.filter(b=>$('cohort').value==='all'||b.cohort===$('cohort').value);$('building').replaceChildren(...visibleBuildings.map((b,i)=>{const o=document.createElement('option');o.value=b.id;o.textContent=`${String(i+1).padStart(2,'0')} · ${referenceMode&&String(b.cohort).startsWith("historical")?"[历史] ":""}${b.shortId||b.id}`;return o;}));
    $('building').disabled=false;$('export').disabled=false;loaded=true;setGroup(group);setBasemap(basemap);
    const initial=visibleBuildings.find(b=>b.id===initialHash.get('building'))||visibleBuildings.find(b=>b.id==='usbf-v1-dc-row85141-osm-66347936')||visibleBuildings[0];
    selectBuilding(initial,true);
    const lng=+initialHash.get('lng'),lat=+initialHash.get('lat'),zoom=+initialHash.get('z');
    if(initialHash.has('lng')&&Number.isFinite(lng)&&Number.isFinite(lat)&&zoom>=14&&zoom<=22){imageMap.jumpTo({center:[lng,lat],zoom,bearing:+initialHash.get('bearing')||0});synchronize(imageMap,modelMap);}
    if(initialHash.has('pitch'))setView(Math.min(75,Math.max(0,+initialHash.get('pitch')||0)));
    $('loading').hidden=true;reportHeight();
  }catch(e){loadError=true;$('loading-text').textContent='页面数据加载失败：'+e.message;console.error(e);}
}
window.roofCompare={imageMap,modelMap,get data(){return data;},get selected(){return selected;},get group(){return group;},get loaded(){return loaded;},get error(){return loadError;},get renderCount(){return renderCount;},get renderer(){return renderer;},get mapErrors(){return mapErrors;},get modelDisplay(){return modelDisplay();},get displayedGeometry(){return displayGeometry;},get diagnostics(){return diagnostics;},get mesh(){return mesh;},get edgeLines(){return edgeLines;},selectBuilding,setGroup,setBasemap,setModelMode,filterBuildings,get visibleBuildings(){return visibleBuildings;},get chapter(){return chapter;},get inputBlock(){return inputBlock;},get curated(){return curated;},pointCloud};
init();

// Visual inspection of frozen source observations; this module never fits a roof.
export function createPointCloudController({THREE,root,map,chapter,getSelected,getGroup,isHidden,toast,onChange,onHeight,initialHash}){
  const $=id=>document.getElementById(id),cache=new Map();
  let payload=null,activeId=null,requestToken=0,visibleCount=0,error=null,loading=false;
  const material=new THREE.PointsMaterial({size:3,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:.95,depthWrite:false,depthTest:false,toneMapped:false});
  const cloud=new THREE.Points(new THREE.BufferGeometry(),material);cloud.name='original-3dep-observations';cloud.renderOrder=8;cloud.frustumCulled=false;cloud.visible=false;root.add(cloud);
  if(['tree','workflow','canopy'].includes(chapter)){for(const [id,value,label]of [['point-mode','removed','本组剔除的候选点'],['point-color','vegetation','DL 植被／篱笆得分']]){const o=document.createElement('option');o.value=value;o.textContent=label;$(id).append(o);}}
  const enumValue=(key,values,fallback)=>values.includes(initialHash.get(key))?initialHash.get(key):fallback;
  $('show-points').checked=initialHash.get('points')!=='0';
  $('point-mode').value=enumValue('pointMode',['inside','high','all','train','test',...(['tree','workflow','canopy'].includes(chapter)?['removed']:[])],'inside');
  if(['workflow','canopy'].includes(chapter)){$('point-mode').querySelector('option[value=test]').remove();$('point-color').querySelector('option[value=split]').textContent='保留候选／其他';}
  if(chapter==='canopy'){const o=document.createElement('option');o.value='decision';o.textContent='当前方法保留／删除';$('point-color').append(o);}
  $('point-color').value=enumValue('pointColor',['height','split','class',...(chapter==='canopy'?['decision']:[]),...(['tree','workflow','canopy'].includes(chapter)?['vegetation']:[])],'height');
  $('point-size').value=initialHash.has('pointSize')?Math.max(1,Math.min(6,+initialHash.get('pointSize')||3)):3;
  $('point-through').checked=initialHash.get('pointThrough')!=='0';
  if(initialHash.has('opacity'))$('opacity').value=Math.max(15,Math.min(100,+initialHash.get('opacity')||55));
  if(initialHash.has('models'))$('models').checked=initialHash.get('models')!=='0';
  function state(){return {points:$('show-points').checked?'1':'0',pointMode:$('point-mode').value,pointColor:$('point-color').value,pointSize:$('point-size').value,pointThrough:$('point-through').checked?'1':'0',opacity:$('opacity').value,models:$('models').checked?'1':'0'};}
  function coordinates(b,xy){
    const target=xy||b?.center;if(!target)return;
    const [lon,lat]=target,latitude=lat.toFixed(7),longitude=lon.toFixed(7),pair=latitude+','+longitude;
    $('building-coordinates').value=latitude+', '+longitude;
    const pano=new URL('https://www.google.com/maps/@');pano.search=new URLSearchParams({api:'1',map_action:'pano',viewpoint:pair,pitch:'20',fov:'80'});
    $('street-view-link').href=pano.href;
    const satellite=new URL('https://www.google.com/maps/@');satellite.search=new URLSearchParams({api:'1',map_action:'map',center:pair,zoom:'20',basemap:'satellite'});
    $('google-map-link').href=satellite.href;
    $('osm-link').href=`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=19/${latitude}/${longitude}`;
    $('coordinate-selection').textContent=b.shortId||b.id;
  }
  function appearance(){
    material.size=+$('point-size').value;material.depthTest=!$('point-through').checked;
    $('point-size-value').textContent=material.size+' px';
    cloud.visible=$('show-points').checked&&!isHidden()&&payload?.id===getSelected()?.id&&visibleCount>0;
    map.triggerRepaint();
  }
  function render(){
    cloud.geometry.dispose();cloud.geometry=new THREE.BufferGeometry();visibleCount=0;
    if(!payload||payload.id!==getSelected()?.id){appearance();return;}
    const key=chapter+'/'+getGroup(),setId=payload.groupToTrainSet[key];
    const originalCandidates=new Set(payload.trainSets[payload.groupToTrainSet[['workflow','canopy'].includes(chapter)?chapter+'/raw':'tree/global']]||[]);
    const scoreKind=payload.groupToScoreModel?.[key]||'fusion',scores=payload.semanticScores?.[scoreKind]||[];
    const train=new Set(payload.trainSets[setId]||[]),test=new Set(payload.tests[chapter]||[]),mode=$('point-mode').value,colorMode=$('point-color').value;
    const indices=[];for(let i=0;i<payload.flags.length;i++){
      const f=payload.flags[i];
      if(mode==='all'||mode==='inside'&&(f&1)&&(f&4)||mode==='high'&&(f&4)||mode==='train'&&train.has(i)||mode==='test'&&test.has(i)||mode==='removed'&&originalCandidates.has(i)&&!train.has(i))indices.push(i);
    }
    const uncertain=new Set(payload.decisionMasks?.uncertain||[]),planeProtected=new Set(payload.decisionMasks?.planeProtected||[]);
    const positions=new Float32Array(indices.length*3),colors=new Float32Array(indices.length*3),c=new THREE.Color();
    for(let k=0;k<indices.length;k++){
      const i=indices[k],j=i*3;positions[k*3]=payload.positions[j];positions[k*3+1]=payload.positions[j+1];positions[k*3+2]=payload.positions[j+2];
      if(colorMode==='decision'){c.set(payload.flags[i]&2?'#d6ab7a':!originalCandidates.has(i)?'#b9c0c5':!train.has(i)?'#ff3b35':planeProtected.has(i)?'#59e68c':uncertain.has(i)?'#ffcf36':'#35d9ed');}
      else if(colorMode==='height'){const h=payload.heightAboveGround[i];c.setHSL((1-Math.max(0,Math.min(1,(h-2)/28)))*.68,.95,.57);}
      else if(colorMode==='vegetation'){const p=scores[i];if(Number.isFinite(p)&&p>=0)c.setHSL((1-p)*.68,.95,.57);else c.set(payload.flags[i]&2?'#d6ab7a':'#bcc4cb');}
      else if(colorMode==='split')c.set(test.has(i)?'#ff56c7':train.has(i)?'#30ebf5':payload.flags[i]&2?'#d6ab7a':'#c5cdd7');
      else c.set(payload.flags[i]&2?'#d6ab7a':payload.classification[i]===17?'#c487ff':'#4ce9ce');
      colors[k*3]=c.r;colors[k*3+1]=c.g;colors[k*3+2]=c.b;
    }
    cloud.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));cloud.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    visibleCount=indices.length;
    const m=payload.metadata,fmt=x=>Number.isFinite(x)?x.toLocaleString('zh-CN'):'—';
    $('point-status').textContent=`显示 ${fmt(visibleCount)} / 周边原始回波 ${fmt(m.rawCount)} 点`;
    $('point-density').textContent=`原足迹内高处回波 ${fmt(m.insideHighCount)} 点 · ${Number.isFinite(m.insideHighDensity_per_m2)?m.insideHighDensity_per_m2.toFixed(1):'—'} 点/m² · 周边地面 ${fmt(m.groundCount)} 点`;
    const tm=m.trainMemberships?.[key],hm=m.testMemberships?.[chapter];
    $('point-membership').textContent=`本组候选 ${fmt(tm?.sourceRecordCount??train.size)} 条 · 留出 ${fmt(hm?.sourceRecordCount??test.size)} 条。颜色和筛选对应当前方法。`;
    const ambiguous=(tm?.ambiguousSourceCoordinates||0)+(hm?.ambiguousSourceCoordinates||0);
    if(['workflow','canopy'].includes(chapter))$('point-membership').textContent=`当前阶段输入 ${fmt(train.size)} 点 · 原始候选 ${fmt(originalCandidates.size)} 点 · 原始索引精确对应；无独立屋顶GT。`;
    $('point-ambiguity').hidden=!ambiguous;
    $('point-ambiguity').textContent=`旧实验中 ${fmt(ambiguous)} 个成员坐标存在重合回波，按原坐标标记全部匹配源记录；候选记录数与可视回波数可能不同。`;
    $('point-legend').dataset.mode=colorMode;
    $('point-legend').textContent=colorMode==='decision'?'红：本组删除　青：保留　黄：保留但模态冲突　绿：观测平面邻域　灰：其他原始点；非GT':colorMode==='vegetation'?({point:'点云',image:'光学',fusion:'融合'}[scoreKind]+'模型：蓝 低 → 红 高植被／篱笆得分 · 灰 未推理 · 棕 地面；非本地GT'):colorMode==='height'?'离估计地面高度：蓝 ≤2 m → 绿 → 黄 → 红 ≥30 m':colorMode==='split'?'青：本组候选　粉：留出　灰：其他　棕：地面':'棕：原地面类 2/18　紫：原重叠未分类 17　青：其他类';
    appearance();onHeight();
  }
  async function sync(){
    const b=getSelected();if(!b)return;
    if(activeId===b.id&&payload){coordinates(b,payload.targetLngLat);render();return;}
    const token=++requestToken;activeId=b.id;payload=null;error=null;loading=true;cloud.visible=false;coordinates(b);
    $('point-status').textContent='正在读取该栋原始 3DEP 回波…';$('point-density').textContent='';$('point-membership').textContent='';$('point-ambiguity').hidden=true;map.triggerRepaint();
    try{
      let promise=cache.get(b.id);
      if(!promise){promise=(async()=>{
        const response=await fetch((chapter==='canopy'?'../next/canopy/data/points/':chapter==='workflow'?'../next/data/points/':'../data/'+(chapter==='tree'?'tree-points/':'points/'))+encodeURIComponent(b.id)+'.json.gz');if(!response.ok)throw new Error('点云 HTTP '+response.status);
        const bytes=new Uint8Array(await response.arrayBuffer());
        const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
        const data=JSON.parse(text);if(data.id!==b.id||data.positions.length!==data.flags.length*3)throw new Error('点云清单不一致');return data;
      })();cache.set(b.id,promise);promise.catch(()=>cache.delete(b.id));}
      const data=await promise;if(token!==requestToken||getSelected()?.id!==b.id)return;
      payload=data;loading=false;coordinates(b,data.targetLngLat);render();
    }catch(e){if(token!==requestToken)return;loading=false;error=e.message;$('point-status').textContent='点云加载失败：'+e.message+'。切换建筑可重试。';onHeight();}
  }
  for(const id of ['show-points','point-size','point-through'])$(id).addEventListener(id==='point-size'?'input':'change',()=>{appearance();onChange();});
  for(const id of ['point-mode','point-color'])$(id).addEventListener('change',()=>{render();onChange();});
  $('points-only').onclick=()=>{$('models').checked=false;$('show-points').checked=true;$('models').dispatchEvent(new Event('change'));appearance();onChange();};
  $('points-model').onclick=()=>{$('models').checked=true;$('show-points').checked=true;$('opacity').value=55;$('opacity').dispatchEvent(new Event('input'));appearance();onChange();};
  $('copy-coordinates').onclick=async()=>{
    const field=$('building-coordinates');let copied=false;
    try{await navigator.clipboard.writeText(field.value);copied=true;}catch{field.focus();field.select();try{copied=document.execCommand('copy');}catch{}}
    toast(copied?'已复制 WGS84 纬度、经度：'+field.value:'请选中坐标复制：'+field.value);
  };
  appearance();
  return {sync,appearance,state,get payload(){return payload;},get object(){return cloud;},get status(){return {id:payload?.id,activeId,loading,error,visibleCount,visible:cloud.visible,mode:$('point-mode').value,color:$('point-color').value,sourceCount:payload?.flags.length};}};
}

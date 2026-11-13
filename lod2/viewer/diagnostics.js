// Read-only explanation of the mesh actually submitted to the renderer.
export function createDiagnostics({getState,onSelect,onHeight}){
 const $=id=>document.getElementById(id),labels={raw:'原始基线',legacy_guarded:'平面保护',fusion:'光学＋点云',context_fusion:'光学＋局部邻域'};
 const methods=Object.keys(labels),rows=new Map(),fingerprints=new WeakMap();labels.precision_repair='数值足迹修复（raw）';
 let index=null,loadError=null,token=0,lastAudit=null;
 const status=document.createElement('p');status.id='render-diagnostic';status.className='render-diagnostic';status.setAttribute('role','status');
 document.querySelector('.model-display-panel').append(status);
 const details=document.createElement('details');details.id='method-diagnostic';details.className='method-diagnostic';
 details.innerHTML='<summary>方法输入与重建诊断</summary><p id="point-meaning"></p><p id="native-failure"></p><p id="diagnostic-trial-link"></p><div class="diagnostic-table-wrap"><table><thead><tr><th>方法</th><th>重建点</th><th>屋面片</th><th>覆盖</th><th>与原始网格</th></tr></thead><tbody id="diagnostic-rows"></tbody></table></div><p class="diagnostic-note">网格按 1 mm 显示精度比较，忽略顶点和三角形的排列顺序。网格不同也可能只是三角划分或细小变化；网格一致不代表精度正确。</p>';
 document.querySelector('.cloud-inspector').append(details);
 details.addEventListener('toggle',onHeight);
 const n=x=>Number.isFinite(x)?x.toLocaleString('zh-CN'):'—',pc=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'—';
 function compare(a,b){for(let i=0;i<a.length;i++){if(Array.isArray(a[i])){const c=compare(a[i],b[i]);if(c)return c;}else if(a[i]!==b[i])return a[i]-b[i];}return 0;}
 function meshHash(geometry){
  if(fingerprints.has(geometry))return fingerprints.get(geometry);
  const work=(async()=>{
   const p=geometry.getAttribute('position'),ix=geometry.index,count=ix?ix.count:(p?.count||0),triangles=[];
   for(let i=0;i<count;i+=3){const t=[];for(let j=0;j<3;j++){const k=ix?ix.getX(i+j):i+j;t.push([Math.round(p.getX(k)*1000),Math.round(p.getY(k)*1000),Math.round(p.getZ(k)*1000)]);}t.sort(compare);triangles.push(t);}
   triangles.sort(compare);
   return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(triangles))))].map(v=>v.toString(16).padStart(2,'0')).join('');
  })();fingerprints.set(geometry,work);return work;
 }
 function drawRows(s,record){
  const body=$('diagnostic-rows');body.replaceChildren();
  if(!record){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent=loadError?'诊断记录加载失败，可刷新重试。':'正在读取逐建筑诊断…';row.append(cell);body.append(row);return;}
  const full=s.mode==='building'&&s.geometrySource!=='compiled-roof-preview';
  for(const method of s.trialMode?['raw','precision_repair']:methods){const d=record.methods[method];if(!d)continue;const tr=document.createElement('tr');tr.className=method===s.method?'active':'';
   const first=document.createElement('td'),button=document.createElement('button');button.textContent=labels[method];button.setAttribute('aria-pressed',String(method===s.method));button.onclick=()=>onSelect(method);first.append(button);tr.append(first);
   const empty=(full?d.fullTriangles:d.roofTriangles)===0,same=full?d.sameFullAsRaw:d.sameRoofAsRaw;
   for(const value of [n(d.keptPoints),n(d.roofSurfaces),pc(d.roofXYCoverage),empty?'无输出':method==='raw'?'基线':same?'相同':'不同']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
  }
 }
 function update(){
  const s=getState();if(!s?.building)return;
  const current=++token,record=rows.get(s.block+'/'+s.building.id),p=s.points.payload,pointState=s.points.status;
  const isRef=s.method==='reference',methodLabel=isRef?'官方来源参考':labels[s.method]||s.method;
  const source=s.geometrySource==='official-reference-full-model'?'官方原始完整几何':s.geometrySource==='numerical-footprint-repair-trial'?'独立数值修复原生模型':s.geometrySource==='native-full-model'?'原生完整模型':'屋顶预览';
  const hasPoints=p?.id===s.building.id;
  const raw=hasPoints?(p.trainSets[p.groupToTrainSet['dl/raw']]||[]):[];
  const kept=hasPoints&&!isRef?(p.trainSets[p.groupToTrainSet['dl/'+(s.method==='precision_repair'?'raw':s.method)]]||[]):[];
  $('point-meaning').textContent=isRef?'官方参考不执行筛点；叠加的是同一份原始 3DEP 观测。':['inside','all','high'].includes(pointState.mode)?'当前显示原始回波：XYZ 不随方法变化。选择“保留点／删除点”或“保留／删除”着色查看筛点差异。':'保留点／删除点对应本方法实际送入重建的源记录，不等于已确认的屋顶／树木标签。';
  const failure=record?.methods[s.method]?.failure;
  $('native-failure').textContent=isRef?'官方几何用于外部参考对照；它不是本实验预测。':failure?.summary||'请同时看实际输入点、屋面覆盖和原生输出状态；点多或程序返回成功，都不保证屋顶完整。';
  $('native-failure').classList.toggle('has-failure',!!failure?.hasRecordedFailure);
  $('diagnostic-trial-link').replaceChildren();
  if(record?.trialURL&&!s.trialMode){const a=document.createElement('a');a.href=new URL(record.trialURL,new URL('../',location.href));a.target='_blank';a.rel='noopener';a.textContent='查看本栋数值足迹修复前后 ↗（独立 raw 控制，未计入主表）';$('diagnostic-trial-link').append(a);}
  drawRows(s,record);
  const prefix='实际显示：'+methodLabel+' · '+source+' · '+n(s.display.triangleCount)+' 个三角面';
  const input=isRef?'':hasPoints?' · 送重建 '+n(kept.length)+' / 候选 '+n(raw.length)+' 点':' · 正在读实际输入点';
  const hidden=s.mode==='hidden'?' · 模型已隐藏；点云当前'+(pointState.visible?'显示':'未显示'):'';
  if(s.display.loading){status.textContent=prefix+' · 正在加载完整几何';lastAudit={method:s.method,loading:true};return;}
  if(!s.display.triangleCount){status.textContent=prefix+input+' · 无模型输出'+hidden;lastAudit={method:s.method,id:s.building.id,block:s.block,mode:s.mode,triangles:0,source:s.geometrySource,loading:false,candidatePoints:raw.length,keptPoints:isRef?null:kept.length,modelHidden:s.mode==='hidden'};return;}
  status.textContent=prefix+input+hidden+' · 正在核对网格';
  meshHash(s.mesh.geometry).then(hash=>{
   if(current!==token)return;
   const full=s.mode==='building'&&s.geometrySource!=='compiled-roof-preview',d=record?.methods[s.method];
   const expected=d?.[full?'fullSHA256':'roofSHA256'];
   const matched=isRef?null:expected?hash===expected:null;
   const same=d?.[full?'sameFullAsRaw':'sameRoofAsRaw'];
   const relation=isRef?'官方参考，非算法':matched===false?'载入网格与该方法记录不符，请检查':s.method==='raw'?'原始基线':s.method==='precision_repair'?'独立数值修复试跑，未计入主表':same===true?'与原始网格相同':same===false?'与原始网格不同':'诊断记录待核对';
   status.textContent=prefix+input+' · 网格 '+hash.slice(0,10)+' · '+relation+hidden;
   status.dataset.verified=matched===true?'true':matched===false?'false':'reference';
   lastAudit={method:s.method,block:s.block,id:s.building.id,mode:s.mode,source:s.geometrySource,triangles:s.display.triangleCount,renderedSHA256:hash,expectedSHA256:expected||null,sourceMatches:matched,sameAsRaw:same??null,candidatePoints:raw.length,keptPoints:isRef?null:kept.length,modelHidden:s.mode==='hidden'};
   onHeight();
  }).catch(error=>{if(current===token){status.textContent=prefix+input+' · 网格核对失败：'+error.message;lastAudit={method:s.method,error:error.message};}});
 }
 (async()=>{try{const response=await fetch('../model-diagnostics/index.json.gz');if(!response.ok)throw Error('HTTP '+response.status);const bytes=new Uint8Array(await response.arrayBuffer());const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);index=JSON.parse(text);for(const b of index.buildings)rows.set(b.blockId+'/'+b.id,b);update();}catch(error){loadError=error.message;update();}})();
 return {update,get status(){return lastAudit;},get loaded(){return !!index;},get error(){return loadError;},get data(){return index;}};
}

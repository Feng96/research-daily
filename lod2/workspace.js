const $=id=>document.getElementById(id),frame=$('experiment-viewer');
const allowed=['raw','legacy_guarded','fusion','context_fusion'];
const states={reference:{block:'boston_g5',group:'raw',base:'naip',pointMode:'inside',pointColor:'decision'},us:{group:'fusion',base:'naip',pointMode:'inside',pointColor:'decision'},controlled:{method:'graph_20000_long_s20261031',case:'dense_canopy'}};
const labels={raw:'原始输入',legacy_guarded:'平面保护',fusion:'光学＋点云',context_fusion:'光学＋局部邻域',reference:'官方来源参考'};
const recipes={raw:'保留全部候选点，直接重建。',legacy_guarded:'旧融合选择器配合规则和平面保护，再交给共同重建器。',fusion:'用几何与 R/G/NIR 光学特征判断干扰点，再重建。',context_fusion:'加入邻点结构判断干扰点，再重建；需要同时检查屋顶误删。',reference:'查看官方来源的屋面几何。参考数据与输入可能不同年份。',graph_20000_long_s20261031:'局部图网络学习邻点关系，再交给固定几何重建器。'};
let experiment='reference',data,reference,summary,loaded=false,resultSlice='all';
const n=x=>Number.isFinite(x)?x.toLocaleString('zh-CN'):'—';
const percent=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'—';
const fixed=x=>Number.isFinite(x)?x.toFixed(3):'—';
function sanitize(id,state){
 const keys=id==='controlled'?['building','case','method','modelMode','edges','opacity','points','pointSize','pointColor']:['block','building','group','base','pointMode','pointColor','points','models','modelMode','edges','opacity','pointSize','pointThrough','lng','lat','z','bearing','pitch'];
 const s=Object.fromEntries(Object.entries(state).filter(([k,v])=>keys.includes(k)&&typeof v==='string'));
 if(s.modelMode&&!['roof','building','wireframe','hidden'].includes(s.modelMode))delete s.modelMode;
 if(id==='controlled'){if(!['raw','graph_20000_long_s20261031'].includes(s.method))s.method='graph_20000_long_s20261031';if(!s.case)s.case='dense_canopy'}
 else{if(![...allowed,...(id==='reference'?['reference']:[])].includes(s.group))s.group=id==='reference'?'raw':'fusion';if(!['satellite','naip','osm'].includes(s.base))s.base='naip';if(!['inside','train','removed','all'].includes(s.pointMode))s.pointMode='inside';if(!['height','decision'].includes(s.pointColor))s.pointColor='decision';if(id==='reference'&&!reference.blocks.some(b=>b.id===s.block))s.block=reference.blocks[0]?.id;}
 return s;
}
function sourceURL(){const s=states[experiment],hash=new URLSearchParams(s);return experiment==='reference'?'viewer/?v=20261113-diagnostics&chapter=dl&curated=1&dataset=reference&block='+encodeURIComponent(s.block)+'&slice='+encodeURIComponent(resultSlice)+'#'+hash:experiment==='us'?'viewer/?v=20261113-diagnostics&chapter=dl&curated=1#'+hash:'native/?v=20261113-diagnostics&curated=1#'+hash;}
function displayState(s){return Object.fromEntries(Object.entries(s).filter(([key])=>['modelMode','edges','opacity','points','models','pointSize','pointThrough'].includes(key)));}
function save(){const p=new URLSearchParams({experiment,...states[experiment],...(experiment==='reference'?{slice:resultSlice}:{})});history.replaceState(null,'','?'+p+(location.hash||''));$('full-viewer').href=sourceURL();}
function fit(h){const next=Math.max(700,Math.min(3600,Math.ceil(h)));if(Math.abs(frame.clientHeight-next)>2)frame.style.height=next+'px';}
function table(headers,rows){const tr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.textContent=h;tr.append(th)}$('result-head').replaceChildren(tr);$('result-rows').replaceChildren(...rows.map(row=>{const tr=document.createElement('tr');for(const v of row){const td=document.createElement('td');td.textContent=v;tr.append(td)}return tr}));}
function render(){
 const isRef=experiment==='reference',us=experiment==='us';$('diagnostic-notes').hidden=!isRef;$('experiment-panel').setAttribute('aria-labelledby','tab-'+experiment);
 for(const b of document.querySelectorAll('[data-experiment]')){const active=b.dataset.experiment===experiment;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
 $('reference-controls').hidden=!isRef;$('reference-block').value=states.reference.block;
 $('result-controls').hidden=!isRef;$('result-slice').value=resultSlice;
 $('regional-downloads').hidden=!isRef;$('regional-download-note').hidden=!isRef;$('regional-downloads').replaceChildren(...(isRef?(reference.downloads||[]).filter(d=>d.block_id===states.reference.block).map(d=>{const a=document.createElement('a');a.href=d.url;a.textContent=d.block_id+' · '+d.part+' · '+n(d.units)+' 记录 ZIP ↓';return a}):[]));
 $('experiment-summary').textContent=isRef?'相同 NAIP、3DEP 与给定足迹，比较四种方法，并直接查看官方参考屋面。':us?'早期 Georgetown 实测样例，保留影像、点云与方法切换。':'已知参考屋顶，检查图网络在受控污染点云中的表现。';
 $('quick-cases').replaceChildren();
 if(isRef){
  const c=reference.counts||{};$('evidence-scope').textContent='2 城市 · '+reference.blocks.length+' 个区域';
  $('finding').textContent=summary?.web_finding||'本表汇总新区域的外部屋面一致性。原生 LoD2 输出率用于检查可用性；覆盖率和内部折线 F1 用于检查屋面形状。';
  const slice=summary?.web_slices?.find(s=>s.id===resultSlice),rows=slice?.methods||summary?.methods||[];
  const ranked=rows.filter(r=>Number.isFinite(r.breakline_f1_1m_mean)).sort((a,b)=>b.breakline_f1_1m_mean-a.breakline_f1_1m_mean);
  if(ranked.length){const best=ranked[0],raw=rows.find(r=>r.method==='raw'),top=ranked.filter(r=>fixed(r.breakline_f1_1m_mean)===fixed(best.breakline_f1_1m_mean));let text;if(top.length===ranked.length)text='四法的内部折线 F1 相近（均约 '+fixed(best.breakline_f1_1m_mean)+'）';else if(top.length>1)text=top.map(r=>labels[r.method]).join('、')+' 的 F1 在三位小数显示精度下并列最高（'+fixed(best.breakline_f1_1m_mean)+'）';else text=labels[best.method]+' 的内部折线 F1 最高（'+fixed(best.breakline_f1_1m_mean)+'），原始输入为 '+fixed(raw?.breakline_f1_1m_mean);$('finding').textContent=(slice?.label||'全部新增记录')+'：'+text+'；同时核对屋面覆盖和失败记录。';}
  table(['方法','共同运行 / 新记录','全部部件 LoD2','屋面覆盖','内部折线 F1'],rows.map(r=>[labels[r.method]||r.method,n(r.fully_executed_units)+' / '+n(r.units),percent(r.paired_population_native_lod2_rate),percent(r.roof_xy_coverage_mean),fixed(r.breakline_f1_1m_mean)]));
  $('result-note').textContent='共用官方足迹，不评价足迹提取。新记录等权，只比较四法均运行的记录并保留失败；LoD2率要求全部部件成功。F1仅统计有内部折线的参考，容差1 m。参考跨年、DC高程基准未核实，因此不声称绝对高度精度。分组与分母见下载。';
  $('result-note').textContent+=' 本条件 F1 参考 N='+n(rows[0]?.breakline_f1_1m_units)+'。';
  $('reference-counts').textContent='锁定来源记录 '+n(c.frozen)+' · 配对输入 '+n(c.ready)+' · 新增共同运行 '+n(summary?.methods[0]?.fully_executed_units)+'；历史样例单独标记。';
  if(resultSlice.startsWith('ndvi_proxy_bin'))$('result-note').textContent+=' 树冠代理是高 NDVI 回波比例，不是树木／遮挡真值。';
  if(slice?.examples?.length){const label=document.createElement('span');label.textContent='该条件样例';$('quick-cases').append(label);for(const item of slice.examples){const b=document.createElement('button');b.textContent=item.unit_id;b.onclick=()=>{const v=frame.contentWindow.roofCompare,target=v?.loaded&&v.data.blockId===item.block_id?v.data.buildings.find(b=>b.id===item.unit_id):null;if(target){v.selectBuilding(target,true);return}states.reference={...displayState(states.reference),block:item.block_id,building:item.unit_id,group:states.reference.group,base:states.reference.base,pointMode:'inside',pointColor:'decision'};setExperiment('reference');};$('quick-cases').append(b);}}
 }else if(us){
  $('evidence-scope').textContent='源场景空间复核，非美国屋顶真值';$('finding').textContent='简单融合较保守；邻域融合剔除更多树木点，也存在较高误删风险。';
  table(['方法','真实屋顶点保留','树木点剔除'],data.us.rows.map(r=>[r.label,percent(r.roof_retention),percent(r.tree_rejection)]));
  $('result-note').textContent='4 个源场景空间划分、各 3 个种子的均值，不能当作美国建筑精度。新区域比较请切换“外部参考对照”。';
 }else{
  $('evidence-scope').textContent='200 栋 × 12 种受控条件';$('finding').textContent='局部图网络在受控测试中降低重建损失；实际迁移效果由真实区域对照检验。';
  table(['方法','重建主损失','屋脊 F1'],data.controlled.rows.map(r=>[r.label,fixed(r.loss)+' m',fixed(r.ridge_f1)]));
  $('result-note').textContent='主损失包含重建失败与缺覆盖罚分。点云与参考同源，不能直接当作美国实测精度。';
 }
 if(!isRef){const shortcuts=us?[['67528254',{osm:'67528254'}],['66347628',{osm:'66347628'}],['67521425',{osm:'67521425'}]]:[['密集树冠',{case:'dense_canopy'}],['极稀疏点',{case:'very_sparse'}]];for(const [name,state]of shortcuts){const b=document.createElement('button');b.textContent=name;b.onclick=()=>selectCase(state);$('quick-cases').append(b);}}
 $('method-note').textContent=recipes[states[experiment].group||states[experiment].method]||'';
}
function setExperiment(id,s={}){experiment=['reference','us','controlled'].includes(id)?id:'reference';states[experiment]=sanitize(experiment,{...states[experiment],...s});render();$('viewer-status').hidden=false;frame.style.height=(innerWidth<650?1480:1060)+'px';frame.src=sourceURL();save();}
function selectCase(s){const w=frame.contentWindow;if(experiment==='us'){const v=w.roofCompare,b=v?.data?.buildings?.find(b=>b.id.endsWith('osm-'+s.osm));if(v?.loaded&&b){v.selectBuilding(b,true);return}const id=data.us.buildings.find(id=>id.endsWith('osm-'+s.osm));setExperiment('us',{...states.us,building:id})}else if(experiment==='reference')setExperiment('reference',s);else{const v=w.lod2Native;if(v?.loaded&&s.case){const select=w.document.getElementById('condition');select.value=s.case;select.dispatchEvent(new Event('change'));return}setExperiment('controlled',s);}}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;const d=e.data;if(d?.type==='lod2-height'&&Number.isFinite(d.height))fit(d.height);if(['reference','us'].includes(experiment)&&d?.type==='lod2-selection'&&d.chapter==='dl'){if(experiment==='reference'&&(d.dataset!=='reference'||d.block!==states.reference.block)||experiment==='us'&&d.dataset==='reference')return;states[experiment]=sanitize(experiment,{...states[experiment],...d});$('method-note').textContent=recipes[states[experiment].group]||'';save();$('viewer-status').hidden=true}if(experiment==='controlled'&&d?.type==='lod2-native-selection'){states.controlled=sanitize('controlled',d);save();$('viewer-status').hidden=true;}});
const tabs=['reference','us','controlled'];for(const b of document.querySelectorAll('[data-experiment]')){b.onclick=()=>setExperiment(b.dataset.experiment);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const i=tabs.indexOf(experiment),id=e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:tabs[(i+(e.key==='ArrowRight'?1:2))%3];$('tab-'+id).focus();setExperiment(id);}};}
frame.addEventListener('load',()=>{try{if(frame.contentDocument?.body)fit(frame.contentDocument.body.scrollHeight)}catch{}});
$('reference-block').onchange=e=>{states.reference={...displayState(states.reference),group:states.reference.group,block:e.target.value,base:states.reference.base,pointMode:'inside',pointColor:'decision'};setExperiment('reference');};
$('result-slice').onchange=e=>{resultSlice=e.target.value;render();save();};
window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search),id=tabs.includes(p.get('experiment'))?p.get('experiment'):'reference',next=sanitize(id,{...states[id],...Object.fromEntries(p)}),same=id===experiment&&Object.keys(next).length===Object.keys(states[id]).length&&Object.keys(next).every(k=>next[k]===states[id][k]);if(!same)setExperiment(id,next);});
try{const read=async p=>{const r=await fetch(p);if(!r.ok)throw Error(p+' HTTP '+r.status);return r.json();};[data,reference,summary]=await Promise.all([read('curated.json?v=20261104-simple'),read('reference-eval/index.json'),read('reference-eval/summary.json')]);if(!reference.blocks?.length)throw Error('外部参考没有已完成区域');$('reference-block').replaceChildren(...reference.blocks.map(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=(b.city||'')+' · '+b.id+' · '+n(b.buildingCount??b.referenceUnits)+' 记录';return o}));$('result-slice').replaceChildren(...(summary.web_slices||[{id:'all',label:'全部新增记录'}]).map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.label;return o}));const p=new URLSearchParams(location.search);if(summary.web_slices?.some(s=>s.id===p.get('slice')))resultSlice=p.get('slice');setExperiment(p.get('experiment')||'reference',Object.fromEntries(p));loaded=true;}catch(e){$('error').hidden=false;$('error').textContent='页面加载失败：'+e.message;$('viewer-status').hidden=true;}
window.lod2Workspace={get loaded(){return loaded},get data(){return data},get reference(){return reference},get summary(){return summary},get experiment(){return experiment},get state(){return {experiment,...states[experiment]}},setExperiment,selectCase};

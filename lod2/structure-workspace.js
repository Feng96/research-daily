import {RESIDUAL_REMOTE_ASSET_BASE} from './viewer/asset-source.js?v=20261120-residual';
const $=id=>document.getElementById(id),frame=$('experiment-viewer');
function residualAsset(path){if(location.hostname!=='feng96.github.io')return 'residual-structure/'+path;if(!/^https:\/\/raw\.githubusercontent\.com\/Feng96\/research-daily\/[0-9a-f]{40}\/lod2\/residual-structure\/$/.test(RESIDUAL_REMOTE_ASSET_BASE))throw Error('局部屋面数据版本无效');return RESIDUAL_REMOTE_ASSET_BASE+path;}
const methods=['raw','geometry','A_joint','B_hierarchical','R_geometry','R_DL','reference'];
const labels={raw:'原始重建',geometry:'几何规整',A_joint:'A · 联合模型',B_hierarchical:'B · 主次模型',reference:'官方原始屋顶（未裁剪）',R_geometry:'残差边界 · 几何',R_DL:'残差边界 · 冻结 DL'};
const descriptions={R_geometry:'点云残差提出局部平台和边界，再以几何证据选面；共用旧 DL 主结构及点语义先验。',R_DL:'点云残差边界＋冻结 DL 重新推理；光学分辨率不足时不作否定证据，可观测性为规则门控，本轮未新增训练。',raw:'相同原始观测的既有重建，用作基线。',geometry:'共用冻结点语义先验及候选屋面，用几何约束规整，不增加新结构网络。',A_joint:'影像与点云共同判断屋面分区及相邻结构，再进行几何解码。',B_hierarchical:'点云建立主屋面，光学核验局部结构；证据不足时采用较简单解释。',reference:'官方屋顶按原始完整范围与位置显示，未按 OSM 裁剪或平移；可切换含墙面的原始建筑，补底部分单独标注。'};
let index,summary,review,residualIndex,residualSummary,loaded=false,state={block:'boston_g5',split:'test',group:'A_joint',base:'naip',points:'0',pointMode:'inside',pointColor:'height',modelMode:'building'};
const n=x=>Number.isFinite(x)?x.toLocaleString('zh-CN'):'—';
const pc=x=>Number.isFinite(x)?(100*x).toFixed(1)+'%':'—';
const fixed=x=>Number.isFinite(x)?x.toFixed(3):'—';
const splitLabels={pilot:'本轮优化样本',test:'隔离测试',val:'验证集',train:'训练集',transfer_test:'DC 迁移对照',all:'全部样本'};
function eligibleBlocks(split){return index.blocks.filter(b=>split==='all'||(b.splits?.[split]||0)>0);}
function sanitize(input){
 const keys=['block','split','building','group','base','points','pointMode','pointColor','modelMode','edges','opacity','pointSize','pointThrough','lng','lat','z','bearing','pitch'];
 const s=Object.fromEntries(Object.entries(input).filter(([k,v])=>keys.includes(k)&&typeof v==='string'));
 if(!Object.hasOwn(splitLabels,s.split))s.split='test';
 if(!methods.includes(s.group))s.group='A_joint';
 if(!['satellite','naip','osm'].includes(s.base))s.base='naip';
 if(!['roof','building','wireframe','hidden'].includes(s.modelMode))s.modelMode='building';
 if(!['inside','train','removed','all'].includes(s.pointMode))s.pointMode='inside';
 if(!['height','decision'].includes(s.pointColor))s.pointColor='height';
 const blocks=eligibleBlocks(s.split);if(!blocks.length)throw Error('该划分没有已完成样本');
 if(!blocks.some(b=>b.id===s.block))s.block=blocks[0].id;
 return s;
}
function viewerURL(){const hash=new URLSearchParams(state);return 'viewer/?v=20261120-residual&chapter=dl&curated=1&dataset=structure&block='+encodeURIComponent(state.block)+'&split='+state.split+'&case='+encodeURIComponent([state.building||'first',state.group,state.modelMode,state.points].join('_'))+'#'+hash;}
function save(){history.replaceState(null,'','?'+new URLSearchParams({experiment:'structure',...state})+(location.hash||''));$('full-viewer').href=viewerURL();}
function table(rows){
 const head=document.createElement('tr');for(const name of ['方法','有参考 / 全部单元','结构线 F1 · 1 m','坡面误差 · °','相对梯度 MAE','平均屋面平面数']){const cell=document.createElement('th');cell.textContent=name;head.append(cell);}$('result-head').replaceChildren(head);
 $('result-rows').replaceChildren(...rows.map(row=>{const tr=document.createElement('tr');for(const value of [labels[row.method]||row.method,n(row.gt_units)+' / '+n(row.units),fixed(row.boundary_f1_1m),Number.isFinite(row.normal_angle_mae_deg)?row.normal_angle_mae_deg.toFixed(2):'—',fixed(row.relative_gradient_mae),Number.isFinite(row.roof_plane_count_mean)?row.roof_plane_count_mean.toFixed(2):'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));
}
function residualTable(){
 let panel=$('residual-observation-metrics');
 if(!panel){panel=document.createElement('div');panel.id='residual-observation-metrics';$('finding').after(panel);}
 panel.replaceChildren();
 const evaluation=residualSummary?.observationEvaluation;
 if(evaluation?.status!=='complete')return;
 const note=document.createElement('p');note.className='small';note.textContent='条件拟合复测：只给新候选局部拟合留点，旧主结构先验已见完整点云；不是生产模型的独立留出测试，也不是真实屋顶精度。平均残差截断 3 m，P90 不截断；逐栋等权汇总。';
 const counts=document.createElement('div');counts.className='small';
 for(const row of evaluation.methods||[]){const c=row.production_outcome_counts;if(!row.method.startsWith('R_')||!c)continue;const values=['applied','no_change','quality_rollback','failure'].map(k=>c[k]);if(!values.every(Number.isFinite))continue;const noMain=row.production_status_counts?.unchanged_no_observational_main_roof||0;const p=document.createElement('p');p.textContent=(labels[row.method]||row.method)+'（'+n(values.reduce((a,b)=>a+b,0))+' 栋）：应用局部结构 '+n(c.applied)+' · 保留原屋面 '+n(c.no_change-noMain)+' · 质量回退保留主结构 '+n(c.quality_rollback)+' · 无主屋面（无新输出）'+n(noMain)+' · 未完成 '+n(c.failure);counts.append(p);}
 const raw=evaluation.raw_early_qc_error_counts;if(raw&&Number.isFinite(raw.production)&&Number.isFinite(raw.conditional)){const p=document.createElement('p');p.textContent='原始早期质量检查失败记录：生产 '+n(raw.production)+'、条件复测 '+n(raw.conditional)+'；原记录保留，最终处理状态单独统计。';counts.append(p);}
 for(const method of ['R_geometry','R_DL']){const value=residualSummary.methodStats?.[method]?.inheritedInvalidSourceGeometry;if(value>0){const p=document.createElement('p');p.textContent=labels[method]+'：'+n(value)+' 栋保留的旧主屋面本身含无效几何；显示与旧 B 相同的缓存面，未修复，不计为新结构改进。';counts.append(p);}}
 const wrap=document.createElement('div');wrap.className='table-scroll';const t=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
 for(const label of ['方法','可评分栋数','条件留点残差 · m','条件 P90 · m']){const c=document.createElement('th');c.textContent=label;tr.append(c);}head.append(tr);t.append(head);
 const body=document.createElement('tbody');
 for(const row of evaluation.methods||[]){const tr=document.createElement('tr');for(const value of [labels[row.method]||row.method,n(row.conditional_units),fixed(row.conditional_capped_mae_m_mean),fixed(row.conditional_p90_m_mean)]){const c=document.createElement('td');c.textContent=value;tr.append(c);}body.append(tr);}
 t.append(body);wrap.append(t);panel.append(counts,note,wrap);
}
function render(){
 $('experiment-panel').setAttribute('aria-labelledby','tab-structure');
 for(const b of document.querySelectorAll('[data-experiment]')){const selected=b.dataset.experiment==='structure';b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;}
 $('diagnostic-notes').hidden=true;$('result-controls').hidden=true;$('reference-controls').hidden=false;$('structure-controls').hidden=false;
 $('reference-block').replaceChildren(...eligibleBlocks(state.split).map(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=(b.city||'')+' · '+b.id+' · '+n(state.split==='all'?b.buildingCount:b.splits[state.split])+' 个单元';return o;}));$('reference-block').value=state.block;$('structure-split').value=state.split;
 const counts=index.counts||{};$('reference-counts').textContent=n(counts.objects)+' 个 OSM 单元，'+n(summary.counts?.paired)+' 个关联到官方屋顶；显示源对象完整范围，位置关系未确认。当前：'+splitLabels[state.split]+'。';
 $('experiment-summary').textContent='相同 NAIP、3DEP 和 OSM；新增局部残差边界，检查真实平台能否保留。官方屋顶仍保持原始范围与位置。';
 $('evidence-scope').textContent=eligibleBlocks(state.split).length+' 个区域 · '+splitLabels[state.split];
 const section=summary.splits?.[state.split];table(section?.rows||[]);
 $('finding').textContent='本轮 '+n(residualIndex.counts?.units)+' 栋：比较旧版与“残差边界 · 几何 / 冻结 DL”。先看 222 的局部平台，也检查稀疏点和树冠代理样本。两种新版本多数结果相同，本轮尚未证明冻结 DL 的额外收益。点云留点一致性用于诊断，不作为真实屋顶精度。官方与 OSM 尚未确认配准，旧裁剪指标不用于评优。';
 residualTable();
 $('historical-cropped-metrics').open=false;
 $('result-note').textContent='以下为既往按 OSM 裁剪的参考诊断，数值未重算。配准偏差可能影响裁剪与指标，不能据此确认方法优劣。F1 越高越好，坡面与梯度误差越低越好；分区数只描述复杂度。梯度 MAE 未截断，含缺测截断损失另见下载数据。失败保留，裁剪边不作屋脊，无参考区域不作负例。新解码器覆盖提升部分来自构造，不能作为 DL 准确的证据。三种新方法共用冻结点语义先验；绝对高度和完整闭合未认证，DC 暂不评价坡度及高差。本表与历史固定区域评价的分母不同。';
 if(state.split==='train'||state.split==='all')$('result-note').textContent+=' 当前包含训练样本；隔离测试同样受配准风险影响，当前不据此评优。';
 $('method-note').textContent=descriptions[state.group];
 $('quick-cases').replaceChildren();
 const focus=document.createElement('button');focus.textContent='222 案例 · 407834212';focus.dataset.buildingId='OSM_way_407834212';focus.onclick=()=>start({block:'boston_g5',split:'pilot',building:'OSM_way_407834212',group:'R_DL',points:'1',modelMode:'building'});$('quick-cases').append(focus);
 const inspected=review.inspection_details;
 const cases=inspected?[...(inspected.boundary_improvement||[]).slice(0,2).map(c=>({block:c.block_id,id:c.id,split:c.split,label:'结构样例',selection:'历史裁剪诊断选出的结构样例；当前配准未确认，不作为改进证明'})),...(inspected.relative_gradient_degradation||[]).slice(0,2).map(c=>({block:c.block_id,id:c.id,split:c.split,label:'高差样例',selection:'历史梯度诊断选出的高低结构样例，保留供目视对照'}))]:review.quickCases||index.quickCases||[];
 for(const c of cases.filter(c=>c.block===state.block&&(state.split==='all'||c.split===state.split)).slice(0,4)){const b=document.createElement('button');b.textContent=(c.label||'案例')+' · '+c.id;b.title=c.selection||'';b.dataset.buildingId=c.id;b.onclick=()=>selectCase({building:c.id});$('quick-cases').append(b);}
 $('regional-download-note').hidden=false;$('regional-downloads').hidden=false;
 $('regional-downloads').replaceChildren(...[[residualAsset('summary.json'),'本轮条件留点诊断'],['residual-structure/index.json','本轮样本与方法范围'],['structure-ab/summary.json','历史裁剪指标（配准未确认）'],['structure-ab/index.json','样本、划分与来源'],['structure-ab/gt-pairing.json','历史配对与裁剪记录'],['structure-review.json','光学消融、训练与案例记录']].map(([url,label])=>{const a=document.createElement('a');a.href=url;a.textContent=label;return a;}));
 let limits=$('structure-limit-panel');if(!limits){limits=document.createElement('details');limits.id='structure-limit-panel';const title=document.createElement('summary');title.textContent='本轮模型与限制';const text=document.createElement('p');text.className='small';const effects=review.optical_audit?.summary,ea=effects?.A_joint?.zero_optical,eb=effects?.B_hierarchical?.zero_optical;const effect=ea&&eb?'在 '+ea.units+' 个验证单元中，移除光学后 A 有 '+ea.units_with_decoded_change+' 个屋面改变，B 有 '+eb.units_with_decoded_change+' 个改变；尚未证明光学提升精度。':'';text.textContent='第一版实际训练候选屋面与相邻结构打分，优化样本为431 个训练、287 个验证单元。A 联合影像与几何；B 先建立几何主结构，再进行条件光学修正。'+effect+'形状选择受候选分区限制，未做连续像素边界回归；OSM 未记录的庭院可能被覆盖。高台阶的边界位置偏差可能主导梯度误差，需结合高差案例核查。观测与参考跨年；城市数据曾用于既往实验，本轮隔离划分不等同于全新城市精度验证。案例按钮来自历史裁剪诊断，仅供检查；配准未确认，不作为方法改进证明，没有据此调整模型。';limits.append(title,text);$('records').prepend(limits);}
}
function start(input={}){state=sanitize({...state,...input});render();frame.style.height=(innerWidth<650?1480:1060)+'px';$('viewer-status').hidden=false;frame.src=viewerURL();save();}
function selectCase(input){const r=frame.contentWindow?.roofCompare,b=r?.data?.buildings.find(b=>b.id===input.building);if(r?.loaded&&b){r.selectBuilding(b,true);return;}start(input);}
function setExperiment(id,input={}){if(id==='structure'){start(input);return;}location.assign('?'+new URLSearchParams({experiment:id,...input}));}
for(const b of document.querySelectorAll('[data-experiment]'))b.onclick=()=>setExperiment(b.dataset.experiment);
$('reference-block').onchange=e=>{const s={...state,block:e.target.value};delete s.building;state=s;start();};
$('structure-split').onchange=e=>{const s={...state,split:e.target.value};delete s.building;state=s;start();};
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;const d=e.data;if(d?.type==='lod2-height'&&Number.isFinite(d.height)){const h=Math.max(700,Math.min(3600,Math.ceil(d.height)));if(Math.abs(frame.clientHeight-h)>2)frame.style.height=h+'px';}if(d?.type==='lod2-selection'&&d.dataset==='structure'&&d.block===state.block){state=sanitize({...state,...d});$('method-note').textContent=descriptions[state.group];$('viewer-status').hidden=true;save();}});
frame.addEventListener('load',()=>{try{const h=frame.contentDocument?.body?.scrollHeight;if(h)frame.style.height=Math.max(700,Math.min(3600,h))+'px';}catch{}});
window.addEventListener('popstate',()=>start(Object.fromEntries(new URLSearchParams(location.search))));
try{const read=async url=>{const r=await fetch(url);if(!r.ok)throw Error(url+' HTTP '+r.status);return r.json();};
 [index,summary,review,residualIndex,residualSummary]=await Promise.all([read('structure-ab/index.json'),read('structure-ab/summary.json'),read('structure-review.json'),read('residual-structure/index.json'),read(residualAsset('summary.json'))]);
 if(!index.complete||!summary.complete||!residualIndex.complete)throw Error('实验导出未完成');
 for(const block of index.blocks){block.splits={...block.splits,pilot:residualIndex.blocks.find(b=>b.id===block.id)?.buildingCount||0};}
 const input=Object.fromEntries(new URLSearchParams(location.search));
 if(!['building','split','group','block'].some(k=>Object.hasOwn(input,k)))Object.assign(input,{block:'boston_g5',split:'pilot',building:'OSM_way_407834212',group:'R_DL',points:'1',modelMode:'building'});
 start(input);loaded=true;
}catch(e){$('error').hidden=false;$('error').textContent='实验加载失败：'+e.message;$('viewer-status').hidden=true;}

window.lod2Workspace={get loaded(){return loaded},get experiment(){return 'structure'},get state(){return {experiment:'structure',...state}},get structure(){return index},get structureSummary(){return summary},get residual(){return residualIndex},get residualSummary(){return residualSummary},setExperiment,selectCase};

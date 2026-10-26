const $=id=>document.getElementById(id),frame=$('dl-viewer');
const fmt=x=>x===null||x===undefined?'—':(100*x).toFixed(2)+'%';
function row(target,values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td)}$(target).append(tr)}
function state(){return new URLSearchParams(location.search)}
function url(s){return '../viewer/?chapter=dl#'+s}
function select(osm){const v=frame.contentWindow.roofCompare,b=v?.data.buildings.find(x=>x.id.endsWith('osm-'+osm));if(v?.loaded&&b){v.selectBuilding(b,true);frame.scrollIntoView({behavior:'smooth',block:'start'})}}
for(const b of document.querySelectorAll('[data-osm]'))b.onclick=()=>select(b.dataset.osm);
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;const d=e.data;if(d?.type==='lod2-height'&&Number.isFinite(d.height))frame.style.height=Math.max(650,Math.min(3500,d.height))+'px';if(d?.type==='lod2-selection'&&d.chapter==='dl'){const s=new URLSearchParams(Object.entries(d).filter(([k])=>!['type','chapter'].includes(k)));history.replaceState(null,'','?'+s+location.hash);$('standalone').href=url(s)}});
try{const r=await fetch('data/summary.json');if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();
 $('status').textContent=d.status==='complete'?'已完成 · 6 种模型 × 3 个种子 · 120 栋点预测 · 24 栋配对重建':'实验进行中：'+d.status;
 for(const text of d.findings){const p=document.createElement('p');p.textContent=text;$('findings-list').append(p)}
 function render(){ $('metrics').replaceChildren();for(const m of d.source_summary){const a=$('metric-scope').value==='full'?m.clean:m.common_clean;row('metrics',[d.labels[m.method],fmt(a.roof_retention.mean)+' ± '+(100*a.roof_retention.std).toFixed(2),fmt(a.tree8_rejection.mean)+' ± '+(100*a.tree8_rejection.std).toFixed(2),fmt(a.mean_iou.mean)+' ± '+(100*a.mean_iou.std).toFixed(2)])}}render();$('metric-scope').onchange=render;
 for(const m of d.source_summary)for(const [c,z]of Object.entries(m.conditions))if(c!=='clean')row('robustness',[d.labels[m.method],({missing_optical:'无光学',shift_1m:'偏移约1米',shift_2m:'偏移约2米'})[c]||c,fmt(z.roof_retention.mean),fmt(z.tree8_rejection.mean)]);
 for(const m of d.reconstruction_summary)row('reconstruction',[d.labels[m.method],m.removed_points.toLocaleString(),m.native_lod2+'/'+d.building_count,m.shell_passed+'/'+d.building_count]);
 if(d.spatialSummary){for(const [method,value]of Object.entries(d.spatialSummary.perMethod)){const z=value.full_with_point_fallback;row('spatial-metrics',[d.labels[method],fmt(z.roof_retention.mean),fmt(z.roof_retention.min),fmt(z.tree8_rejection.mean)])}$('spatial-finding').textContent=d.spatialFinding}else{$('spatial-finding').textContent='空间复核尚未完成，当前没有结果。'}
 $('data-summary').textContent=`训练 ${d.training_records.toLocaleString()} 点；空间验证 ${d.validation_records.toLocaleString()} 点；官方测试参考 ${d.source_test_records.toLocaleString()} 点。美国 ${d.target_records.toLocaleString()} 个候选点，预测与重建原始索引保留。`;
 const s=state();if(!s.has('base'))s.set('base','naip');if(!s.has('pointColor'))s.set('pointColor','decision');frame.src=url(s);$('standalone').href=url(s);window.lod2DL={loaded:true,data:d};
}catch(e){$('status').textContent='结果读取失败：'+e.message;window.lod2DL={loaded:false,error:e.message}}

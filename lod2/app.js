const $=id=>document.getElementById(id);
let manifest,current,selectedState={},changing=false;
const params=()=>new URLSearchParams(location.hash.slice(1));
const n=(x,d=3)=>Number.isFinite(x)?x.toFixed(d):'—';
const pct=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'—';
const delta=x=>Number.isFinite(x)?(x>0?'+':'')+(x*100).toFixed(2)+' cm':'—';
function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
function cell(row,text,cls,title){const td=el('td',text,cls);if(title)td.title=title;row.append(td);return td;}
function results(c){
  const table=$('results-table');table.replaceChildren();const head=el('thead'),tr=el('tr');const latest=c.id==='overnight';
  const labels=latest?['方法 / 配置','原60 · ΔMAE','新增60 · ΔMAE','原 / 新覆盖','边关联 · 原 / 新']:['方法','留出 MAE','原测试覆盖','配对 ΔMAE','边关联','LoD2 输出'];
  for(const label of labels)tr.append(el('th',label));head.append(tr);table.append(head);const body=el('tbody');
  const ids=[...new Set(c.metrics.map(r=>r.name))];
  for(const id of ids){const row=el('tr');const a=c.metrics.find(r=>r.name===id&&r.cohort==='legacy60')||c.metrics.find(r=>r.name===id);cell(row,a.label+(a.engineeringPrototype?' · 实验原型':''));
    if(latest){const b=c.metrics.find(r=>r.name===id&&r.cohort==='fresh60');for(const item of [a,b])cell(row,delta(item?.pairedDelta_m),item?.pairedDelta_m<0?'improve':item?.pairedDelta_m>0?'worse':'',`该组同点MAE ${n(item?.mae_m)} m；对应基线 ${n(item?.pairedControlMae_m)} m；固定${item?.n}栋`);cell(row,pct(a.ownCoverage)+' / '+pct(b?.ownCoverage));cell(row,`${a.edge_passes}/${a.n} · ${b?.edge_passes}/${b?.n}`);
    }else{cell(row,n(a.mae_m)+' m');cell(row,pct(a.ownCoverage??a.coverage));cell(row,delta(a.pairedDelta_m),a.pairedDelta_m<0?'improve':a.pairedDelta_m>0?'worse':'',a.pairedBaseline?'对照：'+a.pairedBaseline:'');cell(row,`${a.edge_passes} / ${a.n}`);cell(row,`${a.lod2_success} / ${a.n}`);}
    body.append(row);
  }table.append(body);
  $('metric-notes').textContent=(c.metricNotes||[]).join(' ');
}
const FIGURES={pilot:[],optimization:[['./figures/optimization.png','四组实验：共同支撑域、覆盖与结构检查。']],tree:[],overnight:[['./figures/workflows.png','12配置完整比较；原60栋与新增60栋分别报告。'],['./figures/roof-cases.png','六个同点改善／退化／中间案例；真实NAIP航片与原始屋面叠加。'],['./figures/robustness.png','描述性空间分块区间与中位数，检查少数案例的影响。']]};
function loadChapter(id,options={}){
  const c=manifest.chapters.find(x=>x.id===id)||manifest.chapters[0];const prior=current;current=c;
  document.querySelectorAll('.chapter-link').forEach(a=>{const active=a.dataset.chapter===c.id;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('chapter-number').textContent='CHAPTER '+String(c.number).padStart(2,'0');$('date').textContent=c.date;$('date').dateTime=c.date;$('title').textContent=c.title;$('subtitle').textContent=c.subtitle;$('summary').textContent=c.summary;
  $('key-metrics').replaceChildren(...c.keyMetrics.map(m=>{const x=el('div',undefined,'key-metric');x.append(el('span',m.label));const value=el('strong',String(m.value));value.append(el('small',m.unit||''));x.append(value,el('p',m.detail));return x;}));
  results(c);$('findings').replaceChildren(...c.findings.map((s,i)=>{const x=el('div',undefined,'finding');x.append(el('span',String(i+1).padStart(2,'0')),el('p',s));return x;}));$('limitations').replaceChildren(...c.limitations.map(s=>el('li',s)));$('question').textContent=c.question;
  $('downloads').replaceChildren(...c.downloads.map(item=>{const a=el('a',item.label+' ↓');a.href=item.url;a.download='';return a;}));
  const figures=FIGURES[c.id];$('evidence-section').hidden=!figures.length;$('figures').replaceChildren(...figures.map(([url,caption])=>{const fig=el('div',undefined,'figure-card'),link=el('a'),img=el('img');link.href=url;link.target='_blank';link.rel='noopener';img.src=url;img.alt=caption;img.loading='lazy';link.append(img);fig.append(link,el('p',caption+' 点击查看原图 ↗'));return fig;}));
  const state={...Object.fromEntries(params()),...selectedState,...options};delete state.chapter;if(prior?.id!==c.id&&state.group&&!c.groups.some(x=>x.id===state.group))delete state.group;
  const url='./viewer/?chapter='+c.id+'&v=20261020-tree#'+new URLSearchParams(state);$('viewer').src=url;$('open-viewer').href=url;
  history.replaceState(null,'','#'+new URLSearchParams({chapter:c.id,...state}));
  $('next-chapter').textContent=c.number===manifest.chapters.length?'回到第一章 ↑':'下一章 →';$('next-chapter').onclick=()=>{loadChapter(manifest.chapters[c.number%manifest.chapters.length].id);$('chapter').scrollIntoView({behavior:'smooth',block:'start'});};
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==$('viewer').contentWindow)return;const message=event.data;
  if(message?.type==='lod2-height'&&Number.isFinite(message.height)){const target=Math.max(760,Math.min(2100,Math.ceil(message.height)));if(Math.abs($('viewer').getBoundingClientRect().height-target)>4)$('viewer').style.height=target+'px';}
  if(message?.type==='lod2-selection'&&message.chapter===current?.id){selectedState={};for(const k of ['building','group','base','cohort','lng','lat','z','bearing','pitch','points','pointMode','pointColor','pointSize','pointThrough','opacity','models'])if(message[k]!==undefined)selectedState[k]=message[k];const hash=new URLSearchParams({chapter:current.id,...selectedState});history.replaceState(null,'','#'+hash);$('open-viewer').href='./viewer/?chapter='+current.id+'&v=20261020-tree#'+new URLSearchParams(selectedState);}
});
window.addEventListener('hashchange',()=>{if(manifest&&!changing){selectedState=Object.fromEntries(params());loadChapter(params().get('chapter'));}});
try{
  const response=await fetch('./data/chapters.json');if(!response.ok)throw new Error('HTTP '+response.status);manifest=await response.json();
  $('chapters').replaceChildren(...manifest.chapters.map(c=>{const a=el('a',undefined,'chapter-link');a.href='#chapter='+c.id;a.dataset.chapter=c.id;const label=el('div');label.append(el('strong',c.title),el('small',c.date+' · '+(c.id==='tree'?'120栋 / 6组':c.id==='overnight'?'120栋 / 12组':c.id==='pilot'?'60栋 / 5方法':'60栋 / 4组')));a.append(el('span',String(c.number).padStart(2,'0')),label);a.onclick=e=>{e.preventDefault();loadChapter(c.id);};return a;}));
  $('article').hidden=false;$('page-loading').hidden=true;loadChapter(params().get('chapter')||'pilot');
}catch(error){$('page-loading').textContent='实验记录加载失败：'+error.message;console.error(error);}
window.lod2Atlas={get current(){return current;},get manifest(){return manifest;},loadChapter};

const frame=document.getElementById('workflow-viewer');
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow)return;if(event.data?.type==='lod2-height'&&Number.isFinite(event.data.height))frame.style.height=Math.max(650,Math.min(3500,event.data.height))+'px';});
try{
  const response=await fetch('./data/summary.json');if(!response.ok)throw Error('结果 HTTP '+response.status);
  const data=await response.json();
  document.getElementById('count').textContent=data.summary.filter(x=>x.native_lod2).length+' / '+data.requested;
  document.getElementById('removed').textContent=data.frontend_removed_total.toLocaleString('zh-CN')+' 点';
  document.getElementById('post').textContent=data.post_removed_total+' 点';
  for(const row of data.summary){const tr=document.createElement('tr'),td=document.createElement('td'),button=document.createElement('button');button.className='case';button.textContent='OSM '+row.id.split('-osm-')[1];button.onclick=()=>{const hash=new URLSearchParams({building:row.id,group:'final',base:'naip',pointMode:'inside'});const url='../viewer/?chapter=workflow#'+hash,viewer=frame.contentWindow.roofCompare;if(viewer?.loaded){viewer.setGroup('final');viewer.setBasemap('naip');viewer.selectBuilding(viewer.data.buildings.find(b=>b.id===row.id),true);}else{frame.src=url;}document.getElementById('standalone').href=url;document.getElementById('visual').scrollIntoView({behavior:'smooth'});};td.append(button);tr.append(td);for(const value of [row.original_points,row.frontend_removed,row.unknown_retained,row.post_removed,row.final_roof_surfaces,row.unresolved_roof_surfaces]){const cell=document.createElement('td');cell.textContent=value.toLocaleString('zh-CN');tr.append(cell);}document.getElementById('results').append(tr);}
  window.lod2Workflow={loaded:true,data};
}catch(error){const box=document.getElementById('error');box.hidden=false;box.textContent='结果加载失败：'+error.message;}

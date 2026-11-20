const mode=new URLSearchParams(location.search).get('experiment')||'structure';
if(mode==='structure')await import('./structure-workspace.js?v=20261120-official');
else{
 await import('./legacy-workspace.js?v=20261120-official');
 document.getElementById('structure-controls').hidden=true;
 const extra=document.getElementById('archive-experiments');if(['reference','us','controlled'].includes(mode))extra.open=true;
 document.getElementById('tab-structure').onclick=()=>location.assign('?experiment=structure');
}

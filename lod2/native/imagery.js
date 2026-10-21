const $=id=>document.getElementById(id);
export function createObservations({onAlign,onResize}){
  let manifest=null,entry=null,requested=null,loaded=null,zoom=1,panX=0,panY=0,sequence=0,aligned=false,error=null;
  const photo=$('observation-image'),square=$('imagery-square'),viewport=$('imagery-viewport');
  const metadata=fetch('imagery.json?v=20261021-imagery').then(async r=>{if(!r.ok)throw Error('影像索引 HTTP '+r.status);manifest=await r.json();return manifest});
  // Attach a rejection handler before the first building arrives.
  metadata.catch(()=>{});
  function layout(){
    const size=Math.min(viewport.clientWidth,viewport.clientHeight);square.style.width=size+'px';square.style.height=size+'px';
    const shiftX=entry?-panX/entry.span_m*size*zoom:0,shiftY=entry?panY/entry.span_m*size*zoom:0;
    square.style.transform=`translate(-50%,-50%) translate(${shiftX}px,${shiftY}px) scale(${zoom})`;
    const columns=getComputedStyle(document.querySelector('.panels')).gridTemplateColumns.split(' ').length;
    const heading=$('selected-panel').querySelector('.panel-heading');
    if(columns>1){const height=document.querySelector('.observation-panel .panel-heading').getBoundingClientRect().height+document.querySelector('.observation-toolbar').getBoundingClientRect().height;heading.style.minHeight=height+'px'}else heading.style.removeProperty('min-height');
    onResize();
  }
  function mode(){const map=$('observation-source').value==='osm';document.querySelector('.photo-attribution').hidden=map;if(map){$('photo-stat').textContent='OSM 地图用于核对建筑位置和周边道路；查看真实屋顶请切回航拍。'}else if(entry&&requested?.metadata){$('photo-stat').textContent=`2023年真实航拍 · 参考 AHN ${requested.metadata.source_ahn_year} · 范围 ${entry.span_m.toFixed(1)} × ${entry.span_m.toFixed(1)} m。影像仅用于目视检查，具体飞行日未核对。`;}$('observation-osm').hidden=!map;square.hidden=map;$('photo-north').hidden=map;$('photo-loading').hidden=map||loaded===requested||!!error;$('photo-error').hidden=map||!error;for(const id of ['photo-plus','photo-minus','align-imagery','observation-outline'])$(id).disabled=map;if(map&&requested){const [lng,lat]=requested.coordinates_lnglat,side=Math.max(entry?.span_m||50,90),dy=side/111320,dx=dy/Math.cos(lat*Math.PI/180),params=new URLSearchParams({bbox:[lng-dx,lat-dy,lng+dx,lat+dy].join(','),layer:'mapnik',marker:lat+','+lng});$('observation-osm').src='https://www.openstreetmap.org/export/embed.html?'+params}else $('observation-osm').removeAttribute('src');layout()}
  async function show(building){
    const seq=++sequence;requested=building;loaded=null;entry=null;error=null;zoom=1;panX=0;panY=0;aligned=false;photo.removeAttribute('src');photo.hidden=true;$('observation-path').setAttribute('d','');$('observation-halo').setAttribute('d','');$('photo-error').hidden=true;$('photo-loading').hidden=false;$('photo-loading').textContent='正在加载本栋真实航拍…';$('full-imagery').removeAttribute('href');
    try{
      await metadata;if(seq!==sequence)return;entry=manifest.buildings.find(e=>e.id===building.id);if(!entry)throw Error('本栋没有已发布的航拍影像');
      const [xmin,ymin,xmax,ymax]=entry.bbox_RD,path=building.footprint.coordinates.map(ring=>ring.map((p,i)=>(i?'L':'M')+((p[0]-xmin)/(xmax-xmin)*1024).toFixed(4)+','+((ymax-p[1])/(ymax-ymin)*1024).toFixed(4)).join(' ')+' Z').join(' ');
      $('observation-path').setAttribute('d',path);$('observation-halo').setAttribute('d',path);$('observation-svg').toggleAttribute('hidden',!$('observation-outline').checked);
      const expected=new URL(entry.file,location.href).href;photo.alt=`${building.id} · ${building.city} · PDOK 2023真实航拍`;photo.dataset.building=building.id;
      photo.onload=()=>{if(seq!==sequence||photo.currentSrc!==expected)return;loaded=building;photo.hidden=false;$('photo-loading').hidden=true;error=null;$('photo-error').hidden=true;onResize()};
      photo.onerror=()=>{if(seq!==sequence)return;error='影像文件加载失败';photo.hidden=true;$('photo-loading').hidden=true;$('photo-error').hidden=false;onResize()};
      photo.src=expected;$('full-imagery').href=expected;
      $('photo-stat').textContent=`2023年真实航拍 · 参考 AHN ${building.metadata.source_ahn_year} · 范围 ${entry.span_m.toFixed(1)} × ${entry.span_m.toFixed(1)} m。影像仅用于目视检查，具体飞行日未核对。`;
      mode();layout();
    }catch(e){if(seq!==sequence)return;error=e.message;$('photo-loading').hidden=true;$('photo-error').hidden=false;onResize()}
  }
  $('observation-source').onchange=mode;$('observation-outline').onchange=()=>{$('observation-svg').toggleAttribute('hidden',!$('observation-outline').checked)};
  $('align-imagery').onclick=()=>{if(!entry)return;zoom=1;panX=0;panY=0;layout();onAlign(zoom)};
  for(const [id,factor] of [['photo-plus',1.4],['photo-minus',1/1.4]])$(id).onclick=()=>{if(!entry)return;zoom=Math.max(.5,Math.min(6,zoom*factor));panX=0;panY=0;layout();onAlign(zoom)};
  $('photo-retry').onclick=()=>{if(requested)show(requested)};
  new ResizeObserver(layout).observe(viewport);
  return {show,get current(){return entry},followAlignment(value,z,x,y){aligned=value;$('align-imagery').setAttribute('aria-pressed',String(value));$('align-imagery').classList.toggle('active',value);if(value){zoom=z;panX=x;panY=y;layout()}},get state(){return {building:requested?.id,loaded:loaded?.id||null,entry,zoom,panX,panY,aligned,error,source:$('observation-source').value}}};
}

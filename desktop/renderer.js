const alignment=document.createElement('link'); alignment.rel='stylesheet'; alignment.href='figma-alignment.css'; document.head.appendChild(alignment);
const chrome=document.createElement('div'); chrome.className='window-chrome'; chrome.innerHTML='<span>ZELUX-DL Pulse</span><div><button data-win="minimize">—</button><button data-win="maximize">□</button><button data-win="close">×</button></div>'; document.body.prepend(chrome); chrome.querySelectorAll('[data-win]').forEach(b=>b.onclick=()=>window.zelux?.window?.[b.dataset.win]?.());
const items=[];
const pendingUrls=[];
const queue=document.querySelector('#queue');
function draw(){queue.innerHTML=items.length?items.map((x,i)=>`<article class="row"><div class="file">⇩<small>URL</small></div><div class="info"><strong>${x[0]}</strong><span>${x[1]}</span></div><div class="track"><i style="width:${x[2]}%"></i></div><b class="pct">${x[2]}%</b><div class="speed"><b>${x[3]}</b><span>ETA ${x[4]}</span></div><span class="provider">${x[5]}</span><button class="pause">Ⅱ</button><button class="cancel">×</button></article>`).join(''):'<div class="empty">ยังไม่มีงานดาวน์โหลด วาง URL แล้วกด Enter เพื่อเริ่ม</div>';
 queue.querySelectorAll('.cancel').forEach(b=>b.onclick=()=>{b.closest('.row').remove();const n=queue.children.length;document.querySelector('#active').textContent=n;document.querySelector('#count').textContent=n+' active'});
 queue.querySelectorAll('.pause').forEach(b=>b.onclick=()=>b.classList.toggle('paused'));
}
draw();
document.querySelector('#add').onclick=()=>{const drop=document.querySelector('#drop');const i=document.querySelector('#url');drop.classList.add('input-open');i.focus()};
document.querySelector('#url').onkeydown=async e=>{if(e.key==='Enter'){const url=e.target.value.trim();if(!/^https?:\/\//i.test(url)) return;pendingUrls.push(url);items.push([url.split('/').pop()||url,url,0,'Starting…','—','Direct','']);draw();e.target.value='';e.target.parentElement.classList.remove('input-open');document.querySelector('#queued').textContent=pendingUrls.length;document.querySelector('#count').textContent=`${items.length} active`;try{await window.zelux?.startDownload?.([url]);}catch(err){document.querySelector('.ready').textContent='● Error';}}};
document.querySelector('#pauseAll').onclick=e=>{e.currentTarget.textContent=e.currentTarget.textContent.includes('Pause')?'▶ Resume all':'Ⅱ Pause all';queue.querySelectorAll('.pause').forEach(b=>b.classList.toggle('paused'))};
document.querySelector('#all').onclick=e=>{e.currentTarget.textContent='✓ Downloading';setTimeout(()=>e.currentTarget.textContent='⇩ Download all',1200)};
document.querySelector('#capture').onclick=e=>{e.currentTarget.textContent='✓ Link captured';setTimeout(()=>e.currentTarget.textContent='＋ Capture link',1200)};
document.querySelector('#contrast').onclick=()=>document.body.classList.toggle('contrast');
function formatBytes(value){if(!value)return '—';const units=['B','KB','MB','GB','TB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${n.toFixed(i?2:0)} ${units[i]}`;}
async function refreshSystemStats(){const s=await window.zelux?.systemStats?.();if(!s)return;const top=document.querySelectorAll('.top>div');if(top[1])top[1].querySelector('b').textContent=s.connections; if(top[3])top[3].querySelector('b').textContent=`${formatBytes(s.free)} free`;}
refreshSystemStats();setInterval(refreshSystemStats,3000);
window.zelux?.onDownloadFinished?.(()=>{document.querySelector('.ready').textContent='● Ready';});

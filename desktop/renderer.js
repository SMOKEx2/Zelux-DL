const alignment=document.createElement('link'); alignment.rel='stylesheet'; alignment.href='figma-alignment.css'; document.head.appendChild(alignment);
const chrome=document.createElement('div'); chrome.className='window-chrome'; chrome.innerHTML='<span>ZELUX-DL Pulse</span><div><button data-win="minimize">—</button><button data-win="maximize">□</button><button data-win="close">×</button></div>'; document.body.prepend(chrome); chrome.querySelectorAll('[data-win]').forEach(b=>b.onclick=()=>window.zelux?.window?.[b.dataset.win]?.());
const items=[['ZELUX_Trailer_4K_2160p.mp4','2.45 GB / 3.41 GB',72,'8.2 MB/s','00:14','Mega','red'],['Project_Assets_Pack.zip','1.12 GB / 2.80 GB',40,'5.4 MB/s','00:29','Google Drive','green'],['Linux_Ubuntu_24.04.iso','1.08 GB / 4.36 GB',25,'3.1 MB/s','01:47','Direct','cyan']];
const queue=document.querySelector('#queue');
function draw(){queue.innerHTML=items.map((x,i)=>`<article class="row"><div class="file">${i===0?'▶':i===1?'▤':'◉'}<small>${i===0?'MP4':i===1?'ZIP':'ISO'}</small></div><div class="info"><strong>${x[0]}</strong><span>${x[1]}</span></div><div class="track"><i style="width:${x[2]}%"></i></div><b class="pct">${x[2]}%</b><div class="speed"><b>${x[3]}</b><span>ETA ${x[4]}</span></div><span class="provider">${x[5]}</span><button class="pause">Ⅱ</button><button class="cancel">×</button></article>`).join('');
 queue.querySelectorAll('.cancel').forEach(b=>b.onclick=()=>{b.closest('.row').remove();const n=queue.children.length;document.querySelector('#active').textContent=n;document.querySelector('#count').textContent=n+' active'});
 queue.querySelectorAll('.pause').forEach(b=>b.onclick=()=>b.classList.toggle('paused'));
}
draw();
document.querySelector('#add').onclick=()=>{const i=document.querySelector('#url');i.style.opacity=1;i.focus()};
document.querySelector('#url').onkeydown=e=>{if(e.key==='Enter'){e.target.value='';document.querySelector('#queued').textContent='1'}};
document.querySelector('#pauseAll').onclick=e=>{e.currentTarget.textContent=e.currentTarget.textContent.includes('Pause')?'▶ Resume all':'Ⅱ Pause all';queue.querySelectorAll('.pause').forEach(b=>b.classList.toggle('paused'))};
document.querySelector('#all').onclick=e=>{e.currentTarget.textContent='✓ Downloading';setTimeout(()=>e.currentTarget.textContent='⇩ Download all',1200)};
document.querySelector('#capture').onclick=e=>{e.currentTarget.textContent='✓ Link captured';setTimeout(()=>e.currentTarget.textContent='＋ Capture link',1200)};
document.querySelector('#contrast').onclick=()=>document.body.classList.toggle('contrast');

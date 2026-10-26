'use strict';
const $ = id => document.getElementById(id);
const state = {data:null,axis:null,mode:'raw',selected:new Set(),pairs:[],labels:[],traces:[],start:0,span:10,playing:false,drag:null,loadId:0,rateConfirmed:false};
const fmt = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(n) : '—';
function clock(seconds) { const ms=Math.round(Math.max(0,seconds)*1000); return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`; }
function icons() { if(window.lucide) lucide.createIcons(); }
function notice(text='') { $('notice').textContent=text; $('notice').hidden=!text; }
function label(i) { return state.labels[i] || state.data.channels[i].key; }
function unitLabel() { if($('outputUnit').value==='uv')return 'µV';const unit=$('inputUnit').value==='auto'?state.data?.unit:$('inputUnit').value;return {counts:'counts',uv:'µV',mv:'mV',v:'V'}[unit] || 'CSV 원본 단위 (미지정)'; }
function option(value,text) {const el=document.createElement('option');el.value=value;el.textContent=text;return el;}
function setMode(mode) {
  state.mode=mode; $('rawTab').setAttribute('aria-selected',mode==='raw');$('bipolarTab').setAttribute('aria-selected',mode==='bipolar');
  $('montageSection').hidden=mode!=='bipolar';$('plotTitle').textContent=mode==='raw'?'Raw traces':'Bipolar traces · A − B';
  renderElectrodes();renderPairs();rebuild();
}
function renderElectrodes() {
  const container=$('electrodes');container.replaceChildren();if(!state.data)return;
  $('channelCount').textContent=state.data.channels.length;
  state.data.channels.forEach((ch,i)=>{
    const row=document.createElement('div');row.className='electrode';
    const check=document.createElement('input');check.type='checkbox';check.checked=state.selected.has(i);check.id=`ch-${i}`;check.disabled=state.mode!=='raw';check.setAttribute('aria-label',`${ch.key} 파형 표시`);
    check.addEventListener('change',()=>{if(check.checked && state.selected.size>=8){check.checked=false;notice('동시에 표시할 수 있는 Raw 채널은 최대 8개입니다.');return;}check.checked?state.selected.add(i):state.selected.delete(i);rebuild();});
    const name=document.createElement('label');name.htmlFor=check.id;name.textContent=ch.key;name.title=ch.key;
    const input=document.createElement('input');input.type='text';input.maxLength=24;input.placeholder='전극명';input.value=state.labels[i];input.setAttribute('aria-label',`${ch.key} 전극명`);
    input.addEventListener('input',()=>{state.labels[i]=input.value.trim();renderPairs();rebuild();});
    row.append(check,name,input);container.append(row);
  });
}
function renderPairs() {
  const container=$('pairs');container.replaceChildren();
  $('addPair').disabled=!state.data || state.data.channels.length<2 || state.pairs.length>=8;
  if(!state.data)return;
  state.pairs.forEach((pair,i)=>{
    const row=document.createElement('div');row.className='pair';const n=document.createElement('span');n.className='pair-number';n.textContent=String(i+1).padStart(2,'0');row.append(n);
    for(const key of ['a','b']) {
      if(key==='b'){const minus=document.createElement('span');minus.textContent='−';row.append(minus);}
      const select=document.createElement('select');select.setAttribute('aria-label',`Bipolar ${i+1} 전극 ${key.toUpperCase()}`);
      state.data.channels.forEach((ch,j)=>select.append(option(j,`${ch.key} ${state.labels[j] || ''}`.trim())));select.value=pair[key];select.title=`${label(pair[key])} (${state.data.channels[pair[key]].key})`;
      select.addEventListener('change',()=>{pair[key]=Number(select.value);rebuild();});row.append(select);
    }
    const remove=document.createElement('button');remove.title=`Bipolar ${i+1} 삭제`;remove.setAttribute('aria-label',remove.title);remove.innerHTML='<i data-lucide="x"></i>';
    remove.addEventListener('click',()=>{state.pairs.splice(i,1);renderPairs();rebuild();});row.append(remove);container.append(row);
  });icons();
}
function rebuild() {
  if(!state.data || !state.axis){draw();return;}
  const configs=state.mode==='raw' ? [...state.selected].map(a=>({a,b:null})) : state.pairs;
  const warnings=[];
  state.traces=configs.map(pair=>{
    const name=pair.b==null?label(pair.a):`${label(pair.a)} − ${label(pair.b)}`;
    try {const result=RawEEG.signal(state.data,pair.a,pair.b,{inputUnit:$('inputUnit').value,outputUnit:$('outputUnit').value});
      if(!result.valid)warnings.push(`${name}: 유효한 샘플이 없습니다.`);
      return {...result,name,pair};
    }catch(e){warnings.push(e.message);return {name,pair,error:e.message};}
  });
  if(state.data.invalid)warnings.push(`빈 값/비수치 ${state.data.invalid.toLocaleString()}개: 파형 단절로 표시`);
  if(state.axis.gaps)warnings.push(`시간 간격 불연속 ${state.axis.gaps.toLocaleString()}개`);
  if(Number($('timeColumn').value)<0 && !state.data.rateDeclared && !state.rateConfirmed)warnings.push('시간 메타데이터 없음: 250 Hz 임시값. CSV / 시간 설정에서 실제 Hz를 확인하고 적용하세요.');
  if(state.mode==='bipolar' && ($('inputUnit').value==='counts' || ($('inputUnit').value==='auto' && state.data.unit==='counts')) && state.pairs.some(p=>!Number.isFinite(state.data.channels[p.a].gain)||!Number.isFinite(state.data.channels[p.b].gain)))warnings.push('Bipolar: Gain 메타데이터 미확인. 두 입력의 Gain/단위가 같아야 합니다.');
  notice([...new Set(warnings)].join(' · '));
  $('viewCount').textContent=`${state.traces.length} / 8 traces`;$('export').disabled=!state.traces.length;
  $('unitLabel').textContent=unitLabel();$('baselineLabel').textContent=`표시 기준선: ${$('baseline').value==='center'?'채널 중앙':'0'} · 원본 값 유지`;
  draw();drawOverview();
}
function applyTime() {
  if(!state.data)return;
  try {const axis=RawEEG.timeAxis(state.data,{rate:Number($('rate').value),column:Number($('timeColumn').value),unit:$('timeUnit').value});state.axis=axis;
    const view=RawEEG.viewport(state.start,state.span,axis.duration);Object.assign(state,view);
    $('duration').textContent=clock(axis.duration);$('timeSource').textContent=axis.source;$('totalTime').textContent=clock(axis.duration);
    for(const id of ['seek','prev','next','play'])$(id).disabled=false;
    rebuild();
  }catch(e){stop();state.axis=null;state.traces=[];for(const id of ['seek','prev','next','play','export'])$(id).disabled=true;notice(e.message);draw();drawOverview();}
}
async function openFile(file) {
  if(!file)return;
  stop();const id=++state.loadId;$('status').textContent='CSV 읽는 중…';
  try {if(file.size>80*1024*1024)throw new Error('최대 파일 크기는 80 MB입니다.');
    const text=await file.text();await new Promise(r=>setTimeout(r,0));if(id!==state.loadId)return;
    const data=RawEEG.parse(text);state.data=data;state.axis=null;state.start=0;state.span=10;state.rateConfirmed=false;state.labels=data.channels.map(ch=>ch.label);
    state.selected=new Set(data.channels.slice(0,8).map((_,i)=>i));state.pairs=Array.from({length:Math.min(8,data.channels.length-1)},(_,i)=>({a:i,b:i+1}));
    $('filename').textContent=file.name;$('samples').textContent=`${data.count.toLocaleString()} / ${data.channels.length}`;
    $('rate').value=data.rate;$('timeUnit').value='auto';$('inputUnit').value='auto';$('outputUnit').value='original';
    $('timeColumn').replaceChildren(option(-1,'행 순서 / 샘플 번호'));data.headers.forEach((h,i)=>$('timeColumn').append(option(i,h)));$('timeColumn').value=data.timeIndex;
    $('empty').hidden=true;$('status').textContent=file.name.startsWith('DEMO_')?'합성 데모 · 실제 측정 데이터 아님':'CSV 로드 완료 · 서버 전송 없음';
    renderElectrodes();renderPairs();applyTime();
  }catch(e){if(id===state.loadId){notice(e.message);$('status').textContent=state.data?'불러오기 실패 · 이전 기록 유지':'불러오기 실패';}}
  $('file').value='';
}
function canvasSize(canvas) {const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;const w=Math.max(1,r.width),h=Math.max(1,r.height);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);return {c,w,h};}
function niceStep(span) {const v=span/8,p=10**Math.floor(Math.log10(v));return ([1,2,5,10].find(x=>x*p>=v)||10)*p;}
function ellipsis(c,text,max) {let out=text;while(out.length>1 && c.measureText(out).width>max)out=out.slice(0,-1);return out===text?out:out.slice(0,-1)+'…';}
function plotGeometry(w,h) {return {left:w<600?78:124,right:61,top:10,bottom:30,lane:(h-40)/Math.max(1,state.traces.length)};}
// Per-pixel min/max preserves extrema at zoomed-out scales; missing samples split the path.
function tracePath(c,values,times,from,to,x,y,gap,width) {
  c.beginPath();let active=false,lastBucket=-1,first=0,last=0,low=0,high=0,bx=0;
  function flush(){if(lastBucket<0)return;if(!active)c.moveTo(bx,first);else c.lineTo(bx,first);c.lineTo(bx,low);c.lineTo(bx,high);c.lineTo(bx,last);active=true;lastBucket=-1;}
  for(let i=from;i<to;i++){
    if(!Number.isFinite(values[i])){flush();active=false;continue;}
    if(i>from && times[i]-times[i-1]>gap){flush();active=false;}
    const px=x(times[i]),py=y(values[i]),bucket=Math.floor(px);
    if(bucket!==lastBucket){flush();lastBucket=bucket;bx=px;first=last=low=high=py;}else{last=py;low=Math.min(low,py);high=Math.max(high,py);}
  }flush();c.stroke();
}
function draw() {
  const {c,w,h}=canvasSize($('plot')),g=plotGeometry(w,h);c.fillStyle='#f1f8ef';c.fillRect(0,0,w,h);
  const pw=w-g.left-g.right,ph=h-g.top-g.bottom;
  c.fillStyle='#f8fbf7';c.fillRect(0,0,g.left-2,h);c.fillRect(w-g.right+2,0,g.right,h);
  const step=niceStep(state.span),x=t=>g.left+(t-state.start)/state.span*pw;
  c.font='10px "Segoe UI",sans-serif';c.textAlign='center';
  const first=Math.ceil(state.start/(step/5))*(step/5);
  for(let t=first;t<=state.start+state.span+1e-8;t+=step/5){const major=Math.abs(t/step-Math.round(t/step))<1e-5;c.strokeStyle=major?'#bed7ba':'#deebd9';c.lineWidth=major?1:.6;c.beginPath();c.moveTo(x(t),g.top);c.lineTo(x(t),h-g.bottom);c.stroke();if(major){c.fillStyle='#597052';c.fillText(`${fmt(t)} s`,x(t),h-10);}}
  if(state.axis){
    const times=state.axis.times,from=Math.max(0,RawEEG.lowerBound(times,state.start)-1),to=Math.min(times.length,RawEEG.lowerBound(times,state.start+state.span)+1);
    state.traces.forEach((tr,i)=>{
      const top=g.top+i*g.lane,cy=top+g.lane/2;
      c.textAlign='left';c.fillStyle='#263d2d';c.font='600 11px "Segoe UI",sans-serif';
      const names=tr.name.split(' − ');names.forEach((n,j)=>c.fillText(ellipsis(c,(j?'− ':'')+n,g.left-15),8,cy-9+j*14));
      c.font='9px "Segoe UI",sans-serif';c.fillStyle='#788672';
      if(tr.error){c.fillStyle='#a56a2b';c.fillText(ellipsis(c,tr.error,pw-10),g.left+7,cy);return;}
      const center=$('baseline').value==='zero'?0:tr.center;
      const scale=$('scale').value==='auto' ? ($('baseline').value==='zero'?Math.max(Math.abs(tr.min),Math.abs(tr.max))*2:tr.span)*1.35/4 : Number($('scale').value);
      const perDiv=Math.max(scale,1e-9),y=v=>cy-(v-center)/perDiv*(g.lane/5);
      c.fillText(ellipsis(c,`기준 ${fmt(center)}`,g.left-13),8,cy+(names.length>1?28:10));
      for(let d=-2;d<=2;d++){const yy=cy+d*g.lane/5;c.strokeStyle=d===0?'#bed4b7':'#e2ebde';c.lineWidth=d===0?.8:.5;c.beginPath();c.moveTo(g.left,yy);c.lineTo(w-g.right,yy);c.stroke();}
      c.save();c.beginPath();c.rect(g.left,top,pw,g.lane);c.clip();c.lineWidth=.9;c.strokeStyle=state.mode==='raw'?'#263e32':'#254d65';
      tracePath(c,tr.values,times,from,to,x,y,state.axis.median*2.5,pw);c.restore();
      c.fillStyle='#6c8066';c.textAlign='right';c.font='9px "Segoe UI",sans-serif';c.fillText(fmt(perDiv),w-5,cy-3);c.fillText('/ div',w-5,cy+9);
    });
    const v=RawEEG.viewport(state.start,state.span,state.axis.duration);state.start=v.start;state.span=v.span;
    $('interval').textContent=`${clock(state.start)} – ${clock(state.start+state.span)}`;
    $('window').value=Number(state.span.toFixed(4));$('start').value=Number(state.start.toFixed(4));$('start').max=Math.max(0,state.axis.duration-state.span);
    $('seek').max=Math.max(0,state.axis.duration-state.span);$('seek').value=state.start;
    $('selection').hidden=false;$('selection').style.left=`${100*state.start/state.axis.duration}%`;$('selection').style.width=`${100*state.span/state.axis.duration}%`;
    $('position').textContent=`${fmt(state.start)} / ${fmt(state.axis.duration)} s`;
  } else {$('selection').hidden=true;}
}
function drawOverview() {
  const {c,w,h}=canvasSize($('overview'));c.clearRect(0,0,w,h);if(!state.axis)return;
  const tr=state.traces.find(t=>!t.error);if(!tr)return;
  c.strokeStyle='#94b4a2';c.lineWidth=1;
  tracePath(c,tr.values,state.axis.times,0,state.axis.times.length,t=>t/state.axis.duration*w,v=>h/2-(v-tr.center)/Math.max(tr.span,1e-9)*h*.8,state.axis.median*2.5,w);
}
function move(start,span=state.span) {if(!state.axis)return;Object.assign(state,RawEEG.viewport(start,span,state.axis.duration));$('cursor').hidden=true;draw();}
function stop(){if(!state.playing)return;state.playing=false;$('play').innerHTML='<i data-lucide="play"></i>';icons();}
function play(){if(!state.axis)return;if(state.playing){stop();return;}if(state.start>=state.axis.duration-state.span)move(0);state.playing=true;$('play').innerHTML='<i data-lucide="pause"></i>';icons();let last=performance.now();function frame(now){if(!state.playing)return;move(state.start+(now-last)/1000);last=now;if(state.start>=state.axis.duration-state.span){stop();return;}requestAnimationFrame(frame);}requestAnimationFrame(frame);}
function demo() {
  const rows=['# unit=uv','# sample_rate_hz=250','t_us,ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8'];
  const names=['Fp1','F3','C3','P3','Fp2','F4','C4','P4'];
  names.forEach((name,i)=>rows.splice(2,0,`# ch${i+1}_electrode=${name}`));
  for(let i=0;i<250*90;i++) {
    const t=i/250;
    rows.push([i*4000,...names.map((_,ch)=>{
      const burst=Math.exp(-(((t-26-ch*.15)/.6)**2))*70;
      return (20*Math.sin(2*Math.PI*(8+ch*.45)*t+ch*.7)+8*Math.sin(2*Math.PI*1.2*t)+3*Math.cos(2*Math.PI*31*t+ch)+burst).toFixed(4);
    })].join(','));
  }
  openFile(new File([rows.join('\n')],'DEMO_synthetic_90s.csv',{type:'text/csv'}));
}
$('open').onclick=$('emptyOpen').onclick=()=>$('file').click();$('file').onchange=e=>openFile(e.target.files[0]);$('demo').onclick=demo;
$('rawTab').onclick=()=>setMode('raw');$('bipolarTab').onclick=()=>setMode('bipolar');
$('addPair').onclick=()=>{if(!state.data||state.pairs.length>=8||state.data.channels.length<2)return;state.pairs.push({a:0,b:1});renderPairs();rebuild();};
$('applyTime').onclick=()=>{state.rateConfirmed=true;applyTime();};
for(const id of ['outputUnit','scale','baseline','inputUnit'])$(id).onchange=rebuild;
$('window').onchange=()=>{const v=Number($('window').value);if(!(v>0)){notice('구간은 0보다 커야 합니다.');return;}stop();move(state.start,v);};
$('start').onchange=()=>{const v=Number($('start').value);if(!Number.isFinite(v))return;stop();move(v);};
$('seek').oninput=()=>{stop();move(Number($('seek').value));};$('prev').onclick=()=>{stop();move(state.start-state.span);};$('next').onclick=()=>{stop();move(state.start+state.span);};$('play').onclick=play;
$('timeline').addEventListener('pointerdown',e=>{if(!state.axis || e.button!==0)return;stop();const rect=$('timeline').getBoundingClientRect();const time=(e.clientX-rect.left)/rect.width*state.axis.duration;
  const mode=e.target.id==='leftHandle'?'left':e.target.id==='rightHandle'?'right':e.target.closest('#selection')?'pan':'jump';
  if(mode==='jump')move(time-state.span/2);
  state.drag={x:e.clientX,start:state.start,span:state.span,mode:mode==='jump'?'pan':mode,width:rect.width};$('timeline').setPointerCapture(e.pointerId);e.preventDefault();
});
$('timeline').addEventListener('pointermove',e=>{const d=state.drag;if(!d)return;const dt=(e.clientX-d.x)/d.width*state.axis.duration;
  if(d.mode==='pan')move(d.start+dt);else if(d.mode==='left'){const end=d.start+d.span,start=Math.max(0,Math.min(end-.05,d.start+dt));move(start,end-start);}else move(d.start,Math.max(.05,Math.min(state.axis.duration-d.start,d.span+dt)));
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('timeline').addEventListener(event,()=>{state.drag=null;});
$('plot').addEventListener('pointermove',e=>{if(!state.axis||!state.traces.length)return;const rect=$('plot').getBoundingClientRect(),g=plotGeometry(rect.width,rect.height),px=e.clientX-rect.left,py=e.clientY-rect.top;
  if(px<g.left||px>rect.width-g.right){$('cursor').hidden=true;return;}
  const t=state.start+(px-g.left)/(rect.width-g.left-g.right)*state.span;let index=RawEEG.lowerBound(state.axis.times,t);index=Math.min(index,state.data.count-1);if(index>0 && t-state.axis.times[index-1]<state.axis.times[index]-t)index--;
  const lane=Math.max(0,Math.min(state.traces.length-1,Math.floor((py-g.top)/g.lane))),tr=state.traces[lane];
  $('cursor').textContent=`${clock(state.axis.times[index])} · ${tr.name}\n${tr.error || fmt(tr.values[index])+' '+unitLabel()}`;$('cursor').hidden=false;
});$('plot').addEventListener('pointerleave',()=>{$('cursor').hidden=true;});
$('export').onclick=()=>{const source=$('plot'),out=document.createElement('canvas');out.width=source.width;out.height=source.height+92;const c=out.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,out.width,out.height);c.fillStyle='#243a2d';c.font='16px sans-serif';c.fillText(`raw EEG | ${state.mode} | ${$('filename').textContent}`,14,25);c.font='13px sans-serif';c.fillText(`${$('interval').textContent} | ${unitLabel()} | ${$('baselineLabel').textContent}`,14,51);c.drawImage(source,0,76);out.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`raw-EEG-${state.mode}-${state.start.toFixed(2)}s.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;document.body.classList.add('dragging');}});document.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('dragging');});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');openFile(e.dataTransfer.files[0]);});
new ResizeObserver(()=>{draw();drawOverview();}).observe($('plotWrap'));
icons();draw();drawOverview();

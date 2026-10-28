'use strict';
const $ = id => document.getElementById(id);
const state = {data:null,axis:null,mode:'raw',view:'raw',selected:new Set(),pairs:[],labels:[],traces:[],start:0,span:10,playing:false,drag:null,loadId:0,rateConfirmed:false,filterCache:new Map(),driftCache:new Map()};
const fmt = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(n) : '—';
function clock(seconds) { const ms=Math.round(Math.max(0,seconds)*1000); return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`; }
function icons() { if(window.lucide) lucide.createIcons(); }
function notice(text='') { $('notice').textContent=text; $('notice').hidden=!text; }
function label(i) { return state.labels[i] || state.data.channels[i].key; }
function unitLabel() { if($('outputUnit').value==='uv')return 'µV';const unit=$('inputUnit').value==='auto'?state.data?.unit:$('inputUnit').value;return {counts:'counts',uv:'µV',mv:'mV',v:'V'}[unit] || 'CSV 원본 단위 (미지정)'; }
function option(value,text) {const el=document.createElement('option');el.value=value;el.textContent=text;return el;}
function filterSettings() {
  return {hpOn:$('hpOn').checked,hp:Number($('hpHz').value),lpOn:$('lpOn').checked,lp:Number($('lpHz').value),
    notchOn:$('notchOn').checked,notch:$('notchHz').value==='both'?'both':Number($('notchHz').value),q:Number($('notchQ').value),
    order:$('filterOrder').value.split(','),lineMethod:$('lineMethod').value,harmonics:$('harmonics').checked,timing:$('filterTiming').value};
}
function filterDescription() {
  const s=filterSettings(),method=state.view==='compare'?'Notch / Multitaper':s.lineMethod==='notch'?`Notch (Q ${s.q})`:'Multitaper (PREP 참고)';
  const stages={hp:s.hpOn?`HPF ${s.hp} Hz`:'',lp:s.lpOn?`LPF ${s.lp} Hz`:'',line:s.notchOn?`${method} ${s.notch==='both'?'50+60':s.notch} Hz${s.harmonics?' + 고조파':''}`:''};
  return s.order.map(k=>stages[k]).filter(Boolean).join(' → ') || '필터 모두 OFF';
}
function updateViewStatus(error='') {
  $('rawView').setAttribute('aria-selected',state.view==='raw');$('filteredView').setAttribute('aria-selected',state.view==='filtered');
  $('driftView').setAttribute('aria-selected',state.view==='drift');
  $('driftControls').hidden=$('driftSection').hidden=state.view!=='drift';
  $('compareView').setAttribute('aria-selected',state.view==='compare');
  $('compareControls').hidden=$('spectrumSection').hidden=state.view!=='compare';
  $('plotTitle').textContent=`${state.view==='compare'?'Raw / Notch / Multitaper':state.view==='raw'?'Raw':state.view==='drift'?'Raw + 느린 추세':'Filtered'} ${state.mode==='bipolar'?'bipolar · A − B':'traces'}`;
  $('plot').setAttribute('aria-label',`${state.mode==='bipolar'?'Bipolar':'채널별'} EEG ${['raw','drift'].includes(state.view)?'원본':'필터 적용'} 파형`);
  $('filterStatus').textContent=state.view==='drift'?`드리프트 · 원본 + ${$('driftWindow').value} s 이동평균 추세 · 필터 미적용`:state.view==='raw'?'Raw · 필터 미적용':error?`적용 실패: ${error}`:`${state.view==='compare'?'비교':'Filtered'} · ${filterDescription()}`;
  $('filterStatus').classList.toggle('invalid',!!error && state.view!=='raw');
  $('filterRate').textContent=state.axis?`Fs ${fmt(state.axis.filterRate)} Hz`:'Fs —';
  $('timingStatus').textContent=state.axis?`${$('filterTiming').value==='samples'?`${fmt(state.axis.filterRate)} Hz 등간격 가정`:'시간 간격 검증'} · 보간 없음 · 시간좌표: CSV 원본`:'';
  $('hpHz').disabled=!$('hpOn').checked;$('lpHz').disabled=!$('lpOn').checked;
  $('notchOn').disabled=state.view==='compare';
  $('notchHz').disabled=$('harmonics').disabled=!$('notchOn').checked;
  $('lineMethod').disabled=!$('notchOn').checked || state.view==='compare';
  $('notchQ').disabled=!$('notchOn').checked || (state.view!=='compare' && $('lineMethod').value!=='notch');
}
function setView(view) {stop();state.view=view;if(view==='compare')$('notchOn').checked=true;$('cursor').hidden=true;rebuild();}
function setMode(mode) {
  state.mode=mode; $('rawTab').setAttribute('aria-selected',mode==='raw');$('bipolarTab').setAttribute('aria-selected',mode==='bipolar');
  $('montageSection').hidden=mode!=='bipolar';
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
  $('cursor').hidden=true;
  updateViewStatus();
  if(!state.data || !state.axis){draw();drawSpectrum();return;}
  const configs=state.mode==='raw' ? [...state.selected].map(a=>({a,b:null})) : state.pairs;
  const previous=$('compareChannel').value;
  $('compareChannel').replaceChildren(...configs.map((pair,i)=>option(i,pair.b==null?label(pair.a):`${label(pair.a)} − ${label(pair.b)}`)));
  if([...$('compareChannel').options].some(o=>o.value===previous))$('compareChannel').value=previous;
  $('compareChannel').disabled=!configs.length;
  const chosen=configs[Number($('compareChannel').value)];
  const jobs=state.view==='compare'?(chosen?['raw','notch','multitaper'].map(method=>({...chosen,method})):[]):configs;
  const warnings=[], settings=filterSettings();let filterError='';
  if(['filtered','compare'].includes(state.view) && settings.timing==='samples'){
    const report=EEGFilters.timing(state.axis);
    if(report.jitter || report.gaps)warnings.push(`샘플 순서 기반 필터: ${fmt(report.fs)} Hz 등간격 가정. 시간 간격 편차 ${report.jitter}개 / 1.5주기 초과 ${report.gaps}개. 원본 시간·샘플 유지, 보간 없음. 실제 누락 여부는 확인되지 않습니다.`);
  }
  const used=new Set(jobs.flatMap(p=>p.b==null?[p.a]:[p.a,p.b]));
  if(($('inputUnit').value==='auto'?state.data.unit:$('inputUnit').value)==='counts')for(const i of used){
    if(state.data.railLocked?.[i])warnings.push(`${state.data.channels[i].key}: ADC 한계값에 고정된 원본 · 필터로 복구되지 않음`);
  }
  const lineStats=[];
  state.traces=jobs.map(pair=>{
    const name=state.view==='compare'?{raw:'Raw',notch:'Notch',multitaper:'Multitaper'}[pair.method]:pair.b==null?label(pair.a):`${label(pair.a)} − ${label(pair.b)}`;
    try {let result=RawEEG.signal(state.data,pair.a,pair.b,{inputUnit:$('inputUnit').value,outputUnit:$('outputUnit').value});
      if(state.view==='filtered' || (state.view==='compare' && pair.method!=='raw')) {
        try {
          const active=state.view==='compare'?{...settings,lineMethod:pair.method}:settings;
          const key=JSON.stringify([pair.a,pair.b,$('inputUnit').value,$('outputUnit').value,active]);
          let filtered=state.filterCache.get(key);
          if(!filtered){filtered=EEGFilters.apply(result.values,state.axis,active);if(state.filterCache.size>=16)state.filterCache.clear();state.filterCache.set(key,filtered);}
          if(filtered.lineStats){lineStats.push(filtered.lineStats);if(filtered.lineStats.skipped)warnings.push(`${name}: Multitaper 창보다 짧은 연속 구간 ${filtered.lineStats.skipped.toLocaleString()}샘플은 전원 잡음 제거 미처리`);}
          result=RawEEG.summarize(filtered.values);
        } catch(e) {filterError=e.message;throw e;}
      }
      if(!result.valid)warnings.push(`${name}: 유효한 샘플이 없습니다.`);
      let trend;
      if(state.view==='drift'){
        const key=JSON.stringify([pair.a,pair.b,$('inputUnit').value,$('outputUnit').value,$('driftWindow').value]);
        trend=state.driftCache.get(key);
        if(!trend){trend=EEGDrift.trend(result.values,state.axis.times,Number($('driftWindow').value),state.axis.median*2.5);if(state.driftCache.size>=16)state.driftCache.clear();state.driftCache.set(key,trend);}
      }
      return {...result,name,pair,trend};
    }catch(e){warnings.push(e.message);return {name,pair,error:e.message};}
  });
  if(state.view==='compare' && settings.lpOn && settings.lp<=(settings.notch==='both'?50:settings.notch))warnings.push('LPF가 전원 주파수보다 낮아 두 방식의 차이가 작아질 수 있습니다.');
  const ls=lineStats[0];
  const summary=ls?`PREP 참고 구현 · 창 ${fmt(ls.windowSeconds)} s / BW ${fmt(ls.bandwidth)} Hz · 검출 ${lineStats.reduce((a,s)=>a+s.detected,0)}건 / ${lineStats.reduce((a,s)=>a+s.windows,0)}창 · 미처리 ${lineStats.reduce((a,s)=>a+s.skipped,0).toLocaleString()}샘플 (전체 기록)` : '';
  $('lineStats').textContent=summary;
  if(state.data.invalid)warnings.push(`빈 값/비수치 ${state.data.invalid.toLocaleString()}개: 파형 단절로 표시`);
  if(state.axis.gaps)warnings.push(`시간 간격 불연속 ${state.axis.gaps.toLocaleString()}개`);
  if((Number($('timeColumn').value)<0 || settings.timing==='samples') && !state.data.rateDeclared && !state.rateConfirmed)warnings.push('샘플링 주파수 메타데이터 없음: 250 Hz 임시값. CSV / 시간 설정에서 실제 Hz를 확인하고 적용하세요.');
  if(state.mode==='bipolar' && ($('inputUnit').value==='counts' || ($('inputUnit').value==='auto' && state.data.unit==='counts')) && state.pairs.some(p=>!Number.isFinite(state.data.channels[p.a].gain)||!Number.isFinite(state.data.channels[p.b].gain)))warnings.push('Bipolar: Gain 메타데이터 미확인. 두 입력의 Gain/단위가 같아야 합니다.');
  notice([...new Set(warnings)].join(' · '));
  updateViewStatus(filterError);
  if(state.view==='filtered' && summary)$('filterStatus').textContent+=` · ${summary}`;
  $('viewCount').textContent=state.view==='compare'?`${state.traces.length} methods`:`${state.traces.length} / 8 traces`;$('export').disabled=!state.traces.some(t=>!t.error);
  $('unitLabel').textContent=unitLabel();$('baselineLabel').textContent=`표시 기준선: ${$('baseline').selectedOptions[0].textContent} · ${['raw','drift'].includes(state.view)?'원본 값':state.view==='compare'?'원본 / 필터 비교':'필터 적용 값'}`;
  draw();drawOverview();drawSpectrum();
}
function applyTime() {
  if(!state.data)return;
  try {const axis=RawEEG.timeAxis(state.data,{rate:Number($('rate').value),column:Number($('timeColumn').value),unit:$('timeUnit').value});
    axis.filterRate=$('filterTiming').value==='samples' || state.data.rateDeclared || state.rateConfirmed || Number($('timeColumn').value)<0?Number($('rate').value):1/axis.median;
    state.filterCache.clear();state.driftCache.clear();state.axis=axis;
    const view=RawEEG.viewport(state.start,state.span,axis.duration);Object.assign(state,view);
    $('duration').textContent=clock(axis.duration);$('timeSource').textContent=axis.source;$('totalTime').textContent=clock(axis.duration);
    for(const id of ['seek','prev','next','play'])$(id).disabled=false;
    rebuild();
  }catch(e){stop();state.axis=null;state.traces=[];for(const id of ['seek','prev','next','play','export'])$(id).disabled=true;notice(e.message);draw();drawOverview();drawSpectrum();}
}
async function openFile(file) {
  if(!file)return;
  stop();const id=++state.loadId;$('status').textContent='CSV 읽는 중…';
  try {if(file.size>80*1024*1024)throw new Error('최대 파일 크기는 80 MB입니다.');
    const text=await file.text();await new Promise(r=>setTimeout(r,0));if(id!==state.loadId)return;
    const data=RawEEG.parse(text);data.railLocked=data.channels.map(ch=>ch.values.every(v=>v===8388607)||ch.values.every(v=>v===-8388608));state.data=data;state.axis=null;state.view='raw';state.filterCache.clear();state.driftCache.clear();state.start=0;state.span=10;state.rateConfirmed=false;state.labels=data.channels.map(ch=>ch.label);
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
    const visible=state.traces.map(tr=>tr.error?null:RawEEG.summarize(tr.values.subarray(RawEEG.lowerBound(times,state.start),RawEEG.lowerBound(times,state.start+state.span+1e-9))));
    const centers=state.traces.map((tr,i)=>$('baseline').value==='zero'?0:$('baseline').value==='window'?(visible[i]?.center || 0):tr.center);
    const amplitudes=state.traces.map((tr,i)=>{const stats=$('scale').value==='window'?visible[i]:tr;return !stats || !stats.valid?0:2*Math.max(Math.abs(stats.min-centers[i]),Math.abs(stats.max-centers[i]));});
    state.traces.forEach((tr,i)=>{
      const top=g.top+i*g.lane,cy=top+g.lane/2;
      c.textAlign='left';c.fillStyle='#263d2d';c.font='600 11px "Segoe UI",sans-serif';
      const names=tr.name.split(' − ');names.forEach((n,j)=>c.fillText(ellipsis(c,(j?'− ':'')+n,g.left-15),8,cy-9+j*14));
      c.font='9px "Segoe UI",sans-serif';c.fillStyle='#788672';
      if(tr.error){c.fillStyle='#a56a2b';c.fillText(ellipsis(c,tr.error,pw-10),g.left+7,cy);return;}
      const center=centers[i];
      const autoRange=state.view==='compare'?Math.max(...amplitudes):amplitudes[i];
      const scale=['auto','window'].includes($('scale').value) ? autoRange*1.35/4 : Number($('scale').value);
      const perDiv=Math.max(scale,1e-9),y=v=>cy-(v-center)/perDiv*(g.lane/5);
      c.fillText(ellipsis(c,`기준 ${fmt(center)}`,g.left-13),8,cy+(names.length>1?28:10));
      for(let d=-2;d<=2;d++){const yy=cy+d*g.lane/5;c.strokeStyle=d===0?'#bed4b7':'#e2ebde';c.lineWidth=d===0?.8:.5;c.beginPath();c.moveTo(g.left,yy);c.lineTo(w-g.right,yy);c.stroke();}
      c.save();c.beginPath();c.rect(g.left,top,pw,g.lane);c.clip();c.lineWidth=.9;c.strokeStyle=state.view==='compare'?['#263e32','#a25c27','#236caa'][i]:state.view==='filtered'?'#8b4f24':state.mode==='raw'?'#263e32':'#254d65';
      tracePath(c,tr.values,times,from,to,x,y,['filtered','compare'].includes(state.view)?1.5/state.axis.filterRate:state.axis.median*2.5,pw);
      if(tr.trend){c.strokeStyle='#be641b';c.lineWidth=2;tracePath(c,tr.trend,times,from,to,x,y,state.axis.median*2.5,pw);}
      c.restore();
      c.fillStyle='#6c8066';c.textAlign='right';c.font='9px "Segoe UI",sans-serif';c.fillText(fmt(perDiv),w-5,cy-3);c.fillText('/ div',w-5,cy+9);
    });
    const v=RawEEG.viewport(state.start,state.span,state.axis.duration);state.start=v.start;state.span=v.span;
    $('interval').textContent=`${clock(state.start)} – ${clock(state.start+state.span)}`;
    $('window').value=Number(state.span.toFixed(4));$('start').value=Number(state.start.toFixed(4));$('start').max=Math.max(0,state.axis.duration-state.span);
    $('seek').max=Math.max(0,state.axis.duration-state.span);$('seek').value=state.start;
    $('selection').hidden=false;$('selection').style.left=`${100*state.start/state.axis.duration}%`;$('selection').style.width=`${100*state.span/state.axis.duration}%`;
    $('position').textContent=`${fmt(state.start)} / ${fmt(state.axis.duration)} s`;
  } else {$('selection').hidden=true;}
  drawDriftMetrics();
}
function drawDriftMetrics(){
  if(state.view!=='drift')return;
  $('driftMetrics').replaceChildren();
  if(!state.axis)return;
  const times=state.axis.times,from=RawEEG.lowerBound(times,state.start),to=RawEEG.lowerBound(times,state.start+state.span+1e-9);
  $('driftMeta').textContent=`${clock(state.start)} – ${clock(state.start+state.span)} · ${unitLabel()} · 추세 ${$('driftWindow').value} s`;
  for(const tr of state.traces){
    const row=document.createElement('tr'),m=tr.error?null:EEGDrift.metrics(tr.values,tr.trend,times,from,to,state.axis.median*2.5);
    for(const value of [tr.name,m?fmt(m.peakToPeak):'—',m?fmt(m.drift):'—',m?fmt(m.step):'—']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
    $('driftMetrics').append(row);
  }
}
function drawOverview() {
  const {c,w,h}=canvasSize($('overview'));c.clearRect(0,0,w,h);if(!state.axis)return;
  const tr=state.traces.find(t=>!t.error);if(!tr)return;
  c.strokeStyle='#94b4a2';c.lineWidth=1;
  tracePath(c,tr.values,state.axis.times,0,state.axis.times.length,t=>t/state.axis.duration*w,v=>h/2-(v-tr.center)/Math.max(tr.span,1e-9)*h*.8,state.view==='filtered'?1.5/state.axis.filterRate:state.axis.median*2.5,w);
}
function drawSpectrum(){
  if(state.view!=='compare')return;
  const {c,w,h}=canvasSize($('spectrum'));c.clearRect(0,0,w,h);$('spectrumMeta').textContent='';
  if(!state.axis || state.traces.length!==3)return;
  const times=state.axis.times,fs=state.axis.filterRate,from=RawEEG.lowerBound(times,state.start),to=RawEEG.lowerBound(times,state.start+state.span);
  const curves=state.traces.map(t=>t.error?null:EEGSpectrum.welch(t.values,times,fs,from,to,$('filterTiming').value));
  const valid=curves.filter(Boolean);
  if(!valid.length){c.fillStyle='#66777a';c.font='12px sans-serif';c.fillText('유효한 연속 구간 부족',20,40);return;}
  const targets=filterSettings().notch;
  const low=(targets==='both'?50:targets)-5,high=Math.min(fs/2,(targets==='both'?60:targets)+5);
  if(high<=low)return;
  let min=Infinity,max=-Infinity;
  for(const spec of valid)for(let k=Math.ceil(low/spec.df);k<=Math.min(spec.power.length-1,Math.floor(high/spec.df));k++){
    const db=10*Math.log10(Math.max(spec.power[k],1e-20));min=Math.min(min,db);max=Math.max(max,db);
  }
  if(!Number.isFinite(min))return;max=Math.max(max,min+1);max+=3;min-=3;
  const l=58,r=12,t=28,b=32,pw=w-l-r,ph=h-t-b,x=f=>l+(f-low)/(high-low)*pw,y=v=>t+(max-v)/(max-min)*ph;
  c.font='10px sans-serif';c.lineWidth=1;
  for(let i=0;i<=4;i++){
    const value=min+(max-min)*i/4,yy=y(value);c.strokeStyle='#e2e8e6';c.beginPath();c.moveTo(l,yy);c.lineTo(w-r,yy);c.stroke();c.textAlign='right';c.fillStyle='#66777a';c.fillText(fmt(value),l-6,yy+3);
    const f=low+(high-low)*i/4;c.textAlign=i===0?'left':i===4?'right':'center';c.fillText(`${fmt(f)} Hz`,x(f),h-12);
  }
  c.textAlign='left';c.fillText(`dB re 1 (${unitLabel()})²/Hz`,l,14);
  curves.forEach((spec,j)=>{if(!spec)return;c.save();c.beginPath();c.rect(l,t,pw,ph);c.clip();c.beginPath();c.strokeStyle=['#263e32','#a25c27','#236caa'][j];c.lineWidth=1.4;
    let first=true;for(let k=Math.max(0,Math.floor(low/spec.df));k<=Math.min(spec.power.length-1,Math.ceil(high/spec.df));k++){const xx=x(k*spec.df),yy=y(10*Math.log10(Math.max(spec.power[k],1e-20)));if(first)c.moveTo(xx,yy);else c.lineTo(xx,yy);first=false;}c.stroke();c.restore();});
  const spec=valid[0];$('spectrumMeta').textContent=`Hann · ${spec.count}창 · Δf ${fmt(spec.df)} Hz${$('filterTiming').value==='samples'?' · 설정 Hz 가정':''}`;
}
function move(start,span=state.span) {if(!state.axis)return;Object.assign(state,RawEEG.viewport(start,span,state.axis.duration));$('cursor').hidden=true;draw();drawSpectrum();}
function stop(){if(!state.playing)return;state.playing=false;$('play').innerHTML='<i data-lucide="play"></i>';icons();}
function play(){if(!state.axis)return;if(state.playing){stop();return;}if(state.start>=state.axis.duration-state.span)move(0);state.playing=true;$('play').innerHTML='<i data-lucide="pause"></i>';icons();let last=performance.now();function frame(now){if(!state.playing)return;move(state.start+(now-last)/1000);last=now;if(state.start>=state.axis.duration-state.span){stop();return;}requestAnimationFrame(frame);}requestAnimationFrame(frame);}
function demo() {
  const rows=['# unit=uv','# sample_rate_hz=250','t_us,ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8'];
  const names=['Fp1','F3','C3','P3','Fp2','F4','C4','P4'];
  names.forEach((name,i)=>rows.splice(2,0,`# ch${i+1}_electrode=${name}`));
  for(let i=0;i<250*90;i++) {
    const t=i/250;
    rows.push([i*4000,...names.map((_,ch)=>{
      const drift=90*Math.sin(2*Math.PI*.035*t+ch*.3)+.7*t;
      const motion=t>=48 && t<51?80*Math.sin(2*Math.PI*3*(t-48))*(1+ch*.1):0;
      const burst=Math.exp(-(((t-26-ch*.15)/.6)**2))*70;
      return (20*Math.sin(2*Math.PI*(8+ch*.45)*t+ch*.7)+8*Math.sin(2*Math.PI*1.2*t)+3*Math.cos(2*Math.PI*31*t+ch)+12*Math.sin(2*Math.PI*60.2*t+ch*.3)+burst+drift+motion).toFixed(4);
    })].join(','));
  }
  openFile(new File([rows.join('\n')],'DEMO_synthetic_90s.csv',{type:'text/csv'}));
}
$('open').onclick=$('emptyOpen').onclick=()=>$('file').click();$('file').onchange=e=>openFile(e.target.files[0]);$('demo').onclick=demo;
$('rawTab').onclick=()=>setMode('raw');$('bipolarTab').onclick=()=>setMode('bipolar');
$('rawView').onclick=()=>setView('raw');$('filteredView').onclick=()=>setView('filtered');
$('driftView').onclick=()=>{setView('drift');if(state.axis)move(state.start,30);};
$('driftWindow').onchange=()=>{stop();rebuild();};
$('driftPreset').onclick=()=>{stop();$('baseline').value='center';$('scale').value='auto';if(state.axis)Object.assign(state,RawEEG.viewport(state.start,30,state.axis.duration));rebuild();};
$('fitWindow').onclick=()=>{stop();$('baseline').value='window';$('scale').value='window';rebuild();};
$('fullRecord').onclick=()=>{stop();if(state.axis)move(0,state.axis.duration);};
$('compareView').onclick=()=>setView('compare');$('compareChannel').onchange=rebuild;
$('filterTiming').onchange=()=>{stop();state.filterCache.clear();if(state.data)applyTime();else updateViewStatus();};
for(const id of ['hpOn','hpHz','lpOn','lpHz','notchOn','notchHz','notchQ','lineMethod','harmonics','filterOrder'])$(id).onchange=()=>{stop();state.filterCache.clear();rebuild();};
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
  $('cursor').textContent=`${clock(state.axis.times[index])} · ${tr.name}\n${tr.error || fmt(tr.values[index])+' '+unitLabel()+(tr.trend?' · 추세 '+fmt(tr.trend[index])+' '+unitLabel():'')}`;$('cursor').hidden=false;
});$('plot').addEventListener('pointerleave',()=>{$('cursor').hidden=true;});
$('export').onclick=()=>{
  const source=$('plot'),out=document.createElement('canvas');out.width=source.width;out.height=source.height+148;
  const c=out.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,out.width,out.height);c.fillStyle='#243a2d';c.font='16px sans-serif';
  c.fillText(`raw EEG | ${state.view.toUpperCase()} | ${state.mode} | ${$('filename').textContent}`,14,25,out.width-28);c.font='13px sans-serif';
  c.fillText(`${$('interval').textContent} | ${unitLabel()} | ${$('baselineLabel').textContent}`,14,51,out.width-28);
  c.fillText(`${$('filterStatus').textContent} | Fs ${fmt(state.axis.filterRate)} Hz`,14,77,out.width-28);c.drawImage(source,0,132);
  if(state.view==='compare')c.fillText(`${$('compareChannel').selectedOptions[0]?.textContent || ''} | Q ${$('notchQ').value} | ${$('lineStats').textContent}`,14,97,out.width-28);
  c.fillText(['raw','drift'].includes(state.view)?'Raw | 원본 시간·샘플 보존':$('timingStatus').textContent,14,119,out.width-28);
  out.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
    a.download=`raw-EEG-${state.mode}-${state.view}-${state.start.toFixed(2)}s.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
};
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;document.body.classList.add('dragging');}});document.addEventListener('dragleave',()=>{if(--dragDepth<=0)document.body.classList.remove('dragging');});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');openFile(e.dataTransfer.files[0]);});
new ResizeObserver(()=>{draw();drawOverview();drawSpectrum();}).observe($('plotWrap'));
icons();draw();drawOverview();

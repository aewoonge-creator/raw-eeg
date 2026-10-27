(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/fili.min.js'),require('./line-noise.js'));
  else root.EEGFilters = factory(root.Fili,root.EEGLineNoise);
})(globalThis, function (Fili, LineNoise) {
  'use strict';
  function order(settings) {
    const result=settings.order || ['hp','lp','line'];
    if(!Array.isArray(result) || result.length!==3 || new Set(result).size!==3 || result.some(x=>!['hp','lp','line'].includes(x)))throw new Error('필터 순서에 HPF, LPF, 전원 잡음이 각각 한 번 필요합니다.');
    return result;
  }
  function frequencies(fs,settings) {
    if(![50,60,'both'].includes(settings.notch))throw new Error('전원 주파수는 50 Hz 또는 60 Hz를 선택하세요.');
    const result=[];
    for(const hz of settings.notch==='both'?[50,60]:[settings.notch]){
      if(hz>=fs/2)throw new Error(`전원 주파수는 Nyquist ${fs/2} Hz보다 작아야 합니다.`);
      for(let f=hz;f<fs/2;f+=hz){result.push(f);if(!settings.harmonics)break;}
    }
    return [...new Set(result)].sort((a,b)=>a-b);
  }
  function design(fs, settings) {
    if (!(Number.isFinite(fs) && fs > 0)) throw new Error('필터 샘플링 주파수를 확인하세요.');
    order(settings);
    const stages = {hp:[],lp:[],line:[]}, c = new Fili.IirCoeffs();
    function frequency(name, value) {
      if (!(Number.isFinite(value) && value > 0 && value < fs / 2)) {
        throw new Error(`${name}: 0 Hz보다 크고 Nyquist ${Number((fs/2).toFixed(3))} Hz보다 작아야 합니다.`);
      }
    }
    if (settings.hpOn) frequency('HPF', settings.hp);
    if (settings.lpOn) frequency('LPF', settings.lp);
    if (settings.hpOn && settings.lpOn && settings.hp >= settings.lp) throw new Error('HPF 주파수는 LPF보다 작아야 합니다.');
    if (settings.hpOn) stages.hp.push(c.highpass({Fs:fs,Fc:settings.hp,Q:Math.SQRT1_2}));
    if (settings.lpOn) stages.lp.push(c.lowpass({Fs:fs,Fc:settings.lp,Q:Math.SQRT1_2}));
    if (settings.notchOn) {
      if(!['notch','multitaper'].includes(settings.lineMethod || 'notch'))throw new Error('전원 잡음 제거 방식을 확인하세요.');
      const targets=frequencies(fs,settings);
      if(settings.lineMethod==='multitaper')LineNoise.plan(fs);
      else {
        if (!(Number.isFinite(settings.q) && settings.q >= 1 && settings.q <= 100)) throw new Error('Notch Q는 1~100 범위여야 합니다.');
        for (const hz of targets)stages.line.push(c.bandstop({Fs:fs,Fc:hz,Q:settings.q}));
      }
    }
    return order(settings).flatMap(stage=>stages[stage]);
  }
  function apply(values, axis, settings) {
    const fs = axis.filterRate || 1 / axis.median, coeffs = design(fs,settings);
    if (!coeffs.length && !(settings.notchOn && settings.lineMethod==='multitaper')) return {values:Float64Array.from(values),fs,resets:0,jitter:0};
    if (axis.times.length !== values.length) throw new Error('시간축과 신호 길이가 다릅니다.');
    const period = 1 / fs;
    let jitter = 0, checked = 0, gaps = 0;
    for (let i=1;i<axis.times.length;i++) {
      const dt = axis.times[i]-axis.times[i-1];
      if (!(dt>0)) throw new Error('필터 시간축이 증가하지 않습니다.');
      if (dt > 1.5 * period) { gaps++; continue; }
      checked++;
      if (Math.abs(dt/period-1) > .2) jitter++;
    }
    if (jitter > Math.max(2,checked*.01) || gaps > Math.max(2,(axis.times.length-1)*.1)) throw new Error('시간 간격과 필터 Hz가 맞지 않습니다. CSV / 시간 설정을 확인하세요. 불규칙 신호는 재보간하지 않습니다.');
    const ranges=[];let start=-1;
    for(let i=0;i<=values.length;i++){
      const valid=i<values.length && Number.isFinite(values[i]);
      if(start>=0 && (!valid || (i>0 && axis.times[i]-axis.times[i-1]>1.5*period))){ranges.push([start,i]);start=-1;}
      if(valid && start<0)start=i;
    }
    let output=Float64Array.from(values),lineStats=null;
    for(const stage of order(settings)){
      if(stage==='line' && settings.notchOn && settings.lineMethod==='multitaper'){
        const result=LineNoise.clean(output,fs,ranges,frequencies(fs,settings));output=result.values;lineStats=result.stats;continue;
      }
      const s={...settings,hpOn:stage==='hp' && settings.hpOn,lpOn:stage==='lp' && settings.lpOn,notchOn:stage==='line' && settings.notchOn};
      const coefficients=design(fs,s);if(!coefficients.length)continue;
      const filter=new Fili.IirFilter(coefficients),next=Float64Array.from(output);
      for(const [from,to] of ranges){
        filter.reinit();const offset=output[from];
        for(let i=from;i<to;i++){
          const value=filter.singleStep(output[i]-offset)+(s.hpOn?0:offset);
          if(!Number.isFinite(value))throw new Error('필터 계산이 불안정합니다. 차단 주파수를 확인하세요.');
          next[i]=value;
        }
      }
      output=next;
    }
    return {values:output,fs,resets:ranges.length,jitter,lineStats};
  }
  return {design,apply,order,frequencies};
});

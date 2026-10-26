(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/fili.min.js'));
  else root.EEGFilters = factory(root.Fili);
})(globalThis, function (Fili) {
  'use strict';
  function design(fs, settings) {
    if (!(Number.isFinite(fs) && fs > 0)) throw new Error('필터 샘플링 주파수를 확인하세요.');
    const stages = [], c = new Fili.IirCoeffs();
    function frequency(name, value) {
      if (!(Number.isFinite(value) && value > 0 && value < fs / 2)) {
        throw new Error(`${name}: 0 Hz보다 크고 Nyquist ${Number((fs/2).toFixed(3))} Hz보다 작아야 합니다.`);
      }
    }
    if (settings.hpOn) frequency('HPF', settings.hp);
    if (settings.lpOn) frequency('LPF', settings.lp);
    if (settings.hpOn && settings.lpOn && settings.hp >= settings.lp) throw new Error('HPF 주파수는 LPF보다 작아야 합니다.');
    if (settings.hpOn) stages.push(c.highpass({Fs:fs,Fc:settings.hp,Q:Math.SQRT1_2}));
    if (settings.lpOn) stages.push(c.lowpass({Fs:fs,Fc:settings.lp,Q:Math.SQRT1_2}));
    if (settings.notchOn) {
      if (![50,60,'both'].includes(settings.notch)) throw new Error('Notch는 50 Hz 또는 60 Hz를 선택하세요.');
      if (!(Number.isFinite(settings.q) && settings.q >= 1 && settings.q <= 100)) throw new Error('Notch Q는 1~100 범위여야 합니다.');
      for (const hz of settings.notch === 'both' ? [50,60] : [settings.notch]) {
        frequency('Notch',hz); stages.push(c.bandstop({Fs:fs,Fc:hz,Q:settings.q}));
      }
    }
    return stages;
  }
  function apply(values, axis, settings) {
    const fs = axis.filterRate || 1 / axis.median, coeffs = design(fs,settings);
    if (!coeffs.length) return {values:Float64Array.from(values),fs,resets:0,jitter:0};
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
    const filter = new Fili.IirFilter(coeffs), output = new Float64Array(values.length);
    let fresh = true, offset = 0, resets = 0;
    for (let i=0;i<values.length;i++) {
      if (!Number.isFinite(values[i])) { output[i]=NaN; fresh=true; continue; }
      if (i>0 && axis.times[i]-axis.times[i-1]>1.5*period) fresh=true;
      if (fresh) { filter.reinit(); offset=values[i]; fresh=false; resets++; }
      // Constant prehistory initializes each continuous segment without a DC startup spike.
      const value=filter.singleStep(values[i]-offset)+(settings.hpOn?0:offset);
      if (!Number.isFinite(value)) throw new Error('필터 계산이 불안정합니다. 차단 주파수를 확인하세요.');
      output[i]=value;
    }
    return {values:output,fs,resets,jitter};
  }
  return {design,apply};
});

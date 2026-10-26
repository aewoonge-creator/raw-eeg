(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/papaparse.min.js'));
  else root.RawEEG = factory(root.Papa);
})(globalThis, function (Papa) {
  'use strict';
  const number = value => String(value ?? '').trim() === '' ? NaN : Number(value);
  const gains = [1, 2, 4, 6, 8, 12, 24];
  function metadata(text) {
    const result = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*#\s*([\w]+)(?:\s*=\s*|\s+)(.*)$/.exec(line);
      if (match) result[match[1].toLowerCase()] = match[2].trim();
    }
    return result;
  }
  function parse(text) {
    const meta = metadata(text.replace(/^\uFEFF/, ''));
    const clean = text.replace(/^\uFEFF/, '').replace(/^sep=([^\r\n]+)\r?\n/i, '');
    const parsed = Papa.parse(clean, {comments:'#', skipEmptyLines:'greedy'});
    const errors = parsed.errors.filter(e => e.code !== 'UndetectableDelimiter');
    if (errors.length) throw new Error(`CSV 형식 오류: ${errors[0].message}`);
    const [head, ...rows] = parsed.data;
    if (!head || rows.length < 2) throw new Error('헤더와 두 행 이상의 데이터가 필요합니다.');
    const headers = head.map(h => h.trim());
    if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV 열 이름이 비어 있거나 중복됩니다.');
    if (rows.some(row => row.length !== headers.length)) throw new Error('CSV 행의 열 개수가 다릅니다. 잘린 행이나 구분자를 확인하세요.');
    const columns = headers.map((_, j) => Float64Array.from(rows, row => number(row[j])));
    const timeIndex = headers.findIndex(h => /^(t_us|t_ms|t_s|time(?:_?\(?[ums]+\)?)?|timestamp(?:_[ums]+)?|seconds?)$/i.test(h));
    const sampleIndex = headers.findIndex(h => /^(sample(?:_?index)?|index|sample_number)$/i.test(h));
    const preferred = headers.map((h,i) => /^(ch\s*\d+|eeg[_ -].+)$/i.test(h) ? i : -1).filter(i => i >= 0);
    const candidates = preferred.length ? preferred : headers.map((_,i) => i).filter(i => i !== timeIndex && i !== sampleIndex && !/^(status|marker|event|sequence|packet|battery|aux\d*)$/i.test(headers[i]));
    const channels = candidates.filter(i => columns[i].some(Number.isFinite)).map(i => {
      const n = /^ch\s*(\d+)$/i.exec(headers[i])?.[1];
      const regText = meta[`channel_${n}_chnset_readback`] ?? new RegExp(`\\bCH${n}SET=(0x[0-9a-f]+)`, 'i').exec(meta.channel_registers || meta.registers || '')?.[1];
      const reg = number(regText);
      const fromReg = Number.isInteger(reg) && reg >= 0 && reg <= 255 ? gains[(reg >> 4) & 7] : NaN;
      const declared = number(meta[`channel_${n}_gain`] ?? new RegExp(`(?:^|\\s)ch${n}:([\\d.]+)`, 'i').exec(meta.ads_channel_gains || '')?.[1] ?? meta.ads_gain);
      const gain = gains.includes(fromReg) ? fromReg : gains.includes(declared) ? declared : NaN;
      return {key:headers[i], values:columns[i], gain, label:meta[`ch${n}_electrode`] || meta[`channel_${n}_electrode`] || ''};
    });
    if (!channels.length) throw new Error('숫자로 된 EEG 채널을 찾을 수 없습니다.');
    const rate = number(meta.configured_adc_sps ?? meta.ads_config_rate_sps ?? meta.sample_rate_hz ?? meta.sampling_rate ?? meta.requested_sps);
    const declaredUnit = String(meta.csv_unit || meta.unit || meta.units || '').toLowerCase();
    const unit = /counts|signed_24bit|adc_counts/.test(`${meta.csv_data || ''} ${declaredUnit}`) ? 'counts'
      : /^(uv|µv|μv|microvolts)$/.test(declaredUnit) ? 'uv' : declaredUnit === 'mv' ? 'mv' : declaredUnit === 'v' ? 'v' : 'unknown';
    return {meta, headers, channels, columns, count:rows.length, timeIndex, sampleIndex, rate:Number.isFinite(rate) && rate > 0 ? rate : 250,
      rateDeclared:Number.isFinite(rate) && rate > 0, unit, vref:number(meta.adc_vref_volts ?? meta.ads_vref_volts),
      invalid:channels.reduce((n,ch) => n + ch.values.reduce((s,v) => s + !Number.isFinite(v),0),0)};
  }
  function timeAxis(data, {rate=data.rate, column=data.timeIndex, unit='auto'} = {}) {
    if (!(rate > 0 && Number.isFinite(rate))) throw new Error('샘플링 주파수는 0보다 커야 합니다.');
    let source, raw, scale;
    if (column >= 0) {
      raw = data.columns[column];
      const name = data.headers[column].toLowerCase();
      const actualUnit = unit === 'auto' ? /us|µs/.test(name) ? 'us' : /ms/.test(name) ? 'ms' : 's' : unit;
      scale = {s:1, ms:1e-3, us:1e-6}[actualUnit];
      source = `${data.headers[column]} (${actualUnit})`;
    } else if (data.sampleIndex >= 0) {
      raw = data.columns[data.sampleIndex]; scale = 1 / rate; source = `${data.headers[data.sampleIndex]} / ${rate} Hz`;
    } else {
      raw = Float64Array.from({length:data.count}, (_,i) => i); scale = 1 / rate; source = `행 순서 / ${rate} Hz`;
    }
    if (!scale) throw new Error('시간 단위를 확인하세요.');
    const times = Float64Array.from(raw, v => (v - raw[0]) * scale);
    for (let i=0; i<times.length; i++) {
      if (!Number.isFinite(times[i]) || (i > 0 && times[i] <= times[i-1])) throw new Error(`시간 값이 비어 있거나 증가하지 않습니다 (${i+2}번째 데이터 위치). 시간 열/단위를 확인하세요.`);
    }
    const intervals = Array.from({length:Math.min(times.length-1,10000)}, (_,i) => times[i+1]-times[i]).sort((a,b)=>a-b);
    const median = intervals[Math.floor(intervals.length/2)];
    let gaps=0; for(let i=1;i<times.length;i++) if(times[i]-times[i-1] > median*2.5) gaps++;
    return {times,duration:times[times.length-1],median,source,gaps};
  }
  function factor(data, ch, inputUnit, outputUnit) {
    const unit = inputUnit === 'auto' ? data.unit : inputUnit;
    if (outputUnit === 'original') return 1;
    if (unit === 'uv') return 1;
    if (unit === 'mv') return 1000;
    if (unit === 'v') return 1e6;
    if (unit === 'counts' && data.vref > 0 && gains.includes(ch.gain)) return data.vref*1e6/(8388608*ch.gain);
    throw new Error(`${ch.key}: µV 환산에 필요한 단위 또는 Gain/VREF 메타데이터가 없습니다.`);
  }
  function signal(data, a, b, {inputUnit='auto',outputUnit='original'}={}) {
    const ca=data.channels[a], cb=b == null ? null : data.channels[b];
    if (!ca || (b != null && !cb)) throw new Error('전극을 선택하세요.');
    if (a === b) throw new Error('서로 다른 전극 두 개를 선택하세요.');
    const unit=inputUnit==='auto' ? data.unit : inputUnit;
    if (cb && outputUnit==='original' && unit==='counts' && Number.isFinite(ca.gain) && Number.isFinite(cb.gain) && ca.gain!==cb.gain) throw new Error('두 채널의 Gain이 다릅니다. 표시 단위를 µV로 바꾸세요.');
    const fa=factor(data,ca,inputUnit,outputUnit), fb=cb ? factor(data,cb,inputUnit,outputUnit) : 0;
    const values=Float64Array.from(ca.values,(v,i) => cb ? v*fa-cb.values[i]*fb : v*fa);
    let min=Infinity,max=-Infinity,valid=0;
    for(const v of values) if(Number.isFinite(v)) { min=Math.min(min,v); max=Math.max(max,v); valid++; }
    return {values,min,max,valid,center:valid ? (min+max)/2 : 0,span:valid ? Math.max(max-min,1e-9) : 1};
  }
  function lowerBound(times,t) { let lo=0,hi=times.length; while(lo<hi) {const m=(lo+hi)>>>1; if(times[m]<t)lo=m+1;else hi=m;}return lo; }
  function viewport(start,span,duration) { span=Math.min(Math.max(span,Math.min(.05,duration)),duration); return {start:Math.max(0,Math.min(start,duration-span)),span}; }
  return {parse,timeAxis,signal,factor,lowerBound,viewport};
});

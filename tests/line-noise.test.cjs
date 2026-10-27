const test=require('node:test');
const assert=require('node:assert/strict');
const Filters=require('../filters.js');
const Spectrum=require('../spectrum.js');
const tapers=require('../vendor/dpss.js');
const fs=250,n=5000;
const axis=(length=n)=>({times:Float64Array.from({length},(_,i)=>i/fs),filterRate:fs});
const settings={hpOn:false,lpOn:false,notchOn:true,notch:60,q:30,lineMethod:'multitaper'};
const tone=(hz,i)=>Math.sin(2*Math.PI*hz*i/fs);
function rms(values){return Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length);}

test('SciPy DPSS tables are orthonormal with seven tapers per length',()=>{
  for(const [size,windows] of Object.entries(tapers)){
    assert.equal(windows.length,7);
    for(let i=0;i<7;i++)for(let j=0;j<=i;j++){
      assert.equal(windows[i].length,Number(size));
      const dot=windows[i].reduce((s,v,k)=>s+v*windows[j][k],0);
      assert.ok(Math.abs(dot-(i===j?1:0))<1e-10,`${size}: ${i}, ${j}: ${dot}`);
    }
  }
});
test('multitaper detects off-grid mains while preserving alpha, offset and linear drift',()=>{
  const clean=Float64Array.from({length:n},(_,i)=>50000+i*.3+10*tone(10,i));
  const input=Float64Array.from(clean,(v,i)=>v+20*tone(60.2,i)),copy=input.slice();
  const result=Filters.apply(input,axis(),settings);
  assert.ok(result.lineStats.detected>=result.lineStats.windows);
  assert.ok(result.lineStats.frequencies.every(f=>Math.abs(f-60.2)<.001));
  assert.ok(rms(result.values.map((v,i)=>v-clean[i]))<.02);
  assert.deepEqual(input,copy);
});
test('50 and 60 Hz, both centers and harmonics use the same target list as notch',()=>{
  for(const opts of [{notch:50},{notch:60},{notch:'both'},{notch:50,harmonics:true},{notch:60,harmonics:true}]){
    const s={...settings,...opts},freqs=Filters.frequencies(fs,s),clean=Float64Array.from({length:n},(_,i)=>tone(10,i));
    const input=Float64Array.from(clean,(v,i)=>v+freqs.reduce((sum,f)=>sum+20*tone(f+.1,i),0));
    const result=Filters.apply(input,axis(),s);
    assert.ok(rms(result.values.map((v,i)=>v-clean[i]))<.05,JSON.stringify(opts));
  }
});
test('no mains: unchanged constant, alpha retained, nearby 63 Hz retained',()=>{
  const constant=new Float64Array(n).fill(80000);
  assert.deepEqual(Filters.apply(constant,axis(),settings).values,constant);
  const input=Float64Array.from({length:n},(_,i)=>10*tone(10,i)+7*tone(63,i));
  const result=Filters.apply(input,axis(),settings);
  assert.equal(result.lineStats.detected,0);assert.deepEqual(result.values,input);
});
test('deterministic broadband-noise fixture is not broadly removed by the line model',()=>{
  let seed=7;
  const input=Float64Array.from({length:20000},()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296-.5;});
  const result=Filters.apply(input,axis(input.length),settings);
  const removed=input.reduce((s,v,i)=>s+(v-result.values[i])**2,0),total=input.reduce((s,v)=>s+v*v,0);
  assert.ok(removed/total<.005);
});
test('short segments, NaN and timestamp gaps are never padded or joined',()=>{
  const input=Float64Array.from({length:1800},(_,i)=>tone(60,i));input[600]=NaN;
  const a=axis(1800);for(let i=1200;i<1800;i++)a.times[i]+=1;
  const result=Filters.apply(input,a,settings);
  assert.equal(result.lineStats.windows,0);assert.equal(result.lineStats.skipped,1799);assert.deepEqual(result.values,input);
});
test('each filter permutation equals explicit stage-by-stage processing',()=>{
  const input=Float64Array.from({length:n},(_,i)=>10*tone(10,i)+20*tone(60.2,i)+i*.01);
  const permutations=[['hp','lp','line'],['hp','line','lp'],['lp','hp','line'],['lp','line','hp'],['line','hp','lp'],['line','lp','hp']];
  for(const method of ['notch','multitaper'])for(const order of permutations){
    const s={...settings,hpOn:true,hp:.5,lpOn:true,lp:80,lineMethod:method,order};
    const result=Filters.apply(input,axis(),s).values;let sequential=input;
    for(const stage of order)sequential=Filters.apply(sequential,axis(),{...s,hpOn:stage==='hp',lpOn:stage==='lp',notchOn:stage==='line'}).values;
    assert.deepEqual(result,sequential);
  }
  assert.throws(()=>Filters.apply(input,axis(),{...settings,order:['hp','hp','lp']}),/순서/);
});
test('multitaper does not silently remove content above Nyquist or use invalid Q',()=>{
  assert.throws(()=>Filters.apply(new Float64Array(n),{...axis(),filterRate:100},settings),/Nyquist/);
  assert.doesNotThrow(()=>Filters.apply(new Float64Array(n),axis(),{...settings,q:NaN}));
});
test('Welch one-sided density integrates to sine variance and rejects gaps',()=>{
  const input=Float64Array.from({length:2048},(_,i)=>3*Math.sin(2*Math.PI*32*i/256));
  const times=Float64Array.from(input,(_,i)=>i/256);
  const spec=Spectrum.welch(input,times,256,0,input.length);
  assert.ok(Math.abs(spec.power.reduce((a,b)=>a+b,0)*spec.df-4.5)<1e-8);
  const bad=new Float64Array(2048).fill(NaN);
  assert.equal(Spectrum.welch(bad,times,256,0,bad.length),null);
});
test('sample-order comparison PSD uses the same nominal sampling model without filling NaN',()=>{
  const values=Float64Array.from({length:2048},(_,i)=>tone(60,i)),a=axis(values.length),b=axis(values.length);
  for(let i=1;i<b.times.length;i++)b.times[i]+=(i%2?.002:0)+(i>=1000?2:0);
  assert.deepEqual(Spectrum.welch(values,a.times,fs,0,values.length,'samples'),Spectrum.welch(values,b.times,fs,0,values.length,'samples'));
  values.fill(NaN,0,1024);
  const result=Spectrum.welch(values,b.times,fs,0,values.length,'samples');assert.equal(result.count,7);
});

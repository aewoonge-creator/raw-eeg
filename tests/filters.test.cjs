const test=require('node:test');
const assert=require('node:assert/strict');
const Filters=require('../filters.js');
const fs=250;
const defaults={hpOn:false,hp:.5,lpOn:false,lp:45,notchOn:false,notch:60,q:30};
function axis(n){return {times:Float64Array.from({length:n},(_,i)=>i/fs),median:1/fs,filterRate:fs};}
function tone(hz,n=10000){return Float64Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*hz*i/fs));}
function amplitude(values,hz){let sin=0,cos=0;const from=Math.floor(values.length/2);for(let i=from;i<values.length;i++){sin+=values[i]*Math.sin(2*Math.PI*hz*i/fs);cos+=values[i]*Math.cos(2*Math.PI*hz*i/fs);}return 2*Math.hypot(sin,cos)/(values.length-from);}
function run(values,settings){return Filters.apply(values,axis(values.length),{...defaults,...settings}).values;}
test('HPF suppresses slow drift and preserves 10 Hz passband',()=>{
  assert.ok(amplitude(run(tone(.1),{hpOn:true}),.1)<.05);
  assert.ok(amplitude(run(tone(10),{hpOn:true}),10)>.99);
});
test('LPF suppresses 90 Hz and has Butterworth -3 dB at cutoff',()=>{
  assert.ok(amplitude(run(tone(90),{lpOn:true,lp:30}),90)<.05);
  const cutoff=amplitude(run(tone(30),{lpOn:true,lp:30}),30);
  assert.ok(Math.abs(cutoff-Math.SQRT1_2)<.001,cutoff);
  assert.ok(amplitude(run(tone(10),{lpOn:true,lp:30}),10)>.99);
});
test('50/60 Hz notch and combined notch reject only their selected centers',()=>{
  for(const hz of [50,60]){
    assert.ok(amplitude(run(tone(hz),{notchOn:true,notch:hz}),hz)<.001);
    assert.ok(amplitude(run(tone(10),{notchOn:true,notch:hz}),10)>.99);
  }
  const mixed=Float64Array.from(tone(50),(v,i)=>v+Math.sin(2*Math.PI*60*i/fs));
  const out=run(mixed,{notchOn:true,notch:'both'});
  assert.ok(amplitude(out,50)<.001);assert.ok(amplitude(out,60)<.001);
});
test('all OFF returns an independent exact copy, never mutating raw samples',()=>{
  const values=Float64Array.of(100,-8388608,NaN,8388607),before=values.slice();
  const out=run(values,{});assert.notEqual(out,values);assert.deepEqual(out,before);
  run(values,{hpOn:true,lpOn:true,notchOn:true});assert.deepEqual(values,before);
});
test('constant prehistory avoids DC startup spikes',()=>{
  const values=new Float64Array(500).fill(123456);
  assert.ok(run(values,{hpOn:true}).every(v=>v===0));
  assert.ok(run(values,{lpOn:true,notchOn:true}).every(v=>v===123456));
});
test('NaN and time gaps reset filter state without synthesizing samples',()=>{
  const part=tone(10,100),values=Float64Array.from([...part,NaN,...part]);
  const output=run(values,{hpOn:true,lpOn:true});assert.ok(Number.isNaN(output[100]));
  assert.deepEqual(output.slice(0,100),output.slice(101));
  const joined=Float64Array.from([...part,...part]),a=axis(200);for(let i=100;i<200;i++)a.times[i]+=1;
  const result=Filters.apply(joined,a,{...defaults,lpOn:true});
  assert.deepEqual(result.values.slice(0,100),result.values.slice(100));assert.equal(result.resets,2);
});
test('cutoffs, Nyquist, Q and ordering are validated',()=>{
  for(const options of [{hpOn:true,hp:0},{lpOn:true,lp:125},{notchOn:true,q:0},{hpOn:true,hp:45,lpOn:true,lp:30}])assert.throws(()=>run(tone(10),options));
  assert.throws(()=>Filters.design(100,{...defaults,notchOn:true,notch:50}),/Nyquist/);
  assert.throws(()=>Filters.design(NaN,defaults),/주파수/);
});
test('grossly irregular or misconfigured timing cannot silently become filtered data',()=>{
  const a=axis(100);for(let i=1;i<100;i+=2)a.times[i]+=.002;
  assert.throws(()=>Filters.apply(tone(10,100),a,{...defaults,lpOn:true}),/시간 간격/);
  const b=axis(100);b.filterRate=1000;
  assert.throws(()=>Filters.apply(tone(10,100),b,{...defaults,lpOn:true}),/시간 간격/);
});

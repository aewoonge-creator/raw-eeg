const test=require('node:test');
const assert=require('node:assert/strict');
const {trend,metrics}=require('../drift.js');
test('centered trend matches a direct time-window mean on irregular samples',()=>{
  const t=Float64Array.from([0,.1,.3,.7,.8,1.1,1.4,1.5]);
  const v=Float64Array.from([1e6,1e6+5,1e6-3,1e6+20,1e6-8,1e6+2,1e6+4,1e6+9]),original=v.slice();
  const actual=trend(v,t,.6,1);
  for(let i=0;i<t.length;i++){
    const window=[...v].filter((_,j)=>t[j]>=t[i]-.3 && t[j]<=t[i]+.3);
    assert.ok(Math.abs(actual[i]-window.reduce((a,b)=>a+b,0)/window.length)<1e-8);
  }
  assert.deepEqual(v,original);
});
test('missing samples and time gaps split both trend and adjacent-step metrics',()=>{
  const v=Float64Array.from([1,1,NaN,100,100,1000,1000]);
  const t=Float64Array.from([0,1,2,3,4,20,21]),b=trend(v,t,20,2.5);
  assert.deepEqual([...b],[1,1,NaN,100,100,1000,1000]);
  assert.equal(metrics(v,b,t,0,v.length,2.5).step,0);
  assert.deepEqual(metrics(v,b,t,3,5,2.5),{valid:2,peakToPeak:0,drift:0,step:0});
  assert.ok(Number.isNaN(metrics(v,b,t,2,3,2.5).peakToPeak));
});
test('slow drift survives while a 10 Hz oscillation is attenuated in the trend',()=>{
  const t=Float64Array.from({length:10000},(_,i)=>i/250);
  const v=t.map(x=>100*Math.sin(2*Math.PI*.05*x)+20*Math.sin(2*Math.PI*10*x));
  const b=trend(v,t,1,.01);
  let error=0;for(let i=250;i<t.length-250;i++)error=Math.max(error,Math.abs(b[i]-100*Math.sin(2*Math.PI*.05*t[i])));
  assert.ok(error<1,error);
  assert.ok(metrics(v,b,t,0,t.length,.01).drift>198);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const csv = '\uFEFF# csv_data=raw_signed_24bit_adc_counts\n# adc_vref_volts=4.5\n# channel_1_chnset_readback=0x60\n# channel_2_chnset_readback=0x30\n# ch1_electrode=Fp1\nt_us,ch1,ch2\n1000000,100,50\n1004000,200,80\n1008000,-8388608,8388607\n';
test('ADS1299 metadata, raw values and actual relative timestamps survive parsing',()=>{
  const data=Core.parse(csv),axis=Core.timeAxis(data);
  assert.equal(data.unit,'counts');assert.equal(data.channels[0].label,'Fp1');
  assert.equal(data.channels[0].gain,24);assert.equal(data.channels[1].gain,6);
  assert.deepEqual([...data.channels[0].values],[100,200,-8388608]);
  assert.deepEqual([...axis.times],[0,.004,.008]);
});
test('bipolar is A minus B, never absolute difference or filtered values',()=>{
  const data=Core.parse('# unit=uv\ntime,ch1,ch2\n0,5,8\n1,-2,9\n2,10,1');
  const result=Core.signal(data,0,1);
  assert.deepEqual([...result.values],[-3,-11,9]);
  assert.deepEqual([...data.channels[0].values],[5,-2,10]);
});
test('different ADC gains require physical-unit conversion before bipolar subtraction',()=>{
  const data=Core.parse(csv);
  assert.throws(()=>Core.signal(data,0,1),/Gain/);
  const tr=Core.signal(data,0,1,{outputUnit:'uv'});
  assert.equal(tr.values[0],100*4.5e6/(8388608*24)-50*4.5e6/(8388608*6));
});
test('unknown unit metadata cannot silently be called microvolts',()=>{
  const data=Core.parse('ch1,ch2\n1,2\n3,4');
  assert.throws(()=>Core.signal(data,0,1,{outputUnit:'uv'}),/메타데이터/);
  assert.deepEqual([...Core.signal(data,0,1,{inputUnit:'mv',outputUnit:'uv'}).values],[-1000,-1000]);
});
test('quoted comma headers, blank values and NaN stay distinguishable',()=>{
  const data=Core.parse('time,"Fp1, left",F3\n0,,2\n1,NaN,3\n2,5,8');
  assert.equal(data.channels[0].key,'Fp1, left');assert.equal(data.invalid,2);
  assert.ok(Number.isNaN(Core.signal(data,0,1).values[0]));
});
test('semicolon and tab delimiters are detected',()=>{
  for(const sep of [';','\t']) {const d=Core.parse(['t_ms,ch1,ch2','0,1,2','4,3,4'].join('\n').replaceAll(',',sep));assert.equal(Core.timeAxis(d).duration,.004);}
});
test('duplicate headers, truncated rows and invalid time order are rejected',()=>{
  assert.throws(()=>Core.parse('ch1,ch1\n1,2\n2,3'),/중복/);
  assert.throws(()=>Core.parse('ch1,ch2\n1,2\n3'),/열 개수/);
  const data=Core.parse('t_us,ch1\n10,2\n10,3');assert.throws(()=>Core.timeAxis(data),/증가/);
  assert.deepEqual([...Core.timeAxis(data,{column:-1,rate:100}).times],[0,.01]);
});
test('sample numbers and timestamp gaps are retained, not filled or interpolated',()=>{
  const d=Core.parse('sample,ch1\n100,2\n101,4\n105,6');
  assert.deepEqual([...Core.timeAxis(d,{rate:250}).times],[0,.004,.02]);
  const timed=Core.parse('t_ms,ch1\n0,2\n4,4\n8,5\n28,6');assert.equal(Core.timeAxis(timed).gaps,1);
});
test('same-electrode bipolar is rejected and view bounds clamp at both ends',()=>{
  const d=Core.parse('ch1,ch2\n1,2\n3,4');assert.throws(()=>Core.signal(d,0,0),/서로 다른/);
  assert.deepEqual(Core.viewport(-4,10,90),{start:0,span:10});
  assert.deepEqual(Core.viewport(89,10,90),{start:80,span:10});
  assert.deepEqual(Core.viewport(0,10,.004),{start:0,span:.004});
});
test('raw extrema survive and no source values change across repeated derivations',()=>{
  const d=Core.parse('# unit=uv\nt_s,ch1,ch2\n0,100,0\n1,-200,0\n2,5000,0');
  assert.equal(Core.signal(d,0,1).max,5000);
  Core.signal(d,0,null);Core.signal(d,1,0);
  assert.deepEqual([...d.channels[0].values],[100,-200,5000]);
});

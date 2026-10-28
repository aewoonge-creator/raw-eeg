(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory();
  else root.EEGDrift=factory();
})(globalThis,function(){
  'use strict';
  // Centered, sample-weighted mean in a CSV-time window; never bridge missing data.
  function trend(values,times,seconds,gap){
    if(!(seconds>0) || !Number.isFinite(seconds))throw new Error('추세 창은 0보다 커야 합니다.');
    const out=new Float64Array(values.length).fill(NaN),half=seconds/2;
    let start=0;
    while(start<values.length){
      if(!Number.isFinite(values[start])){start++;continue;}
      let end=start+1;
      while(end<values.length && Number.isFinite(values[end]) && times[end]-times[end-1]<=gap)end++;
      let left=start,right=start,sum=0;
      // Subtract a segment reference to retain precision with large DC offsets.
      const reference=values[start];
      for(let i=start;i<end;i++){
        while(right<end && times[right]<=times[i]+half){sum+=values[right]-reference;right++;}
        while(left<right && times[left]<times[i]-half){sum-=values[left]-reference;left++;}
        out[i]=reference+sum/(right-left);
      }
      start=end;
    }
    return out;
  }
  function metrics(values,baseline,times,from,to,gap){
    let min=Infinity,max=-Infinity,low=Infinity,high=-Infinity,step=0,valid=0,pairs=0;
    for(let i=from;i<to;i++){
      const v=values[i];if(!Number.isFinite(v))continue;
      valid++;min=Math.min(min,v);max=Math.max(max,v);
      if(Number.isFinite(baseline[i])){low=Math.min(low,baseline[i]);high=Math.max(high,baseline[i]);}
      if(i>from && Number.isFinite(values[i-1]) && times[i]-times[i-1]<=gap){step=Math.max(step,Math.abs(v-values[i-1]));pairs++;}
    }
    return {valid,peakToPeak:valid?max-min:NaN,drift:high>=low?high-low:NaN,step:pairs?step:NaN};
  }
  return {trend,metrics};
});

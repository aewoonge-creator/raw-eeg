(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./vendor/fili.min.js'));
  else root.EEGSpectrum=factory(root.Fili);
})(globalThis,function(Fili){
  'use strict';
  function welch(values,times,fs,from,to){
    const n=2**Math.floor(Math.log2(Math.min(fs*2,to-from)));
    if(n<16)return null;
    const fft=new Fili.Fft(n),power=new Float64Array(n/2+1),window=Float64Array.from({length:n},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/n));
    const norm=fs*window.reduce((s,v)=>s+v*v,0);let count=0;
    for(let start=from;start+n<=to;start+=n/2){
      let mean=0,valid=true;
      for(let i=0;i<n;i++){if(!Number.isFinite(values[start+i]) || (i && times[start+i]-times[start+i-1]>1.5/fs)){valid=false;break;}mean+=values[start+i];}
      if(!valid)continue;mean/=n;
      const data=Float64Array.from({length:n},(_,i)=>(values[start+i]-mean)*window[i]),s=fft.forward(data,'none');
      for(let k=0;k<power.length;k++)power[k]+=(s.re[k]**2+s.im[k]**2)/norm*(k===0||k===n/2?1:2);
      count++;
    }
    if(!count)return null;
    for(let k=0;k<power.length;k++)power[k]/=count;
    return {power,df:fs/n,count,n};
  }
  return {welch};
});

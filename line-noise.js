(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./vendor/fili.min.js'),require('./vendor/dpss.js'));
  else root.EEGLineNoise=factory(root.Fili,root.EEGTapers);
})(globalThis,function(Fili,table){
  'use strict';
  const plans=new Map();
  function plan(fs) {
    const n=Object.keys(table).map(Number).reduce((a,b)=>Math.abs(b-4*fs)<Math.abs(a-4*fs)?b:a);
    if(n/fs<2 || n/fs>8)throw new Error('Multitaper: 이 Fs에서 2~8초 분석 창을 구성할 수 없습니다.');
    if(!plans.has(n)){
      const tapers=table[n],u=tapers.map(t=>t.reduce((a,b)=>a+b,0)),u2=u.reduce((a,b)=>a+b*b,0);
      const size=2**Math.ceil(Math.log2(n))*4;
      plans.set(n,{n,tapers,u,u2,size,fft:new Fili.Fft(size)});
    }
    return plans.get(n);
  }
  function fit(re,im,p) {
    let ar=0,ai=0;
    for(let k=0;k<7;k++){ar+=p.u[k]*re[k];ai+=p.u[k]*im[k];}
    ar/=p.u2;ai/=p.u2;
    let residual=0;
    for(let k=0;k<7;k++)residual+=(re[k]-p.u[k]*ar)**2+(im[k]-p.u[k]*ai)**2;
    const power=p.u2*(ar*ar+ai*ai);
    return {ar,ai,f:power>0?6*power/Math.max(residual,Number.MIN_VALUE):0};
  }
  function exact(data,hz,fs,p) {
    const re=new Float64Array(7),im=new Float64Array(7),w=2*Math.PI*hz/fs,c=Math.cos(w),s=Math.sin(w);
    let cr=1,si=0;
    for(let i=0;i<p.n;i++){
      for(let k=0;k<7;k++){const v=data[i]*p.tapers[k][i];re[k]+=v*cr;im[k]-=v*si;}
      const next=cr*c-si*s;si=si*c+cr*s;cr=next;
    }
    return {...fit(re,im,p),hz};
  }
  function detrend(values,start,n) {
    let mean=0,slope=0;const mid=(n-1)/2;
    // Work relative to the first sample to retain precision for large ADC offsets.
    const offset=values[start];
    for(let i=0;i<n;i++){const v=values[start+i]-offset;mean+=v;slope+=(i-mid)*v;}
    mean/=n;slope/=n*(n*n-1)/12;
    return Float64Array.from({length:n},(_,i)=>(values[start+i]-offset)-mean-slope*(i-mid));
  }
  function clean(values,fs,ranges,frequencies) {
    const p=plan(fs),output=Float64Array.from(values),step=Math.max(1,Math.round(p.n/4));
    const stats={windows:0,detected:0,skipped:0,windowSeconds:p.n/fs,bandwidth:8*fs/p.n,frequencies:[]};
    for(const [start,end] of ranges){
      if(end-start<p.n){stats.skipped+=end-start;continue;}
      const noise=new Float64Array(end-start),weights=new Float64Array(end-start),starts=[];
      for(let i=start;i+p.n<=end;i+=step)starts.push(i);
      if(starts[starts.length-1]!==end-p.n)starts.push(end-p.n);
      for(const at of starts){
        stats.windows++;
        const data=detrend(values,at,p.n),spectra=[];
        for(let k=0;k<7;k++){
          const buf=new Float64Array(p.size);
          for(let i=0;i<p.n;i++)buf[i]=data[i]*p.tapers[k][i];
          const spec=p.fft.forward(buf,'none');
          spectra.push({re:Float64Array.from(spec.re),im:Float64Array.from(spec.im)});
        }
        const fitted=new Float64Array(p.n);
        for(const target of frequencies){
          const lo=Math.max(fs/p.n,target-2),hi=Math.min(fs/2-fs/p.n,target+2);
          let best={f:0,hz:target};
          for(let bin=Math.ceil(lo*p.size/fs);bin<=Math.floor(hi*p.size/fs);bin++){
            const fitAt=fit(spectra.map(s=>s.re[bin]),spectra.map(s=>s.im[bin]),p);
            if(fitAt.f>best.f)best={...fitAt,hz:bin*fs/p.size};
          }
          // Refine the FFT-grid maximum using the same multitaper regression at exact frequencies.
          let left=Math.max(lo,best.hz-fs/p.size),right=Math.min(hi,best.hz+fs/p.size);
          const ratio=(Math.sqrt(5)-1)/2;
          let a=exact(data,right-ratio*(right-left),fs,p),b=exact(data,left+ratio*(right-left),fs,p);
          for(let iteration=0;iteration<14;iteration++){
            if(a.f>b.f){right=b.hz;b=a;a=exact(data,right-ratio*(right-left),fs,p);}
            else {left=a.hz;a=b;b=exact(data,left+ratio*(right-left),fs,p);}
          }
          best=a.f>b.f?a:b;
          // F(2, 2K-2) survival has a closed form. Correct for searched independent frequencies.
          const alpha=.01/Math.max(1,Math.ceil((hi-lo)*p.n/fs));
          const threshold=6*(alpha**(-1/6)-1);
          if(best.f<=threshold)continue;
          stats.detected++;stats.frequencies.push(best.hz);
          const w=2*Math.PI*best.hz/fs,c=Math.cos(w),s=Math.sin(w);let cr=1,si=0;
          for(let i=0;i<p.n;i++){
            fitted[i]+=2*(best.ar*cr-best.ai*si);
            const next=cr*c-si*s;si=si*c+cr*s;cr=next;
          }
        }
        for(let i=0;i<p.n;i++){
          const weight=.5-.5*Math.cos(2*Math.PI*(i+.5)/p.n),index=at-start+i;
          noise[index]+=weight*fitted[i];weights[index]+=weight;
        }
      }
      for(let i=0;i<noise.length;i++)output[start+i]-=noise[i]/weights[i];
    }
    return {values:output,stats};
  }
  return {clean,plan};
});

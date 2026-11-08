export function encodeWav(chunks,sampleRate){
  const count=chunks.reduce((n,c)=>n+c.length,0),pcm=new Float32Array(count);let at=0;
  for(const chunk of chunks){pcm.set(chunk,at);at+=chunk.length;}
  const frames=Math.floor(count*16000/sampleRate),buffer=new ArrayBuffer(44+frames*2),view=new DataView(buffer);
  const word=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  word(0,'RIFF');view.setUint32(4,36+frames*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,frames*2,true);
  for(let i=0;i<frames;i++){const start=Math.floor(i*sampleRate/16000),end=Math.min(count,Math.max(start+1,Math.floor((i+1)*sampleRate/16000)));let sum=0;for(let j=start;j<end;j++)sum+=pcm[j];const value=Math.max(-1,Math.min(1,sum/(end-start)));view.setInt16(44+i*2,value<0?value*32768:value*32767,true);}
  return new Blob([buffer],{type:'audio/wav'});
}
export async function captureVoice(onLimit,{autoStop=true}={}){
  const context=new AudioContext();await context.resume();let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
    await context.audioWorklet.addModule('/voice-recorder.js');
    const source=context.createMediaStreamSource(stream),recorder=new AudioWorkletNode(context,'medika-recorder'),silent=context.createGain();silent.gain.value=0;source.connect(recorder);recorder.connect(silent);silent.connect(context.destination);
    const chunks=[];let finish,stopped=false,spokenMs=0,lastSpeech=0,ending=false;const finalChunk=new Promise(resolve=>finish=resolve),started=performance.now();
    recorder.port.onmessage=event=>{
      if(event.data.samples){
        const samples=event.data.samples;chunks.push(samples);let power=0;for(const sample of samples)power+=sample*sample;
        if(Math.sqrt(power/samples.length)>.012){spokenMs+=samples.length/context.sampleRate*1000;lastSpeech=performance.now();}
      }
      if(event.data.done)finish();
    };
    const pause=setInterval(()=>{if(autoStop&&!stopped&&!ending&&((spokenMs>=250&&performance.now()-lastSpeech>=1800)||(!lastSpeech&&performance.now()-started>=10000))){ending=true;onLimit();}},100);
    const limit=setTimeout(onLimit,45000);
    const close=()=>{clearTimeout(limit);clearInterval(pause);stream.getTracks().forEach(track=>track.stop());if(context.state!=='closed')context.close().catch(()=>{});};
    return {cancel(){stopped=true;close();},async stop(){if(stopped)throw Error('Запись уже остановлена');stopped=true;clearTimeout(limit);try{recorder.port.postMessage('stop');await Promise.race([finalChunk,new Promise(resolve=>setTimeout(resolve,1000))]);return encodeWav(chunks,context.sampleRate);}finally{close();}}};
  }catch(error){stream?.getTracks().forEach(track=>track.stop());await context.close();throw error;}
}

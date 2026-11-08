class VoiceRecorder extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(4096);this.used=0;this.done=false;this.port.onmessage=()=>{if(this.used)this.port.postMessage({samples:this.buffer.slice(0,this.used)});this.used=0;this.done=true;this.port.postMessage({done:true});};}
  process(inputs){
    if(this.done)return false;
    const samples=inputs[0]?.[0];if(!samples)return true;
    for(let i=0;i<samples.length;i++){this.buffer[this.used++]=samples[i];if(this.used===this.buffer.length){this.port.postMessage({samples:this.buffer.slice()});this.used=0;}}
    return true;
  }
}
registerProcessor('medika-recorder',VoiceRecorder);

// Pending audio stays on this device until transcription; facts still use the existing idempotent API.
export const MAX_VOICE_JOBS=10;
export async function createVoiceQueue({api,onChange=()=>{},onSaved=()=>{}}){
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('medika-voice-queue',1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'sequence',autoIncrement:true});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Закройте другую вкладку Медики и повторите.'));});
  let running=false,closed=false;
  // shortcut: without Web Locks, use one tab; same-tab reload still preserves and pauses interrupted work.
  const tabId=sessionStorage.getItem('medika-voice-tab')||('voice-tab-'+Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(16)).join(''));sessionStorage.setItem('medika-voice-tab',tabId);
  if(!navigator.locks)await transaction('readwrite',(store)=>{store.getAll().onsuccess=e=>{for(const job of e.target.result)if(job.state==='processing'&&job.owner===tabId)store.put({...job,state:'interrupted',error:'Обработка прервана. Продолжите её явно.'});};});
  function transaction(mode,operation){return new Promise((resolve,reject)=>{const tx=db.transaction('jobs',mode);let value;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Не удалось сохранить голосовую запись'));operation(tx.objectStore('jobs'),v=>value=v,tx);});}
  const list=()=>transaction('readonly',(store,done)=>{store.getAll().onsuccess=e=>done(e.target.result);});
  async function change(sequence,apply){return transaction('readwrite',(store,done)=>{store.get(sequence).onsuccess=e=>{const job=e.target.result;if(!job)return;const next=apply(job);if(next===null)store.delete(sequence);else store.put(next);done(next);};});}
  const emit=async()=>{const jobs=await list();onChange(jobs);return jobs;};
  async function process(){
    // A Web Lock spans both recognition and recording, including across same-origin tabs.
    for(const job of await list())if(job.state==='processing'&&navigator.locks)await change(job.sequence,j=>({...j,state:'interrupted',error:'Обработка прервана. Продолжите её явно.'}));
    await emit();
    while(!closed){
      const jobs=await list();if(jobs.some(j=>['failed','interrupted'].includes(j.state)))break;
      const job=jobs.find(j=>['queued','complete'].includes(j.state));if(!job)break;
      if(job.state!=='complete'){
        await change(job.sequence,j=>({...j,state:'processing',owner:tabId,error:''}));await emit();
        try{
          if(!job.text){const bytes=new Uint8Array(await job.audio.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const transcript=await api('/transcribe',{audio:btoa(binary),language:job.language});job.text=transcript.text;if(!job.text?.trim())throw Error('Речь не разобрана. Повторите запись.');await change(job.sequence,j=>({...j,text:job.text,audio:null}));}
          job.result=await api('/record-entry',{text:job.text,timeZone:job.timeZone,recordedAt:job.recordedAt,clientKey:job.id});
          if(!job.result.record&&!job.result.draft)throw Error('Не получен результат разбора');
          await change(job.sequence,j=>({...j,audio:null,state:job.result.record?'complete':'review',result:job.result}));
        }catch(error){await change(job.sequence,j=>({...j,audio:null,state:'failed',error:error.uncertain?'Ответ не получен. Проверьте историю или повторите сохранение с тем же ключом.':error.message}));await emit();break;}
      }
      if(job.result?.record){try{await onSaved(job.result.record);}catch{/* The fact already exists; refreshing the view must not resend it. */}await change(job.sequence,()=>null);}
      await emit();
    }
  }
  async function run(){if(running||closed)return;running=true;try{if(navigator.locks)await navigator.locks.request('medika-voice-queue',{mode:'exclusive',ifAvailable:true},lock=>lock?process():undefined);else if(!(await list()).some(j=>j.state==='processing'))await process();}finally{running=false;}}
  const notify=async()=>{await emit();run().catch(error=>onChange(null,error));};
  return {
    async add(file,{recordedAt,language,timeZone,id}){if(!file?.size||file.size>8*1024*1024)throw Error('Голосовая запись пуста или больше 8 МБ');if(!['ru','en'].includes(language)||!Number.isFinite(Date.parse(recordedAt)))throw Error('Неизвестны язык или время записи');let full=false;
      await transaction('readwrite',(store)=>{store.count().onsuccess=e=>{if(e.target.result>=MAX_VOICE_JOBS){full=true;return;}store.add({id,recordedAt,language,timeZone,audio:file,state:'queued',text:''});};});if(full)throw Error('В очереди уже 10 записей. Дождитесь обработки или разберите ошибки.');await notify();},
    async retry(sequence){await change(sequence,j=>{if(!['failed','interrupted'].includes(j.state)||!j.text&&!j.audio)return j;return {...j,state:'queued',error:''};});await notify();},
    async remove(sequence){await change(sequence,j=>j.state==='processing'?j:null);await notify();},
    sync:notify,
    close(){closed=true;db.close();}
  };
}

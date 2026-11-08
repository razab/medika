import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../public/voice-capture.js';
import {voiceStatus,combineTranscripts,transcribeAudio,transcribePrepared} from '../lib/voice.mjs';
import {labVariants} from '../lib/voice-lab.mjs';
test('Whisper Base запрещён; основной Whisper Small + Whisper Medium',async()=>{
  assert.equal((await voiceStatus()).model,'dual');assert.equal((await voiceStatus('medium')).model,'medium');await assert.rejects(voiceStatus('base'));
  assert.ok(labVariants.every(v=>['small','medium','dual'].includes(v.asr)));assert.ok(labVariants.some(v=>v.asr==='medium'));
  assert.ok(labVariants.every(v=>/^Whisper (Small|Medium)( \+ Whisper Medium)? → /.test(v.label)));
});
test('Аудио: mono PCM 16 kHz, границы чанков, длительность и ограничение амплитуды',async()=>{
  const wav=Buffer.from(await encodeWav([new Float32Array(24000).fill(2),new Float32Array(24000).fill(-2)],48000).arrayBuffer());
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);
  assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.length,32044);assert.equal(wav.readUInt32LE(40),32000);
  assert.equal(wav.readInt16LE(44),32767);assert.equal(wav.readInt16LE(wav.length-2),-32768);
  assert.equal((await encodeWav([],44100).arrayBuffer()).byteLength,44);
});

test('Объединение сохраняет обе исходные версии с полными именами моделей',()=>{
 const text=combineTranscripts([{model:'small',text:'Даня, пороцитомол'},{model:'medium',text:'Да нет, парацетамол'}]);assert.equal(text,'Whisper Small:\nДаня, пороцитомол\n\nWhisper Medium:\nДа нет, парацетамол');
 assert.throws(()=>combineTranscripts([{model:'base',text:'x'},{model:'medium',text:'x'}]));assert.throws(()=>combineTranscripts([{model:'small',text:'x'.repeat(2000)},{model:'medium',text:'x'.repeat(2000)}]));
});

test('Общий ASR-замок действует до конца запроса и освобождается после ошибки',async()=>{
 const invalid={language:'fr',audio:'AAAA'},first=assert.rejects(transcribeAudio(invalid,'/tmp'),e=>e.status===400);await assert.rejects(transcribeAudio(invalid,'/tmp'),e=>e.status===429);await first;await assert.rejects(transcribeAudio(invalid,'/tmp'),e=>e.status===400);await assert.rejects(transcribePrepared(Buffer.alloc(0),'ru','/tmp','base'));await assert.rejects(transcribePrepared(Buffer.alloc(0),'ru','/tmp','dual'));
});

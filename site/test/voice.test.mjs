import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../public/voice-capture.js';
import {voiceStatus} from '../lib/voice.mjs';
import {labVariants} from '../lib/voice-lab.mjs';
test('Whisper Base запрещён; основной Whisper Small, сравнение с Whisper Medium',async()=>{
  assert.equal((await voiceStatus()).model,'small');assert.equal((await voiceStatus('medium')).model,'medium');await assert.rejects(voiceStatus('base'));
  assert.ok(labVariants.every(v=>['small','medium'].includes(v.asr)));assert.ok(labVariants.some(v=>v.asr==='medium'));
  assert.ok(labVariants.every(v=>/^Whisper (Small|Medium) → /.test(v.label)));
});
test('Аудио: mono PCM 16 kHz, границы чанков, длительность и ограничение амплитуды',async()=>{
  const wav=Buffer.from(await encodeWav([new Float32Array(24000).fill(2),new Float32Array(24000).fill(-2)],48000).arrayBuffer());
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);
  assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.length,32044);assert.equal(wav.readUInt32LE(40),32000);
  assert.equal(wav.readInt16LE(44),32767);assert.equal(wav.readInt16LE(wav.length-2),-32768);
  assert.equal((await encodeWav([],44100).arrayBuffer()).byteLength,44);
});

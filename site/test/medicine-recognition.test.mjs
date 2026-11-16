import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createMedicineRecognition,validateMedicineRecognition} from '../lib/medicine-recognition.mjs';
const text='TESTMIX\nСпрей назальный\n10 мг + 5 мг/мл\nДля интраназального применения\nTEST LAB';
const output={name:'TESTMIX',nameEvidence:'TESTMIX',medicineForm:'spray',formEvidence:'Спрей назальный',strengthEvidence:'10 мг + 5 мг/мл',instructionsEvidence:'Для интраназального применения',manufacturerEvidence:'TEST LAB',notes:[],conflicts:[]};
test('Локальный OCR упаковки: черновик на сверку, конфликт двух фото и повторное чтение результата',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'medika-package-local-'));
 try{
  const options={local:true,imageType:()=>true,recognize:async bytes=>({text:bytes.toString()}),prepare:async()=>['synthetic-thumbnail']};
  const service=await createMedicineRecognition(dir,options);
  const input={images:[Buffer.from(text).toString('base64')]};
  const draft=await service.recognize(input);
  assert.equal(draft.model,'local-ocr');assert.equal(draft.name,'TESTMIX');assert.equal(draft.medicineForm,'spray');assert.equal(draft.strength,'10 мг + 5 мг/мл');
  assert.equal(draft.canSave,false);
  assert.deepEqual((await service.get(draft.recognitionKey)).photos,['synthetic-thumbnail']);
  const reopened=await createMedicineRecognition(dir,options);
  assert.equal((await reopened.recognize(input)).cached,true);
  const other=Buffer.from('OTHER\nТаблетки\n15 мг').toString('base64');
  const mixed=await reopened.recognize({images:[...input.images,other]});
  assert.equal(mixed.name,'');assert.equal(mixed.strength,'');assert.equal(mixed.canSave,false);assert.ok(mixed.conflicts.length);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('AI упаковки: доказательства из OCR, без выдуманных названий/цифр/инструкций и без смешивания препаратов',()=>{
 const d=validateMedicineRecognition(text,output);assert(d.canSave);assert.equal(d.strength,'10 мг + 5 мг/мл');assert.equal(d.instructions,output.instructionsEvidence);assert.equal(d.manufacturer,'TEST LAB');
 assert.equal(validateMedicineRecognition(text,{...output,name:'OTHER DRUG'}).name,'');assert.equal(validateMedicineRecognition(text,{...output,strengthEvidence:'15 мг/мл'}).strength,'');assert.equal(validateMedicineRecognition(text,{...output,instructionsEvidence:'Детям по 2 мл три раза в день'}).instructions,'');assert.equal(validateMedicineRecognition(text,{...output,medicineForm:'tablet'}).medicineForm,'');assert(!validateMedicineRecognition(text,{...output,conflicts:['Два разных препарата на снимках']}).canSave);
 assert.equal(validateMedicineRecognition('BRAND 600\nтаблетки',{...output,name:'BRAND 600',nameEvidence:'BRAND 600',medicineForm:'tablet',formEvidence:'таблетки',strengthEvidence:'600',instructionsEvidence:'',manufacturerEvidence:''}).strength,'');
 assert.equal(validateMedicineRecognition('NOVA\nsuspension for inhalation\n0,5 mg / 2 ml',{...output,name:'NOVA',nameEvidence:'NOVA',medicineForm:'inhalation',formEvidence:'suspension for inhalation',strengthEvidence:'0,5 mg / 2 ml',instructionsEvidence:'',manufacturerEvidence:''}).strength,'0,5 mg / 2 ml');
});
test('OCR-кэш переживает ошибку AI и перезапуск, без повторов и запросов в фоне',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'medika-pack-cache-'));let ocrCalls=0,modelCalls=0,fail=true;const options={imageType:()=>true,recognize:async()=>{ocrCalls++;return {text};},prepare:async()=>['thumbnail'],parse:async t=>{modelCalls++;if(fail)throw Error('429 test limit');return validateMedicineRecognition(t,output);}};
 try{const image=Buffer.from('synthetic-image').toString('base64'),first=await createMedicineRecognition(dir,options);await assert.rejects(first.recognize({images:[]}),/одно или два/);await assert.rejects(first.recognize({images:['bad!']}),/6 МБ/);await assert.rejects(first.recognize({images:[image]}),/429/);assert.equal(ocrCalls,1);assert.equal(modelCalls,1);fail=false;const resumed=await createMedicineRecognition(dir,options),result=await resumed.recognize({images:[image]});assert.equal(ocrCalls,1);assert.equal(modelCalls,2);assert(result.canSave);assert((await resumed.recognize({images:[image]})).cached);assert.equal(modelCalls,2);assert.equal((await resumed.get(result.recognitionKey)).text,`Фото 1:\n${text}`);const stored=JSON.parse(await readFile(join(dir,'medicine-recognition',result.recognitionKey+'.json'),'utf8'));assert.equal(stored.status,'complete');assert(!JSON.stringify(stored).includes(image));}finally{await rm(dir,{recursive:true,force:true});}
});
test('Реальные виды упаковок: инъекции, дозированный ингалятор, порошок для суспензии и пробиотические единицы',async()=>{
 const {inferMedicineForm,allowedMedicineUnits}=await import('../public/medicine-forms.js');
 for(const [label,form]of [['Раствор для инъекций','injection'],['Soluție injectabilă','injection'],['Suspensie de inhalat presurizată','inhaler'],['Pulbere pentru suspensie orală','suspension']])assert.equal(inferMedicineForm(label),form);
 assert.deepEqual(allowedMedicineUnits('inhaler'),['доза','мкг']);assert(!allowedMedicineUnits('injection').includes('табл.'));assert(!allowedMedicineUnits('suspension').includes('пакет'));
 const t='TESTPRO\nSachets\n10 milliards',v=validateMedicineRecognition(t,{...output,name:'TESTPRO',nameEvidence:'TESTPRO',medicineForm:'powder',formEvidence:'Sachets',strengthEvidence:'10 milliards',instructionsEvidence:'',manufacturerEvidence:''});assert(v.canSave);assert.equal(v.strength,'10 milliards');
});

test('Дозированный ингалятор сохраняет обе напечатанные концентрации в micrograme без пересчёта',()=>{
 const t='TESTINHALER\nSuspensie de inhalat presurizată\n25 micrograme / 250 micrograme / doză',v=validateMedicineRecognition(t,{...output,name:'TESTINHALER',nameEvidence:'TESTINHALER',medicineForm:'inhaler',formEvidence:'Suspensie de inhalat presurizată',strengthEvidence:'25 micrograme / 250 micrograme / doză',instructionsEvidence:'',manufacturerEvidence:''});
 assert(v.canSave);assert.equal(v.strength,'25 micrograme / 250 micrograme / doză');
});

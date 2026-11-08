export const medicineImages=[
  {id:'rinofluimucil',aliases:['Rinofluimucil','Ринофлуимуцил'],photos:[{src:'/medicine-images/rinofluimucil.jpg',source:'https://www.topfarmacia.it/p-rinofluimucil-spray-nasale-10ml'}]},
  {id:'neladex-ns',aliases:['Neladex-NS','Неладекс-НС','Неладекс NS'],photos:[{src:'/medicine-images/neladex-ns.jpg',source:"https://vivafarm.md/catalog/lekarstva_i_bady/otorinolaringologiya/neladeks_ns_sprey_nazalnyy_15ml/"}]},
  {id:'nasacort',aliases:['Nasacort','Назакорт','Насакорт'],photos:[{src:'/medicine-images/nasacort.jpg',source:"https://fr.vivami.co/allergies/nasacort",note:'Упаковка Nasacort 55 мкг/доза. В исходной выписке указано 50 мкг/доза.'}]},
  {id:'elizium',aliases:['Elizium','Элизиум'],photos:[{src:'/medicine-images/elizium.jpg',source:"https://farmacie.md/ru/product/elizium-solutie-orala-05mgml-120ml-n1"}]},
  {id:'zespira',aliases:['Zespira','Зеспира'],photos:[{src:'/medicine-images/zespira.jpg',source:"https://felicia.md/product/zespira-5mg-comp-masticab-n14x2/"}]},
  {id:'kagocel',aliases:['Kagocel','Кагоцел'],photos:[{src:'/medicine-images/kagocel.jpg',source:"https://ff.md/products/kagocel-12mg-comp"}]}
];
const normalized=name=>String(name).normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function medicinePhotoKey(name){const key=normalized(name);return medicineImages.find(m=>m.aliases.some(a=>normalized(a)===key))?.id||key;}
export function photosForMedicine(name,own=[]){const key=medicinePhotoKey(name),record=own.find(p=>p.key===key);return record?{custom:true,version:record.version,photos:record.photos.map(data=>({src:'data:image/jpeg;base64,'+data}))}:{custom:false,version:0,photos:medicineImages.find(m=>m.id===key)?.photos||[]};}

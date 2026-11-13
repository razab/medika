// Local flow definitions only; no clinical records are read or changed.
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openAtlasFlows} from '../lib/atlas-flows.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),data=process.env.MEDIKA_DATA_DIR||resolve(root,'data');
if(!existsSync(resolve(data,'ui-atlas.sqlite')))throw Error('Откройте /ui-atlas/flows, чтобы инициализировать сценарии.');
const store=openAtlasFlows(data,JSON.parse(readFileSync(resolve(root,'public/ui-atlas/flows-seed.json'),'utf8')),resolve(root,'public/ui-atlas/manifest.json'));
try{const [command,id,flag,note]=process.argv.slice(2);if(command==='pending')console.log(JSON.stringify(store.reviews().filter(r=>r.status==='pending'),null,2));else if(command==='done'&&id&&flag==='--note')console.log(JSON.stringify(store.complete(id,note),null,2));else throw Error('Использование: pending | done <request-id> --note <результат и проверки>');}finally{store.close();}

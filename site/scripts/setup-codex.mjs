import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),site=join(dirname(fileURLToPath(import.meta.url)),'..'),prefix=join(site,'tools/codex'),binary=join(prefix,'node_modules/.bin/codex');
let installed=false;try{installed=(await exec(binary,['--version'])).stdout.trim()==='codex-cli 0.167.0';}catch{}
if(!installed)await exec('npm',['install','--prefix',prefix,'--no-fund','--no-audit','@openai/codex@0.167.0'],{timeout:180000,maxBuffer:1024*1024});
const auth=await exec(binary,['login','status']);if(!/Logged in using ChatGPT/i.test(auth.stdout+auth.stderr))throw Error('Войдите в Codex через ChatGPT');console.log('Medika Codex CLI 0.167.0 ready; ChatGPT sign-in; gpt-6.1-terra.');

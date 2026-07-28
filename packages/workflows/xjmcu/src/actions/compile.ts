import {execSync} from "child_process";
import {resolve} from "path";
import {existsSync,mkdirSync} from "fs";
const TC=resolve(import.meta.dirname,"../../toolchain");
export default async function(ctx,i){const{chip,source,output}=i;const d=output||resolve(process.cwd(),"build/"+chip);if(!existsSync(d))mkdirSync(d,{recursive:true});try{const r=execSync(`python -m buildcli build --chip ${chip} --src "${source}" --output "${d}"`,{cwd:TC,encoding:"utf-8",timeout:120000});return{success:true,hex:existsSync(resolve(d,"firmware.hex"))?resolve(d,"firmware.hex"):null,xbin:existsSync(resolve(d,"firmware.xbin"))?resolve(d,"firmware.xbin"):null};}catch(e){return{success:false,error:e.stderr||e.message};}}

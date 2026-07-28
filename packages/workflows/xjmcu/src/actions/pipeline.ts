import {execSync} from "child_process";
import {resolve} from "path";
import {existsSync,mkdirSync,writeFileSync} from "fs";
const TC=resolve(import.meta.dirname,"../../toolchain");
export default async function(ctx,i){const{chip="XC8P9530",source,output}=i;const d=output||resolve(process.cwd(),"build/xjmcu_"+chip);if(!existsSync(d))mkdirSync(d,{recursive:true});const r={chip,steps:{}};const sp=source||resolve(d,chip+"_main.c");if(!source)writeFileSync(sp,`#include "${chip}.h"
void main(void){while(1){}}
`);r.steps.gen={src:sp};const bd=resolve(d,"build");try{const cr=execSync(`python -m buildcli build --chip ${chip} --src "${sp}" --output "${bd}"`,{cwd:TC,encoding:"utf-8",timeout:120000});r.steps.compile={ok:true,xbin:existsSync(resolve(bd,"firmware.xbin"))?resolve(bd,"firmware.xbin"):null};}catch(e){r.steps.compile={ok:false,err:e.message?.slice(0,100)};}if(r.steps.compile?.xbin){try{execSync(`python -m astrocli freerun "${r.steps.compile.xbin}"`,{cwd:TC,timeout:30000});r.steps.flash={ok:true};const ro=execSync("python -m astrocli regs --json",{cwd:TC,encoding:"utf-8",timeout:15000});for(const l of ro.stdout.split("
")){if(l.startsWith("{")){try{r.regs=JSON.parse(l).registers;}catch{}break;}}}catch(e){r.steps.flash={ok:false};}}return r;}

import {writeFileSync,existsSync,mkdirSync} from "fs";
import {resolve} from "path";
export default async function(ctx,i){const{chip,requirement,output}=i;const d=output||resolve(process.cwd(),"build/gen");if(!existsSync(d))mkdirSync(d,{recursive:true});const s=resolve(d,chip+"_main.c");writeFileSync(s,`// ${chip}
#include "${chip}.h"
void main(void){while(1){}}
`);return{success:true,sourcePath:s};}

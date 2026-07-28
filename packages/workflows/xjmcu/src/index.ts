import {resolve,dirname} from "path"; import {fileURLToPath} from "url";
const __dirname=dirname(fileURLToPath(import.meta.url));
export async function run(ctx,i){const a=i.action||"pipeline";const m=await import(`./actions/${a}.js`);return m.default?m.default(ctx,i):m.handler(ctx,i);}

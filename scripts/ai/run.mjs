import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Executed only by the explicit ai:* commands. No browser, Three, or rendering is launched.
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(root,'.ai-cache',`${process.pid}`);
await build({configFile:false,root,logLevel:'silent',build:{
  ssr:resolve(root,'scripts/ai/cli.ts'),outDir:out,emptyOutDir:false,minify:false,sourcemap:false,
  rollupOptions:{output:{entryFileNames:'cli.mjs',inlineDynamicImports:true}},
}});
const child=spawn(process.execPath,[resolve(out,'cli.mjs'),...process.argv.slice(2)],{stdio:'inherit',cwd:root,windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import { auditRelease } from './index.mjs';import { formatReport } from './support.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'mac-release-demo-'));
try {const app=path.join(root,'Synthetic.app'),artifact=path.join(root,'Synthetic.zip');await mkdir(app);await writeFile(artifact,'synthetic artifact fixture');const report=await auditRelease({app,artifact,platform:'darwin',runner:async(command,args)=>({ok:true,output:args.includes('--display')?'Authority=Developer ID Application: Synthetic Fixture':'Simulated command response'})});report.summary='SYNTHETIC FIXTURE DEMO — native tool responses are simulated; no real app was verified. '+report.summary;console.log(formatReport(report,process.argv[2]??'text'));}
finally {await rm(root,{recursive:true,force:true});}

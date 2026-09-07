import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const prefix='js79psjkxyhfxdhajn7mdkc3218dyr2t/49a8041d6fafc99e8e63dbc8/';
const bucket='lazysoft-request-demos-20260907';
const base=`https://${bucket}.storage.yandexcloud.net/${prefix}`;
const files=['categories-v2.css','gallery-v2.js','admin-v1.css','admin-v1.js','content-v1.js','admin.html','covers.html','spreads.html','magazines.html','logos.html','index.html'];
for(const file of files){
 const path='demo-sites/portfolio-03212396/'+file;
 const result=spawnSync(process.env.PORTFOLIO_AWS_CLI||'.local/aws-cli/bin/aws',['--endpoint-url=https://storage.yandexcloud.net','s3','cp',path,`s3://${bucket}/${prefix}${file}`,'--cache-control','no-cache,max-age=0,must-revalidate','--only-show-errors'],{stdio:'pipe',env:process.env});
 if(result.status!==0)throw Error('Upload failed: '+file);
 const response=await fetch(base+file+'?verify=admin-v1');
 const bytes=Buffer.from(await response.arrayBuffer());
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(!response.ok||hash(bytes)!==hash(await readFile(path)))throw Error('Verification failed: '+file);
 console.log(file,'verified');
}

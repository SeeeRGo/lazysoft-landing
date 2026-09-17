// Requires local Docker and a private package created by the packager. No external ports except loopback.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const input=resolve(process.argv[2]);
const dir=mkdtempSync(resolve('.local/portfolio-sprint-test-')),site=join(dir,'site');cpSync(input,site,{recursive:true});
const suffix=Date.now(),db='portfolio-sprint-test-db-'+suffix,php='portfolio-sprint-test-php-'+suffix,network='portfolio-sprint-test-'+suffix;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
let cfg=readFileSync(join(site,'private/config.php'),'utf8').replace('mysql:host=localhost;dbname=ACCOUNT_portfolio;charset=utf8mb4',`mysql:host=${db};dbname=portfolio;charset=utf8mb4`).replaceAll('ACCOUNT_portfolio','portfolio').replace('REPLACE_DATABASE_PASSWORD','test-only').replace('https://YOUR-SITE.xsph.ru','https://test.example');
writeFileSync(join(site,'private/config.php'),cfg,{mode:0o600});
try{
 docker('network','create',network);
 docker('run','-d','--name',db,'--network',network,'--memory','512m','--tmpfs','/var/lib/mysql','-e','MARIADB_ROOT_PASSWORD=test-only','-e','MARIADB_DATABASE=portfolio','-e','MARIADB_USER=portfolio','-e','MARIADB_PASSWORD=test-only','-v',resolve('standalone/portfolio-sprinthost/schema.sql')+':/docker-entrypoint-initdb.d/schema.sql:ro','mariadb:11.4');
 let ready=false;
 for(let i=0;i<120;i++){try{docker('exec',db,'mariadb','-h127.0.0.1','-uroot','-ptest-only','portfolio','-e','SELECT id FROM pf_settings');ready=true;break}catch{}await new Promise(r=>setTimeout(r,500))}
 if(!ready)throw Error('Test database not ready');
 docker('run','-d','--name',php,'--network',network,'--memory','512m','-p','127.0.0.1::8080','-v',site+':/site:ro','portfolio-sprinthost-test:local');
 const port=docker('port',php,'8080').trim().split(':').at(-1);
 ready=false;
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:'+port+'/api.php')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}
 if(!ready)throw Error('Test PHP API not ready');
 execFileSync(process.execPath,['standalone/portfolio-sprinthost/test.mjs',site,port,db,php],{stdio:'inherit'});
 execFileSync(process.execPath,['standalone/portfolio-sprinthost/browser-test.mjs',site,docker('port',php,'8080').trim().split(':').at(-1)],{stdio:'inherit'});
 console.log('Browser screenshots: '+dir);
 console.log('Test containers verified; production untouched.');
}finally{
 for(const name of [php,db])try{docker('rm','-f',name)}catch{}
 try{docker('network','rm',network)}catch{}
}

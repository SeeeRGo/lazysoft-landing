// Documentation assets only. Original official screenshots and locally tested UI.
import {mkdirSync,writeFileSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';
const dir=resolve('docs/assets/sprinthost-guide');mkdirSync(dir,{recursive:true});
const remote={
 'database-create.png':'https://help.sprintbox.ru/img/other/article/a384ae28-45cc-4c6c-80b9-471d149f9d9b-v1-db_new.png',
 'database-import.png':'https://help.sprintbox.ru/img/other/article/pmaimport-5da21e972f090.png',
 'database-export.png':'https://help.sprintbox.ru/img/other/article/pmaexport-5da21e7c160c0.png',
 'upload-icon.png':'https://help.sprintbox.ru/img/other/article/upload-icon-5d94a43ce38e7.png',
 'extract-icon.png':'https://help.sprintbox.ru/img/other/article/archive-icon-5d94a4d6eb515.png',
};
for(const [file,url] of Object.entries(remote)){
 const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Download failed '+file+': '+r.status);
 const b=Buffer.from(await r.arrayBuffer());if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Not PNG: '+file);
 writeFileSync(join(dir,file),b);console.log(file,b.length);
}
for(const file of ['index-1366.png','index-390.png','admin-1366.png','admin-390.png'])cpSync(join('.local/portfolio-sprint-test-zD2TvA',file),join(dir,file));

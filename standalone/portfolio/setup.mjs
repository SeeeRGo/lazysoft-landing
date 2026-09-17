// One interactive command on the customer's host. Never downloads or installs code.
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join,basename} from 'node:path';
import {existsSync,readdirSync,lstatSync} from 'node:fs';
import {runtimeSupported,listSites,install} from './sprinthost-install.mjs';
if(!runtimeSupported()){console.error('Нужен Node.js 22.5+ или 24. Команда на Sprinthost: node22 ~/portfolio/setup.mjs');process.exit(1)}
if(!process.execArgv.includes('--experimental-sqlite')){
 const r=spawnSync(process.execPath,['--experimental-sqlite',fileURLToPath(import.meta.url)],{stdio:'inherit'});process.exit(r.status??1);
}
const ui=createInterface({input:process.stdin,output:process.stdout});
try{
 console.log('\nУстановка портфолио на Sprinthost. Node.js '+process.versions.node+'\n');
 const sites=listSites(homedir());
 if(!sites.length)throw Error('Не найдены сайты в domains. Сначала создайте сайт в панели Sprinthost.');
 sites.forEach((p,i)=>console.log((i+1)+'. '+basename(p)));
 const number=Number(await ui.question('\nНомер ВАШЕГО сайта: '));
 if(!Number.isInteger(number)||number<1||number>sites.length)throw Error('Не выбран сайт. Запустите установку заново.');
 const siteRoot=sites[number-1],proposed=new URL('https://'+basename(siteRoot)).origin;
 const answer=(await ui.question('HTTPS-адрес ['+proposed+'] (Enter — оставить): ')).trim();
 const origin=answer||proposed;
 let replace=false;const pub=join(siteRoot,'public_html');
 if(existsSync(pub)&&!lstatSync(pub).isSymbolicLink()&&readdirSync(pub).length){
  console.log('\nВ public_html уже есть файлы. Они будут сохранены рядом в public_html.before-portfolio-ДАТА. Их не удаляем.');
  replace=(await ui.question('Чтобы сохранить прежнюю папку и включить новое портфолио, введите СОХРАНИТЬ: ')).trim()==='СОХРАНИТЬ';
  if(!replace)throw Error('Отменено. Файлы сайта не изменены.');
 }
 console.log('\nПроверяю HTTPS, Node.js, базу и резервное копирование…');
 const result=await install({appRoot:fileURLToPath(new URL('.',import.meta.url)),siteRoot,origin,replace});
 if(result.alreadyInstalled)console.log('Сайт уже настроен. Повторно создавать ключ не нужно.');
 else{
  console.log('\nГОТОВО. Настройки установлены.');
  console.log('Сайт: '+origin+'\nАдминка: '+origin+'/admin.html');
  console.log('Секретный ключ — в файле '+result.keyFile+' (скачайте через файловый менеджер, не публикуйте).');
  if(result.oldPublic)console.log('Прежние файлы сохранены: '+result.oldPublic);
  console.log('Откройте сайт в браузере. Если он не открылся, проверьте выбор Node.js 22 в панели.');
 }
}catch(e){console.error('\nУстановка остановлена: '+e.message);console.error('Не очищайте базу и не публикуйте ключи. Проверьте шаг инструкции.');process.exitCode=1}
finally{ui.close()}

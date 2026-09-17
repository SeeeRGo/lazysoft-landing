// Creates the exact customer handover ZIP. No cloud credentials, old admin key
// or live sessions are copied. The owner creates a fresh key during setup.
import {DatabaseSync,backup} from '../standalone/portfolio/sqlite-compat.mjs';
import {mkdtempSync,cpSync,mkdirSync,chmodSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
const source=resolve('standalone/portfolio'),input=resolve(process.argv[2]||'');
if(!process.argv[2]||!existsSync(join(input,'portfolio.sqlite')))throw Error('Usage: node scripts/package-portfolio-sprinthost-node.mjs <snapshot/data>');
const value=flag=>{const i=process.argv.indexOf(flag);return i<0?null:process.argv[i+1]};
const login=value('--login'),domain=value('--domain'),personal=Boolean(login||domain);
if(personal&&(!login||!domain))throw Error('Для персонального архива нужны оба параметра: --login и --domain');
if(login&&!/^[a-zA-Z0-9_-]{2,40}$/.test(login))throw Error('Некорректный логин Sprinthost');
if(domain&&(!/^(?=.{3,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain)||domain.includes('..')))throw Error('Некорректный домен');
const target=mkdtempSync(resolve('.local/portfolio-sprinthost-node-'));chmodSync(target,0o700);
const app=join(target,'portfolio');mkdirSync(app,{mode:0o700});
const files=['public','package.json','server.mjs','sqlite-compat.mjs','passenger.cjs','setup.mjs','sprinthost-install.mjs','control.mjs','manage.mjs','check-hosting.mjs','test.mjs'];
for(const name of files)cpSync(join(source,name),join(app,name),{recursive:true});
mkdirSync(join(app,'data'),{mode:0o700});
const db=new DatabaseSync(join(input,'portfolio.sqlite'),{readOnly:true});
try{await backup(db,join(app,'data/portfolio.sqlite'))}finally{db.close()}
const clean=new DatabaseSync(join(app,'data/portfolio.sqlite'));
try{
 if(clean.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Source database check failed');
 clean.exec('DELETE FROM settings; DELETE FROM sessions; DELETE FROM limits; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
 if(personal){
  const key=randomBytes(32).toString('base64url');
  clean.prepare('INSERT INTO settings VALUES(1,?)').run(createHash('sha256').update(key).digest('hex'));
  writeFileSync(join(target,'КЛЮЧ-АДМИНИСТРАТОРА.txt'),key+'\n',{mode:0o600});
 }
}finally{clean.close()}
chmodSync(join(app,'data/portfolio.sqlite'),0o600);
writeFileSync(join(app,'НАЧНИТЕ-ЗДЕСЬ.txt'),personal?`ПОРТФОЛИО ДЛЯ SPRINTHOST — ПЕРСОНАЛЬНЫЙ АРХИВ

Этот архив подготовлен для аккаунта ${login} и домена ${domain}.

1. Загрузите весь ZIP в самую верхнюю папку аккаунта, рядом с domains.
2. Нажмите «Распаковать» в файловом менеджере.
3. В «Сайты → Веб-серверы» выберите Node.js 22 и подключите ${domain}.
4. Нажмите «Перезапустить» у этого веб-сервера.
5. Подождите 1–2 минуты и откройте https://${domain}/
6. Админка: https://${domain}/admin.html
7. Ключ лежит в верхней папке в файле КЛЮЧ-АДМИНИСТРАТОРА.txt.

SSH, терминал и npm не нужны. Не используйте архив на другом аккаунте.
`:`ПОРТФОЛИО ДЛЯ SPRINTHOST — NODE.JS 22

1. Откройте приложенный PDF «Портфолио на Sprinthost».
2. Создайте бесплатный аккаунт и сайт в панели Sprinthost.
3. Загрузите папку portfolio в корень аккаунта, рядом с domains.
4. Подключитесь по SSH по инструкции и выполните одну команду:
   node22 ~/portfolio/setup.mjs
5. Следуйте вопросам установщика. Он сам создаст новый ключ администратора.

Не загружайте папку portfolio внутрь public_html.
Не публикуйте весь этот архив и ключ администратора.
Node.js-пакеты устанавливать не нужно: у проекта нет внешних зависимостей.
`,{mode:0o600});
const guide=resolve('artifacts/archive/instructions/portfolio-sprinthost-user-guide.pdf');
if(existsSync(guide))cpSync(guide,join(app,'ИНСТРУКЦИЯ-SPRINTHOST.pdf'));
let entries=['portfolio'];
if(personal){
 const home='/home/'+login,origin='https://'+domain,siteRoot=join(target,'domains',domain),publicRoot=join(siteRoot,'public_html');
 mkdirSync(publicRoot,{recursive:true});mkdirSync(join(app,'tmp'),{mode:0o700});writeFileSync(join(app,'tmp/restart.txt'),'');
 writeFileSync(join(app,'hosting.json'),JSON.stringify({publicOrigin:origin,publicRoot:home+'/domains/'+domain+'/public_html',nodeExecutable:'/usr/local/bin/node22'},null,2)+'\n',{mode:0o600});
 writeFileSync(join(app,'node22-launcher.sh'),'#!/bin/sh\nexec /usr/local/bin/node22 --experimental-sqlite "$@"\n',{mode:0o755});
 writeFileSync(join(publicRoot,'.htaccess'),`# Lazysoft portable portfolio — personalized no-SSH package
Options -Indexes -MultiViews
Require all granted
SetEnv GHOST_NODE_VERSION_CHECK false
PassengerEnabled on
PassengerAppType node
PassengerAppRoot "${home}/portfolio"
PassengerStartupFile passenger.cjs
PassengerNodejs "${home}/portfolio/node22-launcher.sh"
PassengerAppEnv production
PassengerResolveSymlinksInDocumentRoot on
RewriteEngine On
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ ${origin}%{REQUEST_URI} [R=302,L,NE]
<Files ".htaccess">
Require all denied
</Files>
`,{mode:0o644});
 entries=['portfolio','domains','КЛЮЧ-АДМИНИСТРАТОРА.txt'];
}
const archive=join(target,personal?'portfolio-sprinthost-upload.zip':'portfolio-sprinthost-node22.zip');
execFileSync('zip',['-q','-r','-9',archive,...entries],{cwd:target});chmodSync(archive,0o600);
console.log(JSON.stringify({archive,directory:app,personalized:personal,login,domain,version:cleanVersion(join(app,'data/portfolio.sqlite')),bytes:existsSync(archive)}));
function cleanVersion(file){const d=new DatabaseSync(file,{readOnly:true});try{return d.prepare('SELECT version FROM content').get()?.version??0}finally{d.close()}}

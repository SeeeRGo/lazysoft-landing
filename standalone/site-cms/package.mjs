import {readFile,writeFile,mkdir,cp,lstat,copyFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {validateSchema,validateContent} from './model.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)), own=fileURLToPath(new URL('.',import.meta.url));
export async function installDemoCms(site){
 const schema=validateSchema(JSON.parse(await readFile(join(site,'cms-schema.json'),'utf8')));
 const content=validateContent(schema,JSON.parse(await readFile(join(site,'cms-content.json'),'utf8')));
 await writeFile(join(site,'cms-content.json'),JSON.stringify(content));
 await cp(join(own,'public'),site,{recursive:true});await copyFile(join(own,'model.mjs'),join(site,'cms-model.mjs'));
 const files=new Set(await readdir(site));
 for(const collection of schema.collections){
  if(!collection.page||files.has(collection.page))continue;
  await writeFile(join(site,collection.page),`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${collection.label.replace(/[<>&"]/g,'')}</title><style>body{margin:0;background:#f7f4ed;color:#183d38;font-family:Arial,sans-serif}.demo{padding:10px 24px;background:#183d38;color:#fff;font-size:13px}.nav{display:flex;gap:18px;flex-wrap:wrap;padding:20px 24px}.nav a{color:inherit;font-weight:700}</style></head><body><div class="demo">Демонстрационная версия — данные вымышлены</div><nav class="nav"><a href="index.html">На главную</a><a href="admin.html">Панель редактора</a></nav></body></html>`);
  files.add(collection.page);
 }
 const fallback='<script type="module" src="cms-fallback.js"></script>';
 for(const name of await readdir(site))if(name!=='admin.html'&&name.endsWith('.html')){const path=join(site,name),html=await readFile(path,'utf8');if(!html.includes('cms-fallback.js'))await writeFile(path,html.includes('</body>')?html.replace('</body>',fallback+'</body>'):html+fallback)}
 return {schema,content};
}
function replaceRange(s,start,end,value){const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<0)throw Error('CMS backend adapter requires review');return s.slice(0,a)+value+'\n\n'+s.slice(b)}
export async function buildPackages(site,destination){
 await mkdir(destination,{mode:0o700});
 const schema=validateSchema(JSON.parse(await readFile(join(site,'cms-schema.json'),'utf8'))),content=validateContent(schema,JSON.parse(await readFile(join(site,'cms-content.json'),'utf8')));
 const suffix=randomBytes(4).toString('hex');
 const names={workerName:'site-'+suffix,databaseName:'site-'+suffix,kvNamespaceName:'site-'+suffix+'-files'};
 for(const hosting of ['cloudflare','hostiman']){
  const out=join(destination,hosting);await mkdir(out,{recursive:true,mode:0o700});
  const key=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(key).digest('hex');
  await writeFile(join(out,'INSTALL-KEY.txt'),key+'\n',{mode:0o600});
  if(hosting==='cloudflare'){
   const base=join(root,'standalone/portfolio-cloudflare');
   for(const name of ['schema.sql','package.json','wrangler.template.jsonc','deploy.mjs','install-cloudflare.cmd','install-cloudflare.sh','.gitignore'])await cp(join(base,name),join(out,name),{recursive:true});
   await mkdir(join(out,'src'));await mkdir(join(out,'seed/assets'),{recursive:true});
   await cp(site,join(out,'public'),{recursive:true});
   await cp(join(base,'public/_headers'),join(out,'public/_headers'));
   await writeFile(join(out,'public/cms-config.js'),`window.LAZY_CMS_CONFIG={mode:'server',api:'/api/portfolio'};\n`);
   await copyFile(join(own,'model.mjs'),join(out,'src/cms-model.mjs'));
   await writeFile(join(out,'src/cms-schema.json'),JSON.stringify(schema));
   let code=await readFile(join(base,'src/worker.js'),'utf8');
   code=replaceRange(code,'async function validateContent(env, content) {','async function publicContent(env)',`async function validateContent(env, content) {
 const result=validateCMS(schema,content);
 const check=async(fields,row)=>{for(const field of fields){if(field.type!=='image')continue;const value=row[field.key];if(!value?.startsWith('/'))continue;const match=value.match(/^\\/api\\/portfolio\\/assets\\/([A-Za-z0-9_-]{1,80})$/);if(!match)throw Error('Некорректный файл');const a=await env.DB.prepare('SELECT type FROM pf_assets WHERE id=?').bind(match[1]).first();if(!a?.type?.startsWith('image/'))throw Error('Изображение не найдено')}};
 await check(schema.fields,result.values);for(const c of schema.collections)for(const row of result.items[c.key])await check(c.fields,row);
 return result;
}`);
   code=replaceRange(code,'async function publicContent(env) {','function validFile',`async function publicContent(env) {const row=await env.DB.prepare('SELECT version,json FROM pf_content WHERE id=1').first();return json(row?{version:row.version,content:JSON.parse(row.json)}:null);}`);
   code=`import {validateContent as validateCMS} from './cms-model.mjs';\nimport schema from './cms-schema.json';\n`+code;
   code=code.replace('const MAX_ASSETS = 100;','const MAX_ASSETS = Infinity;').replace('const MAX_ASSET_BYTES = 100 * 1024 * 1024;','const MAX_ASSET_BYTES = 1024 * 1024 * 1024;').replace('Лимит: 100 файлов / 100 МБ','Достигнут объём хранилища 1 ГБ').replace('max = 150000','max = 2000000');
   await writeFile(join(out,'src/worker.js'),code);
   const sql=x=>"'"+x.replaceAll("'","''")+"'";
   await writeFile(join(out,'seed/seed.sql'),`INSERT INTO pf_settings(id,key_hash,asset_count,asset_bytes) VALUES(1,${sql(hash)},0,0);\nINSERT INTO pf_content(id,version,json) VALUES(1,1,${sql(JSON.stringify(content))});\n`,{mode:0o600});
   await writeFile(join(out,'seed/assets.json'),'[]');await writeFile(join(out,'install-settings.json'),JSON.stringify(names));
   await writeFile(join(out,'README.md'),'# Установка в Cloudflare\n\nОткройте install-cloudflare.sh (Linux/macOS) или install-cloudflare.cmd (Windows). Нужен Node.js 22+ и ваш аккаунт Cloudflare. Установщик создаёт Worker, D1 и KV; R2 не используется. После установки откройте /admin.html и войдите ключом из INSTALL-KEY.txt. Храните этот файл отдельно. Изменения сохраняются на сервере. Новые изображения KV могут появляться с задержкой. Подробности ограничений — ../README.md.\n');
  }else{
   const base=join(root,'standalone/portfolio-shared-php');
   for(const name of ['private','public_html'])await cp(join(base,name),join(out,name),{recursive:true});
   const installer=join(out,'public_html/install.php');await writeFile(installer,(await readFile(installer,'utf8')).replace('Установка портфолио','Установка сайта')); 
   await cp(site,join(out,'public_html'),{recursive:true});await cp(join(base,'schema.sql'),join(out,'private/schema.sql'));
   await writeFile(join(out,'public_html/cms-config.js'),`window.LAZY_CMS_CONFIG={mode:'server',api:'/api.php'};\n`);
   await writeFile(join(out,'private/cms-schema.json'),JSON.stringify(schema));
   await writeFile(join(out,'private/seed.json'),JSON.stringify({version:1,content,assets:[],history:[]}),{mode:0o600});
   await writeFile(join(out,'private/setup.php'),`<?php\nreturn ['setup_key_hash'=>'${hash}'];\n`,{mode:0o600});
   let code=await readFile(join(base,'private/app.php'),'utf8');
   const validate=(await readFile(join(own,'server/validate.php'),'utf8')).replace(/^<\?php\s*/,'');
   code=replaceRange(code,'function validate(PDO $db, mixed $c): array {','function assetUrl',validate);
   code=replaceRange(code,'function readContent(PDO $db): mixed {','function runApi',`function readContent(PDO $db): mixed {$r=query($db,'SELECT * FROM pf_content WHERE id=1')->fetch();return $r?['version'=>(int)$r['version'],'content'=>json_decode($r['json'],true,32,JSON_THROW_ON_ERROR)]:null;}`);
   code=code.replace("(int)$q['n']>=100 || (int)$q['size']+strlen($bytes)>104857600","(int)$q['size']+strlen($bytes)>1073741824").replace('Лимит: 100 файлов / 100 МБ','Достигнут объём хранилища 1 ГБ').replace("$op==='save'?150000:1000","$op==='save'?2000000:1000");
   await writeFile(join(out,'private/app.php'),code);
   await writeFile(join(out,'README.md'),'# Установка в HostiMan / PHP-MySQL\n\nНужен хостинг с PHP 8.1+, PDO MySQL и HTTPS. Создайте пустую базу MySQL. Загрузите содержимое public_html в веб-корень, а private — рядом с ним, вне веб-корня. Откройте https://ВАШ-ДОМЕН/install.php, введите реквизиты базы и ключ из INSTALL-KEY.txt. После установки откройте /admin.html и войдите этим ключом. Установщик закрывается после первого запуска. Не публикуйте private и INSTALL-KEY.txt. Изменения сохраняются в MySQL и видны посетителям.\n');
  }
 }
 await writeFile(join(destination,'README.md'),'# Сайт с полноценной админкой\n\nФункции и ограничения конкретного сайта описаны в SITE-NOTES.md, который добавляет worker. Выберите один пакет: cloudflare (Worker + D1 + KV) или hostiman (PHP + MySQL). У каждого свой ключ установки; не публикуйте архив целиком. В админке доступны добавление, удаление, сортировка записей, тексты, цены и изображения. Нет лимита на количество записей в каталоге. Технические пределы: изображение до 8 МиБ, содержимое одного сохранения до 2 МБ, хранилище загрузок до 1 ГБ и действующие квоты выбранного хостинга. Эти пределы можно изменить в серверной конфигурации. Вход действует 15 минут; затем войдите снова. Одновременные сохранения защищены проверкой версии. Проверяйте реквизиты, тексты, лицензии изображений и контакты перед публикацией. Платежи, доставки, личные кабинеты и другие внешние интеграции не становятся подключёнными от наличия дизайна: если идея их требует, их необходимо настроить и проверить отдельно до приёма реальных заказов.\n');
 return destination;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2]||!process.argv[3])throw Error('Usage: node package.mjs <validated site> <output>');
 await buildPackages(resolve(process.argv[2]),resolve(process.argv[3]));console.log('CMS packages prepared');
}

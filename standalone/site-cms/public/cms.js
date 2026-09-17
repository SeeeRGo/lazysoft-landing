import {validateContent} from './cms-model.mjs';
const config=window.LAZY_CMS_CONFIG||{mode:'demo'};
const base=new URL('.',location.href).pathname;
let database;
const db=()=>database??=new Promise((resolve,reject)=>{const r=indexedDB.open('lazysoft-cms:'+base,1);r.onupgradeneeded=()=>r.result.createObjectStore('content');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function local(write,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('content',write?'readwrite':'readonly');const s=t.objectStore('content');const r=write?s.put(value,'current'):s.get('current');t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)})}
let schema;
async function getSchema(){if(!schema){const r=await fetch('cms-schema.json');if(!r.ok)throw Error('Не удалось загрузить структуру сайта');schema=await r.json()}return schema}
async function api(op,body,token){const r=await fetch(config.api+(op?'?op='+op:''),{method:op?'POST':'GET',headers:{...(op?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(op?{body:JSON.stringify(body||{})}:{}),cache:'no-store'});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Ошибка сохранения'),{status:r.status});return data}
export const CMS={
 mode:config.mode, schema:getSchema,
 async load(){const schema=await getSchema();if(config.mode==='server'){const data=await api();return {...data,schema}}let content;try{content=await local(false)}catch{}if(!content){const r=await fetch('cms-content.json');if(!r.ok)throw Error('Не удалось загрузить содержимое');content=await r.json()}return {schema,content,version:0}},
 async save(content,version,token){const clean=validateContent(await getSchema(),content,config.mode!=='server');if(config.mode==='server')return api('save',{content:clean,version},token);await local(true,clean);return {version:0}},
 login:key=>api('login',{},key),logout:token=>api('logout',{},token),
 async upload(file,token){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('Выберите JPG, PNG или WebP до 8 МБ');if(config.mode==='server'){const r=await fetch(config.api+'?op=upload',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':file.type},body:file});const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось загрузить файл');return data.url}return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Не удалось прочитать файл'));r.readAsDataURL(file)})}
};
window.LazyCMS=CMS;

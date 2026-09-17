const MAX_FILE = 8 * 1024 * 1024;
const MAX_ASSETS = 100;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const SESSION_MS = 15 * 60 * 1000;

const now = () => Date.now();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...security(), ...headers}
});
const security = () => ({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
});
const fail = (message, status = 400, headers = {}) => json({error: message}, status, headers);
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const bearer = request => (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const textOk = (value, max) => typeof value === 'string' && [...value].length <= max;
const assetUrl = id => '/api/portfolio/assets/' + encodeURIComponent(id);

async function rate(env, request, group, capacity) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const name = group + ':' + (await sha256(ip)).slice(0, 16);
  const timestamp = now(), reset = timestamp + 60000;
  await env.DB.prepare(`INSERT INTO pf_limits(name,count,reset_at) VALUES(?,1,?)
    ON CONFLICT(name) DO UPDATE SET
      count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
      reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END`).bind(name, reset, timestamp, timestamp, reset).run();
  const row = await env.DB.prepare('SELECT count,reset_at FROM pf_limits WHERE name=?').bind(name).first();
  if (row.count > capacity) return fail('Слишком много запросов. Повторите позже.', 429, {'Retry-After': String(Math.max(1, Math.ceil((row.reset_at - timestamp) / 1000)))});
}

async function authorized(env, request) {
  const token = bearer(request);
  if (token.length > 100) return false;
  const row = await env.DB.prepare('SELECT expires FROM pf_sessions WHERE hash=?').bind(await sha256(token)).first();
  return Boolean(row && row.expires > now());
}

async function readJson(request, max = 150000) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > max) throw Object.assign(Error('Слишком большой запрос'), {status: 413});
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > max) throw Object.assign(Error('Слишком большой запрос'), {status: 413});
  try { return JSON.parse(body); } catch { throw Object.assign(Error('Некорректный JSON'), {status: 400}); }
}

async function validateContent(env, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw Error('Проверьте содержимое');
  const result = {};
  for (const [field, max] of Object.entries({name:100, headline:160, about:3000, email:254, telegram:33, prices:3000})) {
    if (!textOk(content[field], max)) throw Error('Проверьте поле ' + field);
    result[field] = content[field];
  }
  if (!content.name.trim() || !content.headline.trim()) throw Error('Укажите имя и заголовок');
  if (content.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(content.email)) throw Error('Проверьте почту');
  if (content.telegram && !/^@?[A-Za-z0-9_]{5,32}$/.test(content.telegram)) throw Error('Telegram: @username');
  if (!Array.isArray(content.works) || content.works.length > 40) throw Error('Максимум 40 работ');
  const ids = new Set(), assetIds = new Set();
  result.works = content.works.map(work => {
    if (!work || typeof work !== 'object' || !validId(work.id) || ids.has(work.id) || !['covers','spreads','magazines','logos'].includes(work.category) || !textOk(work.title,150) || !work.title.trim() || !textOk(work.description,2000)) throw Error('Проверьте поля работы');
    ids.add(work.id);
    if (!validId(work.image) || (work.document !== undefined && !validId(work.document))) throw Error('Недопустимый файл');
    assetIds.add(work.image); if (work.document) assetIds.add(work.document);
    return {id:work.id, category:work.category, title:work.title, description:work.description, image:work.image, ...(work.document ? {document:work.document} : {})};
  });
  if (assetIds.size) {
    const values = [...assetIds], placeholders = values.map(() => '?').join(',');
    const rows = (await env.DB.prepare(`SELECT id,type FROM pf_assets WHERE id IN (${placeholders})`).bind(...values).all()).results;
    const types = new Map(rows.map(row => [row.id,row.type]));
    for (const work of result.works) {
      if (!types.get(work.image)?.startsWith('image/')) throw Error('Файл не найден или имеет неверный тип');
      if (work.document && types.get(work.document) !== 'application/pdf') throw Error('Файл не найден или имеет неверный тип');
    }
  }
  return result;
}

async function publicContent(env) {
  const row = await env.DB.prepare('SELECT version,json FROM pf_content WHERE id=1').first();
  if (!row) return json(null);
  const content = JSON.parse(row.json);
  const works = content.works.map(work => ({...work, imageUrl:assetUrl(work.image), documentUrl:work.document ? assetUrl(work.document) : null}));
  return json({version:row.version, content, works});
}

function validFile(type, bytes) {
  const a = new Uint8Array(bytes), ascii = (...v) => v.every((x,i) => a[i] === x);
  if (!a.length || a.length > MAX_FILE) return false;
  if (type === 'image/png') return ascii(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
  if (type === 'image/jpeg') return ascii(0xff,0xd8,0xff);
  if (type === 'image/webp') return ascii(0x52,0x49,0x46,0x46) && a[8]===0x57 && a[9]===0x45 && a[10]===0x42 && a[11]===0x50;
  if (type === 'application/pdf') return ascii(0x25,0x50,0x44,0x46,0x2d);
  return false;
}

async function serveAsset(env, request, id) {
  if (!['GET','HEAD'].includes(request.method) || !validId(id)) return fail('Файл не найден', 404);
  const meta = await env.DB.prepare('SELECT type,size FROM pf_assets WHERE id=?').bind(id).first();
  if (!meta) return fail('Файл не найден', 404);
  const bytes = await env.FILES.get('assets/' + id, 'arrayBuffer');
  if (!bytes) return fail('Файл ещё распространяется. Повторите загрузку страницы через минуту.', 503, {'Retry-After':'60'});
  const headers = new Headers({'Content-Type':meta.type, 'Content-Length':String(meta.size), 'Cache-Control':'public, max-age=86400', ...security()});
  if (meta.type === 'application/pdf') headers.set('Content-Disposition','attachment; filename="portfolio.pdf"');
  return new Response(request.method === 'HEAD' ? null : bytes, {headers});
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let result = '';
  for (let i=0;i<bytes.length;i+=32768) result += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(result);
}

async function api(request, env) {
  if (request.method === 'GET') {
    const limited = await rate(env, request, 'read', 120); if (limited) return limited;
    return publicContent(env);
  }
  if (request.method !== 'POST') return fail('Метод не поддерживается',405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail('Запрос с другого сайта запрещён',403);
  const op = new URL(request.url).searchParams.get('op') || '';
  if (op === 'login') {
    const limited = await rate(env, request, 'login', 5); if (limited) return limited;
    const token = bearer(request), setting = await env.DB.prepare('SELECT key_hash FROM pf_settings WHERE id=1').first();
    if (!setting || !/^[A-Za-z0-9_-]{43}$/.test(token) || setting.key_hash !== await sha256(token)) return fail('Неверный ключ доступа',401);
    const session = randomToken(), expiresAt = now()+SESSION_MS;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM pf_sessions WHERE expires<=?').bind(now()),
      env.DB.prepare('INSERT INTO pf_sessions(hash,expires) VALUES(?,?)').bind(await sha256(session),expiresAt),
      env.DB.prepare('INSERT INTO pf_history(event,created) VALUES(?,?)').bind('Вход в админку',now())
    ]);
    return json({token:session,expiresAt});
  }
  if (!await authorized(env,request)) {
    const limited=await rate(env,request,'invalid',30); if(limited)return limited;
    return fail('Сессия истекла или отозвана. Войдите снова.',401);
  }
  const limited=await rate(env,request,op==='backup'?'backup':op==='upload'?'upload':'admin',op==='backup'?2:op==='upload'?10:60); if(limited)return limited;
  if (op === 'history') {
    const rows=(await env.DB.prepare('SELECT event,created AS createdAt,version FROM pf_history ORDER BY id DESC LIMIT 50').all()).results;
    return json(rows.map(row => row.version===null ? {event:row.event,createdAt:row.createdAt} : row));
  }
  if (op === 'revision') {
    const input=await readJson(request,1000); if(!Number.isInteger(input.version))return fail('Неверная версия');
    const row=await env.DB.prepare('SELECT json FROM pf_history WHERE version=?').bind(input.version).first(); return json(row?JSON.parse(row.json):null);
  }
  if (op === 'logout' || op === 'revoke') {
    await env.DB.batch([env.DB.prepare('DELETE FROM pf_sessions'),env.DB.prepare('INSERT INTO pf_history(event,created) VALUES(?,?)').bind('Все сессии отозваны',now())]); return json({ok:true});
  }
  if (op === 'rotate') {
    const input=await readJson(request,1000); if(!/^[A-Za-z0-9_-]{43}$/.test(input.newKey||''))return fail('Неверный формат ключа');
    await env.DB.batch([env.DB.prepare('UPDATE pf_settings SET key_hash=? WHERE id=1').bind(await sha256(input.newKey)),env.DB.prepare('DELETE FROM pf_sessions'),env.DB.prepare('INSERT INTO pf_history(event,created) VALUES(?,?)').bind('Ключ заменён, все сессии отозваны',now())]); return json({ok:true});
  }
  if (op === 'upload') {
    const declared=Number(request.headers.get('Content-Length')||0); if(declared>MAX_FILE)return fail('Слишком большой запрос',413);
    const bytes=await request.arrayBuffer(), type=(request.headers.get('Content-Type')||'').split(';')[0];
    if(!validFile(type,bytes))return fail('Разрешены JPG, PNG, WebP и PDF до 8 МБ; содержимое должно соответствовать формату');
    const setting=await env.DB.prepare('SELECT asset_count,asset_bytes FROM pf_settings WHERE id=1').first();
    if(setting.asset_count>=MAX_ASSETS || setting.asset_bytes+bytes.byteLength>MAX_ASSET_BYTES)return fail('Лимит: 100 файлов / 100 МБ');
    const id=[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
    await env.FILES.put('assets/'+id,bytes);
    try { await env.DB.batch([env.DB.prepare('INSERT INTO pf_assets(id,type,size,created) VALUES(?,?,?,?)').bind(id,type,bytes.byteLength,now()),env.DB.prepare('UPDATE pf_settings SET asset_count=asset_count+1,asset_bytes=asset_bytes+? WHERE id=1').bind(bytes.byteLength)]); }
    catch(error){await env.FILES.delete('assets/'+id);throw error}
    return json({storageId:id,url:assetUrl(id)});
  }
  if (op === 'save') {
    const input=await readJson(request), current=await env.DB.prepare('SELECT version,json FROM pf_content WHERE id=1').first();
    if(!Number.isInteger(input.version) || input.version!==(current?.version??0))return fail('Версия изменилась в другой вкладке. Перезагрузите страницу.',409);
    let content;try{content=await validateContent(env,input.content)}catch(error){return fail(error.message)}
    const previous=current?JSON.parse(current.json):{}, changed=Object.keys(content).filter(key=>JSON.stringify(content[key])!==JSON.stringify(previous[key]));
    const next=input.version+1, encoded=JSON.stringify(content), statements=[];
    if(current)statements.push(env.DB.prepare('INSERT OR IGNORE INTO pf_history(event,created,version,json) VALUES(?,?,?,?)').bind('Версия до включения истории',now(),current.version,current.json));
    statements.push(env.DB.prepare('INSERT INTO pf_content(id,version,json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json WHERE pf_content.version=?').bind(next,encoded,input.version));
    statements.push(env.DB.prepare('INSERT INTO pf_history(event,created,version,json) SELECT ?,?,?,? WHERE (SELECT version FROM pf_content WHERE id=1)=?').bind('Публикация: '+changed.join(', '),now(),next,encoded,next));
    const results=await env.DB.batch(statements); if(!results.at(-2)?.meta?.changes && current)return fail('Версия изменилась в другой вкладке. Перезагрузите страницу.',409);
    return json({version:next});
  }
  if (op === 'backup') {
    const setting=await env.DB.prepare('SELECT asset_bytes FROM pf_settings WHERE id=1').first(); if(setting.asset_bytes>32*1024*1024)return fail('Резервная копия больше 32 МБ. Скачайте крупные файлы отдельно.');
    const content=await env.DB.prepare('SELECT version,json FROM pf_content WHERE id=1').first(), metas=(await env.DB.prepare('SELECT id,type FROM pf_assets ORDER BY created').all()).results;
    // Keep the full backup within the Workers Free subrequest budget.
    if(metas.length>40)return fail('В полной копии может быть до 40 файлов. Скачайте остальные файлы отдельно.');
    const assets=[];
    for(const meta of metas){
      const bytes=await env.FILES.get('assets/'+meta.id,'arrayBuffer');
      if(!bytes)return fail('Не все файлы доступны. Подождите минуту и повторите создание полной копии.',503,{'Retry-After':'60'});
      assets.push({id:meta.id,type:meta.type,bytes:bytesToBase64(bytes)});
    }
    const history=(await env.DB.prepare('SELECT event,created,version,json FROM pf_history ORDER BY id').all()).results.map(({json:body,...row})=>({...row,content:body?JSON.parse(body):null}));
    const backup={format:'lazysoft-portfolio-backup-v1',createdAt:new Date().toISOString(),version:content?.version??0,content:content?JSON.parse(content.json):null,assets,history};
    return json(backup,200,{'Content-Disposition':'attachment; filename="portfolio-backup-'+new Date().toISOString().slice(0,10)+'.json"'});
  }
  return fail('Неизвестное действие');
}

export default {
  async fetch(request, env) {
    try {
      const url=new URL(request.url);
      if(url.pathname==='/api/portfolio')return await api(request,env);
      if(url.pathname.startsWith('/api/portfolio/assets/'))return await serveAsset(env,request,decodeURIComponent(url.pathname.slice('/api/portfolio/assets/'.length)));
      return env.ASSETS.fetch(request);
    } catch(error) {
      console.error(error?.stack || error);
      return fail(error?.status ? error.message : 'Сервис временно недоступен.', error?.status || 503);
    }
  }
};

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';

function main(){
  const root=resolve(import.meta.dirname);
  const settings=JSON.parse(readFileSync(join(root,'install-settings.json'),'utf8'));
  const npx=process.platform==='win32'?'npx.cmd':'npx';
  const stateFile=join(root,'installation-state.json');
  let state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{};
  let accountId, commandConfig;
  const save=()=>writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');
  const run=(args,options={})=>{
    console.log('\n> npx wrangler '+args.join(' '));
    try{
      return execFileSync(npx,['wrangler',...args,...(commandConfig?['--config',commandConfig]:[])],{
        cwd:root,encoding:'utf8',stdio:options.capture?['inherit','pipe','inherit']:'inherit',
        env:{...process.env,...(accountId?{CLOUDFLARE_ACCOUNT_ID:accountId}:{})},
      });
    }catch{
      throw Error('Команда «wrangler '+args.join(' ')+'» не выполнена. Подробности Cloudflare показаны выше.');
    }
  };
  const readIdentity=()=>{
    try{return JSON.parse(run(['whoami','--json'],{capture:true}))}catch{return null}
  };
  console.log('Установка сайта: Cloudflare Workers Free + D1 + KV. Подключать R2 и Workers Paid не нужно.');
  let identity=readIdentity();
  if(!identity?.loggedIn){
    console.log('\nВход по одноразовому коду. Оставьте это окно открытым.');
    console.log('Откройте ссылку Wrangler, проверьте код и нужный аккаунт, затем разрешите доступ. Возврат на localhost не нужен.');
    try{run(['login','--device'])}catch{
      throw Error('Вход в Cloudflare не завершён. Запустите установщик повторно и подтвердите новый код до истечения указанного срока. Старую вкладку localhost закройте.');
    }
    identity=readIdentity();
    if(!identity?.loggedIn)throw Error('Вход в Cloudflare не подтверждён. Проверьте npx wrangler whoami и повторите установку.');
  }
  const accounts=identity.accounts||[];
  const selected=process.env.CLOUDFLARE_ACCOUNT_ID;
  const account=selected?accounts.find(item=>item.id===selected):(accounts.length===1?accounts[0]:null);
  if(!account)throw Error('Доступно несколько аккаунтов или указанный аккаунт недоступен. Укажите ID нужного аккаунта в CLOUDFLARE_ACCOUNT_ID и повторите запуск.');
  accountId=account.id;
  console.log('Аккаунт установки: '+(account.name||accountId));

  // Use a minimal config while provisioning, avoiding stale R2/account bindings.
  commandConfig=join(root,'.install-command.json');
  writeFileSync(commandConfig,JSON.stringify({name:settings.workerName,account_id:accountId}));
  try{
    const databases=JSON.parse(run(['d1','list','--json'],{capture:true}));
    const oldDatabase=databases.find(db=>db.uuid===state.databaseId);
    if((state.accountId&&state.accountId!==accountId)||(state.databaseId&&!state.accountId&&!oldDatabase)){
      const backup=stateFile+'.previous-'+Date.now();
      renameSync(stateFile,backup);
      console.log('Сохранён прогресс другого аккаунта: '+backup+'. Для выбранного аккаунта будет отдельная установка.');
      state={};
    }
    state.accountId=accountId;
    if(!state.databaseId){
      const existing=databases.find(db=>db.name===settings.databaseName);
      if(existing)state.databaseId=existing.uuid;
      else{
        const output=run(['d1','create',settings.databaseName,'--location','eeur','--update-config=false'],{capture:true});
        const match=output.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
        if(!match)throw Error('Идентификатор базы не распознан. Повторите запуск: база будет найдена по имени.');
        state.databaseId=match[0];
      }
      save();
    }else if(!databases.some(db=>db.uuid===state.databaseId)){
      throw Error('Сохранённая база не найдена в этом аккаунте. Проверьте аккаунт и сохранность базы перед продолжением.');
    }

    const namespaces=JSON.parse(run(['kv','namespace','list'],{capture:true}));
    if(!state.kvNamespaceId){
      const name=settings.kvNamespaceName||settings.workerName+'-files';
      const existing=namespaces.find(ns=>ns.title===name);
      if(existing)state.kvNamespaceId=existing.id;
      else{
        const output=run(['kv','namespace','create',name,'--update-config=false'],{capture:true});
        const match=output.match(/\b[0-9a-f]{32}\b/i);
        if(!match)throw Error('Идентификатор KV не распознан. Повторите запуск: хранилище будет найдено по имени.');
        state.kvNamespaceId=match[0];
      }
      state.kvUploadedAssetIds=[];
      state.kvAssetsUploaded=false;
      save();
    }else if(!namespaces.some(ns=>ns.id===state.kvNamespaceId)){
      throw Error('Сохранённое хранилище KV не найдено. Проверьте аккаунт и сохранность файлов.');
    }

    const config=JSON.parse(readFileSync(join(root,'wrangler.template.jsonc'),'utf8')
      .replaceAll('__WORKER_NAME__',settings.workerName)
      .replaceAll('__ACCOUNT_ID__',accountId)
      .replaceAll('__DATABASE_NAME__',settings.databaseName)
      .replaceAll('__DATABASE_ID__',state.databaseId)
      .replaceAll('__KV_NAMESPACE_ID__',state.kvNamespaceId));
    writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify(config,null,2)+'\n');
    commandConfig=join(root,'wrangler.jsonc');
    if(!state.databaseReady){
      run(['d1','execute',settings.databaseName,'--remote','--file=./schema.sql','--yes']);
      const rows=JSON.parse(run(['d1','execute',settings.databaseName,'--remote','--command=SELECT id FROM pf_settings WHERE id=1','--json'],{capture:true}));
      if(!rows[0]?.results?.length)run(['d1','execute',settings.databaseName,'--remote','--file=./seed/seed.sql','--yes']);
      state.databaseReady=true;save();
    }

    if(!state.kvAssetsUploaded){
      const manifest=JSON.parse(readFileSync(join(root,'seed/assets.json'),'utf8'));
      // A previously published R2 site may contain newer uploads than the ZIP.
      // Never switch it to KV while silently dropping these files.
      const result=JSON.parse(run(['d1','execute',settings.databaseName,'--remote','--command=SELECT id,size FROM pf_assets','--json'],{capture:true}));
      const metas=result[0]?.results;
      if(!Array.isArray(metas))throw Error('Не удалось проверить список файлов в базе. Публикация остановлена.');
      const files=metas.map(meta=>{
        const asset=manifest.find(item=>item.id===meta.id);
        if(!asset||!/^[A-Za-z0-9_-]{1,80}$/.test(meta.id)||!existsSync(join(root,'seed/assets',meta.id)))throw Error('В базе есть файлы, которых нет в архиве. Нужен актуальный комплект с файлами сайта; публикация остановлена, прежние ресурсы сохранены.');
        if(readFileSync(join(root,'seed/assets',meta.id)).byteLength!==meta.size)throw Error('Размер файла '+meta.id+' не совпадает с базой. Нужен актуальный комплект файлов.');
        return asset;
      });
      const uploaded=new Set(state.kvUploadedAssetIds||[]);
      for(const asset of files){
        if(uploaded.has(asset.id))continue;
        run(['kv','key','put','assets/'+asset.id,'--namespace-id='+state.kvNamespaceId,'--remote','--path='+join(root,'seed/assets',asset.id)]);
        uploaded.add(asset.id);state.kvUploadedAssetIds=[...uploaded];save();
      }
      state.kvAssetsUploaded=true;save();
    }
    run(['deploy']);
    state.storage='kv';state.deployedAt=new Date().toISOString();save();
    console.log('\nГОТОВО. Адрес сайта указан строкой workers.dev выше.');
    console.log('Админка: тот же адрес + /admin.html. Ключ: INSTALL-KEY.txt.');
    console.log('Новые файлы могут распространяться около минуты или дольше. Если изображение ещё не видно, обновите страницу позже.');
  }finally{rmSync(join(root,'.install-command.json'),{force:true})}
}

try{main()}catch(error){
  console.error('\nУстановка остановлена: '+error.message);
  console.error('Исправьте причину и запустите установщик повторно. Сохранённый прогресс будет использован.');
  process.exitCode=1;
}

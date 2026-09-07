'use strict';
const API='https://fearless-gnu-184.eu-west-1.convex.site/portfolio-03212396';
let key='',expiresAt=0,version=0,works=[],dirty=false,busy=false,nextKey='';
const $=s=>document.querySelector(s),status=$('#status'),editor=$('#editor');
const say=t=>{status.textContent=t};
async function api(op,body){const r=await fetch(API+'?op='+op,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body??{})});const data=await r.json();if(!r.ok){if(r.status===401)expire();throw Error(data.error)}return data}
function node(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;return n}
function control(parent,label,tag,value,onChange){const l=node('label',label),i=node(tag);i.value=value??'';l.append(i);parent.append(l);i.addEventListener('input',()=>{onChange(i.value);dirty=true});return i}
function render(){
 $('#works').replaceChildren();
 works.forEach((w,index)=>{
  const box=node('article');box.className='work-editor';box.append(node('h3','Работа '+(index+1)));
  const title=control(box,'Название','input',w.title,v=>w.title=v);title.required=true;title.maxLength=150;
  const category=control(box,'Категория','select','',v=>w.category=v);
  for(const [value,label] of Object.entries({covers:'Обложки журналов',spreads:'Развороты журналов',magazines:'Полноценные журналы',logos:'Логотипы'})){const o=node('option',label);o.value=value;category.append(o)}category.value=w.category;
  control(box,'Описание','textarea',w.description,v=>w.description=v).maxLength=2000;
  if(w.imageUrl){const img=node('img');img.src=w.imageUrl;img.alt=w.title;box.append(img)}
  for(const [field,label,accept] of [['image','Изображение работы','image/jpeg,image/png,image/webp'],['document','PDF журнала (необязательно)','application/pdf']]){
   const input=control(box,label,'input','',()=>{});input.type='file';input.accept=accept;
   if(w[field])box.append(node('small',field==='image'?'Изображение загружено':'PDF загружен'));
   input.addEventListener('change',async()=>{const file=input.files[0];if(!file)return;
    if(file.size>8*1024*1024){say('Файл больше 8 МБ');input.value='';return}
    busy=true;$('#fields').disabled=true;say('Загружаю файл…');
    try{const r=await fetch(API+'?op=upload',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':file.type},body:file});const d=await r.json();if(!r.ok){if(r.status===401)expire();throw Error(d.error)}w[field]=d.storageId;w[field+'Url']=d.url;dirty=true;say('Файл загружен. Нажмите «Опубликовать изменения».');render()}catch(e){say(e.message)}finally{busy=false;$('#fields').disabled=false}
   });
  }
  const actions=node('div');actions.className='work-actions';
  for(const [label,fn] of [['↑ Выше',()=>{if(index){[works[index-1],works[index]]=[works[index],works[index-1]]}}],['↓ Ниже',()=>{if(index<works.length-1){[works[index+1],works[index]]=[works[index],works[index+1]]}}],['Удалить работу',()=>{if(confirm('Убрать работу из портфолио? Изменение применится после публикации.'))works.splice(index,1)}]]){const b=node('button',label);b.type='button';b.className='button';b.onclick=()=>{fn();dirty=true;render()};actions.append(b)}
  if(w.document){const b=node('button','Убрать PDF');b.type='button';b.onclick=()=>{delete w.document;delete w.documentUrl;dirty=true;render()};actions.append(b)}
  box.append(actions);$('#works').append(box);
 });
}
function fill(c){for(const field of ['name','headline','about','email','telegram','prices'])editor.elements[field].value=c[field]}
function expire(){key='';expiresAt=0;$('#login').hidden=false;$('#session-status').textContent='Требуется повторный вход';say('Сессия истекла или отозвана. Несохранённые поля оставлены в форме. Войдите снова.')}
setInterval(()=>{if(!expiresAt)return;const seconds=Math.ceil((expiresAt-Date.now())/1000);if(seconds<=0)return expire();$('#session-status').textContent='Сессия: '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' до повторного входа'},1000);
$('#login').onsubmit=async e=>{e.preventDefault();const resume=dirty;key=$('#key').value.trim();say('Проверяю доступ…');try{const session=await api('login');key=session.token;expiresAt=session.expiresAt;$('#key').value='';if(!resume){const r=await fetch(API);if(!r.ok)throw Error('Не удалось загрузить данные');const d=await r.json();version=d?.version??0;works=d?.works??[];fill(d?.content??{name:'Форма',headline:'Идеи обретают форму.',about:'Журнальный дизайн и логотипы.',email:'',telegram:'',prices:''});render()}$('#login').hidden=true;editor.hidden=false;say(resume?'Вход выполнен. Несохранённые изменения сохранены в форме.':'Вход выполнен на 15 минут.')}catch(e){key='';expiresAt=0;say(e.message)}};

$('#add').onclick=()=>{if(works.length>=40)return say('Максимум 40 работ');works.push({id:crypto.randomUUID(),category:'covers',title:'',description:''});dirty=true;render()};
editor.addEventListener('input',()=>dirty=true);
editor.onsubmit=async e=>{e.preventDefault();if(works.some(w=>!w.image))return say('Загрузите изображение для каждой работы.');busy=true;$('#fields').disabled=true;say('Публикую…');try{const content={};for(const field of ['name','headline','about','email','telegram','prices'])content[field]=editor.elements[field].value.trim();content.works=works.map(({id,category,title,description,image,document})=>({id,category,title,description,image,...(document?{document}:{})}));const d=await api('save',{content,version});version=d.version;dirty=false;say('Опубликовано. Изменения видны на сайте после обновления страницы.')}catch(e){say(e.message)}finally{busy=false;$('#fields').disabled=false}};
async function revoke(op){if(dirty&&!confirm('Несохранённые изменения останутся в форме. Завершить все сессии?'))return;try{await api(op);expire();say('Все сессии завершены. Ключ входа остаётся действующим.')}catch(e){say(e.message)}}
$('#logout').onclick=()=>revoke('logout');
$('#revoke').onclick=()=>revoke('revoke');
$('#rotate').onclick=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));nextKey=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');$('#new-key').value=nextKey;$('#rotation').hidden=false};
$('#download-key').onclick=()=>{const url=URL.createObjectURL(new Blob([nextKey+'\n'],{type:'text/plain'}));const a=node('a');a.href=url;a.download='portfolio-admin-key.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('#apply-key').onclick=async()=>{if(!nextKey||!confirm('Новый ключ сохранён? Старый ключ и все сессии перестанут работать.'))return;try{await api('rotate',{newKey:nextKey});expire();say('Новый ключ применён. Используйте его для следующего входа.')}catch(e){say(e.message+' Если связь оборвалась, попробуйте войти новым сохранённым ключом.')}};
$('#hide-key').onclick=()=>{nextKey='';$('#new-key').value='';$('#rotation').hidden=true};
$('#history-load').onclick=async()=>{try{const rows=await api('history');$('#history-list').replaceChildren();if(!rows.length)$('#history-list').append(node('p','История пока пуста'));for(const row of rows){const item=node('div',new Date(row.createdAt).toLocaleString('ru-RU')+' — '+row.event);item.className='history-row';if(row.version!==undefined){const b=node('button','Открыть версию '+row.version+' в форме');b.type='button';b.className='button';b.onclick=async()=>{if(dirty&&!confirm('Заменить несохранённые поля выбранной версией?'))return;try{const c=await api('revision',{version:row.version});if(!c)throw Error('Версия недоступна');fill(c);works=c.works;dirty=true;render();say('Версия загружена в форму. Для восстановления нажмите «Опубликовать изменения».')}catch(e){say(e.message)}};item.append(b)}$('#history-list').append(item)}}catch(e){say(e.message)}};

addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue=''}});

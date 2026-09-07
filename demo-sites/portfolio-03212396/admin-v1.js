'use strict';
const API='https://fearless-gnu-184.eu-west-1.convex.site/portfolio-03212396';
let key='',version=0,works=[],dirty=false,busy=false;
const $=s=>document.querySelector(s),status=$('#status'),editor=$('#editor');
const say=t=>{status.textContent=t};
async function api(op,body){const r=await fetch(API+'?op='+op,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body??{})});const data=await r.json();if(!r.ok)throw Error(data.error);return data}
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
    try{const r=await fetch(API+'?op=upload',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':file.type},body:file});const d=await r.json();if(!r.ok)throw Error(d.error);w[field]=d.storageId;w[field+'Url']=d.url;dirty=true;say('Файл загружен. Нажмите «Опубликовать изменения».');render()}catch(e){say(e.message)}finally{busy=false;$('#fields').disabled=false}
   });
  }
  const actions=node('div');actions.className='work-actions';
  for(const [label,fn] of [['↑ Выше',()=>{if(index){[works[index-1],works[index]]=[works[index],works[index-1]]}}],['↓ Ниже',()=>{if(index<works.length-1){[works[index+1],works[index]]=[works[index],works[index+1]]}}],['Удалить работу',()=>{if(confirm('Убрать работу из портфолио? Изменение применится после публикации.'))works.splice(index,1)}]]){const b=node('button',label);b.type='button';b.className='button';b.onclick=()=>{fn();dirty=true;render()};actions.append(b)}
  if(w.document){const b=node('button','Убрать PDF');b.type='button';b.onclick=()=>{delete w.document;delete w.documentUrl;dirty=true;render()};actions.append(b)}
  box.append(actions);$('#works').append(box);
 });
}
$('#login').onsubmit=async e=>{e.preventDefault();key=$('#key').value.trim();say('Проверяю доступ…');try{await api('login');const r=await fetch(API);if(!r.ok)throw Error('Не удалось загрузить данные');const d=await r.json();version=d?.version??0;works=d?.works??[];const c=d?.content??{name:'Форма',headline:'Идеи обретают форму.',about:'Журнальный дизайн и логотипы.',email:'',telegram:'',prices:''};for(const field of ['name','headline','about','email','telegram','prices'])editor.elements[field].value=c[field];$('#login').hidden=true;$('#key').value='';editor.hidden=false;render();say('Вы вошли. Сохранение публикует данные для всех посетителей.')}catch(e){key='';say(e.message)}};
$('#add').onclick=()=>{if(works.length>=40)return say('Максимум 40 работ');works.push({id:crypto.randomUUID(),category:'covers',title:'',description:''});dirty=true;render()};
editor.addEventListener('input',()=>dirty=true);
editor.onsubmit=async e=>{e.preventDefault();if(works.some(w=>!w.image))return say('Загрузите изображение для каждой работы.');busy=true;$('#fields').disabled=true;say('Публикую…');try{const content={};for(const field of ['name','headline','about','email','telegram','prices'])content[field]=editor.elements[field].value.trim();content.works=works.map(({id,category,title,description,image,document})=>({id,category,title,description,image,...(document?{document}:{})}));const d=await api('save',{content,version});version=d.version;dirty=false;say('Опубликовано. Изменения видны на сайте после обновления страницы.')}catch(e){say(e.message)}finally{busy=false;$('#fields').disabled=false}};
$('#logout').onclick=()=>{if(dirty&&!confirm('Выйти без публикации изменений?'))return;key='';works=[];dirty=false;editor.reset();editor.hidden=true;$('#login').hidden=false;say('Вы вышли')};
addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue=''}});

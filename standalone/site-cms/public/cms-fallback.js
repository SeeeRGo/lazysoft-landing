import {CMS} from './cms.js';

const trustedStyle=document.createElement('style');trustedStyle.textContent=':where(a,button,input,textarea,select):focus-visible{outline:3px solid currentColor;outline-offset:3px}:where(.hero,[class*="hero"],[id*="hero"]) img{min-height:80px;aspect-ratio:16/9;object-fit:cover}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}.lazysoft-cms-fallback-inner{box-sizing:border-box;width:min(100%,1200px);margin:0 auto;padding:clamp(32px,6vw,80px) 24px}.lazysoft-cms-fallback-inner h2{margin:0 0 24px;font:inherit;font-size:clamp(1.5rem,3vw,2.5rem)}.lazysoft-cms-fallback-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:24px}.lazysoft-cms-fallback-card{min-width:0}.lazysoft-cms-fallback-card img{display:block;width:100%;max-width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:inherit}.lazysoft-cms-fallback-card h3,.lazysoft-cms-fallback-card p{overflow-wrap:anywhere}@media(max-width:500px){.lazysoft-cms-fallback-inner{padding:32px 16px}.lazysoft-cms-fallback-grid{gap:16px}}';document.head.append(trustedStyle);
const keepImageGutters=()=>{const gutter=innerWidth<500?16:24;for(const image of document.images){if(image.closest('header,[class*="hero"],[id*="hero"]'))continue;const rect=image.getBoundingClientRect();if(rect.width>innerWidth*.72&&(rect.left<gutter-1||innerWidth-rect.right<gutter-1)){Object.assign(image.style,{display:'block',maxWidth:`calc(100vw - ${gutter*2}px)`,marginInline:'auto',boxSizing:'border-box'})}}};
new MutationObserver(()=>requestAnimationFrame(keepImageGutters)).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});addEventListener('resize',keepImageGutters);addEventListener('load',keepImageGutters,{capture:true});requestAnimationFrame(keepImageGutters);

const safeImage=value=>typeof value==='string'&&(
 /^data:image\/(?:png|jpeg|webp);base64,/i.test(value)||
 (/^(?:\.?\.?\/|\/)?[A-Za-z0-9][A-Za-z0-9_./?=&%-]*$/.test(value)&&!value.split(/[/?#]/).includes('..'))
);
const normalized=value=>{try{return new URL(value,location.href).href}catch{return value}};
const presentImage=value=>Array.from(document.images).some(image=>normalized(image.getAttribute('src')||'')===normalized(value));
const presentText=value=>typeof value==='string'&&value.trim().length>2&&document.body.innerText.includes(value.trim());
const fillEmptyImage=(value,label)=>{const image=Array.from(document.images).find(candidate=>!candidate.getAttribute('src'));if(!image)return false;image.src=value;if(!image.alt)image.alt=label||'Изображение';return true};
let root;
function gallery(){
 if(root)return root;
 root=document.createElement('section');root.dataset.lazysoftCmsFallback='';root.setAttribute('aria-label','Дополнительные материалы');
 root.innerHTML='<div class="lazysoft-cms-fallback-inner"><h2>Материалы</h2><div class="lazysoft-cms-fallback-grid"></div></div>';
 document.body.append(root);return root.querySelector('.lazysoft-cms-fallback-grid');
}
function card({title,text,image}){
 const article=document.createElement('article');article.className='lazysoft-cms-fallback-card';
 if(image){const img=document.createElement('img');img.src=image;img.alt=title||'Изображение';article.append(img)}
 if(title){const heading=document.createElement('h3');heading.textContent=title;article.append(heading)}
 if(text&&text!==title){const paragraph=document.createElement('p');paragraph.textContent=text;article.append(paragraph)}
 gallery().append(article);
}
try{
 const {schema,content}=await CMS.load();
 await new Promise(resolve=>setTimeout(resolve,1200));
 for(const field of schema.fields){
  const value=content.values[field.key];
  if(field.type==='image'&&safeImage(value)&&!presentImage(value)&&!fillEmptyImage(value,field.label))card({title:field.label,image:value});
 }
 for(const collection of schema.collections){
  for(const row of content.items[collection.key]){
   const texts=collection.fields.filter(field=>['text','textarea','number'].includes(field.type)).map(field=>String(row[field.key]??'')).filter(value=>value.trim());
   const images=collection.fields.filter(field=>field.type==='image').map(field=>row[field.key]).filter(safeImage);
   const missingText=texts.length>0&&!texts.some(presentText),missingImages=images.filter(image=>!presentImage(image));
   if(!missingText&&!missingImages.length)continue;
   if(missingImages.length){for(const image of missingImages)card({title:texts[0]||collection.label,text:texts.slice(1).join(' · '),image})}
   else card({title:texts[0]||collection.label,text:texts.slice(1).join(' · ')});
  }
 }
}catch{
 if(!/(ошиб|не удалось|error|failed|cannot load)/i.test(document.body.innerText)){
  const notice=document.createElement('p');notice.dataset.lazysoftCmsError='';notice.setAttribute('role','alert');notice.textContent='Не удалось загрузить содержимое сайта. Обновите страницу или попробуйте позже.';
  Object.assign(notice.style,{margin:'16px',padding:'16px',border:'1px solid currentColor',borderRadius:'8px'});document.body.prepend(notice);
 }
}

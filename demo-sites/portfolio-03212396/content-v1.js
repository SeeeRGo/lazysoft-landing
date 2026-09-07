'use strict';
(async()=>{
 const API='https://fearless-gnu-184.eu-west-1.convex.site/portfolio-03212396';
 const n=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el};
 try{
  const r=await fetch(API);if(!r.ok)throw Error('Content unavailable');const d=await r.json();if(!d)return;
  const c=d.content;
  document.querySelector('.brand').textContent=c.name;
  document.querySelector('.demo-notice').textContent='Портфолио · '+c.name;
  const headline=document.querySelector('.portfolio-intro h1');if(headline)headline.textContent=c.headline;
  const intro=document.querySelector('.portfolio-intro .intro');if(intro)intro.textContent=c.about;
  const prices=document.querySelector('.price-list');if(prices){prices.replaceChildren(n('p',c.prices||'Стоимость обсуждается индивидуально.'));prices.style.whiteSpace='pre-wrap'}
  const pricingNote=document.querySelector('.prices-layout .muted');if(pricingNote)pricingNote.textContent='Объём и сроки согласуются перед началом работы.';
  const contact=document.querySelector('.contact-card');contact.replaceChildren(n('span','СВЯЗАТЬСЯ С АВТОРОМ'));
  if(c.email){const a=n('a',c.email);a.href='mailto:'+c.email;a.className='button dark';contact.append(a)}
  if(c.telegram){const a=n('a','Telegram '+c.telegram);a.href='https://t.me/'+c.telegram.replace(/^@/,'');a.target='_blank';a.rel='noopener noreferrer';a.className='button dark';contact.append(a)}
  if(!c.email&&!c.telegram)contact.append(n('p','Контакты пока не добавлены.'));
  document.querySelector('.footer>span').textContent='© '+new Date().getFullYear()+' '+c.name;
  for(const card of document.querySelectorAll('.category-card')){const category=card.getAttribute('href').replace('.html','');const first=d.works.find(w=>w.category===category);if(first){const img=n('img');img.src=first.imageUrl;img.alt=first.title;img.loading='lazy';card.querySelector('.category-art').replaceChildren(img)}}
  const grid=document.querySelector('.gallery-grid');if(!grid)return;
  const category=location.pathname.split('/').pop().replace('.html','');const works=d.works.filter(w=>w.category===category);grid.replaceChildren();
  document.querySelector('.collection .work-note').textContent='Нажмите на работу, чтобы рассмотреть её крупнее.';
  if(!works.length)grid.append(n('p','Работы в этом разделе скоро появятся.'));
  works.forEach(w=>{
   const box=n('article'),button=n('button');button.className='gallery-work';button.type='button';button.setAttribute('aria-haspopup','dialog');
   const art=n('span');art.className='category-art';const img=n('img');img.src=w.imageUrl;img.alt=w.title;img.loading='lazy';art.append(img);const title=n('span',w.title);title.className='category-label';button.append(art,title);box.append(button,n('p',w.description));
   if(w.documentUrl){const a=n('a','Открыть журнал (PDF) ↗');a.href=w.documentUrl;a.target='_blank';a.rel='noopener noreferrer';box.append(a)}
   button.onclick=()=>{const dialog=document.querySelector('#gallery-dialog');document.querySelector('#gallery-title').textContent=w.title;const large=img.cloneNode();large.loading='eager';document.querySelector('#gallery-art').replaceChildren(large);dialog.querySelector(':scope > p').textContent=w.description;dialog.showModal();document.body.classList.add('modal-open');dialog.addEventListener('close',()=>button.focus(),{once:true})};grid.append(box);
  });
 }catch{const notice=document.querySelector('.demo-notice');notice.textContent='Не удалось загрузить актуальные работы. Обновите страницу позже. Ниже — демонстрационный макет.'}
})();

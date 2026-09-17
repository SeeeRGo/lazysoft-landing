const photos = {
  "drill": {
    "alt": "Аккумуляторная дрель-шуруповёрт",
    "width": 960,
    "height": 1280
  },
  "saw": {
    "alt": "Дисковая пила",
    "width": 960,
    "height": 640
  },
  "grinder": {
    "alt": "Угловая шлифмашина",
    "width": 960,
    "height": 576
  },
  "hammer": {
    "alt": "Молоток-гвоздодёр",
    "width": 960,
    "height": 435
  },
  "kit": {
    "alt": "Набор торцевых головок и трещоток",
    "width": 960,
    "height": 1008
  },
  "bits": {
    "alt": "Свёрла по бетону",
    "width": 960,
    "height": 600
  }
};
const photo = (type, hero = false) => {
 const p = photos[type];
 return `<img class="tool-photo tool-photo-${type}" src="images/${type}.jpg" alt="${p.alt}" width="${p.width}" height="${p.height}" ${hero ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"'} decoding="async">`;
};
const products = [
 {id:'d20',name:'Дрель-шуруповёрт D20',category:'power',price:6490,spec:'20 В · 45 Н·м · 2 аккумулятора',type:'drill',tag:'ВЫБОР ДЛЯ ДОМА',description:'Аккумуляторная дрель для сборки мебели, сверления и повседневного ремонта. В демонстрационной комплектации: два аккумулятора, зарядное устройство и кейс.'},
 {id:'s165',name:'Дисковая пила S165',category:'power',price:8990,spec:'1 200 Вт · диск 165 мм',type:'saw',tag:'ДЛЯ МАСТЕРСКОЙ',description:'Пример дисковой пилы для прямого распила древесины. Регулируемые глубина и угол реза, удобная дополнительная рукоятка.'},
 {id:'g125',name:'Угловая шлифмашина G125',category:'power',price:4290,spec:'900 Вт · диск 125 мм',type:'grinder',tag:'УНИВЕРСАЛЬНЫЙ',description:'Компактная шлифмашина для задач в мастерской. В примере предусмотрены боковая рукоятка и защитный кожух. Оснастка подбирается под материал.'},
 {id:'h500',name:'Молоток H500',category:'hand',price:890,spec:'500 г · удобная рукоятка',type:'hammer',tag:'БАЗОВЫЙ НАБОР',description:'Классический молоток с удобной рукояткой и стальной рабочей частью. Пример ручного инструмента для домашнего набора.'},
 {id:'k46',name:'Набор инструментов K46',category:'hand',price:3490,spec:'46 предметов · кейс',type:'kit',tag:'ВСЁ ПОД РУКОЙ',description:'Демонстрационный набор торцевых головок, бит и трещотки. Каждый предмет лежит на своём месте в компактном кейсе.'},
 {id:'b32',name:'Набор бит и свёрл B32',category:'accessories',price:1290,spec:'32 предмета · универсальный',type:'bits',tag:'ОСНАСТКА',description:'Набор оснастки для небольших домашних задач. Пример карточки аксессуара: здесь продавец укажет размеры и совместимость.'}
];
const money = value => new Intl.NumberFormat('ru-RU').format(value)+' ₽';
const cart = new Map();
let category='all', search='', sort='default', toastTimer;
document.querySelector('#hero-tool').innerHTML=photo('drill', true);
function renderProducts(){
 let filtered=products.filter(p=>(category==='all'||p.category===category)&&`${p.name} ${p.spec}`.toLocaleLowerCase('ru').includes(search));
 if(sort!=='default')filtered.sort((a,b)=>sort==='asc'?a.price-b.price:b.price-a.price);
 document.querySelector('#products').innerHTML=filtered.map(p=>`<article class="product"><button class="product-open" data-product="${p.id}" aria-haspopup="dialog"><span class="product-art"><span class="product-tag">${p.tag}</span>${photo(p.type)}</span><h3>${p.name}</h3><p class="product-spec">${p.spec}</p></button><div class="product-bottom"><strong>${money(p.price)}</strong><button class="add" data-add="${p.id}" aria-label="Добавить ${p.name} в корзину">+</button></div></article>`).join('');
 document.querySelector('#empty').hidden=filtered.length>0;
 document.querySelector('#result-count').textContent=`Найдено: ${filtered.length} из ${products.length}`;
}
function announce(message){const toast=document.querySelector('#toast');toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),2200)}
function renderCart(){
 const count=[...cart.values()].reduce((sum,n)=>sum+n,0);
 document.querySelector('#cart-count').textContent=count;
 document.querySelector('#checkout-status').textContent='';
 document.querySelector('#cart-items').innerHTML=cart.size?[...cart].map(([id,n])=>{const p=products.find(p=>p.id===id);return `<div class="cart-row"><div><strong>${p.name}</strong><small>${money(p.price)} / шт.</small></div><div class="quantity"><button data-change="${id}" data-delta="-1" aria-label="Уменьшить количество ${p.name}">−</button><span aria-label="Количество">${n}</span><button data-change="${id}" data-delta="1" aria-label="Увеличить количество ${p.name}">+</button></div><button class="remove" data-remove="${id}" aria-label="Удалить ${p.name}">Удалить</button></div>`}).join(''):'<p>Пока пусто. Выберите инструмент в каталоге.</p>';
 const total=[...cart].reduce((sum,[id,n])=>sum+products.find(p=>p.id===id).price*n,0);
 document.querySelector('#cart-summary').innerHTML=cart.size?`<div class="cart-total"><span>Итого</span><strong>${money(total)}</strong></div><button class="primary" id="checkout">Попробовать оформление ↗</button>`:'';
}
document.addEventListener('click',event=>{
 const add=event.target.closest('[data-add]');if(add){const id=add.dataset.add;cart.set(id,Math.min(99,(cart.get(id)||0)+1));renderCart();announce('Инструмент добавлен в корзину');return}
 const open=event.target.closest('[data-product]');if(open){const p=products.find(p=>p.id===open.dataset.product);document.querySelector('#product-detail').innerHTML=`<div class="product-art">${photo(p.type)}</div><p class="eyebrow">${p.tag}</p><h2 id="product-title">${p.name}</h2><p>${p.spec}</p><p>${p.description}</p><strong>${money(p.price)}</strong><br><button class="primary" data-add="${p.id}">Добавить в корзину +</button><p class="demo-note">Демонстрационный товар. Название, характеристики и цена вымышлены; фотография показывает тип инструмента.</p>`;document.querySelector('#product-dialog').showModal();return}
 const change=event.target.closest('[data-change]');if(change){const n=(cart.get(change.dataset.change)||0)+Number(change.dataset.delta);if(n<=0)cart.delete(change.dataset.change);else cart.set(change.dataset.change,Math.min(n,99));renderCart()}
 const remove=event.target.closest('[data-remove]');if(remove){cart.delete(remove.dataset.remove);renderCart()}
 if(event.target.closest('#checkout'))document.querySelector('#checkout-status').textContent='Так выглядел бы следующий шаг оформления. Это демо: заказ не создан, данные не отправлены, списаний нет.';
});
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderProducts()}));
document.querySelector('#search').addEventListener('input',event=>{search=event.target.value.trim().toLocaleLowerCase('ru');renderProducts()});
document.querySelector('#sort').addEventListener('change',event=>{sort=event.target.value;renderProducts()});
document.querySelector('#reset').addEventListener('click',()=>{document.querySelector('#search').value='';search='';document.querySelector('[data-category=all]').click()});
document.querySelector('#open-cart').addEventListener('click',()=>{renderCart();document.querySelector('#cart-dialog').showModal()});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))dialog.close()}));
renderProducts();renderCart();

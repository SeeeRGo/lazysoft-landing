'use strict';
const dialog=document.querySelector('#gallery-dialog');
let opener;
document.querySelectorAll('.gallery-work').forEach(button=>button.addEventListener('click',()=>{
 opener=button;
 document.querySelector('#gallery-title').textContent=button.dataset.title;
 document.querySelector('#gallery-art').replaceChildren(button.querySelector('.category-art').cloneNode(true));
 dialog.showModal();document.body.classList.add('modal-open');
}));
document.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))dialog.close()});
dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');opener?.focus()});
document.querySelector('#copy-contact')?.addEventListener('click',async()=>{
 const status=document.querySelector('#copy-status');
 try{await navigator.clipboard.writeText('hello@forma.example');status.textContent='Пример скопирован. Адрес не принимает письма.'}
 catch{status.textContent='Выделите адрес и скопируйте вручную.'}
});

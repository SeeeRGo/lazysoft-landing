import {elapsedLabel,updateWaitingMessage} from "./waiting-messages";
export interface WorkProgress {stage:"queued"|"designing"|"checking"|"publishing"|"ready"|"failed";queuedAt:number;startedAt?:number;heartbeatAt?:number;serverTime:number;}
const panel=document.querySelector<HTMLElement>("[data-work-progress]");
let progress:WorkProgress|undefined, checkedAt=0, offset=0, failedConnection=false;
const text=(selector:string,value:string)=>{const node=panel?.querySelector<HTMLElement>(selector);if(node)node.textContent=value};
function tick(){
 if(!panel||panel.hidden||!progress)return;
 const start=(progress.startedAt??progress.queuedAt)+offset;
 text("[data-work-elapsed]",elapsedLabel(start));updateWaitingMessage(panel.querySelector("[data-work-joke]"),progress.queuedAt+offset);
 const stale=progress.stage!=="queued"&&progress.heartbeatAt&&Date.now()-(progress.heartbeatAt+offset)>120_000;
 text("[data-work-connection]",failedConnection?"Связь временно прервалась. Повторяем проверку…":stale?"Давно нет сигнала от генератора. Проверяем статус…":`Статус проверен ${new Date(checkedAt).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`);
 const node=panel.querySelector("[data-work-connection]");node?.classList.toggle("wait-connection-warning",!!(failedConnection||stale));
 text("[data-progress-note]",Date.now()-start>15*60_000?"Подготовка занимает больше обычного. Заявка сохранена; новые статусы появятся здесь. Если нужна помощь, напишите разработчику ниже.":progress.stage==="queued"?"Заявка в очереди. После запуска создание сайта обычно занимает до 15 минут.":"Обычно создание версии занимает до 15 минут. Это ориентир, а не обратный отсчёт до гарантированной готовности.");
}
export function showProgress(value:WorkProgress|undefined){
 if(!panel)return;failedConnection=false;checkedAt=Date.now();progress=value;
 panel.hidden=!value||["ready","failed"].includes(value.stage);if(panel.hidden||!value)return;
 offset=Date.now()-value.serverTime;
 const titles={queued:"Идея сохранена. Скоро начнём",designing:"Создаём ваш сайт",checking:"Проверяем готовую версию",publishing:"Публикуем демо",ready:"Сайт готов",failed:"Нужна проверка"};
 text("[data-work-title]",value.stage==="queued"&&value.startedAt?"Ожидаем повторного запуска":titles[value.stage]);
 text("[data-work-kicker]",value.stage==="queued"?"ВАША ИДЕЯ СОХРАНЕНА":"ВАША ИДЕЯ УЖЕ В РАБОТЕ");
 const steps=["queued","designing","checking","publishing"];const current=steps.indexOf(value.stage);
 panel.querySelectorAll<HTMLElement>("[data-work-step]").forEach((el,i)=>{el.dataset.state=i<current?"done":i===current?"current":"next";if(i===current)el.setAttribute("aria-current","step");else el.removeAttribute("aria-current")});tick();
}
export function progressConnectionFailed(){failedConnection=true;tick()}
const timer=window.setInterval(()=>{if(!document.hidden)tick()},1000);
window.addEventListener("pagehide",()=>clearInterval(timer));

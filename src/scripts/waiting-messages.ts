export const waitingMessages = [
  "Пиксели заняли места. Один опоздал, но мы его дождались.",
  "У хорошего сайта, как у чая, есть время заваривания.",
  "В вашей идее уже больше будущего сайта, чем кажется.",
  "Черепаха Lazysoft за скорость не хвастается. За результат — постарается.",
  "Кнопка «Сделать красиво» мечтает о таком внимании к деталям.",
  "Если бы у отступов был профсоюз, он бы одобрил эту паузу.",
  "Ваш будущий сайт пока стесняется. Скоро познакомимся.",
  "Можно потянуться. Спина тоже участвует в этом проекте.",
  "Один маленький сайт для интернета. Большой шаг для вашей идеи.",
  "Место для вашей гениальной идеи уже забронировано.",
  "Дизайн любит воздух. Вы тоже можете открыть окно.",
  "Пока сайт собирается, придумайте, кому покажете его первым.",
];
export function updateWaitingMessage(node: HTMLElement | null, since: number) {
  if (!node) return;
  const text = waitingMessages[Math.floor(Math.max(0, Date.now() - since) / 12_000) % waitingMessages.length];
  if (node.textContent !== text) node.textContent = text;
}
export function elapsedLabel(since: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

# Production-автоматизация заявок MVP

Сайт и API: `https://lazysoft.ru`, Яндекс Serverless Containers.
Backend: `https://fearless-gnu-184.eu-west-1.convex.site`.
Генератор работает на этом компьютере с сохранённой ChatGPT-авторизацией.
CRM и мобильные заявки сохраняются как раньше, автоматически обрабатываются
только новые заявки типа `mvp`. Старые заявки массово в очередь не переносятся.

## Изоляция

Профиль `automation/isolation.mjs` заменяет временное dev-исключение.
Docker допускает запуск вложенного bubblewrap (`seccomp=unconfined`,
`apparmor=unconfined`), но сохраняет непривилегированного пользователя,
`cap-drop=ALL`, `no-new-privileges`, read-only корень и лимиты 2 CPU / 2 GiB.
Внутренний именованный профиль Codex разрешает запись только в workspace,
output и tmp, запрещает чтение `/home/node/.codex` дочерними командами
и запрещает им сеть. Основной процесс Codex использует авторизацию и сеть
для обращения к модели. Облачные ключи и bot token в контейнер не передаются.

Проверка в реальном контейнере подтвердила: запись в workspace разрешена,
чтение авторизации, запись в `/usr/local` и исходящее соединение заблокированы.
Настройки ядра и изоляция других контейнеров не меняются.
Контейнер имеет собственный лимит 30 минут; worker обрабатывает SIGTERM/SIGINT.
Это слоистая защита, не гарантия безопасности произвольного вредоносного кода.
Основание: [OpenAI Docs](https://learn.chatgpt.com/docs/security) и
[официальная схема конфигурации](https://developers.openai.com/codex/config-schema.json).

## Секреты и запуск

Production-файл `.env.automation.production` имеет права 600 и исключён из git.
Dev-файл `.env.automation` остаётся отдельным. Не печатайте содержимое файлов.
Production service выбирает конфиг через `REQUEST_WORKER_ENV_FILE`.

```sh
REQUEST_WORKER_ENV_FILE=.env.automation.production npm run worker:local -- --check-config
systemctl --user status lazysoft-request-worker.timer
journalctl --user -u lazysoft-request-worker.service -n 30
```

Timer запускает worker через 5 минут после предыдущего завершения. `flock`
не допускает параллельного использования сохранённой авторизации. Не запускайте
другой Codex с каталогом `.local/request-worker/auth` одновременно с worker.
Компьютер должен быть включён, пользовательский systemd — доступен, интернет — работать.
GitHub-генератор остаётся выключенным; облачной круглосуточной генерации нет.

## Доставка

ТЗ и демо появляются на секретной странице заявки. Уведомление владельцу
приходит в Telegram. Для доставки клиенту в Telegram нужен запуск
`@lazysoft_mvp_idea_bot` кнопкой на странице заявки; одного username недостаточно.
Webhook направляется на production Convex с отдельным секретом.
Клиентам, оставившим email/MAX, результат пока передаётся владельцем вручную:
SMTP и MAX bot token не настроены. Страница заявки доступна независимо от канала.
ЮКасса выключена: кнопка исходников отправляет уведомление, оплата и передача
обсуждаются вручную. Оплата не выставляется автоматически.

## Остановка и откат

```sh
npx convex env set REQUEST_AUTOMATION_ENABLED false --prod
systemctl --user disable --now lazysoft-request-worker.timer
```

Эти действия останавливают новые задачи, но не отзывают уже готовые результаты.
Для прерывания текущей задачи: `systemctl --user stop lazysoft-request-worker.service`.
Код сайта откатывается повторным деплоем нужного коммита через workflow
`Deploy to Yandex Cloud`; данные Convex не удалять и dev поверх prod не импортировать.

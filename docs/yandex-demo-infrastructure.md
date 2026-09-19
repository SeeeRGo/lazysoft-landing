# Инфраструктура публикации демо — 7 сентября 2026

Создана через существующую авторизацию Yandex CLI. Рабочие ресурсы лендинга, другие бакеты и DNS не изменялись.

## Ресурсы

- Каталог: `b1gd8r24c2unlb3s6bcc`.
- Бакет: `lazysoft-request-demos-20260907`, STANDARD, лимит объёма 1 ГиБ.
- HTTPS origin: `https://lazysoft-request-demos-20260907.storage.yandexcloud.net`.
- Сервисный аккаунт: `lazysoft-demo-uploader` / `ajecsp78qsi44s7me9tv`.
- Роль `storage.uploader` назначена **только на бакет**, не на каталог/облако. Доступ на удаление объектов и управление бакетом не выдан. Policy — `deploy/demo-bucket-policy.json`; идентификаторы — `deploy/demo-resources.json`.
- Публичное HTTPS-чтение файлов разрешено политикой. Анонимный список объектов закрыт. В бакет нельзя помещать контакты клиентов, PDF, архивы, токены и другие секреты. Это публичные демо, не приватное файловое хранилище.
- Статический ключ сохранён только в `.env.automation` и резервном `.local/demo-access-key.json`, права 600. Оба пути исключены из git. Не копировать содержимое в чат/логи.

Объём ограничен, но это не лимит расходов на трафик. Хранение и запросы/трафик тарифицируются Яндексом. Отдельный домен/CDN/VM пока не создавались.

## Исполнитель

Convex немедленно передаёт job постоянно размещённому HTTPS executor. Executor выполняет генерацию, браузерную проверку, упаковку и публикацию. Сохранённая авторизация, CLI и фоновые процессы конкретного рабочего компьютера в production-цепочке не используются. Для ручной диагностики можно создать локальный `.env.automation`, но это не штатный способ запуска.

Production executor: Serverless Container `lazysoft-generation-executor`
(`bba36tbq8k96cghbhu2f`), образ в registry `crp9ahlalqaspg7tfd5v`, 2 vCPU,
2 ГиБ RAM, `concurrency=1`, timeout 3600 секунд. Асинхронный вызов настроен через
`lazysoft-runtime`; endpoint `/generate` дополнительно проверяет
`X-Lazysoft-Executor-Token`.

## Convex

В **dev** `notable-buffalo-804` автоматическая обработка выключена. В production
`fearless-gnu-184` заданы `REQUEST_GENERATION_EXECUTOR_URL`,
`AUTOMATION_WORKER_SECRET` и `REQUEST_AUTOMATION_ENABLED=true`. Ключи RouterAI и
Яндекс Object Storage находятся только в окружении hosted executor, не в Convex.

Существующие `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` перенесены из локального `.env` в dev Convex. Токен проверен запросом `getMe`. Сообщения не отправлялись; webhook и клиентские привязки не менялись.

## Проверено

- Страница `_system-check/index.html` загружена **новым ограниченным ключом**, а не пользовательским аккаунтом администратора.
- HTTPS GET страницы: 200, `Content-Type: text/html`, без принудительного скачивания.
- Анонимный запрос списка файлов: 403.
- `npm run worker:once -- --check-config`: проверяет наличие настроек при ручной диагностике; штатный запуск инициирует Convex.
- Async `/health` возвращает 202; `/generate` без executor-токена возвращает 401, с правильным токеном и пустым payload — 400.
- Реальная заявка `#1f029af4` точечно запущена после production deploy и перешла в `running`; heartbeat executor обновился.

Следующий этап: подтвердить terminal status и опубликованное демо заявки `#1f029af4`, затем проверить revision job тем же маршрутом.

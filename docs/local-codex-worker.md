# Локальный обработчик с авторизацией ChatGPT

Выбран запуск на этом компьютере, не GitHub Actions. API-ключ не нужен.

Обновление 7 сентября: production использует отдельный файл
`.env.automation.production` и постоянный профиль `automation/isolation.mjs`.
Актуальная эксплуатационная инструкция — [production-automation.md](production-automation.md).
Описание проверок и выключенного timer ниже относится к первоначальной dev-настройке.

## Авторизация

`node automation/setup-local-auth.mjs` однократно переносит сохранённый вход из `CODEX_HOME/auth.json` (по умолчанию пользовательский `.codex/auth.json`) в `.local/request-worker/auth/auth.json`. Существующую копию не перезаписывает. Права: каталог 700, файл 600. `.local/` и `.env.automation` исключены из git.

Контейнер получает только отдельный каталог авторизации, а не весь домашний каталог, историю Codex или секреты проекта. Каталог сохраняется между запусками с обновлёнными токенами. Режим `chatgpt` не передаёт API-ключ даже при его наличии в окружении. Генерируемый код не запускается на хосте; архив собирается только из разрешённых файлов проекта.

Авторизация доступна процессу Codex внутри контейнера — это чувствительный секрет, а не полная изоляция от самого агента. Запускайте только доверенную конфигурацию обработчика. Не отправляйте auth.json в GitHub, сообщения или клиентские артефакты. Не копируйте исходный файл заново при каждом запуске: можно затереть обновлённую сессию.

Если сессия отозвана или появляется ошибка обновления токена, выполните отдельный вход для обработчика:

```sh
CODEX_HOME=/home/cosysoft/projects/lazysoft-landing/.local/request-worker/auth codex login
```

Это также позволяет отделить вход обработчика от сессии, используемой для интерактивной разработки. При входе из keyring вместо файла первоначальный перенос потребует такого отдельного входа.

## Настройки и запуск

В `.env.automation` уже выбран `CODEX_AUTH_MODE=chatgpt`, указан абсолютный `CODEX_AUTH_DIR` и образ контейнера. Для имеющейся версии Docker используется `DOCKER_API_VERSION=1.44`.

Остальные настройки: `CONVEX_SITE_URL`, `AUTOMATION_WORKER_SECRET` (такой же в Convex), `REQUEST_DEMO_BUCKET`, `REQUEST_DEMO_ORIGIN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Также нужны Docker, AWS CLI и zip/unzip. Конфигурация доставки результата остаётся в Convex — см. request-automation.md.

```sh
# Не обращается к очереди, не вызывает модель, выводит только недостающие настройки:
npm run worker:local -- --check-config

# Одна заявка; выполнять только после настройки и проверки dev:
npm run worker:local
```

Локальный запуск использует `flock`: второй процесс пропускает выполнение. После аварийного завершения блокировка освобождается ОС. Для сохранённой авторизации используйте именно `worker:local`, а не прямой запуск worker.mjs. Не запускайте параллельно ручной Codex с тем же каталогом авторизации.

## Автозапуск — пока не включён

Подготовлены unit-файлы `automation/systemd/lazysoft-request-worker.service` и `.timer` для текущего компьютера. В них указан установленный Node 24; после обновления Node путь нужно проверить.

После сквозной проверки dev можно установить их как пользовательский timer:

```sh
systemctl --user link /home/cosysoft/projects/lazysoft-landing/automation/systemd/lazysoft-request-worker.service
systemctl --user link /home/cosysoft/projects/lazysoft-landing/automation/systemd/lazysoft-request-worker.timer
systemctl --user daemon-reload
systemctl --user enable --now lazysoft-request-worker.timer
```

Проверка: `systemctl --user status lazysoft-request-worker.timer`; журнал: `journalctl --user -u lazysoft-request-worker.service`.
Остановка новых запусков: `systemctl --user disable --now lazysoft-request-worker.timer`. Уже выполняющийся запуск и его Docker-контейнер требуют отдельной остановки.

Timer работает при запущенном пользовательском systemd и бодрствующем компьютере. Выход из аккаунта/сон/выключение могут остановить обработку; круглосуточную доступность не гарантирует. GitHub-исполнитель должен оставаться выключенным.

## Проверки

Проверено 7 сентября 2026: вход ChatGPT на хосте и внутри контейнера, выбор режима без API-ключа, права на секреты, тесты разделения авторизации и артефактов. Реальный `codex exec` в контейнере вернул ровно `CODEX_AUTH_OK` с кодом 0 без API-ключа и без клиентских данных. В образ добавлены системные TLS-сертификаты, проверка HTTPS не отключалась. Проходят 17 тестов, TypeScript и сборка сайта.

Проверка модели не обращалась к очереди и не публиковала демо. Автозапуск не установлен и не включён. Позже в тот же день созданы ресурсы Яндекса, установлен локальный AWS CLI и заполнены инфраструктурные настройки для dev Convex — см. [yandex-demo-infrastructure.md](yandex-demo-infrastructure.md). Полная обработка заявки ещё не проверена.

Основание: [официальная документация OpenAI — сохранённая авторизация в автоматизации](https://learn.chatgpt.com/docs/non-interactive-mode).

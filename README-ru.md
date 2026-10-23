<div align="center">

> [中文](README.md) | [🇷🇺 Русская версия](README-ru.md) | [English](README-en.md)

# 🚀 Qwen-Proxy

[![Version](https://img.shields.io/badge/version-26.10.19.00.34-blue.svg)](https://github.com/Rfym21/Qwen2API)
[![Bun](https://img.shields.io/badge/Bun-1.3.14+-green.svg)](https://bun.sh/)
[![Docker](https://img.shields.io/badge/Docker-supported-blue.svg)](https://hub.docker.com/r/rfym21/qwen2api)

[🔗 Присоединиться к чату](https://t.me/nodejs_project) | [📖 Документация](#api-документация) | [🐳 Развертывание Docker](#развертывание-docker)

</div>

## 🛠️ Быстрый старт

### Описание проекта

Qwen-Proxy — это прокси-сервис, преобразующий `https://chat.qwen.ai` и `Qwen Code / Qwen Cli` в API, совместимый с OpenAI. С помощью этого проекта вам нужен всего один аккаунт, чтобы использовать любой клиент с поддержкой OpenAI API (например, ChatGPT-Next-Web, LobeChat и др.) для вызова различных моделей `https://chat.qwen.ai` и `Qwen Code / Qwen Cli`. Модели в эндпоинте `/cli` предоставляются `Qwen Code / Qwen Cli`, поддерживают контекст 256K и нативный параметр tools.

**Основные возможности:**
- Совместимость с форматом OpenAI API, бесшовная интеграция с различными клиентами
- Совместимость с OpenAI Responses API (`/v1/responses`): потоковый и непотоковый режимы, рассуждения и вызов инструментов; работает с OpenAI SDK и Codex CLI
- Поддержка ротации нескольких аккаунтов для повышения доступности
- Поддержка потоковых/непотоковых ответов
- Поддержка мультимодальности (распознавание изображений, генерация изображений)
- Поддержка интеллектуального поиска, глубокого размышления и других продвинутых функций
- Поддержка CLI-эндпоинта с контекстом 256K и возможностью вызова инструментов
- Веб-интерфейс управления для удобной настройки и мониторинга
- Массовое добавление аккаунтов с отображением прогресса в реальном времени, параллельность входа настраивается в системных настройках

### ⚠️ Примечание о высокой нагрузке

> **Важно**: `chat.qwen.ai` ограничивает скорость запросов по IP. Известно, что это ограничение не связано с Cookie, а только с IP-адресом.

**Решения:**

Для высоконагруженного использования рекомендуется применять пул прокси для ротации IP:

| Вариант | Способ настройки | Описание |
|---------|------------------|----------|
| **Вариант 1** | `PROXY_URL` + [ProxyFlow](https://github.com/Rfym21/ProxyFlow) | Прямая настройка прокси-адреса, все запросы проходят через пул с ротацией IP |
| **Вариант 2** | `QWEN_CHAT_PROXY_URL` + [UrlProxy](https://github.com/Rfym21/UrlProxy) + [ProxyFlow](https://github.com/Rfym21/ProxyFlow) | Комбинация обратного прокси + пул прокси для более гибкой ротации IP |

**Примеры настройки:**

```bash
# Вариант 1: Прямое использование пула прокси
PROXY_URL=http://127.0.0.1:8282  # Адрес ProxyFlow

# Вариант 2: Обратный прокси + пул прокси
QWEN_CHAT_PROXY_URL=http://127.0.0.1:8000/qwen  # Адрес обратного прокси UrlProxy (UrlProxy настроен с HTTP_PROXY на ProxyFlow)
```

### 🚀 Пошаговое развёртывание и управление сервисом (исходники на Bun, рекомендуется)

Проект **ориентирован в первую очередь на Bun**: в репозитории только `bun.lock` (один в корне и один в `public/`), а `packageManager` и `engines` требуют `bun >= 1.3.14`. npm/pnpm разрешают зависимости на лету и расходятся с lock-файлом, поэтому **рекомендуется запуск из исходников на Bun** (это ещё и режим, в котором сессия браузера продлевается автоматически; в отдельном исполняемом файле нет скрипта сбора — см. «Отдельный исполняемый файл»).

Ниже шаги по порядку, каждый можно проверить отдельно.

#### 1. Установка Bun

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL                 # добавить ~/.bun/bin в PATH
bun --version               # требуется >= 1.3.14
```

#### 2. Получение кода

```bash
git clone https://github.com/Rfym21/Qwen2API.git
cd Qwen2API
```

#### 3. Установка зависимостей и сборка фронтенда

```bash
bun install --frozen-lockfile                  # зависимости сервера (на продакшн-машине можно добавить --production)
bun install --cwd public --frozen-lockfile     # зависимости фронтенда (vite лежит в devDependencies, не добавляйте --production)
bun run build:frontend                         # создаёт public/dist, сервер читает его с диска
```

#### 4. Настройка (`.env`)

```bash
cp .env.example .env
```

**Два параметра, которые нужно изменить обязательно:**

| Переменная | Рекомендуемое значение | Описание |
|---|---|---|
| `API_KEY` | `sk-your-api-key` | Администраторский ключ; если ключей несколько через запятую, первый — администратор. Он же используется для вызова API |
| `DATA_SAVE_MODE` | `file` | **Чтобы добавлять аккаунты в панели управления, обязательно задайте `file`.** Значение по умолчанию `none` — это «режим только переменных окружения»: изменения в панели не сохраняются на диск |

**Часто используемые необязательные параметры:**

| Переменная | Описание |
|---|---|
| `SERVICE_PORT` | Порт прослушивания, по умолчанию 3000 |
| `ACCOUNTS` | Аккаунты в режиме переменных окружения: `почта:пароль` через запятую, можно указать `почта:пароль\|http://прокси`; в режиме `file` оставьте пустым и добавляйте аккаунты в панели |
| `CHROME_PATH` | Путь к исполняемому файлу Chrome; если пусто — ищется автоматически `/usr/bin/chromium`, `google-chrome` по платформе |
| `PROXY_URL` | Глобальный исходящий прокси (прокси для отдельных аккаунтов задаются в панели) |

После правок проверьте результат командой `grep -E '^(API_KEY|DATA_SAVE_MODE|SERVICE_PORT)=' .env`.

> При `DATA_SAVE_MODE=none` панель всё равно открывается, но «Добавить аккаунт» сразу возвращает 400 и просит сначала переключиться на `file` (раньше сохранение тихо не срабатывало, оставляя только три непонятные строки в логе).

#### 5. Установка Chromium (нужна для продления сессии)

Access token `chat.qwen.ai` живёт всего 15 минут, а прокси обновляет его сам через headless-браузер. Если на сервере нет браузера, после истечения токена upstream начнёт отклонять запросы (в логах — `unauthorized`).

```bash
sudo apt install -y chromium        # Debian / Ubuntu; CentOS: dnf install chromium
# после установки проверьте путь этой командой — он должен совпасть с CHROME_PATH в .env:
command -v chromium || command -v chromium-browser || command -v google-chrome
```

#### 6. Первый запуск и проверка

```bash
bun run start        # запуск в foreground, остановка по Ctrl+C; эквивалентно bun --no-env-file src/server.js
```

В другом терминале:

```bash
curl -s http://127.0.0.1:3000/api/health                                  # вернёт 200
curl -s -H "Authorization: Bearer sk-your-api-key" http://127.0.0.1:3000/v1/models | head -c 300
```

Откройте в браузере `http://<IP-сервера>:3000` → войдите с администраторским ключом → пул аккаунтов → добавьте аккаунт. Первое добавление аккаунта автоматически логинится через headless-браузер и собирает сессию (3–15 с); когда в столбце «Доступность» появится зелёная метка «Доступен», можно отправлять запросы. Отправьте тестовое сообщение, чтобы проверить всю цепочку:

```bash
curl -s http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" -H "Content-Type: application/json" \
  -d '{"model":"qwen3.7-plus","messages":[{"role":"user","content":"只回答两个字：你好"}]}'
```

#### 7. Автозапуск при загрузке (необязательно, рекомендуется для продакшна)

```bash
# разовая подготовка: отдельный пользователь + каталог + Bun под этим пользователем (нужен для ExecStart)
sudo useradd --system --create-home --home-dir /home/qwen2api --shell /usr/sbin/nologin qwen2api
sudo mkdir -p /opt/qwen2api
sudo -u qwen2api -H bash -c 'curl -fsSL https://bun.sh/install | bash'
```

Разместите проект в `/opt/qwen2api` (`git clone` или `rsync`; учтите, что владельцем `/opt/qwen2api/.env` и `data/` должен быть `qwen2api`), затем напишите unit-файл сервиса:

```ini
# /etc/systemd/system/qwen2api.service
[Unit]
Description=Qwen2API (Bun)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=qwen2api
WorkingDirectory=/opt/qwen2api
Environment=PATH=/home/qwen2api/.bun/bin:/usr/local/bin:/usr/bin:/bin
# скрипт сбора сам находит /usr/bin/chromium или google-chrome; путь задаётся явно, только если найти не удалось:
# Environment=CHROME_PATH=/usr/bin/chromium
ExecStart=/home/qwen2api/.bun/bin/bun --no-env-file src/server.js
Restart=always
RestartSec=3
TimeoutStopSec=20
# статистика аккаунтов, лимиты и переиспользование сессий хранятся в памяти процесса: только один экземпляр, не запускайте несколько

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R qwen2api:qwen2api /opt/qwen2api
sudo systemctl daemon-reload
sudo systemctl enable --now qwen2api
curl -s http://127.0.0.1:3000/api/health        # 200 означает успешный запуск
```

#### Обновление до новой версии

```bash
cd /opt/qwen2api
sudo systemctl stop qwen2api                             # сначала остановите, чтобы сборка не висела без ответа
sudo git pull --ff-only                                  # или скопируйте новый код через rsync
sudo -u qwen2api bun install --frozen-lockfile --production
sudo -u qwen2api bun install --cwd public --frozen-lockfile
sudo -u qwen2api bun run build:frontend
sudo systemctl start qwen2api
```

Важно: `data/` и `.env` не входят в git, `pull` их не перезаписывает — обновляться можно спокойно.

#### Управление сервисом скриптом (без systemd)

В репозитории есть скрипт управления, которому нужны только `bash` и `bun`; PID-файл и логи лежат в `logs/`:

```bash
./scripts/qwen2api.sh start      # запуск в фоне (PID в logs/qwen2api.pid, лог в logs/qwen2api.out)
./scripts/qwen2api.sh status     # состояние + проверка здоровья
./scripts/qwen2api.sh restart    # перезапуск
./scripts/qwen2api.sh stop       # остановка (сначала TERM, через 15 с — KILL)
./scripts/qwen2api.sh logs       # следить за логом (по умолчанию последние 100 строк)
```

Он же отсекает типичные ошибки: повторный запуск (состояние в памяти процесса требует единственного экземпляра), отсутствующий `.env` (копируется из шаблона и подсказывает, что заполнить), `.env` без `API_KEY`, не собранный фронтенд и уже запущенный systemd-юнит.

#### Остановка / перезапуск / логи

```bash
sudo systemctl stop qwen2api                     # остановить
sudo systemctl restart qwen2api                  # перезапустить
sudo systemctl status qwen2api                   # статус
sudo journalctl -u qwen2api -f                   # логи в реальном времени (выход по Ctrl+C)
sudo journalctl -u qwen2api --since '10 min ago' # последние 10 минут
```

При запуске в foreground остановка выполняется по `Ctrl+C`; если не хочется ставить systemd, запустите `nohup bun run start > qwen2api.log 2>&1 &` в фоне и останавливайте через `kill <PID>`.

#### Данные и резервные копии

- `data/`: аккаунты, отпечатки сессий браузера (`browser-profile.<почта>.json`), статистика — **обязательно к резервному копированию**
- `.env`: ключи и конфигурация — тоже нужно копировать
- `public/dist/`: результат сборки фронтенда, можно пересобрать в любой момент

Порт меняется параметром `SERVICE_PORT` в `.env`; перед развёртыванием нескольких реплик нужно сначала решить вопрос общего состояния процессов, иначе статистика и лимиты будут считаться в каждом процессе отдельно.

#### Частые вопросы

| Симптом | Причина и решение |
|---|---|
| При добавлении аккаунта пишет «не удалось сохранить», в логе `环境变量模式不支持保存账户数据` | `DATA_SAVE_MODE` всё ещё `none`. Измените на `file` и перезапустите (теперь панель сама показывает эту подсказку) |
| При запуске ошибка `请务必设置 API_KEY 环境变量` | Нет `.env` или запуск не из корня проекта |
| В столбце статуса аккаунта постоянно «Нет сессии» / запросы возвращают `unauthorized` | На сервере не установлен Chromium или неверный пароль аккаунта; нажмите «Создать» рядом со столбцом «Доступность», чтобы увидеть конкретную ошибку |
| Порт занят | Измените `SERVICE_PORT` в `.env` или найдите процесс через `ss -lntp \| grep 3000` |
| Страница фронтенда отдаёт 404 / пустая | Не выполнен `bun run build:frontend`, каталога `public/dist` нет |

### 🌐 Прокси для каждого аккаунта / Per-account proxy

Каждому аккаунту можно назначить собственный исходящий прокси, чтобы разные аккаунты ходили с разных IP одновременно и не попадали под массовый бан `chat.qwen.ai` по корреляции IP.

**Приоритет:** `account.proxy` > глобальный `PROXY_URL` > без прокси

**Поддерживаемые протоколы:** HTTP / HTTPS / SOCKS5 / SOCKS5H (как у `PROXY_URL`)

**Через панель (рекомендуется):**
Откройте dashboard → при добавлении аккаунта заполните поле «Proxy URL», либо нажмите кнопку «Изменить proxy» на карточке существующего аккаунта.

**Через ENV (DATA_SAVE_MODE=none):**

```bash
# Старый формат (обратная совместимость, прокси не задан)
ACCOUNTS=user1@mail.com:pass1,user2@mail.com:pass2

# Новый формат (URL прокси через `|`, можно смешивать со старым)
ACCOUNTS=user1@mail.com:pass1|http://10.0.0.1:8080,user2@mail.com:pass2|socks5://10.0.0.2:1080
```

**Схема `data/data.json` (file-режим):**

```json
{
  "accounts": [
    {
      "email": "user@mail.com",
      "password": "...",
      "token": "...",
      "expires": 1234567890,
      "proxy": "http://10.0.0.1:8080"
    }
  ]
}
```

Если поле `proxy` равно `null` или отсутствует, аккаунт ходит через глобальный `PROXY_URL` (если он задан).

> ⚠️ **Внимание:** прокси-URL в ответах API **не маскируются**. Проект рассчитан на запуск в доверенной локальной/частной сети с единственным администратором.

### Требования к окружению

- Bun 1.3.14+ (для запуска из исходников; Docker использует 1.3.14)
- Node.js 24+ (только для тестов и lint при разработке, не нужен в production-образе)
- Docker (опционально)
- Redis (опционально, для персистентного хранения данных)

### ⚙️ Настройка окружения

Создайте файл `.env` и настройте следующие параметры:

```bash
# 🌐 Конфигурация сервиса
LISTEN_ADDRESS=localhost       # Адрес прослушивания
SERVICE_PORT=3000             # Порт сервиса

# 🔐 Безопасность
API_KEY=sk-123456,sk-456789   # API-ключи (обязательно, поддержка нескольких ключей)
ACCOUNTS=                     # Настройка аккаунтов (формат: user1:pass1[|proxy_url],user2:pass2[|proxy_url])

# 🔍 Конфигурация функций
SEARCH_INFO_MODE=table        # Режим отображения результатов поиска (table/text)
OUTPUT_THINK=true             # Выводить ли процесс размышления (true/false)
LEGACY_REASONING_IN_CONTENT=false # Формат рассуждений: false=поле reasoning_content, true=старый режим <think> внутри content (true/false)
SIMPLE_MODEL_MAP=false        # Упрощенное сопоставление моделей (true/false)
MODELS_CACHE_TTL=3600         # Срок жизни кэша списка моделей (сек), 0=бессрочно
AGENT_TURN_MAX_TOOL_CALLS=24  # Anthropic: лимит tool_use по текстовому каналу за ход агента (4-256), дальше обрыв upstream

# 🌐 Прокси и обратный прокси
QWEN_CHAT_PROXY_URL=          # Пользовательский URL обратного прокси Chat API (по умолчанию: https://chat.qwen.ai)
QWEN_CLI_PROXY_URL=           # Пользовательский URL обратного прокси CLI API (по умолчанию: https://portal.qwen.ai)
PROXY_URL=                    # Адрес HTTP/HTTPS/SOCKS5/SOCKS5H прокси (например: http://127.0.0.1:7890)

# 🗄️ Хранение данных
DATA_SAVE_MODE=none           # Режим сохранения данных (none/file/redis)
REDIS_URL=                    # Адрес подключения к Redis (опционально, при TLS используйте rediss://)
BATCH_LOGIN_CONCURRENCY=5     # Параллельность входа при массовом добавлении аккаунтов

# 📸 Конфигурация кэширования
CACHE_MODE=default            # Режим кэширования изображений (default/file)
```

#### 📋 Описание параметров

| Параметр | Описание | Пример |
|----------|----------|--------|
| `LISTEN_ADDRESS` | Адрес прослушивания сервиса | `localhost` или `0.0.0.0` |
| `SERVICE_PORT` | Порт работы сервиса | `3000` |
| `API_KEY` | API-ключи доступа, поддержка нескольких ключей. Первый ключ — администраторский (доступ к панели управления), остальные — обычные (только вызов API). Разделяются запятой | `sk-admin123,sk-user456,sk-user789` |
| `SEARCH_INFO_MODE` | Формат отображения результатов поиска | `table` или `text` |
| `OUTPUT_THINK` | Отображать ли процесс размышления AI | `true` или `false` |
| `LEGACY_REASONING_IN_CONTENT` | Формат вывода рассуждений. По умолчанию `false` = рассуждения в отдельном поле `reasoning_content`; `true` = старый режим (`<think>` внутри `content`) | `true` или `false` |
| `SIMPLE_MODEL_MAP` | Упрощенное сопоставление моделей, возвращает только базовые модели без вариантов | `true` или `false` |
| `MODEL_MAP` | Сопоставление входящих имён моделей: `alias=qwen-id,...,*=fallback`. Точное совпадение в приоритете (хвостовой `[..]` отбрасывается, без учёта регистра), существующие id Qwen проходят без изменений, остальное идёт в `*`; действует только для `/v1/chat/completions`, `/v1/messages` и `/v1/responses`. Редактируется и в панели (Настройки → Сопоставление моделей); сохранённое в панели сопоставление имеет приоритет над этой переменной, см. `.env.example` | `*=qwen3.8-max-thinking` |
| `MODELS_CACHE_TTL` | Срок жизни кэша списка моделей (в секундах); по истечении следующий запрос обновит список; `0` = бессрочный кэш | `3600` |
| `AGENT_TURN_MAX_TOOL_CALLS` | Путь Anthropic: лимит блоков `tool_use` по текстовому каналу за один ход агента (4–256). Если модель «идёт вразнос» после нарративного `[TOOL CALL]` (сотни повторов одного вызова, выдуманная сессия целиком), upstream обрывается сразу после N-го принятого вызова, а принятые вызовы отдаются со `stop_reason=tool_use`; после уже принятого в более раннем delta вызова дубликат, отклонённый вызов или проза/размышление также обрывают ход | `24` |
| `QWEN_CHAT_PROXY_URL` | Пользовательский адрес обратного прокси Chat API | `https://your-proxy.com` |
| `QWEN_CLI_PROXY_URL` | Пользовательский адрес обратного прокси CLI API | `https://your-cli-proxy.com` |
| `PROXY_URL` | Адрес прокси для исходящих запросов, поддержка HTTP/HTTPS/SOCKS5/SOCKS5H | `http://127.0.0.1:7890` |
| `DATA_SAVE_MODE` | Способ персистентного хранения данных | `none`/`file`/`redis` |
| `REDIS_URL` | Адрес подключения к Redis, при использовании TLS-шифрования необходим протокол `rediss://` | `redis://localhost:6379` или `rediss://xxx.upstash.io` |
| `BATCH_LOGIN_CONCURRENCY` | Параллельность входа при массовом добавлении аккаунтов, можно динамически менять в системных настройках фронтенда | `5` |
| `CACHE_MODE` | Способ хранения кэша изображений | `default`/`file` |
| `LOG_LEVEL` | Уровень логирования | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `ENABLE_FILE_LOG` | Включить ли файловое логирование | `true` или `false` |
| `LOG_DIR` | Директория файлов логов | `./logs` |
| `MAX_LOG_FILE_SIZE` | Максимальный размер файла лога (МБ) | `10` |
| `MAX_LOG_FILES` | Количество сохраняемых файлов логов | `5` |

> 💡 **Подсказка**: Можно бесплатно создать экземпляр Redis на [Upstash](https://upstash.com/), при использовании протокола TLS адрес имеет формат `rediss://...`
<div>
<img src="./docs/images/upstash.png" alt="Upstash Redis" width="600">
</div>

#### 🔑 Настройка нескольких API_KEY

Переменная окружения `API_KEY` поддерживает настройку нескольких API-ключей для реализации разных уровней доступа:

**Формат настройки:**
```bash
# Один ключ (права администратора)
API_KEY=sk-admin123

# Несколько ключей (первый — администратор, остальные — обычные пользователи)
API_KEY=sk-admin123,sk-user456,sk-user789
```

**Описание прав:**

| Тип ключа | Область прав | Описание функций |
|-----------|--------------|------------------|
| **Администраторский ключ** | Полные права | • Доступ к панели управления<br>• Изменение системных настроек<br>• Вызов всех API-эндпоинтов<br>• Добавление/удаление обычных ключей |
| **Обычный ключ** | Права вызова API | • Только вызов API-эндпоинтов<br>• Нет доступа к панели управления<br>• Нет возможности изменять системные настройки |

**Сценарии использования:**
- **Командная работа**: назначение ключей с разными правами для разных членов команды
- **Интеграция приложений**: предоставление ограниченного API-доступа сторонним приложениям
- **Разделение безопасности**: разделение административных и пользовательских прав

**Примечания:**
- Первый API_KEY автоматически становится администраторским ключом с максимальными правами
- Администратор может динамически добавлять или удалять обычные ключи через панель управления
- Все ключи могут вызывать API-эндпоинты, различия в правах касаются только функций управления

#### 📸 Описание режимов CACHE_MODE

Переменная окружения `CACHE_MODE` управляет способом хранения кэша изображений для оптимизации производительности загрузки и обработки:

| Режим | Описание | Сценарий использования |
|-------|----------|------------------------|
| `default` | Кэширование в памяти (по умолчанию) | Однопроцессное развертывание, кэш теряется при перезапуске |
| `file` | Файловое кэширование | Многопроцессное развертывание, кэш сохраняется в директорию `./caches/` |

**Рекомендуемая настройка:**
- **Однопроцессное развертывание**: используйте `CACHE_MODE=default`, максимальная производительность
- **Многопроцессное/кластерное развертывание**: используйте `CACHE_MODE=file`, обеспечивает общий кэш между процессами
- **Развертывание Docker**: рекомендуется `CACHE_MODE=file` с монтированием директории `./caches`

**Структура директории файлового кэша:**
```
caches/
├── [signature1].txt    # Файл кэша, содержит URL изображения
├── [signature2].txt
└── ...
```

---

## 🚀 Способы развертывания

### 🐳 Развертывание Docker

#### Способ 1: Прямой запуск

```bash
docker run -d \
  -p 3000:3000 \
  -e API_KEY=sk-admin123,sk-user456,sk-user789 \
  -e DATA_SAVE_MODE=none \
  -e CACHE_MODE=file \
  -e ACCOUNTS= \
  -v ./caches:/app/caches \
  --name qwen2api \
  rfym21/qwen2api:latest
```

#### Способ 2: Docker Compose

```bash
# Скачать файл конфигурации
curl -o docker-compose.yml https://raw.githubusercontent.com/Rfym21/Qwen2API/refs/heads/main/docker/docker-compose.yml

# Запустить сервис
docker compose pull && docker compose up -d
```

### 📦 Локальное развертывание

Рекомендуется пройти раздел «🚀 Пошаговое развёртывание и управление сервисом» выше: там есть шаги от установки Bun до настройки systemd.

Минимальные шаги при ручном развёртывании:

```bash
git clone https://github.com/Rfym21/Qwen2API.git && cd Qwen2API
bun install --frozen-lockfile
bun install --cwd public --frozen-lockfile
bun run build:frontend
cp .env.example .env          # как минимум заполните API_KEY и аккаунты
bun run start                 # = bun --no-env-file src/server.js
bun run dev                   # режим разработки (--watch)
```

### Запуск и проверка

Сервис работает в одном процессе Bun. PM2 и автоматический cluster удалены;
`PM2_INSTANCES` и `PM2_MAX_MEMORY` больше не действуют. Перезапуск задается через
Compose `restart: always`, лимит памяти через `mem_limit`. Статистика, лимиты и
настройки частично хранятся в памяти процесса: нескольким репликам нужна синхронизация.

`bun run test` сохраняет Node test runner для существующих тестов.
`bun run test:bun` проверяет реальный Bun-сервис с локальным mock upstream:
вход, фронтенд, WASM, OpenAI/Anthropic JSON и SSE без реальных аккаунтов.
По умолчанию используются исходники. Для сравнения доступен `node src/server.js`.

### Отдельный исполняемый файл

`bun run build:binary` собирает фронтенд и бинарный файл для текущей системы в `pkg_dist/`.
Для Linux x64: `bun run build:binary --target bun-linux-x64` (для Alpine: `bun-linux-x64-musl`).
Кросс-компиляция не заменяет проверку запуска на целевой системе.
Проверка Windows: `bun run test:bun --binary pkg_dist/qwen2api-windows-x64.exe`.

Файл содержит Bun, бэкенд, фронтенд и tiktoken WASM; Node, Bun и node_modules на сервере
не нужны. Запускайте его из доступного для записи каталога с `.env` либо задайте переменные
окружения. Учётные данные и `.env` не встраиваются. Каталоги `data/`, `logs/`, `caches/`
создаются относительно рабочего каталога; `QWEN2API_RUNTIME_DIR` меняет этот корень.
`--version` выводит версию без запуска сервера. Docker содержит Alpine и musl-бинарник,
без исходников, node_modules и отдельного Bun CLI.

### CI и публикация

`ci.yml` проверяет push и PR без публикации. Общий `verify.yml` запускает lint и регрессию
на Node 24, берет Bun из packageManager, собирает фронтенд один раз и проверяет бинарники
Windows x64, Linux x64/arm64 на нативных runner. Linux также проверяет реальные Alpine-контейнеры.

`release.yml` публикует только при изменении version в package.json на main или вручную
через Run workflow с включённым publish на main. Без publish создаются только artifacts.
Обычные изменения исходников, PR и push тегов не публикуют релиз.

Релиз содержит три .tar.gz (бинарник, .env.example, инструкция), SHA256SUMS и Docker-образы
linux/amd64 и linux/arm64. Архивы Linux используют glibc, контейнеры musl. Публикуются уже
проверенные образы без повторной сборки. Опубликованные версии не перезаписываются; тег
другого коммита требует новой версии. Незавершённый черновик можно повторить на том же коммите.
latest обновляется, пока main имеет ту же версию и содержит коммит релиза в своей истории.
Очередь publish использует queue:max (до 100 ожидающих задач). Публикация не атомарна: при сбое могут
остаться черновик и часть тегов образов.

Нужны secrets DOCKERHUB_USERNAME, DOCKERHUB_TOKEN и доступный для записи Docker Hub репозиторий.
Только publish job имеет contents:write; environment release позволяет задать ограничения
ветки и ручное подтверждение. Перед первым новым релизом увеличьте текущую версию.
Локальная сборка: `docker build -f docker/Dockerfile -t qwen2api:local .`.
Проверка контейнера на Linux: `bun run test:bun --docker-image qwen2api:local`.

### ☁️ Развертывание на Hugging Face

Быстрое развертывание на Hugging Face Spaces:

[![Deploy to Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Deploy-yellow)](https://huggingface.co/spaces/devme/q2waepnilm)

<div>
<img src="./docs/images/hf.png" alt="Hugging Face Deployment" width="600">
</div>

### ☁️ Развертывание на Vercel

Быстрое развертывание на Vercel:

Этот вариант сохраняет совместимость Node/Express; переход на Bun относится к локальному запуску и Docker.

[![Развернуть с Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRfym21%2FQwen2API)

Необходимо настроить переменные окружения:
```
ACCOUNTS=email:password
SERVICE_PORT=80
API_KEY=sk-xxx
DATA_SAVE_MODE=none
```

---

## 📁 Структура проекта

```
Qwen2API/
├── README.md
├── bun.lock                         # Фиксация зависимостей Bun
├── package.json
│
├── docker/                          # Директория конфигурации Docker
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose-redis.yml
│
├── caches/                          # Директория файлов кэша
├── data/                            # Директория файлов данных
│   ├── data.json
│   └── data_template.json
├── scripts/                         # Директория скриптов
│   └── fingerprint-injector.js      # Скрипт инъекции отпечатка браузера
│
├── src/                             # Директория исходного кода бэкенда
│   ├── server.js                    # Главный файл сервера
│   ├── config/
│   │   └── index.js                 # Файл конфигурации
│   ├── controllers/                 # Директория контроллеров
│   │   ├── chat.js                  # Контроллер чата
│   │   ├── chat.image.video.js      # Контроллер генерации изображений/видео
│   │   ├── cli.chat.js              # Контроллер CLI-чата
│   │   └── models.js                # Контроллер моделей
│   ├── middlewares/                 # Директория middleware
│   │   ├── authorization.js         # Middleware авторизации
│   │   └── chat-middleware.js       # Middleware чата
│   ├── models/                      # Директория моделей
│   │   └── models-map.js            # Конфигурация сопоставления моделей
│   ├── routes/                      # Директория маршрутов
│   │   ├── accounts.js              # Маршруты аккаунтов
│   │   ├── chat.js                  # Маршруты чата
│   │   ├── cli.chat.js              # Маршруты CLI-чата
│   │   ├── models.js                # Маршруты моделей
│   │   ├── settings.js              # Маршруты настроек
│   │   └── verify.js                # Маршруты верификации
│   └── utils/                       # Директория утилит
│       ├── account-rotator.js       # Ротатор аккаунтов
│       ├── account.js               # Управление аккаунтами
│       ├── chat-helpers.js          # Вспомогательные функции чата
│       ├── cli.manager.js           # Менеджер CLI
│       ├── cookie-generator.js      # Генератор Cookie
│       ├── data-persistence.js      # Персистентность данных
│       ├── fingerprint.js           # Генерация отпечатка браузера
│       ├── img-caches.js            # Кэш изображений
│       ├── logger.js                # Утилита логирования
│       ├── precise-tokenizer.js     # Точный токенизатор
│       ├── proxy-helper.js          # Вспомогательные функции прокси
│       ├── redis.js                 # Подключение к Redis
│       ├── request.js               # Обертка HTTP-запросов
│       ├── setting.js               # Управление настройками
│       ├── ssxmod-manager.js        # Менеджер параметров ssxmod
│       ├── token-manager.js         # Менеджер токенов
│       ├── tools.js                 # Обработка вызова инструментов
│       └── upload.js                # Загрузка файлов
│
└── public/                          # Директория фронтенд-проекта
    ├── dist/                        # Скомпилированные фронтенд-файлы
    │   ├── assets/                  # Статические ресурсы
    │   ├── favicon.png
    │   └── index.html
    ├── src/                         # Исходный код фронтенда
    │   ├── App.vue                  # Главный компонент приложения
    │   ├── main.js                  # Точка входа
    │   ├── style.css                # Глобальные стили
    │   ├── assets/                  # Статические ресурсы
    │   │   └── background.mp4
    │   ├── routes/                  # Конфигурация маршрутизации
    │   │   └── index.js
    │   └── views/                   # Компоненты страниц
    │       ├── auth.vue             # Страница авторизации
    │       ├── dashboard.vue        # Панель управления
    │       └── settings.vue         # Страница настроек
    ├── package.json                 # Конфигурация фронтенд-зависимостей
    ├── package-lock.json
    ├── index.html                   # Входной HTML фронтенда
    ├── postcss.config.js            # Конфигурация PostCSS
    ├── tailwind.config.js           # Конфигурация TailwindCSS
    ├── vite.config.js               # Конфигурация сборки Vite
    └── public/                      # Публичные статические ресурсы
        └── favicon.png
```

## 📖 API-документация

### 🔐 Аутентификация API

API поддерживает многоключевую аутентификацию, все запросы должны содержать действительный API-ключ в заголовке:

```http
Authorization: Bearer sk-your-api-key
```

**Поддерживаемые типы ключей:**
- **Администраторский ключ**: первый настроенный API_KEY, обладает полными правами
- **Обычный ключ**: остальные настроенные API_KEY, только вызов API-эндпоинтов

**Примеры аутентификации:**
```bash
# Использование администраторского ключа
curl -H "Authorization: Bearer sk-admin123" http://localhost:3000/v1/models

# Использование обычного ключа
curl -H "Authorization: Bearer sk-user456" http://localhost:3000/v1/chat/completions
```

### 🔍 Получение списка моделей

Получение списка всех доступных AI-моделей.

```http
GET /v1/models
Authorization: Bearer sk-your-api-key
```

```http
GET /models (без аутентификации)
```

**Пример ответа:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen-max-latest",
      "object": "model",
      "created": 1677610602,
      "owned_by": "qwen"
    }
  ]
}
```

### 💬 Чат-диалог

Отправка сообщения и получение ответа AI.

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**Тело запроса:**
```json
{
  "model": "qwen-max-latest",
  "messages": [
    {
      "role": "system",
      "content": "Ты полезный помощник."
    },
    {
      "role": "user",
      "content": "Привет, расскажи о себе."
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**Пример ответа:**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "qwen-max-latest",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Привет! Я AI-помощник..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 50,
    "total_tokens": 70
  }
}
```

### 🤖 Anthropic Messages API

Проект предоставляет **Anthropic-compatible bridge** для конечной точки `/v1/messages`, чтобы её можно было использовать с такими клиентами, как Claude Code, Anthropic SDK, aider и другими совместимыми инструментами.

> Примечание: Qwen2API — это слой совместимости, а не эквивалентный официальный backend Anthropic. Для неподдерживаемых полей текущая стратегия намеренно **мягкая**: запрос по возможности принимается, а важные неподдерживаемые поля явно показываются через response headers и серверные логи, вместо того чтобы молча игнорироваться. Поля `system`, многоходовые `messages`, `tools`, `tool_choice` и `thinking` сейчас поддерживаются **приближённо**, а не как нативная семантика Anthropic.

```http
POST /v1/messages
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**Матрица совместимости:**

| Поле / возможность | Статус | Текущее поведение | Примечание / влияние на клиента |
|---|---|---|---|
| `model` | Supported | Сопоставляется с именем модели Qwen | Можно использовать любой разрешаемый ID модели Qwen |
| `messages.text` | Supported | Поддерживаются обычные текстовые сообщения | Базовые chat-клиенты работают |
| `messages.image` | Supported | Поддерживаются image-блоки с переводом во внутренний формат изображений | Подходит для типичных мультимодальных клиентов |
| `messages.tool_use` | Partial | Принимаются Anthropic-style блоки истории `tool_use`, затем они переводятся и сворачиваются внутри bridge | Это не нативная upstream-семантика tool call |
| `messages.tool_result` | Partial | Принимается `tool_result`, затем преобразуется в текстовый результат bridge-слоя | Детали вроде `is_error` не гарантированно сохраняются |
| `system` | Partial | Встраивается в префикс prompt | Не сохраняется как отдельный нативный system-слой upstream |
| `messages` (multi-turn) | Partial | История нескольких ходов сжимается / переводится | Семантика структурированного диалога приблизительная |
| `tools[]` | Partial | Поддерживается базовая форма `{name,input_schema,description}` | Реализовано через prompt/XML-симуляцию, а не нативное upstream tool execution |
| `tool_choice` | Partial | Поддерживаются базовые режимы `auto` / `any` / `tool` / `none` | Опирается на prompt steering и retry hints, а не на жёсткую гарантию upstream |
| `thinking` | Partial | Сейчас принимается legacy-форма `thinking: {type:"enabled", budget_tokens:N}` и приблизительно отображается | Не эквивалентно новым adaptive thinking / effort semantics Anthropic |
| `stream` | Supported | Возвращает Anthropic-style SSE последовательность событий | Подходит для Claude Code и других streaming-клиентов |
| `max_tokens` | Ignored with warning | Сейчас не ограничивает upstream output по-настоящему | Показывается через warning headers / logs |
| `stop_sequences` | Ignored with warning | Сейчас не отображается на upstream stop behavior | Показывается через warning headers / logs |
| `metadata` | Ignored with warning | Сейчас не участвует в upstream-запросе | Показывается через warning headers / logs |
| `temperature` / `top_p` / `top_k` | Ignored with warning | Сейчас не переводится в upstream sampling controls | Показывается через warning headers / logs |
| `service_tier` | Ignored with warning | Сейчас не поддерживается | Показывается через warning headers / logs |
| `container` | Ignored with warning | Сейчас не поддерживается | Показывается через warning headers / logs |
| `output_config` | Ignored with warning | Сейчас не поддерживаются official structured outputs / effort semantics | Показывается через warning headers / logs |
| `mcp_servers` | Not supported yet | Anthropic MCP runtime semantics сейчас не поддерживаются | Пока только помечается как риск; в будущей версии может стать явной ошибкой |
| `context_management` | Not supported yet | Official compaction / context-editing semantics сейчас не поддерживаются | Пока только помечается как риск; в будущей версии может стать явной ошибкой |

Если запрос содержит приближённо поддерживаемые или неподдерживаемые поля, в ответе могут появиться следующие headers:

- `X-Qwen2API-Anthropic-Compatibility`
- `X-Qwen2API-Anthropic-Warnings`

Эти headers показывают, какие Anthropic-возможности имеют статус **Partial**, а какие поля были **Ignored with warning**. Они не меняют базовую форму успешного response body.

**Пример запроса (с tool calling):**

```json
{
  "model": "qwen3-coder-plus",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Проверь погоду в Гуанчжоу"}
  ],
  "tools": [
    {
      "name": "get_weather",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "tool_choice": { "type": "any" }
}
```

> Примечание: `max_tokens` в примере выше принимается, но сейчас относится к **Ignored with warning** и не ограничивает upstream output так же, как это делает официальный Anthropic API.

**Непотоковый ответ:**

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "model": "qwen3-coder-plus",
  "content": [
    {
      "type": "tool_use",
      "id": "call_xxx",
      "name": "get_weather",
      "input": { "city": "Гуанчжоу" }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": { "input_tokens": 233, "output_tokens": 25 }
}
```

**Последовательность SSE-событий в потоковом режиме:**

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_xxx","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"city\":\"Гуанчжоу\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":234,"output_tokens":25}}

event: message_stop
data: {"type":"message_stop"}
```

### 🔌 OpenAI Responses API

Эндпоинт `/v1/responses` реализует **OpenAI Responses API**. В нём вход и выход разделены: на входе — элементы `input`, на выходе — элементы `output`, а потоковый ответ представляет собой последовательность событий `response.*`. Эндпоинт не зависит от `/v1/chat/completions`, они могут работать параллельно; клиенты, поддерживающие этот протокол, — например, `client.responses.create()` из официального OpenAI SDK или Codex CLI, — подключаются напрямую.

```http
POST /v1/responses
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**Пример запроса (потоковый):**

```bash
curl -N http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "qwen3.7-plus",
    "input": "Объясни в одном предложении, что такое векторная база данных.",
    "instructions": "Ты краткий помощник. Отвечай не более чем тремя предложениями.",
    "stream": true,
    "max_output_tokens": 1024,
    "temperature": 0.7,
    "reasoning": { "effort": "medium" }
  }'
```

**Как задать `input`:**

Обычная строка — эквивалент одного сообщения user:

```json
{ "input": "Привет" }
```

Массив сообщений, где `content` может быть строкой или массивом частей:

```json
{
  "input": [
    { "role": "user", "content": "Привет" }
  ]
}
```

```json
{
  "input": [
    { "role": "user", "content": [{ "type": "input_text", "text": "Привет" }] }
  ]
}
```

Результат инструмента — обычно отправляется вместе с элементом `function_call` из предыдущего хода:

```json
{
  "input": [
    { "type": "function_call", "call_id": "call_xxx", "name": "get_time", "arguments": "{}" },
    { "type": "function_call_output", "call_id": "call_xxx", "output": "{\"time\":\"12:00\"}" }
  ]
}
```

**Поля запроса:**

| Поле | Тип | Описание |
|---|---|---|
| `model` | string | ID модели, те же значения, что `id` в ответе `/v1/models` |
| `input` | string \| array | Строка или массив элементов, см. выше |
| `instructions` | string | Эквивалент `system`, добавляется в начало диалога |
| `stream` | boolean | `true` — поток SSE-событий, по умолчанию `false` |
| `max_output_tokens` | number | Верхняя граница длины ответа |
| `temperature` / `top_p` | number | Параметры сэмплирования |
| `tools[]` | array | Инструменты-функции вида `{type:"function",name,description,parameters}` (на один уровень `function` меньше, чем в `/v1/chat/completions`) |
| `tool_choice` | string \| object | `auto` / `required` / `none` или `{type:"function",name:"..."}` для фиксированной функции |
| `reasoning.effort` | string | `none` / `minimal` отключают рассуждения, остальные значения включают |
| `user` | string | Идентификатор конечного пользователя, передаётся вместе с запросом |

**Непотоковый запрос:**

```json
{
  "model": "qwen3.7-plus",
  "input": "Привет",
  "instructions": "Ответь одним словом, без пояснений."
}
```

**Непотоковый ответ:**

```json
{
  "id": "resp_d2beb5aef96b4826a58e36a920630467",
  "object": "response",
  "created_at": 1792661279,
  "status": "completed",
  "model": "qwen3.7-plus",
  "output": [
    {
      "id": "rs_2c68fffeb3e34ebe8d8b9c0f81677704",
      "type": "reasoning",
      "summary": [
        { "type": "summary_text", "text": "Я внимательно проверил явное требование пользователя: ответить одним словом.……" }
      ]
    },
    {
      "id": "msg_f2f5eeb079c14b83a8bb0f91591b3f03",
      "type": "message",
      "status": "completed",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "Привет", "annotations": [] }
      ]
    }
  ],
  "usage": {
    "input_tokens": 1236,
    "output_tokens": 84,
    "total_tokens": 1320,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens_details": { "reasoning_tokens": 0 }
  },
  "error": null,
  "incomplete_details": null
}
```

`output` — массив элементов; по порядку могут встречаться три вида:

- `reasoning` — сводка рассуждений, текст в `summary[0].text`
- `message` — сам ответ, текст в `content[0].text` (`type` равен `output_text`)
- `function_call` — вызов инструмента с полями `call_id` / `name` / `arguments`, где `arguments` — строка JSON

**Вызов инструментов (несколько ходов):**

`tools[]` использует плоский формат Responses. Запрос первого хода:

```json
{
  "model": "qwen3-coder-plus",
  "input": "Который час?",
  "tools": [
    {
      "type": "function",
      "name": "get_time",
      "description": "Возвращает текущее время",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

В `output` ответа появляется элемент `function_call`:

```json
{
  "id": "fc_xxx",
  "type": "function_call",
  "status": "completed",
  "call_id": "call_abc123",
  "name": "get_time",
  "arguments": "{}"
}
```

Во втором ходе отправьте этот вызов и его результат вместе в `input`, чтобы получить обычный текст ответа:

```json
{
  "model": "qwen3-coder-plus",
  "input": [
    { "type": "function_call", "call_id": "call_abc123", "name": "get_time", "arguments": "{}" },
    { "type": "function_call_output", "call_id": "call_abc123", "output": "{\"time\":\"2026-10-22 17:30\"}" }
  ]
}
```

Во втором ходе в тесте вернулся обычный ответ ассистента. Вызовы инструментов разбираются на стороне сервера, поэтому клиент видит только стандартные элементы `function_call`, без внутреннего протокольного текста.

**Потоковые события (фрагмент):**

```
event: response.created
data: {"type":"response.created","response":{...}}

event: response.in_progress
data: {"type":"response.in_progress","response":{...}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_xxx","type":"reasoning","summary":[]}}

event: response.reasoning_summary_part.added
data: {"type":"response.reasoning_summary_part.added","item_id":"rs_xxx","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_xxx","output_index":0,"summary_index":0,"delta":"Сначала объяснить"}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":1,"item":{"id":"msg_xxx","type":"message","status":"in_progress","role":"assistant","content":[]}}

event: response.content_part.added
data: {"type":"response.content_part.added","item_id":"msg_xxx","output_index":1,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_xxx","output_index":1,"content_index":0,"delta":"Векторная база"}

event: response.content_part.done
data: {"type":"response.content_part.done","item_id":"msg_xxx","output_index":1,"content_index":0,"part":{"type":"output_text","text":"Векторная база данных…","annotations":[]}}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":1,"item":{"id":"msg_xxx","type":"message","status":"completed","role":"assistant","content":[...]}}

event: response.completed
data: {"type":"response.completed","response":{...}}
```

**Порядок событий:**

1. `response.created` → `response.in_progress`
2. Если есть рассуждения: `response.output_item.added` (reasoning) → `response.reasoning_summary_part.added` → `response.reasoning_summary_text.delta` × N → `response.reasoning_summary_text.done` → `response.reasoning_summary_part.done` → `response.output_item.done` (reasoning)
3. Сам ответ: `response.output_item.added` (message) → `response.content_part.added` → `response.output_text.delta` × N → `response.output_text.done` → `response.content_part.done` → `response.output_item.done` (message)
4. Если есть вызовы инструментов: `response.output_item.added` (function_call) → `response.function_call_arguments.delta` × N → `response.function_call_arguments.done` → `response.output_item.done`
5. Завершение: `response.completed`; при ошибке — `response.failed`
6. Финального `[DONE]` нет: конец потока определяется по `response.completed` / `response.failed`

**Отличия от `/v1/chat/completions`:**

| Аспект | `/v1/chat/completions` | `/v1/responses` |
|---|---|---|
| Вход | `messages[]`, system через `role:"system"` | `input` (строка или массив элементов), system через `instructions` |
| Описание инструментов | `{type:"function",function:{name,...}}` | `{type:"function",name,...}` (без уровня `function`) |
| Результат инструмента | `role:"tool"` + `tool_call_id` | элемент `{type:"function_call_output",call_id,output}` |
| Выход | `choices[0].message.content` | массив элементов `output[]` (`reasoning` / `message` / `function_call`) |
| Использование токенов | `prompt_tokens` / `completion_tokens` / `total_tokens` | `input_tokens` / `output_tokens` / `total_tokens`, плюс `input_tokens_details` / `output_tokens_details` |
| Поток | `data: {"choices":[{"delta":...}]}`, завершается `[DONE]` | `event: response.*` + `data: {"type":...}`, завершается `response.completed` |

**Подключение клиентов:**

Официальный Python SDK OpenAI работает без доработок:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="sk-your-api-key")

resp = client.responses.create(
    model="qwen3.7-plus",
    input="Объясни в одном предложении, что такое векторная база данных.",
)
print(resp.output_text)
```

Для Codex CLI достаточно указать у своего provider в `~/.codex/config.toml` параметры `wire_api = "responses"` и `base_url = "http://localhost:3000/v1"` (точные поля — в документации Codex CLI).

**Примечания:**

- Сейчас Responses-цепочка работает только с текстом: нетекстовые части `content` (изображения, видео) игнорируются, для мультимодальных запросов используйте `/v1/chat/completions`
- `input_tokens_details.cached_tokens` и `output_tokens_details.reasoning_tokens` в `usage` сейчас всегда равны `0` (эта детализация пока не передаётся)
- `tools[]` принимает только `type:"function"`; встроенные инструменты вроде `web_search` и `file_search` пока не поддерживаются
- Некорректное тело запроса даёт `400`: пустой `input` (`code` — `invalid_input`) или отсутствующий `model` (`code` — `invalid_model`); ошибка upstream — `502` или статус upstream. Тело ошибки единое: `{"error":{"message","type","code","param"}}`
- При ошибке поток завершается событием `response.failed`: `response.status` равен `failed`, а `error` содержит `code` / `message`

### 🎨 Генерация/редактирование изображений

Используйте модели с суффиксом `-image` для генерации изображений из текста.
Используйте модели с суффиксом `-image-edit` для редактирования изображений.
При использовании моделей `-image` можно управлять размером изображения, добавив параметр `size` в тело запроса или включив ключевые слова `1:1`, `4:3`, `3:4`, `16:9`, `9:16` в текст сообщения.

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**Тело запроса:**
```json
{
  "model": "qwen-max-latest-image",
  "messages": [
    {
      "role": "user",
      "content": "Нарисуй котенка, играющего в саду, в мультяшном стиле"
    }
  ],
  "size": "1:1",
  "stream": false
}
```

**Поддерживаемые параметры:**
- `size`: размер изображения, поддерживается `"1:1"`, `"4:3"`, `"3:4"`, `"16:9"`, `"9:16"`
- `stream`: поддержка потокового и непотокового ответа

**Пример ответа:**
```json
{
  "created": 1677652288,
  "model": "qwen-max-latest",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image](https://example.com/generated-image.jpg)"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### 🎯 Продвинутые функции

#### 🔍 Режим интеллектуального поиска

Добавьте суффикс `-search` к имени модели для включения функции поиска:

```json
{
  "model": "qwen-max-latest-search",
  "messages": [...]
}
```

#### 🧠 Режим рассуждений

Добавьте суффикс `-thinking` к имени модели для вывода процесса размышления:

```json
{
  "model": "qwen-max-latest-thinking",
  "messages": [...]
}
```

#### 🔍🧠 Комбинированный режим

Одновременное включение поиска и рассуждений:

```json
{
  "model": "qwen-max-latest-thinking-search",
  "messages": [...]
}
```

#### 🎨 Режим генерации изображений T2I

Активируйте генерацию изображений из текста, установив параметр `chat_type` в значение `t2i`:

```json
{
  "model": "qwen-max-latest",
  "chat_type": "t2i",
  "messages": [
    {
      "role": "user",
      "content": "Нарисуй милого котенка"
    }
  ],
  "size": "1:1"
}
```

**Поддерживаемые размеры изображений:** `1:1`, `4:3`, `3:4`, `16:9`, `9:16`

**Умное определение размера:** система автоматически распознает ключевые слова размера в промпте и устанавливает соответствующий размер

#### 🖼️ Мультимодальная поддержка

API автоматически обрабатывает загрузку изображений, поддерживает отправку изображений в диалоге:

```json
{
  "model": "qwen-max-latest",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Что изображено на этой картинке?"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ]
}
```

### 🖥️ CLI-эндпоинт

CLI-эндпоинт использует OAuth-токены Qwen Code / Qwen Cli для доступа, поддерживает контекст 256K и вызов инструментов (Function Calling).

**Поддерживаемые модели:**

| ID модели | Описание |
|-----------|----------|
| `qwen3-coder-plus` | Qwen3 Coder Plus |
| `qwen3-coder-flash` | Qwen3 Coder Flash (быстрее) |
| `coder-model` | Qwen 3.5 Plus (с цепочкой рассуждений, контекст 256K) |
| `qwen3.5-plus` | Алиас для `coder-model`, автоматическое перенаправление |

#### 💬 CLI чат-диалог

Отправка чат-запросов через CLI-эндпоинт, поддержка потоковых и непотоковых ответов.

```http
POST /cli/v1/chat/completions
Content-Type: application/json
Authorization: Bearer API_KEY
```

**Тело запроса:**
```json
{
  "model": "qwen3-coder-plus",
  "messages": [
    {
      "role": "user",
      "content": "Привет, расскажи о себе."
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

Использование `coder-model` (т.е. Qwen 3.5 Plus) или его алиаса `qwen3.5-plus`:
```json
{
  "model": "coder-model",
  "messages": [
    {
      "role": "user",
      "content": "Напиши алгоритм быстрой сортировки."
    }
  ],
  "stream": false
}
```

**Потоковый запрос:**
```json
{
  "model": "qwen3-coder-flash",
  "messages": [
    {
      "role": "user",
      "content": "Напиши стихотворение о весне."
    }
  ],
  "stream": true
}
```

**Формат ответа:**

Непотоковый ответ соответствует стандартному формату OpenAI API:
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "qwen3-coder-plus",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Привет! Я AI-помощник..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 50,
    "total_tokens": 70
  }
}
```

Потоковый ответ использует формат Server-Sent Events (SSE):
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"qwen3-coder-flash","choices":[{"index":0,"delta":{"content":"Привет"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"qwen3-coder-flash","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: [DONE]
```

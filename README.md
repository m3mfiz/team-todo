# team-todo — командный таск-менеджер в стиле Things

PWA-приложение задач для команды из 5 человек (1 администратор + 4 сотрудника).
Администратор ставит задачи конкретному сотруднику или всем сразу; сотрудник
видит только свои задачи, общие задачи и задачи, созданные им самим (их также
видит администратор). Вход по логину/паролю. Устанавливается на iPhone и
Android как PWA («На экран Домой» / «Установить приложение»).

Дизайн и логика следуют аудиту Things 3: `audit/things-design-audit.md`.
Аудит серверов и решения по стеку: `audit/server-audit.md`.

## Стек

- **Сервер**: Fastify 4 + better-sqlite3 (WAL) + JWT (access 15 мин / refresh
  7 дней с ротацией и family-revocation) + Zod. Запуск через `tsx`, без
  build-шага. Порт **3002** (3001 занят lab-booking).
- **Клиент**: React 18 + Vite 5 + vite-plugin-pwa. Сборка в
  `packages/client/dist`, в проде её отдаёт сам Fastify (SPA fallback).
- Монорепа npm workspaces: `packages/server`, `packages/client`.
- Node ≥ 18 (dev — 18.19, prod — 22).

## Локальная разработка

```bash
cp .env.example .env        # заполнить JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD
npm install
npm run db:setup            # миграция + сид (admin + 4 сотрудника)
npm run dev                 # сервер :3002 + Vite :5173 (proxy /api -> :3002)
```

Сид создаёт пользователей: `admin` (пароль из `ADMIN_PASSWORD`) и сотрудников
`ivan`, `maria`, `sergey`, `olga` (дефолтный пароль `<login>123` — сменить!).

## Проверки

```bash
npm test                    # vitest, интеграционные тесты сервера
npm run typecheck           # tsc --noEmit для обоих пакетов
npm run build               # production-сборка клиента
```

## Продакшен (хост 138.16.178.200, ask4k.live)

Работает рядом с lab-booking (:3001) на том же хосте: PM2-процесс
`team-todo`, порт **3002**, SQLite-файл в `data/` (в git не входит).

### Первичная установка

```bash
ssh -i ~/.ssh/id_ed25519_github m3mfis@138.16.178.200
git clone git@github.com:m3mfiz/team-todo.git ~/team-todo
cd ~/team-todo
cp .env.example .env && nano .env   # реальные секреты, ADMIN_PASSWORD
npm install
npm run db:setup
npm run build
pm2 start ecosystem.config.cjs && pm2 save
```

### Caddy

Добавить в Caddyfile отдельный site-блок (конфиг lab-booking не трогать):

```caddy
todo.ask4k.live {
    reverse_proxy localhost:3002
}
```

и `caddy reload`. (Альтернатива без поддомена — path-маршрут
`handle_path /todo/*` внутри блока `ask4k.live`, тогда клиенту нужен
`base: '/todo/'` в vite.config.ts; вариант с поддоменом предпочтительнее.)

### Деплой новой версии (одной командой)

```bash
ssh -i ~/.ssh/id_ed25519_github m3mfis@138.16.178.200 \
  'cd ~/team-todo && git pull --ff-only && npm install && npm run db:setup && npm run build && pm2 restart team-todo --update-env'
```

`db:setup` идемпотентен (CREATE TABLE IF NOT EXISTS / сид пропускает
существующих пользователей) — безопасен при каждом деплое.

## API (кратко)

| Метод | Путь | Описание |
|---|---|---|
| POST | /api/auth/login | вход, выдаёт access+refresh |
| POST | /api/auth/refresh | ротация refresh-токена |
| POST | /api/auth/logout | отзыв refresh-токена |
| GET | /api/auth/me | текущий пользователь |
| GET | /api/users | список пользователей (для имён/назначения) |
| GET | /api/tasks | задачи с учётом ролей видимости |
| POST | /api/tasks | создать (member — только себе; admin — кому угодно или всем `assigneeId: null`) |
| PATCH | /api/tasks/:id | правка/выполнить/переоткрыть (по правам) |
| DELETE | /api/tasks/:id | удалить (автор или admin) |

Правила видимости: member видит задачи, где он исполнитель, общие
(`assignee_id IS NULL`) и созданные им; admin видит всё.

Сроки задач: устанавливаются при создании кем угодно, но **переносить срок
может только администратор** (PATCH с `deadline` от сотрудника → 403).

## Push-уведомления

- Уведомления о **новой задаче** приходят исполнителю (или всем, если задача
  общая), кроме самого автора.
- **Напоминания о сроке** — ежедневно в 09:00 (Europe/Moscow) за **7, 3 и
  1 день** до дедлайна, только по невыполненным задачам; без дублей
  (журнал отправок `push_sent_log`).
- Включение: ключи VAPID в `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`). Без ключей пуш-подсистема тихо выключена, приложение
  работает как раньше. Генерация ключей:
  `node -e "console.log(require('web-push').generateVAPIDKeys())"`.
- Пользователь включает уведомления кнопкой в приложении (баннер после
  входа). На iPhone пуши работают только в **установленном** PWA
  (iOS ≥ 16.4, «На экран Домой»); на Android — и в браузере, и в PWA.

| Метод | Путь | Описание |
|---|---|---|
| GET | /api/push/vapid-public-key | публичный VAPID-ключ (или null) |
| POST | /api/push/subscribe | сохранить push-подписку устройства |
| POST | /api/push/unsubscribe | удалить подписку (при выходе) |
| POST | /api/admin/users | создать сотрудника (только админ) |
| DELETE | /api/admin/users/:id | удалить сотрудника (soft-delete; только админ) |
| POST | /api/admin/users/:id/password | сменить пароль пользователю (только админ) |

## Управление пользователями

Администратор открывает экран «Сотрудники» **тапом по своему имени** в правом
верхнем углу. Доступно: добавление сотрудника (логин латиницей, имя, пароль),
удаление (мягкое: логин освобождается, вход и push отключаются, задачи и имена
в истории сохраняются; удалить самого себя нельзя) и смена пароля любому
пользователю (все его refresh-токены отзываются — потребуется заново войти).

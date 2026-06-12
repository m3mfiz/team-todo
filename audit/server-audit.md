# Аудит серверов — проект team-todo

Дата аудита: 2026-06-12

## 1. Локальный dev-сервер (эта машина)

| Параметр | Значение |
|---|---|
| ОС | Ubuntu 24.04.4 LTS |
| Node | v18.19.1 |
| npm | 9.2.0 |
| Python | 3.12 |
| RAM | 2 GB (≈1.2 GB available) |
| Диск | 19 GB, свободно ~11 GB |
| Postgres | **нет** |
| Docker | **нет** (нет доступа) |
| Caddy / nginx локально | **нет** |

### Занятые порты (ss -tlnp)

| Порт | Сервис |
|---|---|
| 22 | sshd |
| 443 | xray (VPN-нода) |
| 8080 (10.8.0.4) | statuspage / VPN dashboard |
| 62789 (127.0.0.1) | локальный служебный процесс |
| 53 | systemd-resolved |

**Вывод:** порт **3002** свободен и выбран для team-todo (3001 зарезервирован
за lab-booking на проде; держим единообразную карту портов на обоих серверах).

## 2. Удалённый prod-сервер (вводные из проекта lab-booking)

Прямой SSH-аудит с dev-машины на момент проверки невозможен
(`ssh 138.16.178.200:22 → connection timed out` — доступ, по-видимому,
ограничен файрволом/VPN). Данные ниже взяты из `lab-booking/CLAUDE.md` —
актуального операционного описания этого же сервера.

| Параметр | Значение |
|---|---|
| Хост | 138.16.178.200 |
| Пользователь | m3mfis |
| SSH-ключ | `~/.ssh/id_ed25519_github` |
| Домен | `ask4k.live` (Let's Encrypt auto-TLS) |
| Reverse proxy | **Caddy** (HTTP/2 + HTTP/3), фронтит `:3001` |
| Процесс-менеджер | **PM2** (lab-booking: `instances: 1`, fork) |
| Node на проде | **22** |
| БД на проде | Postgres (используется lab-booking) |
| TZ | Europe/Moscow (задаётся через ecosystem.config.cjs) |
| Существующие сервисы | lab-booking (Fastify 5) на порту **3001** |
| Деплой | git pull --ff-only + pm2 restart (см. README) |

### Риски конфликтов и их закрытие

1. **Порт**: lab-booking занимает 3001 → team-todo работает на **3002**. Других
   известных слушателей на 3002 нет.
2. **PM2-имя процесса**: используем уникальное имя `team-todo`.
3. **Caddy**: добавляется отдельный site-блок (поддомен `todo.ask4k.live` или
   path-маршрут) → `localhost:3002`; конфиг lab-booking не трогаем.
4. **БД**: lab-booking использует Postgres. Чтобы не создавать связности и не
   рисковать чужой БД, team-todo использует **SQLite (better-sqlite3)** —
   см. решение ниже.
5. **TZ**: наследуем Europe/Moscow в ecosystem.config.cjs (единообразие с
   lab-booking; влияет на трактовку дедлайнов).

## 3. Решение по стеку

- **SQLite (better-sqlite3 ^11)** вместо Postgres: на dev-машине Postgres нет,
  команда из 5 человек — нагрузка тривиальная, нулевое администрирование,
  файл БД лежит рядом с приложением и исключён из git. Полная изоляция от
  Postgres lab-booking на проде.
- **Fastify 4.x** (не 5.x): Fastify 5 требует Node ≥20, а dev-машина на
  Node 18.19. Fastify 4 работает и на Node 18, и на Node 22 (prod).
- **Vite 5 + React 18 + vite-plugin-pwa**: совместимы с Node 18; PWA для
  установки на iPhone/Android.
- Монорепа npm workspaces `packages/server` + `packages/client` — зеркалит
  конвенции lab-booking (единый стиль обслуживания обоих проектов).

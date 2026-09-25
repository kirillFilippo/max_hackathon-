# ─────────────────────────────────────────────────────────────────────────────
# Бот-ассистент организатора досуговых мероприятий в MAX.
# Сборка многоступенчатая: dev-зависимости не попадают в runtime-образ.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS build
WORKDIR /app

# Сначала только манифесты — слой с зависимостями кешируется между сборками.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ca-certificates — системное хранилище корневых сертификатов,
# tzdata — корректная работа APP_TZ.
# Дополнительный сертификат MAX/Минцифры встраивать НЕ обязательно:
# образ и бот работают на системных сертификатах. Если потребуется — см. README.
RUN apk add --no-cache ca-certificates tzdata

# Каталог для снимка памяти на время обрыва связи с базой (OFFLINE_STATE_PATH).
# Создаём до смены пользователя: том compose унаследует владельца node.
RUN mkdir -p /app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN chown -R node:node /app
USER node

# 8080 — только для BOT_MODE=webhook, 8090 — мини-приложение (вопросы и анкета).
EXPOSE 8080 8090

# Схема БД приводится к актуальной версии при старте (миграции в src/db/migrations.ts).
CMD ["node", "dist/index.js"]

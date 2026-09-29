/**
 * Миграции схемы. Хранятся строками в коде (а не отдельными .sql-файлами), чтобы
 * не настраивать копирование файлов в сборку Docker: `tsc` не переносит .sql.
 * Каждая миграция применяется один раз и фиксируется в schema_migrations.
 */
export interface Migration {
  version: string;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: '0001_init',
    description: 'базовая схема: пользователи, события, участники, покупки, шаблоны, сессии',
    sql: `
CREATE TABLE IF NOT EXISTS users (
  user_id        bigint PRIMARY KEY,
  name           text NOT NULL DEFAULT '',
  username       text,
  contact        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id             text PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  starts_at      timestamptz NOT NULL,
  place          text NOT NULL,
  place_lat      double precision,
  place_lon      double precision,
  limit_count    integer,
  status         text NOT NULL DEFAULT 'published',
  organizer_id   bigint NOT NULL,
  organizer_name text NOT NULL DEFAULT '',
  fields         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS events_status_starts_idx ON events (status, starts_at);
CREATE INDEX IF NOT EXISTS events_organizer_idx ON events (organizer_id, starts_at);

CREATE TABLE IF NOT EXISTS participants (
  id              text PRIMARY KEY,
  event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id         bigint NOT NULL,
  name            text NOT NULL,
  username        text,
  contact         text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending',
  answers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  waitlisted      boolean NOT NULL DEFAULT false,
  confirm_sent_at timestamptz,
  final_sent_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS participants_event_idx ON participants (event_id, created_at);

CREATE TABLE IF NOT EXISTS event_items (
  id         text PRIMARY KEY,
  event_id   text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title      text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_items_event_idx ON event_items (event_id, position);

-- Бронь: item_id — первичный ключ, поэтому одну позицию нельзя забронировать дважды.
CREATE TABLE IF NOT EXISTS reservations (
  item_id      text PRIMARY KEY REFERENCES event_items(id) ON DELETE CASCADE,
  event_id     text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL,
  user_name    text NOT NULL,
  reserved_at  timestamptz NOT NULL DEFAULT now(),
  note         text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS reservations_event_idx ON reservations (event_id);
CREATE INDEX IF NOT EXISTS reservations_user_idx ON reservations (event_id, user_id);

CREATE TABLE IF NOT EXISTS templates (
  id         text PRIMARY KEY,
  owner_id   bigint NOT NULL,
  name       text NOT NULL,
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS templates_owner_idx ON templates (owner_id, name);

CREATE TABLE IF NOT EXISTS sessions (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
`,
  },
  {
    version: '0002_event_answer_mode',
    description: 'режим анкеты у события: авто по весу вопросов, чат или мини-приложение',
    sql: `
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS answer_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_answer_mode_check;

ALTER TABLE events
  ADD CONSTRAINT events_answer_mode_check
  CHECK (answer_mode IN ('auto', 'chat', 'miniapp'));
`,
  },
  {
    version: '0003_drop_settlements',
    description: 'расчёты убраны из продукта: удаляем таблицу переводов и денежные поля',
    sql: `
DROP TABLE IF EXISTS transfer_requests;

ALTER TABLE reservations
  DROP COLUMN IF EXISTS paid_kopecks;

ALTER TABLE reservations
  DROP COLUMN IF EXISTS paid_at;

ALTER TABLE users
  DROP COLUMN IF EXISTS bank_name;

ALTER TABLE users
  DROP COLUMN IF EXISTS payment_handle;
`,
  },
  {
    version: '0004_participants_user_idx',
    description: 'индекс по участнику: «Мои события» не должны читать всю таблицу заявок',
    sql: `
-- listForUser ищет заявки по user_id, а был только индекс по (event_id, created_at):
-- запрос читал всю таблицу. Индекс по user_id закрывает этот и подобные обходы.
CREATE INDEX IF NOT EXISTS participants_user_idx ON participants (user_id, created_at);
`,
  },
];

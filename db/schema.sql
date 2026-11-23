-- 洁灵 · Function-owned private schema.
-- Submitted through the reviewed migration flow; never packaged inside functions/.

-- Cross-instance lease + durable binding record for Cloud Agent/Environment creation.
-- expires_at_ms is epoch milliseconds from the Function clock so lease comparison
-- never depends on database/session timezone rendering.
CREATE TABLE app.cloud_lease (
  lock_key text PRIMARY KEY,
  record text,
  holder text NOT NULL,
  expires_at_ms bigint NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Shared folder fingerprint knowledge. Deliberately contains NO owner_id and NO
-- user paths: rows are generic "a folder named X with structure Y belongs to Z"
-- facts, comparable to the bundled markdown rules, so they are safe to share
-- across anonymous visitors.
CREATE TABLE app.knowledge (
  fingerprint text PRIMARY KEY,
  subject text NOT NULL,
  owner text NOT NULL,
  owner_kind text NOT NULL,
  purpose text NOT NULL,
  verdict text NOT NULL,
  -- 0..100 的整数百分比。平台 DDL 不支持 real；判定值本身只保留两位小数，故无损。
  confidence integer NOT NULL,
  rebuildable boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  consequence text NOT NULL,
  revival text NOT NULL DEFAULT '[]',
  evidence text NOT NULL DEFAULT '[]',
  origin text NOT NULL DEFAULT 'ai',
  hit_count integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_verdict_idx ON app.knowledge (verdict);

-- Abuse control for anonymous AI access: one global daily bucket plus short
-- per-caller windows. bucket is 'day:YYYY-MM-DD' or 'win:<hash>:<slot>'.
CREATE TABLE app.ai_usage (
  bucket text PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Conexiones del docente con plataformas externas (credenciales cifradas con AES-GCM)
CREATE TABLE integrations (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft','moodle')),
  data TEXT NOT NULL,          -- JSON cifrado: tokens / url+token de Moodle
  account TEXT,                -- email o nombre visible de la cuenta conectada
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (teacher_id, provider)
);

-- Identificador del alumno en la plataforma externa (para sincronizar sin duplicar)
ALTER TABLE students ADD COLUMN external_id TEXT;
CREATE INDEX idx_students_external ON students(group_id, external_id);

-- Vínculo de la actividad con su tarea en la plataforma externa: {"provider": "...", "id": "..."}
ALTER TABLE assessments ADD COLUMN external TEXT;

-- Claves de API personales para conectar otras plataformas (Zapier, Make, scripts...)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  last_used TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_api_keys_teacher ON api_keys(teacher_id);

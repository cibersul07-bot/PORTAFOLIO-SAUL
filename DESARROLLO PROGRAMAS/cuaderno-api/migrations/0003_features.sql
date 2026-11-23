-- Ajustes por grupo (fórmula de media, umbrales de color, plano de clase...) en JSON
ALTER TABLE groups ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';

-- Competencias del grupo y vínculo con actividades (JSON con ids de competencias)
CREATE TABLE competencies (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  description TEXT
);
CREATE INDEX idx_competencies_group ON competencies(group_id);
ALTER TABLE assessments ADD COLUMN competencies TEXT NOT NULL DEFAULT '[]';

-- Recursos del grupo (enlaces a documentos, vídeos, webs...)
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  kind TEXT NOT NULL DEFAULT 'link',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resources_group ON resources(group_id);

-- Quizzes con enlace público para alumnos
CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  -- JSON: [{ "q": "...", "options": ["a","b","c","d"], "answer": 0 }]
  questions TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quizzes_group ON quizzes(group_id);

CREATE TABLE quiz_responses (
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  answers TEXT NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (quiz_id, student_id)
);

-- Autoevaluación / coevaluación con rúbrica y enlace público
CREATE TABLE peer_evals (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  rubric_id TEXT NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('self','peer')),
  token TEXT NOT NULL UNIQUE,
  open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_peer_evals_group ON peer_evals(group_id);

CREATE TABLE peer_responses (
  eval_id TEXT NOT NULL REFERENCES peer_evals(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  levels TEXT NOT NULL,
  pct REAL NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (eval_id, evaluator_id, target_id)
);

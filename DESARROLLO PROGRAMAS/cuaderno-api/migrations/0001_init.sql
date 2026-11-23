-- Cuaderno docente: esquema inicial
PRAGMA foreign_keys = ON;

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  school_year TEXT,
  color TEXT,
  grading_scale REAL NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_groups_teacher ON groups(teacher_id);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  guardian_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_students_group ON students(group_id);

-- Categorías de evaluación con peso (p.ej. Exámenes 60%, Tareas 40%)
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1
);
CREATE INDEX idx_categories_group ON categories(group_id);

-- Columnas del cuaderno (actividades evaluables)
CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  rubric_id TEXT REFERENCES rubrics(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  date TEXT,
  term TEXT,
  max_score REAL NOT NULL DEFAULT 10,
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assessments_group ON assessments(group_id);

CREATE TABLE grades (
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score REAL,
  comment TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (assessment_id, student_id)
);

CREATE TABLE attendance (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note TEXT,
  PRIMARY KEY (student_id, date)
);
CREATE INDEX idx_attendance_group_date ON attendance(group_id, date);

-- Planificación de sesiones / diario de clase
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  objectives TEXT,
  content TEXT,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_group_date ON sessions(group_id, date);

-- Rúbricas (propiedad del docente, reutilizables)
CREATE TABLE rubrics (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- JSON: [{ "name": "...", "weight": 1, "levels": [{ "label": "...", "score": 4, "descriptor": "..." }] }]
  criteria TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rubrics_teacher ON rubrics(teacher_id);

-- Observaciones / anecdotario
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT (date('now')),
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','positive','negative')),
  text TEXT NOT NULL
);
CREATE INDEX idx_observations_student ON observations(student_id);

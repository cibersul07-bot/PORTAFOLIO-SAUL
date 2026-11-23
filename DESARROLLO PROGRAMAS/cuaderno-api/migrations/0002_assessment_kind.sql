-- Tipo de actividad: numeric (nota), emoji (caritas), check (hecho / no hecho)
ALTER TABLE assessments ADD COLUMN kind TEXT NOT NULL DEFAULT 'numeric' CHECK (kind IN ('numeric','emoji','check'));

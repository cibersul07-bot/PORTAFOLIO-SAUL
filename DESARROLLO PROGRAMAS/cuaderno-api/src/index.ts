import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import { hashPassword, verifyPassword } from "./auth";

type Bindings = { DB: D1Database; AI: Ai; JWT_SECRET: string; AI_MODEL?: string };
type Vars = { teacherId: string };
type C = Context<{ Bindings: Bindings; Variables: Vars }>;

const DEFAULT_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();
const id = () => crypto.randomUUID();
const bad = (msg: string, status: 400 | 401 | 403 | 404 | 409 = 400) => {
  throw new HTTPException(status, { message: msg });
};

async function body<T = Record<string, any>>(c: C): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return bad("JSON inválido");
  }
}
function need(obj: Record<string, any>, ...keys: string[]) {
  for (const k of keys) if (obj[k] === undefined || obj[k] === null || obj[k] === "") bad(`Falta el campo '${k}'`);
}

app.use("*", cors());
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Error interno" }, 500);
});

app.get("/", (c) =>
  c.json({
    name: "Cuaderno API",
    version: "1.0.0",
    docs: "Ver README.md. Autenticación: Bearer <token> obtenido en /auth/login",
  }),
);

// ───────────── Auth ─────────────
app.post("/auth/register", async (c) => {
  const b = await body(c);
  need(b, "email", "password", "name");
  if (String(b.password).length < 8) bad("La contraseña debe tener al menos 8 caracteres");
  const email = String(b.email).toLowerCase().trim();
  const exists = await c.env.DB.prepare("SELECT 1 FROM teachers WHERE email = ?").bind(email).first();
  if (exists) bad("El email ya está registrado", 409);
  const tid = id();
  await c.env.DB.prepare("INSERT INTO teachers (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
    .bind(tid, email, b.name, await hashPassword(b.password))
    .run();
  return c.json({ id: tid, email, name: b.name, token: await token(c, tid) }, 201);
});

app.post("/auth/login", async (c) => {
  const b = await body(c);
  need(b, "email", "password");
  const t = await c.env.DB.prepare("SELECT id, name, email, password_hash FROM teachers WHERE email = ?")
    .bind(String(b.email).toLowerCase().trim())
    .first<{ id: string; name: string; email: string; password_hash: string }>();
  if (!t || !(await verifyPassword(b.password, t.password_hash))) bad("Credenciales incorrectas", 401);
  return c.json({ id: t!.id, name: t!.name, email: t!.email, token: await token(c, t!.id) });
});

async function token(c: C, sub: string) {
  return sign({ sub, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, c.env.JWT_SECRET, "HS256");
}

// Todo lo de abajo requiere token
const api = new Hono<{ Bindings: Bindings; Variables: Vars }>();
api.use("*", async (c, next) => {
  const h = c.req.header("Authorization") ?? "";
  if (!h.startsWith("Bearer ")) bad("Token requerido", 401);
  try {
    const p = await verify(h.slice(7), c.env.JWT_SECRET, "HS256");
    c.set("teacherId", p.sub as string);
  } catch {
    bad("Token inválido o caducado", 401);
  }
  await next();
});

api.get("/me", async (c) => {
  const t = await c.env.DB.prepare("SELECT id, email, name, created_at FROM teachers WHERE id = ?")
    .bind(c.get("teacherId"))
    .first();
  return c.json(t);
});

// ───────────── Helpers de propiedad ─────────────
async function ownGroup(c: C, groupId: string) {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ? AND teacher_id = ?")
    .bind(groupId, c.get("teacherId"))
    .first<Record<string, any>>();
  if (!g) bad("Grupo no encontrado", 404);
  return g!;
}
async function ownStudent(c: C, studentId: string) {
  const s = await c.env.DB.prepare(
    "SELECT s.* FROM students s JOIN groups g ON g.id = s.group_id WHERE s.id = ? AND g.teacher_id = ?",
  )
    .bind(studentId, c.get("teacherId"))
    .first<Record<string, any>>();
  if (!s) bad("Alumno no encontrado", 404);
  return s!;
}
async function ownAssessment(c: C, aid: string) {
  const a = await c.env.DB.prepare(
    "SELECT a.* FROM assessments a JOIN groups g ON g.id = a.group_id WHERE a.id = ? AND g.teacher_id = ?",
  )
    .bind(aid, c.get("teacherId"))
    .first<Record<string, any>>();
  if (!a) bad("Evaluación no encontrada", 404);
  return a!;
}
async function ownRubric(c: C, rid: string) {
  const r = await c.env.DB.prepare("SELECT * FROM rubrics WHERE id = ? AND teacher_id = ?")
    .bind(rid, c.get("teacherId"))
    .first<Record<string, any>>();
  if (!r) bad("Rúbrica no encontrada", 404);
  return { ...r!, criteria: JSON.parse(r!.criteria) };
}

/** UPDATE genérico solo con columnas permitidas */
async function patch(c: C, table: string, rowId: string, b: Record<string, any>, allowed: string[], pk = "id") {
  const keys = allowed.filter((k) => k in b);
  if (!keys.length) bad("Nada que actualizar");
  await c.env.DB.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE ${pk} = ?`)
    .bind(...keys.map((k) => b[k]), rowId)
    .run();
}

// ───────────── Grupos ─────────────
const GROUP_FIELDS = ["name", "subject", "school_year", "color", "grading_scale"];

api.get("/groups", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.*, (SELECT COUNT(*) FROM students s WHERE s.group_id = g.id) AS student_count
     FROM groups g WHERE teacher_id = ? ORDER BY name`,
  )
    .bind(c.get("teacherId"))
    .all();
  return c.json(results);
});
api.post("/groups", async (c) => {
  const b = await body(c);
  need(b, "name");
  const gid = id();
  await c.env.DB.prepare(
    "INSERT INTO groups (id, teacher_id, name, subject, school_year, color, grading_scale) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(gid, c.get("teacherId"), b.name, b.subject ?? null, b.school_year ?? null, b.color ?? null, b.grading_scale ?? 10)
    .run();
  return c.json(await ownGroup(c, gid), 201);
});
api.get("/groups/:id", async (c) => c.json(await ownGroup(c, c.req.param("id"))));
api.patch("/groups/:id", async (c) => {
  await ownGroup(c, c.req.param("id"));
  await patch(c, "groups", c.req.param("id"), await body(c), GROUP_FIELDS);
  return c.json(await ownGroup(c, c.req.param("id")));
});
api.delete("/groups/:id", async (c) => {
  await ownGroup(c, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

// ───────────── Alumnos ─────────────
const STUDENT_FIELDS = ["first_name", "last_name", "email", "guardian_email", "notes"];

api.get("/groups/:id/students", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare("SELECT * FROM students WHERE group_id = ? ORDER BY last_name, first_name")
    .bind(c.req.param("id"))
    .all();
  return c.json(results);
});
/** Acepta un alumno o un array de alumnos (importación masiva) */
api.post("/groups/:id/students", async (c) => {
  const gid = c.req.param("id");
  await ownGroup(c, gid);
  const b = await body<any>(c);
  const list: Record<string, any>[] = Array.isArray(b) ? b : [b];
  if (!list.length || list.length > 200) bad("Envía entre 1 y 200 alumnos");
  list.forEach((s) => need(s, "first_name", "last_name"));
  const rows: Record<string, any>[] = list.map((s) => ({ ...s, id: id() }));
  await c.env.DB.batch(
    rows.map((s) =>
      c.env.DB.prepare(
        "INSERT INTO students (id, group_id, first_name, last_name, email, guardian_email, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(s.id, gid, s.first_name, s.last_name, s.email ?? null, s.guardian_email ?? null, s.notes ?? null),
    ),
  );
  return c.json(Array.isArray(b) ? rows.map((r) => r.id) : await ownStudent(c, rows[0].id), 201);
});
api.get("/students/:id", async (c) => c.json(await ownStudent(c, c.req.param("id"))));
api.patch("/students/:id", async (c) => {
  await ownStudent(c, c.req.param("id"));
  await patch(c, "students", c.req.param("id"), await body(c), STUDENT_FIELDS);
  return c.json(await ownStudent(c, c.req.param("id")));
});
api.delete("/students/:id", async (c) => {
  await ownStudent(c, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM students WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

// ───────────── Categorías de evaluación ─────────────
api.get("/groups/:id/categories", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare("SELECT * FROM categories WHERE group_id = ?").bind(c.req.param("id")).all();
  return c.json(results);
});
api.post("/groups/:id/categories", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const b = await body(c);
  need(b, "name");
  const cid = id();
  await c.env.DB.prepare("INSERT INTO categories (id, group_id, name, weight) VALUES (?, ?, ?, ?)")
    .bind(cid, c.req.param("id"), b.name, b.weight ?? 1)
    .run();
  return c.json({ id: cid, group_id: c.req.param("id"), name: b.name, weight: b.weight ?? 1 }, 201);
});
api.patch("/categories/:id", async (c) => {
  const cat = await c.env.DB.prepare(
    "SELECT k.id FROM categories k JOIN groups g ON g.id = k.group_id WHERE k.id = ? AND g.teacher_id = ?",
  )
    .bind(c.req.param("id"), c.get("teacherId"))
    .first();
  if (!cat) bad("Categoría no encontrada", 404);
  await patch(c, "categories", c.req.param("id"), await body(c), ["name", "weight"]);
  return c.json({ ok: true });
});
api.delete("/categories/:id", async (c) => {
  const r = await c.env.DB.prepare(
    "DELETE FROM categories WHERE id = ? AND group_id IN (SELECT id FROM groups WHERE teacher_id = ?)",
  )
    .bind(c.req.param("id"), c.get("teacherId"))
    .run();
  if (!r.meta.changes) bad("Categoría no encontrada", 404);
  return c.body(null, 204);
});

// ───────────── Evaluaciones (columnas) y notas ─────────────
const ASSESS_FIELDS = ["name", "date", "term", "max_score", "weight", "category_id", "rubric_id", "kind"];
const KINDS = ["numeric", "emoji", "check"];

api.get("/groups/:id/assessments", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const term = c.req.query("term");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM assessments WHERE group_id = ? ${term ? "AND term = ?" : ""} ORDER BY date, created_at`,
  )
    .bind(...(term ? [c.req.param("id"), term] : [c.req.param("id")]))
    .all();
  return c.json(results);
});
api.post("/groups/:id/assessments", async (c) => {
  const gid = c.req.param("id");
  await ownGroup(c, gid);
  const b = await body(c);
  need(b, "name");
  if (b.kind !== undefined && !KINDS.includes(b.kind)) bad(`kind debe ser uno de ${KINDS.join(", ")}`);
  if (b.rubric_id) await ownRubric(c, b.rubric_id);
  const aid = id();
  await c.env.DB.prepare(
    "INSERT INTO assessments (id, group_id, category_id, rubric_id, name, date, term, max_score, weight, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(aid, gid, b.category_id ?? null, b.rubric_id ?? null, b.name, b.date ?? null, b.term ?? null, b.max_score ?? 10, b.weight ?? 1, b.kind ?? "numeric")
    .run();
  return c.json(await ownAssessment(c, aid), 201);
});
api.patch("/assessments/:id", async (c) => {
  await ownAssessment(c, c.req.param("id"));
  const pb = await body(c);
  if (pb.kind !== undefined && !KINDS.includes(pb.kind)) bad(`kind debe ser uno de ${KINDS.join(", ")}`);
  await patch(c, "assessments", c.req.param("id"), pb, ASSESS_FIELDS);
  return c.json(await ownAssessment(c, c.req.param("id")));
});
api.delete("/assessments/:id", async (c) => {
  await ownAssessment(c, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM assessments WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

api.get("/assessments/:id/grades", async (c) => {
  await ownAssessment(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare("SELECT * FROM grades WHERE assessment_id = ?").bind(c.req.param("id")).all();
  return c.json(results);
});
/** body: [{ student_id, score, comment? }] — upsert masivo */
api.put("/assessments/:id/grades", async (c) => {
  const a = await ownAssessment(c, c.req.param("id"));
  const list = await body<any[]>(c);
  if (!Array.isArray(list) || !list.length) bad("Envía un array de notas");
  const { results: valid } = await c.env.DB.prepare("SELECT id FROM students WHERE group_id = ?").bind(a.group_id).all<{ id: string }>();
  const ok = new Set(valid.map((v) => v.id));
  for (const g of list) {
    if (!ok.has(g.student_id)) bad(`Alumno ${g.student_id} no pertenece al grupo`);
    if (g.score !== null && g.score !== undefined && (g.score < 0 || g.score > a.max_score))
      bad(`Nota fuera de rango (0-${a.max_score}) para ${g.student_id}`);
  }
  await c.env.DB.batch(
    list.map((g) =>
      c.env.DB.prepare(
        `INSERT INTO grades (assessment_id, student_id, score, comment) VALUES (?, ?, ?, ?)
         ON CONFLICT(assessment_id, student_id) DO UPDATE SET score = excluded.score, comment = excluded.comment, updated_at = datetime('now')`,
      ).bind(a.id, g.student_id, g.score ?? null, g.comment ?? null),
    ),
  );
  return c.json({ saved: list.length });
});

/** Puntúa con rúbrica: body { student_id, levels: [indiceNivelPorCriterio] } → calcula y guarda la nota */
api.post("/assessments/:id/rubric-score", async (c) => {
  const a = await ownAssessment(c, c.req.param("id"));
  if (!a.rubric_id) bad("Esta evaluación no tiene rúbrica");
  const r = await ownRubric(c, a.rubric_id);
  const b = await body(c);
  need(b, "student_id", "levels");
  await ownStudent(c, b.student_id);
  if (!Array.isArray(b.levels) || b.levels.length !== r.criteria.length) bad("levels debe tener un índice por criterio");
  let got = 0, max = 0;
  r.criteria.forEach((cr: any, i: number) => {
    const lv = cr.levels[b.levels[i]];
    if (!lv) bad(`Nivel inválido en criterio ${i}`);
    const w = cr.weight ?? 1;
    got += lv.score * w;
    max += Math.max(...cr.levels.map((l: any) => l.score)) * w;
  });
  const score = Math.round((got / max) * a.max_score * 100) / 100;
  await c.env.DB.prepare(
    `INSERT INTO grades (assessment_id, student_id, score, comment) VALUES (?, ?, ?, ?)
     ON CONFLICT(assessment_id, student_id) DO UPDATE SET score = excluded.score, comment = excluded.comment, updated_at = datetime('now')`,
  )
    .bind(a.id, b.student_id, score, b.comment ?? `Rúbrica: ${JSON.stringify(b.levels)}`)
    .run();
  return c.json({ score, max_score: a.max_score });
});

// ───────────── Cuaderno completo y medias ─────────────
async function computeGradebook(c: C, gid: string, term?: string) {
  const g = await ownGroup(c, gid);
  const db = c.env.DB;
  const [students, cats, assess, grades] = await Promise.all([
    db.prepare("SELECT id, first_name, last_name FROM students WHERE group_id = ? ORDER BY last_name, first_name").bind(gid).all<any>(),
    db.prepare("SELECT * FROM categories WHERE group_id = ?").bind(gid).all<any>(),
    db.prepare(`SELECT * FROM assessments WHERE group_id = ? ${term ? "AND term = ?" : ""} ORDER BY date, created_at`)
      .bind(...(term ? [gid, term] : [gid])).all<any>(),
    db.prepare("SELECT gr.* FROM grades gr JOIN assessments a ON a.id = gr.assessment_id WHERE a.group_id = ?").bind(gid).all<any>(),
  ]);
  const scale = g.grading_scale ?? 10;
  const catWeight = new Map(cats.results.map((k: any) => [k.id, k.weight]));
  const gradeMap = new Map(grades.results.map((x: any) => [`${x.assessment_id}|${x.student_id}`, x]));

  const rows = students.results.map((s: any) => {
    const buckets = new Map<string, { sum: number; w: number }>();
    const scores: Record<string, number | null> = {};
    for (const a of assess.results) {
      const gr = gradeMap.get(`${a.id}|${s.id}`);
      scores[a.id] = gr?.score ?? null;
      if (gr?.score === null || gr?.score === undefined) continue;
      const key = a.category_id && catWeight.has(a.category_id) ? a.category_id : "_none";
      const bk = buckets.get(key) ?? { sum: 0, w: 0 };
      bk.sum += (gr.score / a.max_score) * a.weight;
      bk.w += a.weight;
      buckets.set(key, bk);
    }
    let total = 0, tw = 0;
    const by_category: Record<string, number> = {};
    for (const [k, bk] of buckets) {
      if (!bk.w) continue;
      const avg = bk.sum / bk.w;
      by_category[k] = Math.round(avg * scale * 100) / 100;
      const w = k === "_none" ? 1 : (catWeight.get(k) as number);
      total += avg * w;
      tw += w;
    }
    return {
      student: s,
      scores,
      by_category,
      average: tw ? Math.round((total / tw) * scale * 100) / 100 : null,
    };
  });
  return { group: g, categories: cats.results, assessments: assess.results, rows };
}

api.get("/groups/:id/gradebook", async (c) => c.json(await computeGradebook(c, c.req.param("id"), c.req.query("term"))));

api.get("/groups/:id/gradebook.csv", async (c) => {
  const gb = await computeGradebook(c, c.req.param("id"), c.req.query("term"));
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Apellidos", "Nombre", ...gb.assessments.map((a: any) => a.name), "Media"];
  const lines = [head.map(esc).join(",")];
  for (const r of gb.rows)
    lines.push([r.student.last_name, r.student.first_name, ...gb.assessments.map((a: any) => r.scores[a.id]), r.average].map(esc).join(","));
  return c.body("﻿" + lines.join("\n"), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="cuaderno.csv"; filename*=UTF-8''${encodeURIComponent(`cuaderno-${gb.group.name}.csv`)}`,
  });
});

// ───────────── Asistencia ─────────────
api.get("/groups/:id/attendance", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const from = c.req.query("from") ?? "0000-01-01";
  const to = c.req.query("to") ?? "9999-12-31";
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM attendance WHERE group_id = ? AND date BETWEEN ? AND ? ORDER BY date",
  )
    .bind(c.req.param("id"), from, to)
    .all();
  return c.json(results);
});
/** body: { date: 'YYYY-MM-DD', records: [{ student_id, status, note? }] } */
api.put("/groups/:id/attendance", async (c) => {
  const gid = c.req.param("id");
  await ownGroup(c, gid);
  const b = await body(c);
  need(b, "date", "records");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) bad("date debe ser YYYY-MM-DD");
  const { results: valid } = await c.env.DB.prepare("SELECT id FROM students WHERE group_id = ?").bind(gid).all<{ id: string }>();
  const ok = new Set(valid.map((v) => v.id));
  const STATUSES = ["present", "absent", "late", "excused"];
  for (const r of b.records) {
    if (!ok.has(r.student_id)) bad(`Alumno ${r.student_id} no pertenece al grupo`);
    if (!STATUSES.includes(r.status)) bad(`status debe ser uno de ${STATUSES.join(", ")}`);
  }
  await c.env.DB.batch(
    b.records.map((r: any) =>
      c.env.DB.prepare(
        `INSERT INTO attendance (group_id, student_id, date, status, note) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, note = excluded.note`,
      ).bind(gid, r.student_id, b.date, r.status, r.note ?? null),
    ),
  );
  return c.json({ saved: b.records.length });
});
api.get("/groups/:id/attendance/summary", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    `SELECT s.id AS student_id, s.first_name, s.last_name,
       SUM(a.status = 'present') AS present, SUM(a.status = 'absent') AS absent,
       SUM(a.status = 'late') AS late, SUM(a.status = 'excused') AS excused, COUNT(a.date) AS total
     FROM students s LEFT JOIN attendance a ON a.student_id = s.id
     WHERE s.group_id = ? GROUP BY s.id ORDER BY s.last_name, s.first_name`,
  )
    .bind(c.req.param("id"))
    .all();
  return c.json(results);
});

// ───────────── Planificación de sesiones ─────────────
const SESSION_FIELDS = ["date", "title", "objectives", "content", "done"];
api.get("/groups/:id/sessions", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare("SELECT * FROM sessions WHERE group_id = ? ORDER BY date").bind(c.req.param("id")).all();
  return c.json(results);
});
api.post("/groups/:id/sessions", async (c) => {
  await ownGroup(c, c.req.param("id"));
  const b = await body(c);
  need(b, "date", "title");
  const sid = id();
  await c.env.DB.prepare("INSERT INTO sessions (id, group_id, date, title, objectives, content, done) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(sid, c.req.param("id"), b.date, b.title, b.objectives ?? null, b.content ?? null, b.done ? 1 : 0)
    .run();
  return c.json({ id: sid, ...b }, 201);
});
async function ownSession(c: C, sid: string) {
  const s = await c.env.DB.prepare(
    "SELECT x.* FROM sessions x JOIN groups g ON g.id = x.group_id WHERE x.id = ? AND g.teacher_id = ?",
  )
    .bind(sid, c.get("teacherId"))
    .first();
  if (!s) bad("Sesión no encontrada", 404);
  return s;
}
api.patch("/sessions/:id", async (c) => {
  await ownSession(c, c.req.param("id"));
  await patch(c, "sessions", c.req.param("id"), await body(c), SESSION_FIELDS);
  return c.json(await ownSession(c, c.req.param("id")));
});
api.delete("/sessions/:id", async (c) => {
  await ownSession(c, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

// ───────────── Observaciones ─────────────
api.get("/students/:id/observations", async (c) => {
  await ownStudent(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare("SELECT * FROM observations WHERE student_id = ? ORDER BY date DESC")
    .bind(c.req.param("id"))
    .all();
  return c.json(results);
});
api.post("/students/:id/observations", async (c) => {
  await ownStudent(c, c.req.param("id"));
  const b = await body(c);
  need(b, "text");
  const oid = id();
  const date = b.date ?? new Date().toISOString().slice(0, 10);
  await c.env.DB.prepare("INSERT INTO observations (id, student_id, date, kind, text) VALUES (?, ?, ?, ?, ?)")
    .bind(oid, c.req.param("id"), date, b.kind ?? "note", b.text)
    .run();
  return c.json({ id: oid, student_id: c.req.param("id"), date, kind: b.kind ?? "note", text: b.text }, 201);
});
api.delete("/observations/:id", async (c) => {
  const r = await c.env.DB.prepare(
    `DELETE FROM observations WHERE id = ? AND student_id IN
       (SELECT s.id FROM students s JOIN groups g ON g.id = s.group_id WHERE g.teacher_id = ?)`,
  )
    .bind(c.req.param("id"), c.get("teacherId"))
    .run();
  if (!r.meta.changes) bad("Observación no encontrada", 404);
  return c.body(null, 204);
});

// ───────────── Rúbricas ─────────────
function validateCriteria(criteria: any) {
  if (!Array.isArray(criteria) || !criteria.length) bad("criteria debe ser un array no vacío");
  for (const cr of criteria) {
    if (!cr.name || !Array.isArray(cr.levels) || !cr.levels.length) bad("Cada criterio necesita name y levels[]");
    for (const l of cr.levels) if (typeof l.score !== "number" || !l.label) bad("Cada nivel necesita label y score numérico");
  }
}
api.get("/rubrics", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM rubrics WHERE teacher_id = ? ORDER BY created_at DESC")
    .bind(c.get("teacherId"))
    .all<any>();
  return c.json(results.map((r) => ({ ...r, criteria: JSON.parse(r.criteria) })));
});
api.post("/rubrics", async (c) => {
  const b = await body(c);
  need(b, "title", "criteria");
  validateCriteria(b.criteria);
  const rid = id();
  await c.env.DB.prepare("INSERT INTO rubrics (id, teacher_id, title, description, criteria) VALUES (?, ?, ?, ?, ?)")
    .bind(rid, c.get("teacherId"), b.title, b.description ?? null, JSON.stringify(b.criteria))
    .run();
  return c.json(await ownRubric(c, rid), 201);
});
api.get("/rubrics/:id", async (c) => c.json(await ownRubric(c, c.req.param("id"))));
api.patch("/rubrics/:id", async (c) => {
  await ownRubric(c, c.req.param("id"));
  const b = await body(c);
  if (b.criteria) {
    validateCriteria(b.criteria);
    b.criteria = JSON.stringify(b.criteria);
  }
  await patch(c, "rubrics", c.req.param("id"), b, ["title", "description", "criteria"]);
  return c.json(await ownRubric(c, c.req.param("id")));
});
api.delete("/rubrics/:id", async (c) => {
  await ownRubric(c, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM rubrics WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

// ───────────── IA (Workers AI) ─────────────
async function ask(c: C, system: string, user: string, maxTokens = 700) {
  const out: any = await c.env.AI.run((c.env.AI_MODEL || DEFAULT_AI_MODEL) as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
  });
  // Algunos modelos devuelven el JSON ya parseado como objeto
  const r = out?.response;
  return (r && typeof r === "object" ? JSON.stringify(r) : String(r ?? "")).trim();
}

/** body: { student_id, term?, tone?: 'formal'|'cercano' } → comentario para el boletín */
api.post("/ai/report-comment", async (c) => {
  const b = await body(c);
  need(b, "student_id");
  const s = await ownStudent(c, b.student_id);
  const gb = await computeGradebook(c, s.group_id, b.term);
  const row = gb.rows.find((r) => r.student.id === s.id)!;
  const att = await c.env.DB.prepare(
    "SELECT status, COUNT(*) n FROM attendance WHERE student_id = ? GROUP BY status",
  ).bind(s.id).all();
  const obs = await c.env.DB.prepare("SELECT date, kind, text FROM observations WHERE student_id = ? ORDER BY date DESC LIMIT 15")
    .bind(s.id).all();
  const notas = gb.assessments.map((a: any) => `${a.name}: ${row.scores[a.id] ?? "sin nota"}/${a.max_score}`).join("; ");
  const comment = await ask(
    c,
    "Eres un docente experimentado que redacta comentarios de boletín en español. Sé concreto, constructivo, " +
      "menciona fortalezas y un aspecto de mejora con una sugerencia práctica. Máximo 90 palabras. No inventes datos.",
    `Alumno: ${s.first_name}. Asignatura: ${gb.group.subject ?? gb.group.name}. Tono: ${b.tone ?? "formal"}.
Notas: ${notas || "ninguna"}. Media: ${row.average ?? "sin calcular"}/${gb.group.grading_scale}.
Asistencia: ${JSON.stringify(att.results)}.
Observaciones: ${obs.results.map((o: any) => `[${o.kind}] ${o.text}`).join(" | ") || "ninguna"}.`,
  );
  return c.json({ student_id: s.id, average: row.average, comment });
});

/** body: { topic, level?, criteria_count?, levels_count?, save? } → genera rúbrica */
api.post("/ai/rubric", async (c) => {
  const b = await body(c);
  need(b, "topic");
  const nC = Math.min(Math.max(Number(b.criteria_count ?? 4), 2), 8);
  const nL = Math.min(Math.max(Number(b.levels_count ?? 4), 2), 5);
  const raw = await ask(
    c,
    "Generas rúbricas de evaluación en español. Responde SOLO con JSON válido, sin texto adicional, con la forma " +
      '{"title": string, "description": string, "criteria": [{"name": string, "weight": number, "levels": [{"label": string, "score": number, "descriptor": string}]}]}. ' +
      "Los niveles van de mayor a menor puntuación.",
    `Tema/actividad: ${b.topic}. Nivel educativo: ${b.level ?? "secundaria"}. ${nC} criterios, ${nL} niveles por criterio (puntuaciones ${nL} a 1).`,
    1800,
  );
  let rubric: any;
  try {
    rubric = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    validateCriteria(rubric.criteria);
  } catch {
    return c.json({ error: "La IA devolvió un formato inválido, reintenta", raw }, 502);
  }
  if (b.save) {
    const rid = id();
    await c.env.DB.prepare("INSERT INTO rubrics (id, teacher_id, title, description, criteria) VALUES (?, ?, ?, ?, ?)")
      .bind(rid, c.get("teacherId"), rubric.title ?? b.topic, rubric.description ?? null, JSON.stringify(rubric.criteria))
      .run();
    return c.json(await ownRubric(c, rid), 201);
  }
  return c.json(rubric);
});

/** body: { group_id, topic, sessions?: n, start_date? } → propone planificación de sesiones (no guarda) */
api.post("/ai/plan", async (c) => {
  const b = await body(c);
  need(b, "group_id", "topic");
  const g = await ownGroup(c, b.group_id);
  const n = Math.min(Math.max(Number(b.sessions ?? 5), 1), 15);
  const raw = await ask(
    c,
    'Eres un planificador didáctico. Responde SOLO con un array JSON: [{"title": string, "objectives": string, "content": string}]. En español.',
    `Asignatura: ${g.subject ?? g.name}. Unidad/tema: ${b.topic}. Número de sesiones: ${n}.`,
    2000,
  );
  try {
    let plan: any;
    try {
      plan = JSON.parse(raw);
    } catch {
      plan = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    }
    if (!Array.isArray(plan)) plan = Object.values(plan ?? {}).find(Array.isArray);
    if (!Array.isArray(plan) || !plan.length) throw new Error("sin array");
    return c.json(plan);
  } catch {
    return c.json({ error: "La IA devolvió un formato inválido, reintenta", raw }, 502);
  }
});

app.route("/", api);
export default app;

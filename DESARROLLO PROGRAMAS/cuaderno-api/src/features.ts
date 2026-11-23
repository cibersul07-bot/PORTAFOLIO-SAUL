// Competencias, recursos, quizzes, auto/coevaluación, enlaces públicos para alumnos y copia de seguridad.
import type { Hono } from "hono";

type Env = { Bindings: { DB: D1Database; AI: Ai; JWT_SECRET: string }; Variables: { teacherId: string } };

type H = {
  ownGroup: (c: any, id: string) => Promise<any>;
  ownRubric: (c: any, id: string) => Promise<any>;
  body: <T = any>(c: any) => Promise<T>;
  need: (o: any, ...k: string[]) => void;
  bad: (msg: string, status?: 400 | 401 | 403 | 404 | 409) => never;
  patch: (c: any, table: string, id: string, b: any, allowed: string[]) => Promise<void>;
  id: () => string;
  ask: (c: any, system: string, user: string, maxTokens?: number) => Promise<string>;
};

const newToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
};
/** Fecha local del cliente (YYYY-MM-DD) o null para usar la del servidor */
const validDate = (d: any) => (typeof d === "string" && /^d{4}-d{2}-d{2}$/.test(d) ? d : null);
const parseJSON = (s: any, d: any) => {
  try {
    return typeof s === "string" ? JSON.parse(s) : (s ?? d);
  } catch {
    return d;
  }
};

function validateQuestions(qs: any, bad: H["bad"]) {
  if (!Array.isArray(qs) || !qs.length || qs.length > 50) bad("questions debe tener entre 1 y 50 preguntas");
  for (const q of qs) {
    if (!q.q || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) bad("Cada pregunta necesita q y 2-6 options");
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) bad("answer debe ser el índice de la opción correcta");
  }
}

export function registerFeatures(app: Hono<Env>, api: Hono<Env>, h: H) {
  const { ownGroup, ownRubric, body, need, bad, patch, id, ask } = h;
  const tid = (c: any) => c.get("teacherId");

  /** Comprueba que una fila de `table` pertenece a un grupo del docente */
  async function ownRow(c: any, table: string, rowId: string, label: string) {
    const r = await c.env.DB.prepare(
      `SELECT x.* FROM ${table} x JOIN groups g ON g.id = x.group_id WHERE x.id = ? AND g.teacher_id = ?`,
    )
      .bind(rowId, tid(c))
      .first();
    if (!r) bad(`${label} no encontrado`, 404);
    return r as any;
  }

  // ───────── Competencias ─────────
  api.get("/groups/:id/competencies", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const { results } = await c.env.DB.prepare("SELECT * FROM competencies WHERE group_id = ? ORDER BY code, name").bind(c.req.param("id")).all();
    return c.json(results);
  });
  api.post("/groups/:id/competencies", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const b = await body(c);
    const list: any[] = Array.isArray(b) ? b : [b];
    list.forEach((x) => need(x, "name"));
    const rows = list.map((x) => ({ id: id(), code: x.code ?? null, name: x.name, description: x.description ?? null }));
    await c.env.DB.batch(
      rows.map((r) =>
        c.env.DB.prepare("INSERT INTO competencies (id, group_id, code, name, description) VALUES (?, ?, ?, ?, ?)").bind(
          r.id, c.req.param("id"), r.code, r.name, r.description,
        ),
      ),
    );
    return c.json(Array.isArray(b) ? rows : rows[0], 201);
  });
  api.patch("/competencies/:id", async (c) => {
    await ownRow(c, "competencies", c.req.param("id"), "Competencia");
    await patch(c, "competencies", c.req.param("id"), await body(c), ["code", "name", "description"]);
    return c.json(await ownRow(c, "competencies", c.req.param("id"), "Competencia"));
  });
  api.delete("/competencies/:id", async (c) => {
    await ownRow(c, "competencies", c.req.param("id"), "Competencia");
    await c.env.DB.prepare("DELETE FROM competencies WHERE id = ?").bind(c.req.param("id")).run();
    return c.body(null, 204);
  });

  // ───────── Recursos ─────────
  const RES_KINDS = ["link", "video", "doc", "slides", "image", "other"];
  api.get("/groups/:id/resources", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const { results } = await c.env.DB.prepare("SELECT * FROM resources WHERE group_id = ? ORDER BY created_at DESC").bind(c.req.param("id")).all();
    return c.json(results);
  });
  api.post("/groups/:id/resources", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const b = await body(c);
    need(b, "title");
    if (b.url && !/^https?:\/\//i.test(b.url)) bad("La URL debe empezar por http:// o https://");
    const kind = RES_KINDS.includes(b.kind) ? b.kind : "link";
    const rid = id();
    await c.env.DB.prepare("INSERT INTO resources (id, group_id, title, url, kind, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(rid, c.req.param("id"), b.title, b.url ?? null, kind, b.notes ?? null)
      .run();
    return c.json(await ownRow(c, "resources", rid, "Recurso"), 201);
  });
  api.patch("/resources/:id", async (c) => {
    await ownRow(c, "resources", c.req.param("id"), "Recurso");
    const b = await body(c);
    if (b.url && !/^https?:\/\//i.test(b.url)) bad("La URL debe empezar por http:// o https://");
    if (b.kind && !RES_KINDS.includes(b.kind)) bad("Tipo de recurso no válido");
    await patch(c, "resources", c.req.param("id"), b, ["title", "url", "kind", "notes"]);
    return c.json(await ownRow(c, "resources", c.req.param("id"), "Recurso"));
  });
  api.delete("/resources/:id", async (c) => {
    await ownRow(c, "resources", c.req.param("id"), "Recurso");
    await c.env.DB.prepare("DELETE FROM resources WHERE id = ?").bind(c.req.param("id")).run();
    return c.body(null, 204);
  });

  // ───────── Quizzes ─────────
  const quizOut = (q: any) => ({ ...q, questions: parseJSON(q.questions, []), open: !!q.open });

  api.get("/groups/:id/quizzes", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const { results } = await c.env.DB.prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM quiz_responses r WHERE r.quiz_id = q.id) AS responses
       FROM quizzes q WHERE group_id = ? ORDER BY created_at DESC`,
    )
      .bind(c.req.param("id"))
      .all();
    return c.json(results.map(quizOut));
  });
  /** Crea el quiz y una actividad numérica vinculada donde caen las notas automáticamente */
  api.post("/groups/:id/quizzes", async (c) => {
    const gid = c.req.param("id");
    await ownGroup(c, gid);
    const b = await body(c);
    need(b, "title", "questions");
    validateQuestions(b.questions, bad);
    const qid = id(), aid = id();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO assessments (id, group_id, name, date, term, max_score, weight, kind) VALUES (?, ?, ?, COALESCE(?, date('now')), ?, 10, 1, 'numeric')",
      ).bind(aid, gid, `Quiz: ${b.title}`, validDate(b.date), b.term ?? null),
      c.env.DB.prepare("INSERT INTO quizzes (id, group_id, assessment_id, title, questions, token) VALUES (?, ?, ?, ?, ?, ?)").bind(
        qid, gid, aid, b.title, JSON.stringify(b.questions), newToken(),
      ),
    ]);
    return c.json(quizOut(await ownRow(c, "quizzes", qid, "Quiz")), 201);
  });
  api.patch("/quizzes/:id", async (c) => {
    await ownRow(c, "quizzes", c.req.param("id"), "Quiz");
    const b = await body(c);
    if (b.questions !== undefined) {
      validateQuestions(b.questions, bad);
      b.questions = JSON.stringify(b.questions);
    }
    if (b.open !== undefined) b.open = b.open ? 1 : 0;
    await patch(c, "quizzes", c.req.param("id"), b, ["title", "questions", "open"]);
    return c.json(quizOut(await ownRow(c, "quizzes", c.req.param("id"), "Quiz")));
  });
  api.delete("/quizzes/:id", async (c) => {
    await ownRow(c, "quizzes", c.req.param("id"), "Quiz");
    await c.env.DB.prepare("DELETE FROM quizzes WHERE id = ?").bind(c.req.param("id")).run();
    return c.body(null, 204);
  });
  api.get("/quizzes/:id/responses", async (c) => {
    const q = await ownRow(c, "quizzes", c.req.param("id"), "Quiz");
    const { results } = await c.env.DB.prepare(
      `SELECT r.student_id, r.answers, r.correct, r.total, r.created_at, s.first_name, s.last_name
       FROM quiz_responses r JOIN students s ON s.id = r.student_id WHERE r.quiz_id = ? ORDER BY s.last_name`,
    )
      .bind(q.id)
      .all<any>();
    return c.json(results.map((r) => ({ ...r, answers: parseJSON(r.answers, []) })));
  });
  /** Borra la respuesta de un alumno para que pueda repetir */
  api.delete("/quizzes/:id/responses/:sid", async (c) => {
    const q = await ownRow(c, "quizzes", c.req.param("id"), "Quiz");
    await c.env.DB.prepare("DELETE FROM quiz_responses WHERE quiz_id = ? AND student_id = ?").bind(q.id, c.req.param("sid")).run();
    return c.body(null, 204);
  });

  api.post("/ai/quiz", async (c) => {
    const b = await body(c);
    need(b, "topic");
    const n = Math.min(Math.max(Number(b.count ?? 5), 1), 15);
    const raw = await ask(
      c,
      'Creas cuestionarios de opción múltiple en español. Responde SOLO con JSON: {"questions": [{"q": string, "options": [string, string, string, string], "answer": número índice 0-3 de la correcta}]}. Una sola respuesta correcta, distractores plausibles, sin ambigüedades.',
      `Tema: ${b.topic}. Nivel: ${b.level ?? "adultos, capacitación para el trabajo"}. ${n} preguntas.`,
      2500,
    );
    try {
      let p = parseJSON(raw, null) ?? JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const qs = Array.isArray(p) ? p : (p.questions ?? Object.values(p).find(Array.isArray));
      const clean = qs.map((q: any) => ({ q: String(q.q ?? q.question), options: (q.options ?? []).map(String), answer: Number(q.answer) }));
      validateQuestions(clean, bad);
      return c.json({ questions: clean });
    } catch {
      return c.json({ error: "La IA devolvió un formato inválido, reintenta" }, 502);
    }
  });

  // ───────── Auto / coevaluación ─────────
  const evalOut = (e: any) => ({ ...e, open: !!e.open });
  api.get("/groups/:id/evals", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const { results } = await c.env.DB.prepare(
      `SELECT e.*, r.title AS rubric_title, (SELECT COUNT(*) FROM peer_responses p WHERE p.eval_id = e.id) AS responses
       FROM peer_evals e JOIN rubrics r ON r.id = e.rubric_id WHERE e.group_id = ? ORDER BY e.created_at DESC`,
    )
      .bind(c.req.param("id"))
      .all();
    return c.json(results.map(evalOut));
  });
  api.post("/groups/:id/evals", async (c) => {
    await ownGroup(c, c.req.param("id"));
    const b = await body(c);
    need(b, "title", "rubric_id", "mode");
    if (!["self", "peer"].includes(b.mode)) bad("mode debe ser self o peer");
    await ownRubric(c, b.rubric_id);
    const eid = id();
    await c.env.DB.prepare("INSERT INTO peer_evals (id, group_id, rubric_id, title, mode, token) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(eid, c.req.param("id"), b.rubric_id, b.title, b.mode, newToken())
      .run();
    return c.json(evalOut(await ownRow(c, "peer_evals", eid, "Evaluación")), 201);
  });
  api.patch("/evals/:id", async (c) => {
    await ownRow(c, "peer_evals", c.req.param("id"), "Evaluación");
    const b = await body(c);
    if (b.open !== undefined) b.open = b.open ? 1 : 0;
    await patch(c, "peer_evals", c.req.param("id"), b, ["title", "open"]);
    return c.json(evalOut(await ownRow(c, "peer_evals", c.req.param("id"), "Evaluación")));
  });
  api.delete("/evals/:id", async (c) => {
    await ownRow(c, "peer_evals", c.req.param("id"), "Evaluación");
    await c.env.DB.prepare("DELETE FROM peer_evals WHERE id = ?").bind(c.req.param("id")).run();
    return c.body(null, 204);
  });
  /** Respuestas + resumen por alumno evaluado (autoevaluación y media de compañeros) */
  api.get("/evals/:id/responses", async (c) => {
    const e = await ownRow(c, "peer_evals", c.req.param("id"), "Evaluación");
    const { results } = await c.env.DB.prepare(
      `SELECT p.*, ev.first_name AS ev_first, ev.last_name AS ev_last, t.first_name AS t_first, t.last_name AS t_last
       FROM peer_responses p JOIN students ev ON ev.id = p.evaluator_id JOIN students t ON t.id = p.target_id
       WHERE p.eval_id = ? ORDER BY t.last_name`,
    )
      .bind(e.id)
      .all<any>();
    const summary: Record<string, { target_id: string; name: string; self: number | null; peers: number[]; comments: string[] }> = {};
    for (const r of results) {
      const s = (summary[r.target_id] ||= { target_id: r.target_id, name: `${r.t_last}, ${r.t_first}`, self: null, peers: [], comments: [] });
      if (r.evaluator_id === r.target_id) s.self = r.pct;
      else s.peers.push(r.pct);
      if (r.comment) s.comments.push(r.comment);
    }
    return c.json({
      responses: results.map((r) => ({ ...r, levels: parseJSON(r.levels, []) })),
      summary: Object.values(summary).map((s) => ({
        ...s,
        peers_avg: s.peers.length ? s.peers.reduce((a, b) => a + b, 0) / s.peers.length : null,
        peers_count: s.peers.length,
      })),
    });
  });
  /** Vuelca los resultados a una actividad nueva del cuaderno. body: { source: 'self'|'peers'|'mix' } */
  api.post("/evals/:id/to-gradebook", async (c) => {
    const e = await ownRow(c, "peer_evals", c.req.param("id"), "Evaluación");
    const b = await body(c);
    const source = ["self", "peers", "mix"].includes(b.source) ? b.source : "mix";
    const { results } = await c.env.DB.prepare("SELECT evaluator_id, target_id, pct FROM peer_responses WHERE eval_id = ?").bind(e.id).all<any>();
    const by: Record<string, { self?: number; peers: number[] }> = {};
    for (const r of results) {
      const s = (by[r.target_id] ||= { peers: [] });
      if (r.evaluator_id === r.target_id) s.self = r.pct;
      else s.peers.push(r.pct);
    }
    const aid = id();
    const label = { self: "Autoevaluación", peers: "Coevaluación", mix: "Auto+Coevaluación" }[source as "self"];
    const stmts = [
      c.env.DB.prepare("INSERT INTO assessments (id, group_id, name, date, max_score, weight, kind) VALUES (?, ?, ?, COALESCE(?, date('now')), 10, 1, 'numeric')").bind(
        aid, e.group_id, `${label}: ${e.title}`, validDate(b.date),
      ),
    ];
    let n = 0;
    for (const [sid, s] of Object.entries(by)) {
      const pa = s.peers.length ? s.peers.reduce((a, b) => a + b, 0) / s.peers.length : undefined;
      const v = source === "self" ? s.self : source === "peers" ? pa : s.self != null && pa != null ? (s.self + pa) / 2 : (s.self ?? pa);
      if (v == null) continue;
      n++;
      stmts.push(
        c.env.DB.prepare("INSERT INTO grades (assessment_id, student_id, score) VALUES (?, ?, ?)").bind(aid, sid, Math.round(v * 1000) / 100),
      );
    }
    await c.env.DB.batch(stmts);
    return c.json({ assessment_id: aid, grades: n }, 201);
  });

  // ───────── Copia de seguridad (integraciones) ─────────
  api.get("/groups/:id/export", async (c) => {
    const g = await ownGroup(c, c.req.param("id"));
    const q = (sql: string) => c.env.DB.prepare(sql).bind(g.id).all().then((r: any) => r.results);
    const [students, categories, assessments, grades, attendance, sessions, observations, competencies, resources, quizzes] = await Promise.all([
      q("SELECT * FROM students WHERE group_id = ?"),
      q("SELECT * FROM categories WHERE group_id = ?"),
      q("SELECT * FROM assessments WHERE group_id = ?"),
      q("SELECT gr.* FROM grades gr JOIN assessments a ON a.id = gr.assessment_id WHERE a.group_id = ?"),
      q("SELECT * FROM attendance WHERE group_id = ?"),
      q("SELECT * FROM sessions WHERE group_id = ?"),
      q("SELECT o.* FROM observations o JOIN students s ON s.id = o.student_id WHERE s.group_id = ?"),
      q("SELECT * FROM competencies WHERE group_id = ?"),
      q("SELECT * FROM resources WHERE group_id = ?"),
      q("SELECT id, title, questions, open, created_at FROM quizzes WHERE group_id = ?"),
    ]);
    return c.json(
      { exported_at: new Date().toISOString(), group: g, students, categories, assessments, grades, attendance, sessions, observations, competencies, resources, quizzes },
      200,
      { "Content-Disposition": `attachment; filename="grupo.json"` },
    );
  });

  // ───────── Páginas públicas para alumnos (sin login, por token) ─────────
  const studentsOf = (c: any, gid: string) =>
    c.env.DB.prepare("SELECT id, first_name, last_name FROM students WHERE group_id = ? ORDER BY last_name, first_name").bind(gid).all().then((r: any) => r.results);

  app.get("/p/quiz/:token", async (c) => {
    const q = await c.env.DB.prepare("SELECT q.*, g.name AS group_name FROM quizzes q JOIN groups g ON g.id = q.group_id WHERE token = ?")
      .bind(c.req.param("token"))
      .first<any>();
    if (!q) bad("Cuestionario no encontrado", 404);
    const questions = parseJSON(q.questions, []).map((x: any) => ({ q: x.q, options: x.options })); // sin respuestas
    const { results: done } = await c.env.DB.prepare("SELECT student_id FROM quiz_responses WHERE quiz_id = ?").bind(q.id).all<any>();
    return c.json({ title: q.title, group: q.group_name, open: !!q.open, questions, students: await studentsOf(c, q.group_id), done: done.map((d: any) => d.student_id) });
  });
  app.post("/p/quiz/:token", async (c) => {
    const q = await c.env.DB.prepare("SELECT * FROM quizzes WHERE token = ?").bind(c.req.param("token")).first<any>();
    if (!q) bad("Cuestionario no encontrado", 404);
    if (!q.open) bad("El cuestionario está cerrado", 403);
    const b = await body(c);
    need(b, "student_id", "answers");
    const st = await c.env.DB.prepare("SELECT id FROM students WHERE id = ? AND group_id = ?").bind(b.student_id, q.group_id).first();
    if (!st) bad("Alumno no válido");
    const qs = parseJSON(q.questions, []);
    if (!Array.isArray(b.answers) || b.answers.length !== qs.length) bad("Responde todas las preguntas");
    const correct = qs.reduce((n: number, x: any, i: number) => n + (Number(b.answers[i]) === x.answer ? 1 : 0), 0);
    const prev = await c.env.DB.prepare("SELECT 1 FROM quiz_responses WHERE quiz_id = ? AND student_id = ?").bind(q.id, b.student_id).first();
    if (prev) bad("Ya enviaste este cuestionario", 409);
    const score = Math.round((correct / qs.length) * 1000) / 100;
    const stmts = [
      c.env.DB.prepare("INSERT INTO quiz_responses (quiz_id, student_id, answers, correct, total) VALUES (?, ?, ?, ?, ?)").bind(
        q.id, b.student_id, JSON.stringify(b.answers.map(Number)), correct, qs.length,
      ),
    ];
    if (q.assessment_id)
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO grades (assessment_id, student_id, score) VALUES (?, ?, ?)
           ON CONFLICT(assessment_id, student_id) DO UPDATE SET score = excluded.score, updated_at = datetime('now')`,
        ).bind(q.assessment_id, b.student_id, score),
      );
    await c.env.DB.batch(stmts);
    return c.json({ correct, total: qs.length, score, review: qs.map((x: any, i: number) => ({ answer: x.answer, yours: Number(b.answers[i]) })) });
  });

  app.get("/p/eval/:token", async (c) => {
    const e = await c.env.DB.prepare(
      "SELECT e.*, g.name AS group_name, r.title AS rubric_title, r.criteria FROM peer_evals e JOIN groups g ON g.id = e.group_id JOIN rubrics r ON r.id = e.rubric_id WHERE token = ?",
    )
      .bind(c.req.param("token"))
      .first<any>();
    if (!e) bad("Evaluación no encontrada", 404);
    const { results: done } = await c.env.DB.prepare("SELECT evaluator_id, target_id FROM peer_responses WHERE eval_id = ?").bind(e.id).all<any>();
    return c.json({
      title: e.title, group: e.group_name, mode: e.mode, open: !!e.open,
      rubric: { title: e.rubric_title, criteria: parseJSON(e.criteria, []) },
      students: await studentsOf(c, e.group_id), done,
    });
  });
  app.post("/p/eval/:token", async (c) => {
    const e = await c.env.DB.prepare("SELECT e.*, r.criteria FROM peer_evals e JOIN rubrics r ON r.id = e.rubric_id WHERE token = ?")
      .bind(c.req.param("token"))
      .first<any>();
    if (!e) bad("Evaluación no encontrada", 404);
    if (!e.open) bad("La evaluación está cerrada", 403);
    const b = await body(c);
    need(b, "evaluator_id", "levels");
    const target = e.mode === "self" ? b.evaluator_id : b.target_id;
    if (!target) bad("Elige a qué compañero evalúas");
    if (e.mode === "peer" && target === b.evaluator_id) bad("En coevaluación no puedes evaluarte a ti mismo");
    const { results: ok } = await c.env.DB.prepare("SELECT id FROM students WHERE group_id = ? AND id IN (?, ?)").bind(e.group_id, b.evaluator_id, target).all();
    if (ok.length !== (target === b.evaluator_id ? 1 : 2)) bad("Alumno no válido");
    const criteria = parseJSON(e.criteria, []);
    if (!Array.isArray(b.levels) || b.levels.length !== criteria.length) bad("Marca un nivel en cada criterio");
    let got = 0, max = 0;
    criteria.forEach((cr: any, i: number) => {
      const lv = cr.levels[b.levels[i]];
      if (!lv) bad(`Nivel inválido en el criterio ${i + 1}`);
      const w = cr.weight ?? 1;
      got += lv.score * w;
      max += Math.max(...cr.levels.map((l: any) => l.score)) * w;
    });
    const pct = got / max;
    await c.env.DB.prepare(
      `INSERT INTO peer_responses (eval_id, evaluator_id, target_id, levels, pct, comment) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(eval_id, evaluator_id, target_id) DO UPDATE SET levels = excluded.levels, pct = excluded.pct, comment = excluded.comment, created_at = datetime('now')`,
    )
      .bind(e.id, b.evaluator_id, target, JSON.stringify(b.levels.map(Number)), pct, b.comment ? String(b.comment).slice(0, 1000) : null)
      .run();
    return c.json({ ok: true, pct: Math.round(pct * 100) });
  });
}

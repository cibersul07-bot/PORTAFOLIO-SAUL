// Integraciones con LMS: Google Classroom, Microsoft Teams (Graph Education), Moodle y claves de API.
import type { Hono } from "hono";
import { sign, verify } from "hono/jwt";

type Bindings = {
  DB: D1Database;
  AI: Ai;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  // Solo para pruebas locales con servidores simulados
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_API_BASE?: string;
  GOOGLE_USERINFO_URL?: string;
  MS_AUTHORITY?: string;
  GRAPH_BASE?: string;
};
type Env = { Bindings: Bindings; Variables: { teacherId: string } };
type H = {
  ownGroup: (c: any, id: string) => Promise<any>;
  body: <T = any>(c: any) => Promise<T>;
  need: (o: any, ...k: string[]) => void;
  bad: (msg: string, status?: 400 | 401 | 403 | 404 | 409) => never;
  id: () => string;
};
type Provider = "google" | "microsoft" | "moodle";
type ExtStudent = { external_id: string; first_name: string; last_name: string; email: string | null };

// ───────── Cifrado de credenciales (AES-GCM con clave derivada del secreto) ─────────
const enc = new TextEncoder();
async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret + ":integrations:v1"));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
async function seal(secret: string, data: any) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(data))));
  return b64(iv) + "." + b64(ct);
}
async function unseal(secret: string, s: string) {
  const [iv, ct] = s.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
export async function sha256hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function registerIntegrations(app: Hono<Env>, api: Hono<Env>, h: H) {
  const { ownGroup, body, need, bad, id } = h;

  // ───────── Configuración de proveedores OAuth ─────────
  const conf = (env: Bindings, p: "google" | "microsoft") => {
    if (p === "google")
      return {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        authUrl: env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
        api: env.GOOGLE_API_BASE ?? "https://classroom.googleapis.com",
        userinfo: env.GOOGLE_USERINFO_URL ?? "https://openidconnect.googleapis.com/v1/userinfo",
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/classroom.courses.readonly",
          "https://www.googleapis.com/auth/classroom.rosters.readonly",
          "https://www.googleapis.com/auth/classroom.profile.emails",
          "https://www.googleapis.com/auth/classroom.coursework.students",
        ].join(" "),
        extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } as Record<string, string>,
      };
    const authority = env.MS_AUTHORITY ?? "https://login.microsoftonline.com/common";
    return {
      clientId: env.MS_CLIENT_ID,
      clientSecret: env.MS_CLIENT_SECRET,
      authUrl: `${authority}/oauth2/v2.0/authorize`,
      tokenUrl: `${authority}/oauth2/v2.0/token`,
      api: env.GRAPH_BASE ?? "https://graph.microsoft.com/v1.0",
      userinfo: `${env.GRAPH_BASE ?? "https://graph.microsoft.com/v1.0"}/me`,
      scopes: "offline_access openid email User.Read EduRoster.ReadBasic EduAssignments.ReadWrite",
      extra: { prompt: "select_account" } as Record<string, string>,
    };
  };
  const redirectUri = (c: any, p: string) => `${new URL(c.req.url).origin}/oauth/${p}/callback`;

  async function load(c: any, p: Provider) {
    const row = await c.env.DB.prepare("SELECT data, account FROM integrations WHERE teacher_id = ? AND provider = ?")
      .bind(c.get("teacherId"), p)
      .first();
    if (!row) return null;
    return { data: await unseal(c.env.JWT_SECRET, row.data), account: row.account as string | null };
  }
  async function save(c: any, teacherId: string, p: Provider, data: any, account: string | null) {
    await c.env.DB.prepare(
      `INSERT INTO integrations (teacher_id, provider, data, account) VALUES (?, ?, ?, ?)
       ON CONFLICT(teacher_id, provider) DO UPDATE SET data = excluded.data, account = COALESCE(excluded.account, integrations.account)`,
    )
      .bind(teacherId, p, await seal(c.env.JWT_SECRET, data), account)
      .run();
  }

  async function tokenRequest(url: string, params: Record<string, string>) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `Error ${r.status} al obtener el token`);
    return j;
  }

  /** Devuelve un access token válido, renovándolo si caducó */
  async function accessToken(c: any, p: "google" | "microsoft") {
    const cur = await load(c, p);
    if (!cur) bad(`Conecta primero tu cuenta de ${p === "google" ? "Google Classroom" : "Microsoft Teams"}`, 409);
    const d = cur!.data;
    if (d.expires_at > Date.now() + 60_000) return d.access_token as string;
    if (!d.refresh_token) bad("La conexión caducó: vuelve a conectar la cuenta", 409);
    const cf = conf(c.env, p);
    try {
      const t = await tokenRequest(cf.tokenUrl, {
        grant_type: "refresh_token",
        refresh_token: d.refresh_token,
        client_id: cf.clientId!,
        client_secret: cf.clientSecret!,
        ...(p === "microsoft" ? { scope: cf.scopes } : {}),
      });
      const nd = { access_token: t.access_token, refresh_token: t.refresh_token ?? d.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000 };
      await save(c, c.get("teacherId"), p, nd, null);
      return nd.access_token as string;
    } catch (e: any) {
      bad(`No se pudo renovar la conexión (${e.message}). Vuelve a conectar la cuenta.`, 409);
    }
  }

  /** fetch JSON a la API externa con mensajes de error legibles */
  async function xfetch(url: string, token: string, init: RequestInit = {}) {
    const r = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const t = await r.text();
    let j: any = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {}
    if (!r.ok) {
      const msg = j?.error?.message || j?.error_description || j?.message || t.slice(0, 200) || r.statusText;
      if (r.status === 401) bad(`La plataforma rechazó la sesión (${msg}). Vuelve a conectar la cuenta.`, 409);
      if (r.status === 403) bad(`Sin permiso en la plataforma: ${msg}`, 403);
      bad(`Error de la plataforma (${r.status}): ${msg}`);
    }
    return j;
  }

  async function gpaged(url: string, token: string, key: string) {
    const out: any[] = [];
    let page = "";
    for (let i = 0; i < 50; i++) {
      const j = await xfetch(url + (url.includes("?") ? "&" : "?") + (page ? `pageToken=${encodeURIComponent(page)}` : ""), token);
      out.push(...(j[key] ?? []));
      if (!j.nextPageToken) break;
      page = j.nextPageToken;
    }
    return out;
  }
  async function graphPaged(url: string, token: string) {
    const out: any[] = [];
    let next: string | undefined = url;
    for (let i = 0; next && i < 50; i++) {
      const j: any = await xfetch(next, token);
      out.push(...(j.value ?? []));
      next = j["@odata.nextLink"];
    }
    return out;
  }

  // ───────── Moodle (REST con token del usuario) ─────────
  const flatten = (obj: any, prefix = "", out: Record<string, string> = {}) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v !== null && typeof v === "object") flatten(v, key, out);
      else if (v !== undefined) out[key] = String(v);
    }
    return out;
  };
  async function moodle(m: { url: string; token: string }, fn: string, params: any = {}) {
    const r = await fetch(`${m.url}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ wstoken: m.token, wsfunction: fn, moodlewsrestformat: "json", ...flatten(params) }),
    }).catch(() => null);
    if (!r) bad("No se pudo conectar con el sitio Moodle");
    const j: any = await r!.json().catch(() => null);
    if (!r!.ok || j === null) bad(`Moodle respondió con error ${r!.status}. ¿La URL es correcta?`);
    if (j?.exception) bad(`Moodle: ${j.message || j.errorcode}`);
    return j;
  }
  const moodleUrl = (u: string) => {
    let x: URL;
    try {
      x = new URL(u.trim());
    } catch {
      return bad("URL de Moodle no válida");
    }
    const local = ["localhost", "127.0.0.1"].includes(x.hostname);
    if (x.protocol !== "https:" && !local) bad("La URL de Moodle debe empezar por https://");
    return (x.origin + x.pathname).replace(/\/+$/, "").replace(/\/(login|my|course)(\/.*)?$/, "");
  };

  // ───────── Estado de las integraciones ─────────
  api.get("/integrations", async (c) => {
    const { results } = await c.env.DB.prepare("SELECT provider, account, created_at FROM integrations WHERE teacher_id = ?").bind(c.get("teacherId")).all<any>();
    const by = Object.fromEntries(results.map((r) => [r.provider, r]));
    const st = (p: string, configured: boolean) => ({ configured, connected: !!by[p], account: by[p]?.account ?? null, since: by[p]?.created_at ?? null });
    return c.json({
      google: st("google", !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET)),
      microsoft: st("microsoft", !!(c.env.MS_CLIENT_ID && c.env.MS_CLIENT_SECRET)),
      moodle: st("moodle", true),
      redirect_uris: { google: redirectUri(c, "google"), microsoft: redirectUri(c, "microsoft") },
    });
  });

  api.get("/integrations/:p/start", async (c) => {
    const p = c.req.param("p") as "google" | "microsoft";
    if (!["google", "microsoft"].includes(p)) bad("Proveedor no válido", 404);
    const cf = conf(c.env, p);
    if (!cf.clientId || !cf.clientSecret) bad(`${p === "google" ? "Google" : "Microsoft"} aún no está configurado en el servidor (faltan las credenciales de la app).`, 409);
    const state = await sign({ sub: c.get("teacherId"), p, exp: Math.floor(Date.now() / 1000) + 600 }, c.env.JWT_SECRET, "HS256");
    const u = new URL(cf.authUrl);
    const q = { client_id: cf.clientId!, redirect_uri: redirectUri(c, p), response_type: "code", scope: cf.scopes, state, ...cf.extra };
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return c.json({ url: u.toString() });
  });

  // Vuelta del login de Google / Microsoft (pública: la identidad va firmada en `state`)
  app.get("/oauth/:p/callback", async (c) => {
    const p = c.req.param("p") as "google" | "microsoft";
    const back = (q: string) => c.redirect(`/#/integraciones?${q}`, 302);
    if (!["google", "microsoft"].includes(p)) return back("error=" + encodeURIComponent("Proveedor no válido"));
    const err = c.req.query("error");
    if (err) return back(`error=${encodeURIComponent(c.req.query("error_description") || err)}`);
    let sub: string;
    try {
      const s: any = await verify(c.req.query("state") || "", c.env.JWT_SECRET, "HS256");
      if (s.p !== p) throw new Error();
      sub = s.sub;
    } catch {
      return back("error=" + encodeURIComponent("La solicitud caducó. Vuelve a intentarlo."));
    }
    const cf = conf(c.env, p);
    try {
      const t = await tokenRequest(cf.tokenUrl, {
        grant_type: "authorization_code",
        code: c.req.query("code") || "",
        redirect_uri: redirectUri(c, p),
        client_id: cf.clientId!,
        client_secret: cf.clientSecret!,
        ...(p === "microsoft" ? { scope: cf.scopes } : {}),
      });
      let account: string | null = null;
      try {
        const me: any = await xfetch(cf.userinfo, t.access_token);
        account = me.email || me.mail || me.userPrincipalName || me.name || null;
      } catch {}
      await save(c, sub, p, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000 }, account);
      return back(`ok=${p}`);
    } catch (e: any) {
      return back(`error=${encodeURIComponent(e.message || "No se pudo conectar")}`);
    }
  });

  api.post("/integrations/moodle", async (c) => {
    const b = await body(c);
    need(b, "url", "token");
    const m = { url: moodleUrl(b.url), token: String(b.token).trim() };
    const info = await moodle(m, "core_webservice_get_site_info");
    if (!info?.userid) bad("Moodle no devolvió los datos del usuario. Revisa el token.");
    await save(c, c.get("teacherId"), "moodle", { ...m, userid: info.userid, sitename: info.sitename }, `${info.fullname} · ${info.sitename}`);
    return c.json({ ok: true, account: `${info.fullname} · ${info.sitename}` });
  });

  api.delete("/integrations/:p", async (c) => {
    await c.env.DB.prepare("DELETE FROM integrations WHERE teacher_id = ? AND provider = ?").bind(c.get("teacherId"), c.req.param("p")).run();
    return c.body(null, 204);
  });

  // ───────── Cursos y alumnos de cada plataforma ─────────
  async function courses(c: any, p: Provider) {
    if (p === "google") {
      const t = await accessToken(c, p);
      const list = await gpaged(`${conf(c.env, p).api}/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=100`, t!, "courses");
      return list.map((x: any) => ({ id: x.id, name: x.name, section: x.section ?? null }));
    }
    if (p === "microsoft") {
      const t = await accessToken(c, p);
      const list = await graphPaged(`${conf(c.env, p).api}/education/me/classes`, t!);
      return list.map((x: any) => ({ id: x.id, name: x.displayName, section: x.description ?? null }));
    }
    const m = (await load(c, "moodle"))?.data;
    if (!m) bad("Conecta primero tu sitio Moodle", 409);
    const list = await moodle(m, "core_enrol_get_users_courses", { userid: m.userid });
    return (list || []).map((x: any) => ({ id: String(x.id), name: x.fullname, section: x.shortname ?? null }));
  }

  async function roster(c: any, p: Provider, courseId: string): Promise<ExtStudent[]> {
    if (p === "google") {
      const t = await accessToken(c, p);
      const list = await gpaged(`${conf(c.env, p).api}/v1/courses/${encodeURIComponent(courseId)}/students?pageSize=100`, t!, "students");
      return list.map((s: any) => ({
        external_id: s.userId,
        first_name: s.profile?.name?.givenName || s.profile?.name?.fullName || "—",
        last_name: s.profile?.name?.familyName || "",
        email: s.profile?.emailAddress ?? null,
      }));
    }
    if (p === "microsoft") {
      const t = await accessToken(c, p);
      const base = `${conf(c.env, p).api}/education/classes/${encodeURIComponent(courseId)}`;
      const [members, teachers] = await Promise.all([graphPaged(`${base}/members`, t!), graphPaged(`${base}/teachers`, t!)]);
      const tIds = new Set(teachers.map((x: any) => x.id));
      return members
        .filter((u: any) => !tIds.has(u.id))
        .map((u: any) => {
          const [first, ...rest] = String(u.displayName || "—").split(" ");
          return {
            external_id: u.id,
            first_name: u.givenName || first,
            last_name: u.surname || rest.join(" "),
            email: u.mail || u.userPrincipalName || null,
          };
        });
    }
    const m = (await load(c, "moodle"))?.data;
    if (!m) bad("Conecta primero tu sitio Moodle", 409);
    const list = await moodle(m, "core_enrol_get_enrolled_users", { courseid: courseId });
    return (list || [])
      .filter((u: any) => !u.roles?.length || u.roles.some((r: any) => r.shortname === "student"))
      .map((u: any) => ({ external_id: String(u.id), first_name: u.firstname || "—", last_name: u.lastname || "", email: u.email ?? null }));
  }

  api.get("/integrations/:p/courses", async (c) => {
    const p = c.req.param("p") as Provider;
    if (!["google", "microsoft", "moodle"].includes(p)) bad("Proveedor no válido", 404);
    return c.json(await courses(c, p));
  });

  /** Vincula el grupo con un curso externo */
  api.post("/groups/:id/lms/link", async (c) => {
    const g = await ownGroup(c, c.req.param("id"));
    const b = await body(c);
    if (b.provider === null) {
      const { lms, ...rest } = g.settings;
      await c.env.DB.prepare("UPDATE groups SET settings = ? WHERE id = ?").bind(JSON.stringify(rest), g.id).run();
      return c.json({ ok: true });
    }
    need(b, "provider", "course_id");
    if (!["google", "microsoft", "moodle"].includes(b.provider)) bad("Proveedor no válido");
    const lms = { provider: b.provider, course_id: String(b.course_id), course_name: b.course_name ?? null, linked_at: new Date().toISOString() };
    await c.env.DB.prepare("UPDATE groups SET settings = ? WHERE id = ?").bind(JSON.stringify({ ...g.settings, lms }), g.id).run();
    return c.json({ ok: true, lms });
  });

  /** Importa/actualiza alumnos desde el curso vinculado (no borra a nadie) */
  api.post("/groups/:id/lms/roster", async (c) => {
    const g = await ownGroup(c, c.req.param("id"));
    const lms = g.settings?.lms;
    if (!lms) bad("Vincula primero este grupo con un curso");
    const ext = await roster(c, lms.provider, lms.course_id);
    const { results: local } = await c.env.DB.prepare("SELECT id, first_name, last_name, email, external_id FROM students WHERE group_id = ?").bind(g.id).all<any>();
    const byExt = new Map(local.filter((s) => s.external_id).map((s) => [s.external_id, s]));
    const byEmail = new Map(local.filter((s) => s.email).map((s) => [norm(s.email), s]));
    const byName = new Map(local.map((s) => [norm(`${s.first_name} ${s.last_name}`), s]));
    const stmts: D1PreparedStatement[] = [];
    let created = 0, linked = 0, unchanged = 0;
    const used = new Set<string>();
    for (const e of ext) {
      const extId = `${lms.provider}:${e.external_id}`;
      const m =
        byExt.get(extId) || (e.email && byEmail.get(norm(e.email))) || byName.get(norm(`${e.first_name} ${e.last_name}`));
      if (m && !used.has(m.id)) {
        used.add(m.id);
        if (m.external_id === extId && (!e.email || m.email === e.email)) unchanged++;
        else {
          linked++;
          stmts.push(c.env.DB.prepare("UPDATE students SET external_id = ?, email = COALESCE(email, ?) WHERE id = ?").bind(extId, e.email, m.id));
        }
      } else {
        created++;
        stmts.push(
          c.env.DB.prepare("INSERT INTO students (id, group_id, first_name, last_name, email, external_id) VALUES (?, ?, ?, ?, ?, ?)").bind(
            id(), g.id, e.first_name, e.last_name, e.email, extId,
          ),
        );
      }
    }
    for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
    return c.json({ total: ext.length, created, linked, unchanged, not_in_lms: local.length - used.size });
  });

  /** Envía las notas de una actividad a la plataforma (crea la tarea si hace falta) */
  api.post("/assessments/:id/lms/push", async (c) => {
    const a: any = await c.env.DB.prepare(
      "SELECT a.*, g.settings AS gsettings FROM assessments a JOIN groups g ON g.id = a.group_id WHERE a.id = ? AND g.teacher_id = ?",
    )
      .bind(c.req.param("id"), c.get("teacherId"))
      .first();
    if (!a) bad("Actividad no encontrada", 404);
    const lms = JSON.parse(a.gsettings || "{}").lms;
    if (!lms) bad("Vincula primero este grupo con un curso");
    const b = await body(c).catch(() => ({}) as any);
    const doReturn = !!b.return;
    const { results: grades } = await c.env.DB.prepare(
      "SELECT gr.score, s.external_id FROM grades gr JOIN students s ON s.id = gr.student_id WHERE gr.assessment_id = ? AND gr.score IS NOT NULL",
    )
      .bind(a.id)
      .all<any>();
    const prefix = `${lms.provider}:`;
    const scoreBy = new Map(grades.filter((g) => g.external_id?.startsWith(prefix)).map((g) => [g.external_id.slice(prefix.length), g.score]));
    const sinVinculo = grades.length - scoreBy.size;
    let ext = a.external ? JSON.parse(a.external) : null;
    if (ext && (ext.provider !== lms.provider || ext.course_id !== lms.course_id)) ext = null;
    const saveExt = (e: any) => c.env.DB.prepare("UPDATE assessments SET external = ? WHERE id = ?").bind(JSON.stringify(e), a.id).run();

    if (lms.provider === "moodle")
      bad("Moodle no permite crear calificaciones por API sin un módulo de tarea. Usa «Descargar CSV para Moodle» e impórtalo en Calificaciones → Importar → CSV.");

    if (lms.provider === "google") {
      const t = (await accessToken(c, "google"))!;
      const base = `${conf(c.env, "google").api}/v1/courses/${encodeURIComponent(lms.course_id)}/courseWork`;
      if (!ext) {
        const w = await xfetch(base, t, {
          method: "POST",
          body: JSON.stringify({ title: a.name, description: "Calificación sincronizada desde Cuaderno", maxPoints: a.max_score, workType: "ASSIGNMENT", state: "PUBLISHED" }),
        });
        ext = { provider: "google", course_id: lms.course_id, id: w.id, link: w.alternateLink ?? null };
        await saveExt(ext);
      }
      const subs = await gpaged(`${base}/${ext.id}/studentSubmissions?pageSize=100`, t, "studentSubmissions");
      let pushed = 0;
      for (const s of subs) {
        const score = scoreBy.get(s.userId);
        if (score == null) continue;
        await xfetch(`${base}/${ext.id}/studentSubmissions/${s.id}?updateMask=assignedGrade,draftGrade`, t, {
          method: "PATCH",
          body: JSON.stringify({ assignedGrade: score, draftGrade: score }),
        });
        if (doReturn) await xfetch(`${base}/${ext.id}/studentSubmissions/${s.id}:return`, t, { method: "POST", body: "{}" });
        pushed++;
      }
      return c.json({ pushed, without_link: sinVinculo, link: ext.link, returned: doReturn });
    }

    // Microsoft Teams
    const t = (await accessToken(c, "microsoft"))!;
    const base = `${conf(c.env, "microsoft").api}/education/classes/${encodeURIComponent(lms.course_id)}/assignments`;
    if (!ext) {
      const w = await xfetch(base, t, {
        method: "POST",
        body: JSON.stringify({
          displayName: a.name,
          instructions: { content: "Calificación sincronizada desde Cuaderno", contentType: "text" },
          grading: { "@odata.type": "#microsoft.graph.educationAssignmentPointsGradeType", maxPoints: a.max_score },
          assignTo: { "@odata.type": "#microsoft.graph.educationAssignmentClassRecipient" },
        }),
      });
      await xfetch(`${base}/${w.id}/publish`, t, { method: "POST", body: "{}" });
      ext = { provider: "microsoft", course_id: lms.course_id, id: w.id, link: w.webUrl ?? null };
      await saveExt(ext);
    }
    const subs = await graphPaged(`${base}/${ext.id}/submissions`, t);
    if (!subs.length)
      return c.json({ pushed: 0, without_link: sinVinculo, link: ext.link, pending: true, message: "Teams aún está preparando la tarea. Vuelve a pulsar «Enviar notas» en un minuto." });
    let pushed = 0;
    for (const s of subs) {
      const score = scoreBy.get(s.recipient?.userId);
      if (score == null) continue;
      const outs = await graphPaged(`${base}/${ext.id}/submissions/${s.id}/outcomes`, t);
      const po = outs.find((o: any) => o["@odata.type"] === "#microsoft.graph.educationPointsOutcome");
      if (!po) continue;
      await xfetch(`${base}/${ext.id}/submissions/${s.id}/outcomes/${po.id}`, t, {
        method: "PATCH",
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.educationPointsOutcome",
          points: { "@odata.type": "#microsoft.graph.educationAssignmentPointsGrade", points: score },
        }),
      });
      if (doReturn) await xfetch(`${base}/${ext.id}/submissions/${s.id}/return`, t, { method: "POST", body: "{}" });
      pushed++;
    }
    return c.json({ pushed, without_link: sinVinculo, link: ext.link, returned: doReturn });
  });

  /** CSV con email por alumno: para importar notas en Moodle (Calificaciones → Importar → CSV) u otras plataformas */
  api.get("/groups/:id/export/lms.csv", async (c) => {
    const g = await ownGroup(c, c.req.param("id"));
    const [st, as, gr] = await Promise.all([
      c.env.DB.prepare("SELECT id, first_name, last_name, email, external_id FROM students WHERE group_id = ? ORDER BY last_name, first_name").bind(g.id).all<any>(),
      c.env.DB.prepare("SELECT id, name FROM assessments WHERE group_id = ? ORDER BY date, created_at").bind(g.id).all<any>(),
      c.env.DB.prepare("SELECT gr.assessment_id, gr.student_id, gr.score FROM grades gr JOIN assessments a ON a.id = gr.assessment_id WHERE a.group_id = ?").bind(g.id).all<any>(),
    ]);
    const sc = new Map(gr.results.map((x) => [`${x.assessment_id}|${x.student_id}`, x.score]));
    const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Email address", "ID number", "First name", "Last name", ...as.results.map((a) => a.name)].map(q).join(",")];
    for (const s of st.results)
      lines.push(
        [s.email, s.external_id?.split(":").slice(1).join(":") ?? "", s.first_name, s.last_name, ...as.results.map((a) => sc.get(`${a.id}|${s.id}`) ?? "")]
          .map(q)
          .join(","),
      );
    return c.body("﻿" + lines.join("\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="notas-lms.csv"`,
    });
  });

  // ───────── Claves de API (otras plataformas) ─────────
  api.get("/api-keys", async (c) => {
    const { results } = await c.env.DB.prepare("SELECT id, name, prefix, last_used, created_at FROM api_keys WHERE teacher_id = ? ORDER BY created_at DESC")
      .bind(c.get("teacherId"))
      .all();
    return c.json(results);
  });
  api.post("/api-keys", async (c) => {
    const b = await body(c);
    need(b, "name");
    const raw = "ck_" + [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const kid = id();
    await c.env.DB.prepare("INSERT INTO api_keys (id, teacher_id, name, prefix, key_hash) VALUES (?, ?, ?, ?, ?)")
      .bind(kid, c.get("teacherId"), String(b.name).slice(0, 80), raw.slice(0, 10), await sha256hex(raw))
      .run();
    return c.json({ id: kid, name: b.name, key: raw }, 201); // la clave solo se muestra una vez
  });
  api.delete("/api-keys/:id", async (c) => {
    await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND teacher_id = ?").bind(c.req.param("id"), c.get("teacherId")).run();
    return c.body(null, 204);
  });
}

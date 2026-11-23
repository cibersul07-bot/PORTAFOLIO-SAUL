// Cuaderno — frontend SPA sin dependencias
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => isoLocal(new Date());
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "");
const COLORS = ["#3b5bdb", "#2b8a3e", "#e67700", "#c2255c", "#7048e8", "#0c8599", "#5c940d", "#d9480f"];
const STATUS = { present: "Presente", absent: "Falta", late: "Retraso", excused: "Justificada" };

const state = {
  token: localStorage.getItem("token"),
  me: JSON.parse(localStorage.getItem("me") || "null"),
  groups: [],
};

// ───────── API ─────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && state.token) {
    logout();
    throw new Error("Sesión caducada");
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3000);
}
const fail = (e) => toast(e.message || String(e), true);

/** Ejecuta fn con el botón en estado de carga */
async function busy(btn, fn) {
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> ${prev}`;
  try {
    return await fn();
  } catch (e) {
    fail(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

/** Diálogo modal con formulario; resuelve con FormData-objeto o null */
function modal(title, inner, { submit = "Guardar", wide = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    if (wide) d.style.width = "min(900px, 96vw)";
    d.innerHTML = `<div class="dlg-body"><form method="dialog">
      <h3>${esc(title)}</h3>${inner}
      <div class="row"><span class="spacer"></span>
        <button type="button" data-cancel>${submit ? "Cancelar" : "Cerrar"}</button>
        ${submit ? `<button class="primary" type="submit">${esc(submit)}</button>` : ""}
      </div></form></div>`;
    document.body.append(d);
    const form = $("form", d);
    let result = null;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      result = Object.fromEntries(fd);
      Object.defineProperty(result, "__fd", { value: fd });
      d.close();
    });
    $("[data-cancel]", d).onclick = () => d.close();
    d.addEventListener("close", () => {
      d.remove();
      resolve(result);
    });
    d.showModal();
    d._form = form;
  });
}

function logout() {
  state.token = null;
  state.me = null;
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  location.hash = "#/login";
}

// ───────── Router ─────────
async function route() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  // Páginas públicas para alumnos (no requieren sesión)
  if (parts[0] === "q" && parts[1]) return renderPublicQuiz(parts[1]);
  if (parts[0] === "e" && parts[1]) return renderPublicEval(parts[1]);
  if (!state.token) return renderAuth();
  if (parts[0] === "login") return (location.hash = "#/");
  try {
    state.groups = await api("/groups");
  } catch (e) {
    return fail(e);
  }
  if (parts[0] === "g" && parts[1]) return renderGroup(parts[1], parts[2] || "cuaderno");
  if (parts[0] === "rubricas") return renderRubrics();
  if (parts[0] === "integraciones") return renderIntegrations(new URLSearchParams(query));
  return renderHome();
}
window.addEventListener("hashchange", route);

function shell(active, content) {
  $("#app").innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand">📒 Cuaderno</div>
      <nav>
        <a href="#/" class="${active === "home" ? "active" : ""}">🏠 Inicio</a>
        <a href="#/rubricas" class="${active === "rubricas" ? "active" : ""}">📐 Rúbricas</a>
        <a href="#/integraciones" class="${active === "integraciones" ? "active" : ""}">🔌 Integraciones</a>
      </nav>
      <div class="section-label">Mis grupos</div>
      <nav>
        ${state.groups
          .map(
            (g) => `<a href="#/g/${g.id}" class="${active === g.id ? "active" : ""}">
              <span class="dot" style="background:${esc(g.color || COLORS[0])}"></span>${esc(g.name)}
              <span class="spacer"></span><small class="muted">${g.student_count}</small></a>`,
          )
          .join("")}
        <a href="#" id="new-group">＋ Nuevo grupo</a>
      </nav>
      <span class="spacer"></span>
      <div class="row"><span class="muted">${esc(state.me?.name)}</span><span class="spacer"></span>
        <button class="ghost" id="logout">Salir</button></div>
    </aside>
    <main><button class="menu-btn" id="menu">☰</button>${content}</main>
  </div>`;
  $("#logout").onclick = logout;
  $("#new-group").onclick = (e) => (e.preventDefault(), groupDialog());
  $("#menu").onclick = () => $("#sidebar").classList.toggle("open");
}

// ───────── Auth ─────────
function renderAuth(mode = "login") {
  const reg = mode === "register";
  $("#app").innerHTML = `
  <div class="auth"><div class="card">
    <div class="brand">📒 Cuaderno</div>
    <p class="muted">${reg ? "Crea tu cuenta de docente" : "Tu cuaderno de clase en la nube"}</p>
    <form id="auth">
      ${reg ? `<input name="name" placeholder="Nombre" required autocomplete="name">` : ""}
      <input name="email" type="email" placeholder="Email" required autocomplete="email">
      <input name="password" type="password" placeholder="Contraseña${reg ? " (mín. 8)" : ""}" required minlength="${reg ? 8 : 1}"
        autocomplete="${reg ? "new-password" : "current-password"}">
      <button class="primary" type="submit">${reg ? "Crear cuenta" : "Entrar"}</button>
    </form>
    <p class="muted" style="text-align:center">${reg ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?"}
      <a href="#" id="switch">${reg ? "Entrar" : "Regístrate"}</a></p>
  </div></div>`;
  $("#switch").onclick = (e) => (e.preventDefault(), renderAuth(reg ? "login" : "register"));
  $("#auth").onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    busy($("#auth button"), async () => {
      const r = await api(reg ? "/auth/register" : "/auth/login", { method: "POST", body });
      state.token = r.token;
      state.me = { id: r.id, name: r.name, email: r.email };
      localStorage.setItem("token", r.token);
      localStorage.setItem("me", JSON.stringify(state.me));
      location.hash = "#/";
      route();
    });
  };
}

// ───────── Inicio ─────────
// ───────── Mensajes motivacionales ─────────
const MOTIVATION = [
  ["🌱", "Cada clase es una semilla. No siempre verás la cosecha, pero siempre la estás sembrando."],
  ["✨", "Hoy alguien va a entender algo por primera vez gracias a ti."],
  ["🧭", "No enseñas solo un tema: enseñas a no rendirse ante lo difícil."],
  ["💪", "Los días difíciles también cuentan. Lo que haces importa, aunque hoy no lo parezca."],
  ["🔥", "La curiosidad se contagia. Llega con ganas y tu grupo te seguirá."],
  ["🎯", "Un pequeño avance de cada alumno vale más que un gran plan sin empezar."],
  ["📚", "Aprender nunca es tarde: tus alumnos de 15 y de 64 años son la prueba."],
  ["🤝", "Recordar el nombre y la historia de cada alumno también es enseñar."],
  ["🌟", "Celebra los aciertos en voz alta y corrige los errores en voz baja."],
  ["🛠️", "Equivocarse en clase no es fallar: es el laboratorio donde se aprende."],
  ["☕", "Cuídate tú también. Un docente descansado enseña el doble de bien."],
  ["🚀", "La tecnología cambia rápido; las ganas de aprender son lo que nunca pasa de moda."],
  ["🗝️", "Una buena pregunta abre más puertas que cien respuestas."],
  ["🌈", "Cada alumno avanza a su ritmo. Tu paciencia es parte de la lección."],
  ["🏁", "No hace falta que la clase sea perfecta. Hace falta que sea tuya y con corazón."],
  ["💡", "Lo que hoy te parece rutina, para alguien será el día en que todo hizo clic."],
  ["🙌", "Tu ejemplo enseña más que cualquier manual: sigue aprendiendo junto a ellos."],
  ["📝", "Evaluar no es juzgar: es mostrarle a cada uno cuánto ha crecido."],
  ["🌻", "Una palabra de ánimo a tiempo puede cambiar el rumbo de un alumno."],
  ["⏳", "Lo importante no es terminar el temario, sino que nadie se quede atrás."],
  ["🎓", "Enseñar es la profesión que hace posibles todas las demás."],
  ["🧩", "Cuando un alumno no entiende, no es un muro: es una invitación a explicarlo distinto."],
  ["🌄", "Nuevo día, nueva oportunidad de inspirar. ¡A por ello!"],
  ["❤️", "Gracias por elegir enseñar. Tu trabajo deja huella."],
];
const dayIndex = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}
function motivationCard(i) {
  const [icon, text] = MOTIVATION[((i % MOTIVATION.length) + MOTIVATION.length) % MOTIVATION.length];
  return `<div class="motivation" id="motivation" data-i="${i}">
    <div class="motivation-icon">${icon}</div>
    <div class="motivation-text"><small>Mensaje del día</small><p>${esc(text)}</p></div>
    <button class="ghost" id="next-msg" title="Otro mensaje" aria-label="Otro mensaje">↻</button>
  </div>`;
}

function renderHome() {
  let fecha = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  fecha = fecha.charAt(0).toUpperCase() + fecha.slice(1);
  const total = state.groups.reduce((n, g) => n + (g.student_count || 0), 0);
  shell(
    "home",
    `<div class="header"><div><h2>${greeting()}, ${esc(state.me?.name?.split(" ")[0])} 👋</h2>
      <div class="muted">${fecha}${state.groups.length ? ` · ${state.groups.length} grupo${state.groups.length > 1 ? "s" : ""} · ${total} alumnos` : ""}</div></div>
      <span class="spacer"></span>
      <button class="primary" id="add">＋ Nuevo grupo</button></div>
    ${motivationCard(dayIndex())}
    ${
      state.groups.length
        ? `<div class="grid-cards">${state.groups
            .map(
              (g) => `<div class="card group-card" data-id="${g.id}" style="border-left-color:${esc(g.color || COLORS[0])}">
              <h3>${esc(g.name)}</h3>
              <div class="muted">${esc(g.subject || "Sin asignatura")} ${g.school_year ? "· " + esc(g.school_year) : ""}</div>
              <p class="muted">${g.student_count} alumnos · escala 0–${g.grading_scale}</p></div>`,
            )
            .join("")}</div>`
        : `<div class="card empty"><h3>Aún no tienes grupos</h3><p>Crea tu primer grupo para empezar a evaluar.</p></div>`
    }`,
  );
  $("#add").onclick = () => groupDialog();
  const bindNext = () =>
    ($("#next-msg").onclick = () => {
      const box = $("#motivation");
      box.outerHTML = motivationCard(Number(box.dataset.i) + 1);
      bindNext();
    });
  bindNext();
  $$(".group-card").forEach((el) => (el.onclick = () => (location.hash = `#/g/${el.dataset.id}`)));
}

async function groupDialog(g) {
  const v = await modal(
    g ? "Editar grupo" : "Nuevo grupo",
    `<div class="form-grid">
      <label>Nombre<input name="name" required value="${esc(g?.name)}" placeholder="3º ESO B"></label>
      <label>Asignatura<input name="subject" value="${esc(g?.subject)}" placeholder="Matemáticas"></label>
      <label>Curso escolar<input name="school_year" value="${esc(g?.school_year || "2026-27")}"></label>
      <label>Escala de notas<input name="grading_scale" type="number" min="1" step="any" value="${esc(g?.grading_scale ?? 10)}"></label>
      <label>Color<select name="color">${COLORS.map((c) => `<option value="${c}" ${g?.color === c ? "selected" : ""} style="color:${c}">● ${c}</option>`).join("")}</select></label>
    </div>
    <h3 style="margin-top:6px">🧮 Fórmula de la media</h3>
    <div class="form-grid">
      <label>Cálculo<select name="formula">
        ${[["weighted", "Ponderada (pesos y categorías)"], ["mean", "Media simple"], ["median", "Mediana"]]
          .map(([k, l]) => `<option value="${k}" ${(g?.settings?.formula || "weighted") === k ? "selected" : ""}>${l}</option>`)
          .join("")}</select></label>
      <label>Descartar las peores notas<input name="drop_lowest" type="number" min="0" max="5" value="${esc(g?.settings?.drop_lowest ?? 0)}"></label>
    </div>
    <h3 style="margin-top:6px">🎨 Condicionales (colores)</h3>
    <div class="form-grid">
      <label>🔴 → 🟡 Aprobado desde<input name="pass" type="number" min="0" step="any" value="${esc(g?.settings?.pass ?? (g?.grading_scale ?? 10) * 0.6)}"></label>
      <label>🟡 → 🟢 Muy bien desde<input name="good" type="number" min="0" step="any" value="${esc(g?.settings?.good ?? (g?.grading_scale ?? 10) * 0.8)}"></label>
    </div>`,
  );
  if (!v) return;
  v.grading_scale = Number(v.grading_scale) || 10;
  const pass = Number(v.pass), good = Number(v.good);
  if (!(pass < good)) return toast("«Aprobado desde» debe ser menor que «Muy bien desde»", true);
  v.settings = { formula: v.formula, drop_lowest: Number(v.drop_lowest) || 0, pass, good };
  for (const k of ["formula", "drop_lowest", "pass", "good"]) delete v[k];
  try {
    const r = await api(g ? `/groups/${g.id}` : "/groups", { method: g ? "PATCH" : "POST", body: v });
    toast(g ? "Grupo actualizado" : "Grupo creado");
    if (g) route();
    else location.hash = `#/g/${r.id}`;
  } catch (e) {
    fail(e);
  }
}

// ───────── Grupo ─────────
const TABS = {
  cuaderno: "📊 Cuaderno",
  alumnos: "👥 Alumnos",
  asistencia: "✅ Asistencia",
  plano: "🪑 Plano",
  sesiones: "🗓️ Sesiones",
  quizzes: "❓ Quizzes",
  autoeval: "🪞 Auto/Coevaluación",
  recursos: "📎 Recursos",
};
// Umbrales de color del grupo activo (en % de la escala)
let TH = { pass: 0.6, good: 0.8 };
function setThresholds(g) {
  const sc = g.grading_scale || 10;
  const p = Number(g.settings?.pass ?? sc * 0.6) / sc, gd = Number(g.settings?.good ?? sc * 0.8) / sc;
  TH = p < gd ? { pass: p, good: gd } : { pass: 0.6, good: 0.8 };
}

async function renderGroup(gid, tab) {
  const g = state.groups.find((x) => x.id === gid);
  if (!g) return (location.hash = "#/");
  setThresholds(g);
  shell(
    gid,
    `<div class="header">
      <span class="dot" style="background:${esc(g.color || COLORS[0])};width:14px;height:14px"></span>
      <h2>${esc(g.name)}</h2><span class="muted">${esc(g.subject || "")}</span><span class="spacer"></span>
      <button class="magic-btn" id="magic">🪄 Magic box</button>
      <button id="rand" title="Alumno aleatorio">🎲</button>
      <button id="lms" title="Classroom, Teams, Moodle…">🔌 ${g.settings?.lms ? esc(LMS[g.settings.lms.provider]?.short || "LMS") : "LMS"}</button>
      <button id="export" title="Descargar copia de seguridad (JSON)">💾</button>
      <button id="edit-g">⚙️ Ajustes</button><button class="danger" id="del-g">Eliminar</button>
    </div>
    <div class="tabs">${Object.entries(TABS)
      .map(([k, v]) => `<a href="#/g/${gid}/${k}" class="${tab === k ? "active" : ""}">${v}</a>`)
      .join("")}</div>
    <div id="tab"><div class="empty"><span class="spin"></span></div></div>`,
  );
  $("#edit-g").onclick = () => groupDialog(g);
  $("#del-g").onclick = async () => {
    if (!confirm(`¿Eliminar el grupo "${g.name}" con todos sus alumnos, notas y asistencia? No se puede deshacer.`)) return;
    try {
      await api(`/groups/${gid}`, { method: "DELETE" });
      toast("Grupo eliminado");
      location.hash = "#/";
    } catch (e) {
      fail(e);
    }
  };
  $("#magic").onclick = () => magicBox(g);
  $("#rand").onclick = () => magicBox(g, "random");
  $("#lms").onclick = () => lmsDialog(g);
  $("#export").onclick = async () => {
    const res = await fetch(`/groups/${gid}/export`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return toast("No se pudo exportar", true);
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: `copia-${g.name}-${today()}.json` }).click();
    URL.revokeObjectURL(url);
    toast("Copia de seguridad descargada");
  };
  const fn =
    {
      cuaderno: tabGradebook,
      alumnos: tabStudents,
      asistencia: tabAttendance,
      plano: tabSeating,
      sesiones: tabSessions,
      quizzes: tabQuizzes,
      autoeval: tabEvals,
      recursos: tabResources,
    }[tab] || tabGradebook;
  try {
    await fn(g, $("#tab"));
  } catch (e) {
    fail(e);
  }
}

// ── Visual: avatares, colores y caritas
const KIND_INFO = {
  numeric: { icon: "🔢", label: "Nota", hint: "Número (0–máx.)" },
  emoji: { icon: "😁", label: "Caritas", hint: "Feliz · Sonriente · Seria · Triste" },
  check: { icon: "✅", label: "Hecho / No", hint: "Entregó o no entregó" },
};
const FACES = [
  { e: "😁", label: "Feliz", pct: 1 },
  { e: "🙂", label: "Sonriente", pct: 0.8 },
  { e: "😐", label: "Seria", pct: 0.6 },
  { e: "😟", label: "Triste", pct: 0.3 },
];
const faceFor = (pct) => (pct == null ? null : FACES.reduce((b, f) => (Math.abs(f.pct - pct) < Math.abs(b.pct - pct) ? f : b)));
const moodFor = (pct) =>
  pct == null ? "" : pct >= Math.max(TH.good, 0.9) ? "😁" : pct >= TH.good ? "🙂" : pct >= TH.pass ? "😐" : "😟";
const level = (pct) => (pct == null ? "none" : pct < TH.pass ? "bad" : pct < TH.good ? "mid" : "good");
const AV_COLORS = ["#4c6ef5", "#7950f2", "#e64980", "#f76707", "#2f9e44", "#1098ad", "#d6336c", "#5c7cfa", "#ae3ec9", "#0ca678"];
function avatar(s, size = 32) {
  const name = `${s.first_name} ${s.last_name}`;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ini = (s.first_name[0] || "") + (s.last_name[0] || "");
  return `<span class="avatar" style="--av:${AV_COLORS[h % AV_COLORS.length]};width:${size}px;height:${size}px;font-size:${size * 0.38}px">${esc(ini.toUpperCase())}</span>`;
}
const shortName = (s) => `${esc(s.first_name.split(" ")[0])} ${esc(s.last_name.split(" ")[0])}`;

// Contenido de una celda del cuaderno según el tipo de actividad
function cellHtml(a, sid, score) {
  const pct = score == null ? null : score / a.max_score;
  const lv = level(pct);
  if (a.kind === "emoji") {
    const f = faceFor(pct);
    return `<button class="cell-face lv-${lv}" data-face="${a.id}" data-s="${sid}" title="${f ? f.label : "Sin evaluar"}">${f ? f.e : "＋"}</button>`;
  }
  if (a.kind === "check") {
    const v = score == null ? "" : pct >= 0.5 ? "✓" : "✗";
    return `<button class="cell-check lv-${score == null ? "none" : pct >= 0.5 ? "good" : "bad"}" data-check="${a.id}" data-s="${sid}">${v || "·"}</button>`;
  }
  return `<div class="cell-num lv-${lv}"><input type="number" step="any" min="0" max="${a.max_score}" value="${score ?? ""}"
      data-a="${a.id}" data-s="${sid}" aria-label="Nota">${a.rubric_id ? `<button class="ghost mini" title="Evaluar con rúbrica" data-rub="${a.id}" data-s="${sid}">📐</button>` : ""}</div>`;
}

function statsHtml(gb, scale) {
  const avgs = gb.rows.map((r) => r.average).filter((v) => v != null);
  const mean = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
  const good = avgs.filter((v) => level(v / scale) === "good").length;
  const mid = avgs.filter((v) => level(v / scale) === "mid").length;
  const bad = avgs.filter((v) => level(v / scale) === "bad").length;
  const FORMULA = { weighted: "ponderada", mean: "media simple", median: "mediana" };
  const pend = gb.rows.length - avgs.length;
  const seg = (n, c) => (n ? `<span class="seg seg-${c}" style="flex:${n}" title="${n}"></span>` : "");
  return `<div class="stats">
    <div class="stat"><div class="stat-icon">${moodFor(mean == null ? null : mean / scale) || "📊"}</div>
      <div><small>Media del grupo · ${FORMULA[gb.formula] || "ponderada"}${gb.drop_lowest ? ` · sin ${gb.drop_lowest} peor${gb.drop_lowest > 1 ? "es" : ""}` : ""}</small><b class="lv-text-${level(mean == null ? null : mean / scale)}">${mean == null ? "—" : mean.toFixed(1)}</b></div></div>
    <div class="stat"><div class="stat-icon good">😁</div><div><small>Van muy bien</small><b>${good}</b></div></div>
    <div class="stat"><div class="stat-icon mid">😐</div><div><small>Pueden mejorar</small><b>${mid}</b></div></div>
    <div class="stat"><div class="stat-icon bad">😟</div><div><small>En riesgo</small><b>${bad}</b></div></div>
    <div class="stat wide"><div style="flex:1"><small>Distribución · ${gb.assessments.length} actividades${pend ? ` · ${pend} sin notas` : ""}</small>
      <div class="distbar">${seg(good, "good")}${seg(mid, "mid")}${seg(bad, "bad")}${seg(pend, "none")}</div></div></div>
  </div>`;
}

// ── Cuaderno de notas
async function tabGradebook(g, el, term = "", view = "actividades") {
  const q = term ? `?term=${encodeURIComponent(term)}` : "";
  const [gb, rubrics, all, att] = await Promise.all([
    api(`/groups/${g.id}/gradebook${q}`),
    api("/rubrics"),
    api(`/groups/${g.id}/assessments`),
    api(`/groups/${g.id}/attendance/summary`),
  ]);
  if (!el.isConnected) return; // el usuario cambió de pestaña mientras cargaba
  state.comps = gb.competencies;
  const terms = [...new Set(all.map((a) => a.term).filter(Boolean))];
  const catName = Object.fromEntries(gb.categories.map((c) => [c.id, c.name]));
  const attBy = Object.fromEntries(att.map((r) => [r.student_id, r]));
  const scale = g.grading_scale;
  const pct = (x) => Math.round(x * 100);

  const actTable = () => `<div class="table-wrap"><table class="grid gb"><thead><tr>
        <th class="sticky-col">Alumno</th>
        <th class="num" title="Asistencia">📅</th>
        ${gb.assessments
          .map(
            (a) => `<th class="num"><div class="col-head">
              <span class="kind-badge">${KIND_INFO[a.kind || "numeric"].icon}</span>
              <a href="#" data-edit-a="${a.id}" title="Editar">${esc(a.name)}</a>
              <small class="muted">${a.kind === "numeric" || !a.kind ? `/${a.max_score}` : ""}${a.weight != 1 ? ` ×${a.weight}` : ""}${a.date ? " · " + fmtDate(a.date) : ""}</small>
              <span class="row" style="gap:3px;justify-content:center">
                ${a.category_id ? `<span class="chip">${esc(catName[a.category_id])}</span>` : ""}
                ${a.rubric_id ? `<span class="chip">📐</span>` : ""}
                ${a.competencies?.length ? `<span class="chip" title="Competencias">🎯 ${a.competencies.length}</span>` : ""}
                ${a.kind === "numeric" || !a.kind ? `<button class="ghost mini" data-paste="${a.id}" title="Pegar columna desde Excel">📋</button>` : ""}
              </span></div></th>`,
          )
          .join("")}
        <th class="num">Media</th></tr></thead><tbody>
        ${gb.rows
          .map((r) => {
            const t = attBy[r.student.id];
            const ap = t?.total ? (t.present + t.late) / t.total : null;
            return `<tr><td class="sticky-col"><div class="who">${avatar(r.student)}<span>${esc(r.student.last_name)}, ${esc(r.student.first_name)}</span></div></td>
            <td class="num"><span class="att-dot lv-${level(ap)}" title="${ap == null ? "Sin registros" : pct(ap) + "% asistencia"}">${ap == null ? "·" : pct(ap) + "%"}</span></td>
            ${gb.assessments
              .map((a) => {
                const cm = r.comments?.[a.id];
                return `<td class="num gcell ${cm ? "has-comment" : ""}" data-ca="${a.id}" data-cs="${r.student.id}" title="${cm ? "💬 " + esc(cm) + "\n" : ""}Clic derecho: comentario">${cellHtml(a, r.student.id, r.scores[a.id])}</td>`;
              })
              .join("")}
            <td class="num" data-avg="${r.student.id}">${avgHtml(r.average, scale)}</td></tr>`;
          })
          .join("")}
      </tbody></table></div>`;

  const compTable = () =>
    !gb.competencies.length
      ? `<div class="card empty"><div style="font-size:40px">🎯</div>Aún no hay competencias.<br>Créalas con <b>🎯 Competencias</b> y vincúlalas a las actividades al editarlas.</div>`
      : `<div class="table-wrap"><table class="grid gb"><thead><tr><th class="sticky-col">Alumno</th>
        ${gb.competencies
          .map((k) => {
            const n = gb.assessments.filter((a) => a.competencies?.includes(k.id)).length;
            return `<th class="num"><div class="col-head"><b>${esc(k.code || "")}</b><span>${esc(k.name)}</span><small class="muted">${n} actividad${n === 1 ? "" : "es"}</small></div></th>`;
          })
          .join("")}<th class="num">Media</th></tr></thead><tbody>
        ${gb.rows
          .map(
            (r) => `<tr><td class="sticky-col"><div class="who">${avatar(r.student)}<span>${esc(r.student.last_name)}, ${esc(r.student.first_name)}</span></div></td>
            ${gb.competencies
              .map((k) => {
                const v = r.by_competency?.[k.id];
                return `<td class="num">${v == null ? `<span class="avg-pill lv-none">—</span>` : `<span class="avg-pill lv-${level(v / scale)}">${moodFor(v / scale)} ${v}</span>`}</td>`;
              })
              .join("")}<td class="num">${avgHtml(r.average, scale)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`;

  el.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <div class="seg-ctl"><button class="${view === "actividades" ? "on" : ""}" data-view="actividades">📝 Actividades</button>
        <button class="${view === "competencias" ? "on" : ""}" data-view="competencias">🎯 Competencias</button></div>
      <select id="term"><option value="">Todas las evaluaciones</option>${terms
        .map((t) => `<option ${t === term ? "selected" : ""}>${esc(t)}</option>`)
        .join("")}</select>
      <span class="spacer"></span>
      <button id="comps">🎯 Competencias (${gb.competencies.length})</button>
      <button id="cats">🏷️ Categorías (${gb.categories.length})</button>
      <button id="csv">⬇ CSV</button>
      <button class="primary" id="add-a">＋ Actividad</button>
    </div>
    ${
      !gb.rows.length
        ? `<div class="card empty">Añade alumnos en la pestaña <a href="#/g/${g.id}/alumnos">Alumnos</a>.</div>`
        : !gb.assessments.length
          ? `<div class="card empty"><div style="font-size:40px">📝</div>Crea la primera actividad con <b>＋ Actividad</b>.<br>
             Puedes evaluar con nota, con <b>caritas</b> 😁🙂😐😟 o con ✓/✗.</div>`
          : `<div id="stats">${statsHtml(gb, scale)}</div>
      ${view === "competencias" ? compTable() : actTable()}
      <div class="legend"><span><i class="sw good"></i>≥ ${+(TH.good * scale).toFixed(2)}</span><span><i class="sw mid"></i>${+(TH.pass * scale).toFixed(2)}–${+(TH.good * scale).toFixed(2)}</span><span><i class="sw bad"></i>&lt; ${+(TH.pass * scale).toFixed(2)}</span>
        <span>😁 Feliz · 🙂 Sonriente · 😐 Seria · 😟 Triste</span><span>💬 clic derecho = comentario · 📋 pegar desde Excel</span><span class="muted">Colores y fórmula en ⚙️ Ajustes</span></div>`
    }`;

  const reload = () => tabGradebook(g, el, term, view);
  $$("[data-view]", el).forEach((b) => (b.onclick = () => tabGradebook(g, el, term, b.dataset.view)));
  $("#term").onchange = (e) => tabGradebook(g, el, e.target.value, view);
  $("#add-a").onclick = () => assessmentDialog(g, gb.categories, rubrics, null, reload);
  $("#cats").onclick = () => categoriesDialog(g, gb.categories, reload);
  $("#comps").onclick = () => competenciesDialog(g, gb.competencies, reload);
  $("#csv").onclick = async () => {
    const res = await fetch(`/groups/${g.id}/gradebook.csv${q}`, { headers: { Authorization: `Bearer ${state.token}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: `cuaderno-${g.name}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  $$("[data-edit-a]", el).forEach(
    (a) =>
      (a.onclick = (e) => {
        e.preventDefault();
        assessmentDialog(g, gb.categories, rubrics, gb.assessments.find((x) => x.id === a.dataset.editA), reload);
      }),
  );
  $$("[data-paste]", el).forEach((b) => (b.onclick = () => pasteDialog(gb.assessments.find((a) => a.id === b.dataset.paste), gb.rows, reload)));
  const byId = Object.fromEntries(gb.assessments.map((a) => [a.id, a]));

  // Comentario por nota: clic derecho (o mantener pulsado en móvil)
  const openComment = async (td) => {
    const a = byId[td.dataset.ca];
    const r = gb.rows.find((x) => x.student.id === td.dataset.cs);
    const cur = r.comments?.[a.id] || "";
    const v = await modal(
      `💬 ${r.student.first_name} — ${a.name}`,
      `<textarea name="comment" rows="4" placeholder="Anotación sobre esta nota (solo la ves tú)">${esc(cur)}</textarea>`,
    );
    if (!v) return;
    try {
      await api(`/assessments/${a.id}/grades`, { method: "PUT", body: [{ student_id: r.student.id, comment: v.comment.trim() }] });
      r.comments = { ...(r.comments || {}), [a.id]: v.comment.trim() };
      td.classList.toggle("has-comment", !!v.comment.trim());
      td.title = (v.comment.trim() ? "💬 " + v.comment.trim() + "\n" : "") + "Clic derecho: comentario";
      toast("Comentario guardado");
    } catch (e) {
      fail(e);
    }
  };
  $$("td.gcell", el).forEach((td) => {
    td.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openComment(td);
    });
    let t;
    td.addEventListener("touchstart", () => (t = setTimeout(() => openComment(td), 650)), { passive: true });
    td.addEventListener("touchend", () => clearTimeout(t));
    td.addEventListener("touchmove", () => clearTimeout(t), { passive: true });
  });

  /** Guarda una nota y repinta la celda + medias */
  async function save(aid, sid, score, td) {
    try {
      await api(`/assessments/${aid}/grades`, { method: "PUT", body: [{ student_id: sid, score }] });
      if (td) {
        td.innerHTML = cellHtml(byId[aid], sid, score);
        bindCell(td);
        td.firstElementChild.classList.add("pop");
      }
      refreshSummary(g, el, q);
    } catch (e) {
      fail(e);
    }
  }

  function bindCell(scope) {
    $$("input[data-a]", scope).forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const cells = $$(`input[data-a="${inp.dataset.a}"]`, el);
          cells[cells.indexOf(inp) + 1]?.focus();
        }
      });
      inp.addEventListener("change", async () => {
        const score = inp.value === "" ? null : Number(inp.value);
        const a = byId[inp.dataset.a];
        if (score != null && (score < 0 || score > a.max_score)) {
          inp.parentElement.className = "cell-num lv-error";
          return toast(`La nota debe estar entre 0 y ${a.max_score}`, true);
        }
        try {
          await api(`/assessments/${a.id}/grades`, { method: "PUT", body: [{ student_id: inp.dataset.s, score }] });
          inp.parentElement.className = `cell-num lv-${level(score == null ? null : score / a.max_score)} pop`;
          refreshSummary(g, el, q);
        } catch (e) {
          inp.parentElement.className = "cell-num lv-error";
          fail(e);
        }
      });
    });
    $$("[data-check]", scope).forEach(
      (b) =>
        (b.onclick = () => {
          const a = byId[b.dataset.check];
          const cur = b.textContent.trim();
          const next = cur === "·" ? a.max_score : cur === "✓" ? 0 : null; // vacío → ✓ → ✗ → vacío
          save(a.id, b.dataset.s, next, b.parentElement);
        }),
    );
    $$("[data-face]", scope).forEach((b) => (b.onclick = (e) => facePicker(e.currentTarget, byId[b.dataset.face], save)));
    $$("[data-rub]", scope).forEach((b) => (b.onclick = () => rubricScoreDialog(byId[b.dataset.rub], b.dataset.s, rubrics, reload)));
  }
  bindCell(el);
}

/** Pegar una columna de notas copiada de Excel / Hojas de cálculo */
async function pasteDialog(a, rows, done) {
  const norm = (s) =>
    String(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const v = await modal(
    `📋 Pegar notas — ${a.name}`,
    `<p class="muted">Copia en Excel la columna de notas y pégala aquí.</p>
     <ul class="muted small" style="margin:0;padding-left:18px">
       <li><b>Solo números</b>: se asignan en el orden de la lista (${rows.length} alumnos, por apellido).</li>
       <li><b>Nombre ⇥ nota</b> (dos columnas): se busca a cada alumno por su nombre.</li>
       <li>Celdas vacías se ignoran. Se aceptan comas decimales (8,5).</li>
     </ul>
     <textarea name="data" rows="10" required placeholder="8,5&#10;7&#10;9,2&#10;…"></textarea>`,
    { submit: "Previsualizar" },
  );
  if (!v) return;
  const lines = v.data.replace(/\r/g, "").split("\n");
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const num = (s) => {
    const t = String(s).trim().replace(",", ".");
    return t === "" ? undefined : Number(t);
  };
  const out = [];
  const errors = [];
  const named = lines.some((l) => l.includes("\t") && isNaN(num(l.split("\t")[0]) ?? NaN));
  lines.forEach((l, i) => {
    if (named) {
      const cols = l.split("\t");
      const score = num(cols.at(-1));
      if (score === undefined) return;
      const name = norm(cols.slice(0, -1).join(" "));
      const r = rows.find((x) => {
        const full = norm(`${x.student.last_name} ${x.student.first_name}`), inv = norm(`${x.student.first_name} ${x.student.last_name}`);
        return full === name || inv === name || full.startsWith(name) || inv.startsWith(name);
      });
      if (!r) return errors.push(`Línea ${i + 1}: no encuentro a «${cols.slice(0, -1).join(" ")}»`);
      out.push({ r, score });
    } else {
      const score = num(l.split("\t")[0]);
      if (score === undefined) return;
      if (!rows[i]) return errors.push(`Línea ${i + 1}: hay más notas que alumnos`);
      out.push({ r: rows[i], score });
    }
  });
  out.forEach(({ r, score }) => {
    if (isNaN(score) || score < 0 || score > a.max_score) errors.push(`${r.student.first_name} ${r.student.last_name}: «${score}» fuera de 0–${a.max_score}`);
  });
  const okRows = out.filter(({ score }) => !isNaN(score) && score >= 0 && score <= a.max_score);
  const confirmV = await modal(
    "Confirmar notas pegadas",
    `${errors.length ? `<div class="ai-box" style="background:var(--bad-bg)">⚠️ ${errors.map(esc).join("<br>")}</div>` : ""}
     <div class="table-wrap"><table><thead><tr><th>Alumno</th><th class="num">Nota</th></tr></thead><tbody>
     ${okRows.map(({ r, score }) => `<tr><td>${esc(r.student.last_name)}, ${esc(r.student.first_name)}</td><td class="num"><span class="avg-pill lv-${level(score / a.max_score)}">${score}</span></td></tr>`).join("")}
     </tbody></table></div>`,
    { submit: `Guardar ${okRows.length} notas` },
  );
  if (!confirmV || !okRows.length) return;
  try {
    await api(`/assessments/${a.id}/grades`, { method: "PUT", body: okRows.map(({ r, score }) => ({ student_id: r.student.id, score })) });
    toast(`${okRows.length} notas guardadas`);
    done();
  } catch (e) {
    fail(e);
  }
}

/** Gestión de competencias del grupo */
async function competenciesDialog(g, comps, done) {
  const p = modal(
    "🎯 Competencias del grupo",
    `<p class="muted">Define las competencias y luego vincúlalas a cada actividad (⚙ al editar la actividad). El cuaderno calculará la media por competencia.</p>
     <div class="list" id="comp-list">${
       comps
         .map(
           (k) => `<div class="list-item"><span class="chip">${esc(k.code || "—")}</span><div style="flex:1">${esc(k.name)}</div>
             <button type="button" class="danger ghost" data-delcomp="${k.id}">✕</button></div>`,
         )
         .join("") || `<p class="muted">Sin competencias todavía.</p>`
     }</div>
     <div class="row"><input name="code" placeholder="Código (CE1)" style="width:110px"><input name="cname" placeholder="Nombre de la competencia" style="flex:1">
       <button type="button" id="add-comp">Añadir</button></div>
     <details><summary class="muted">Pegar varias (una por línea: «código ⇥ nombre» o solo nombre)</summary>
       <textarea name="bulk" rows="5"></textarea><button type="button" id="bulk-comp">Añadir todas</button></details>`,
    { submit: "" },
  );
  const dlg = $$("dialog").at(-1);
  const add = async (list) => {
    try {
      await api(`/groups/${g.id}/competencies`, { method: "POST", body: list });
      dlg.close();
      toast("Competencias guardadas");
    } catch (e) {
      fail(e);
    }
  };
  $("#add-comp", dlg).onclick = () => {
    const name = $("[name=cname]", dlg).value.trim();
    if (name) add({ code: $("[name=code]", dlg).value.trim() || null, name });
  };
  $("#bulk-comp", dlg).onclick = () => {
    const list = $("[name=bulk]", dlg)
      .value.split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (l.includes("\t") ? { code: l.split("\t")[0].trim(), name: l.split("\t").slice(1).join(" ").trim() } : { name: l }));
    if (list.length) add(list);
  };
  $$("[data-delcomp]", dlg).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("¿Eliminar esta competencia? Se desvinculará de las actividades.")) return;
        await api(`/competencies/${b.dataset.delcomp}`, { method: "DELETE" }).then(() => b.closest(".list-item").remove(), fail);
      }),
  );
  await p;
  done();
}

function avgHtml(v, scale) {
  if (v == null) return `<span class="avg-pill lv-none">—</span>`;
  const p = v / scale;
  return `<span class="avg-pill lv-${level(p)}">${moodFor(p)} ${v}</span>`;
}

/** Menú flotante para elegir carita */
function facePicker(btn, a, save) {
  $(".face-pop")?.remove();
  const pop = document.createElement("div");
  pop.className = "face-pop";
  pop.innerHTML =
    FACES.map((f) => `<button data-pct="${f.pct}" title="${f.label}"><span>${f.e}</span><small>${f.label}</small></button>`).join("") +
    `<button data-pct="" title="Quitar"><span>⌫</span><small>Quitar</small></button>`;
  document.body.append(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  pop.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const score = b.dataset.pct === "" ? null : Math.round(Number(b.dataset.pct) * a.max_score * 100) / 100;
    pop.remove();
    save(a.id, btn.dataset.s, score, btn.parentElement);
  };
  setTimeout(() => document.addEventListener("click", function off(e) {
    if (!pop.contains(e.target)) {
      pop.remove();
      document.removeEventListener("click", off);
    }
  }), 0);
}

async function refreshSummary(g, el, q) {
  const gb = await api(`/groups/${g.id}/gradebook${q}`);
  for (const r of gb.rows) {
    const td = $(`[data-avg="${r.student.id}"]`, el);
    if (td) td.innerHTML = avgHtml(r.average, g.grading_scale);
  }
  const st = $("#stats", el);
  if (st) st.innerHTML = statsHtml(gb, g.grading_scale);
}

async function assessmentDialog(g, cats, rubrics, a, done) {
  const v = await modal(
    a ? "Editar actividad" : "Nueva actividad evaluable",
    `<div class="form-grid">
      <label style="grid-column:1/-1">Nombre<input name="name" required value="${esc(a?.name)}" placeholder="Examen tema 1"></label>
      <div style="grid-column:1/-1"><label>Tipo de evaluación</label>
        <div class="kind-picker">${Object.entries(KIND_INFO)
          .map(
            ([k, i]) => `<label class="kind-opt"><input type="radio" name="kind" value="${k}" ${(a?.kind || "numeric") === k ? "checked" : ""}>
              <span class="kind-card"><b>${i.icon}</b><span>${i.label}</span><small>${i.hint}</small></span></label>`,
          )
          .join("")}</div></div>
      <label>Fecha<input name="date" type="date" value="${esc(a?.date || today())}"></label>
      <label>Evaluación / trimestre<input name="term" value="${esc(a?.term || "")}" placeholder="1ª Evaluación"></label>
      <label>Nota máxima<input name="max_score" type="number" min="0.1" step="any" value="${esc(a?.max_score ?? 10)}"></label>
      <label>Peso<input name="weight" type="number" min="0" step="any" value="${esc(a?.weight ?? 1)}"></label>
      <label>Categoría<select name="category_id"><option value="">— Sin categoría —</option>
        ${cats.map((c) => `<option value="${c.id}" ${a?.category_id === c.id ? "selected" : ""}>${esc(c.name)} (${c.weight})</option>`).join("")}</select></label>
      <label>Rúbrica<select name="rubric_id"><option value="">— Ninguna —</option>
        ${rubrics.map((r) => `<option value="${r.id}" ${a?.rubric_id === r.id ? "selected" : ""}>${esc(r.title)}</option>`).join("")}</select></label>
    </div>
    ${
      (state.comps || []).length
        ? `<label>🎯 Competencias que evalúa</label><div class="comp-picker">${state.comps
            .map((k) => `<label class="comp-opt"><input type="checkbox" name="comp" value="${k.id}" ${a?.competencies?.includes(k.id) ? "checked" : ""}><span>${esc(k.code ? k.code + " · " : "")}${esc(k.name)}</span></label>`)
            .join("")}</div>`
        : ""
    }
    ${a ? `<button type="button" class="danger" data-del-a="${a.id}">Eliminar actividad y sus notas</button>` : ""}`,
  );
  if (!v) return;
  const competencies = v.__fd.getAll("comp");
  delete v.comp;
  const body = { ...v, competencies, kind: v.kind || "numeric", max_score: Number(v.max_score), weight: Number(v.weight), category_id: v.category_id || null, rubric_id: v.rubric_id || null, date: v.date || null, term: v.term || null };
  try {
    await api(a ? `/assessments/${a.id}` : `/groups/${g.id}/assessments`, { method: a ? "PATCH" : "POST", body });
    toast("Actividad guardada");
    done();
  } catch (e) {
    fail(e);
  }
}
// botón eliminar dentro del diálogo de actividad
document.addEventListener("click", async (e) => {
  if (!e.target.matches("[data-del-a]")) return;
  const dlg = e.target.closest("dialog");
  if (!confirm(`¿Eliminar "${$("input[name=name]", dlg).value}" y todas sus notas?`)) return;
  try {
    await api(`/assessments/${e.target.dataset.delA}`, { method: "DELETE" });
    dlg.close();
    toast("Actividad eliminada");
    route();
  } catch (err) {
    fail(err);
  }
});

async function categoriesDialog(g, cats, done) {
  const d = modal(
    "Categorías de evaluación",
    `<p class="muted">Agrupa actividades y pondéralas. Ej.: Exámenes 0.6 · Trabajos 0.3 · Actitud 0.1</p>
     <div class="list" id="cat-list">${cats
       .map(
         (c) => `<div class="list-item"><b>${esc(c.name)}</b><span class="spacer"></span>
          <input type="number" step="any" min="0" value="${c.weight}" data-cat="${c.id}" style="width:80px">
          <button type="button" class="danger" data-delcat="${c.id}">✕</button></div>`,
       )
       .join("")}</div>
     <div class="row"><input name="name" placeholder="Nueva categoría"><input name="weight" type="number" step="any" min="0" value="1" style="width:80px">
       <button type="button" id="add-cat">Añadir</button></div>`,
    { submit: "" },
  );
  const dlg = $$("dialog").at(-1);
  $("#add-cat", dlg).onclick = async () => {
    const name = $("[name=name]", dlg).value.trim();
    if (!name) return;
    try {
      await api(`/groups/${g.id}/categories`, { method: "POST", body: { name, weight: Number($("[name=weight]", dlg).value) || 1 } });
      dlg.close();
      done();
    } catch (e) {
      fail(e);
    }
  };
  $$("[data-cat]", dlg).forEach(
    (i) => (i.onchange = () => api(`/categories/${i.dataset.cat}`, { method: "PATCH", body: { weight: Number(i.value) } }).then(() => toast("Peso actualizado"), fail)),
  );
  $$("[data-delcat]", dlg).forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api(`/categories/${b.dataset.delcat}`, { method: "DELETE" });
          b.closest(".list-item").remove();
        } catch (e) {
          fail(e);
        }
      }),
  );
  await d;
  done();
}

async function rubricScoreDialog(a, studentId, rubrics, done) {
  const r = rubrics.find((x) => x.id === a.rubric_id);
  if (!r) return toast("Rúbrica no encontrada", true);
  const v = await modal(
    `${a.name} — ${r.title}`,
    `<div class="table-wrap"><table class="rubric"><tbody>${r.criteria
      .map(
        (c, i) => `<tr><th>${esc(c.name)}</th>${c.levels
          .map(
            (l, j) => `<td><label style="color:inherit;display:flex;gap:6px;align-items:flex-start">
              <input type="radio" name="c${i}" value="${j}" required>
              <span><b>${esc(l.label)}</b> (${l.score})<br><span class="muted">${esc(l.descriptor || "")}</span></span></label></td>`,
          )
          .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`,
    { submit: "Calcular nota", wide: true },
  );
  if (!v) return;
  try {
    const res = await api(`/assessments/${a.id}/rubric-score`, {
      method: "POST",
      body: { student_id: studentId, levels: r.criteria.map((_, i) => Number(v[`c${i}`])) },
    });
    toast(`Nota: ${res.score}/${res.max_score}`);
    done();
  } catch (e) {
    fail(e);
  }
}

// ── Alumnos
async function tabStudents(g, el) {
  const students = await api(`/groups/${g.id}/students`);
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="muted">${students.length} alumnos</span><span class="spacer"></span>
      <button id="csv-s" title="CSV exportado de Classroom, Teams, Moodle, Excel…">📄 Importar CSV</button>
      <button id="bulk">📋 Importar lista</button><button class="primary" id="add-s">＋ Alumno</button></div>
    ${
      students.length
        ? `<div class="table-wrap"><table><thead><tr><th>Apellidos</th><th>Nombre</th><th>Email</th><th>Familia</th><th></th></tr></thead><tbody>
      ${students
        .map(
          (s) => `<tr><td>${esc(s.last_name)}</td><td>${esc(s.first_name)}</td><td>${esc(s.email || "")}</td><td>${esc(s.guardian_email || "")}</td>
          <td style="text-align:right"><button data-open="${s.id}">Ficha</button> <button class="ghost" data-edit="${s.id}">✎</button></td></tr>`,
        )
        .join("")}</tbody></table></div>`
        : `<div class="card empty">Sin alumnos. Pulsa <b>📋 Importar lista</b> para pegar la lista de clase.</div>`
    }`;
  const reload = () => route();
  $("#add-s").onclick = () => studentDialog(g, null, reload);
  $("#csv-s").onclick = () => csvImportDialog(g, students, reload);
  $("#bulk").onclick = async () => {
    const v = await modal(
      "Importar lista de alumnos",
      `<p class="muted">Un alumno por línea con el formato <code>Apellidos, Nombre</code> (también vale copiar dos columnas desde una hoja de cálculo).</p>
       <textarea name="list" rows="12" required placeholder="García López, Ana&#10;Pérez Ruiz, Luis"></textarea>`,
      { submit: "Importar" },
    );
    if (!v) return;
    const rows = v.list
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [last, first] = l.includes("\t") ? l.split("\t") : l.includes(",") ? l.split(",") : [l.split(" ").slice(1).join(" "), l.split(" ")[0]];
        return { last_name: (last || "").trim() || "-", first_name: (first || "").trim() || "-" };
      });
    try {
      await api(`/groups/${g.id}/students`, { method: "POST", body: rows });
      toast(`${rows.length} alumnos importados`);
      reload();
    } catch (e) {
      fail(e);
    }
  };
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => studentDialog(g, students.find((s) => s.id === b.dataset.edit), reload)));
  $$("[data-open]", el).forEach((b) => (b.onclick = () => studentSheet(g, students.find((s) => s.id === b.dataset.open))));
}

async function studentDialog(g, s, done) {
  const v = await modal(
    s ? "Editar alumno" : "Nuevo alumno",
    `<div class="form-grid">
      <label>Nombre<input name="first_name" required value="${esc(s?.first_name)}"></label>
      <label>Apellidos<input name="last_name" required value="${esc(s?.last_name)}"></label>
      <label>Email<input name="email" type="email" value="${esc(s?.email)}"></label>
      <label>Email familia<input name="guardian_email" type="email" value="${esc(s?.guardian_email)}"></label>
      <label style="grid-column:1/-1">Notas privadas<textarea name="notes" rows="3">${esc(s?.notes)}</textarea></label>
    </div>
    ${s ? `<button type="button" class="danger" data-del-s="${s.id}">Eliminar alumno</button>` : ""}`,
  );
  if (!v) return;
  try {
    await api(s ? `/students/${s.id}` : `/groups/${g.id}/students`, { method: s ? "PATCH" : "POST", body: v });
    toast("Alumno guardado");
    done();
  } catch (e) {
    fail(e);
  }
}
document.addEventListener("click", async (e) => {
  if (!e.target.matches("[data-del-s]")) return;
  const dlg = e.target.closest("dialog");
  const first = $("[name=first_name]", dlg).value;
  const last = $("[name=last_name]", dlg).value;
  if (!confirm(`¿Eliminar a ${first} ${last} con todas sus notas? No se puede deshacer.`)) return;
  try {
    await api(`/students/${e.target.dataset.delS}`, { method: "DELETE" });
    dlg.close();
    toast("Alumno eliminado");
    route();
  } catch (err) {
    fail(err);
  }
});

async function studentSheet(g, s) {
  const obs = await api(`/students/${s.id}/observations`);
  const p = modal(
    `${s.first_name} ${s.last_name}`,
    `<h3>Observaciones</h3>
     <div class="row"><select name="kind"><option value="positive">👍 Positiva</option><option value="note" selected>📝 Nota</option><option value="negative">👎 A mejorar</option></select>
       <input name="text" placeholder="Escribe una observación…" style="flex:1"><button type="button" id="add-obs">Añadir</button></div>
     <div class="list" id="obs">${obs.map(obsItem).join("") || `<p class="muted">Sin observaciones.</p>`}</div>
     <h3>Comentario para el boletín (IA)</h3>
     <div class="row"><select name="tone"><option value="formal">Tono formal</option><option value="cercano">Tono cercano</option></select>
       <button type="button" id="gen">✨ Generar comentario</button></div>
     <div id="ai"></div>`,
    { submit: "", wide: true },
  );
  const dlg = $$("dialog").at(-1);
  $("#add-obs", dlg).onclick = async () => {
    const text = $("[name=text]", dlg).value.trim();
    if (!text) return;
    try {
      const o = await api(`/students/${s.id}/observations`, { method: "POST", body: { text, kind: $("[name=kind]", dlg).value, date: today() } });
      const list = $("#obs", dlg);
      if (!list.querySelector(".list-item")) list.innerHTML = "";
      list.insertAdjacentHTML("afterbegin", obsItem(o));
      $("[name=text]", dlg).value = "";
    } catch (e) {
      fail(e);
    }
  };
  $("[name=text]", dlg).onkeydown = (e) => e.key === "Enter" && (e.preventDefault(), $("#add-obs", dlg).click());
  dlg.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-delobs]");
    if (!b) return;
    try {
      await api(`/observations/${b.dataset.delobs}`, { method: "DELETE" });
      b.closest(".list-item").remove();
    } catch (err) {
      fail(err);
    }
  });
  $("#gen", dlg).onclick = (e) =>
    busy(e.currentTarget, async () => {
      const r = await api("/ai/report-comment", { method: "POST", body: { student_id: s.id, tone: $("[name=tone]", dlg).value } });
      $("#ai", dlg).innerHTML = `<div class="ai-box">${esc(r.comment)}</div>
        <div class="row" style="margin-top:6px"><span class="muted">Media actual: ${r.average ?? "—"}</span><span class="spacer"></span>
        <button type="button" id="copy">Copiar</button></div>`;
      $("#copy", dlg).onclick = () => navigator.clipboard.writeText(r.comment).then(() => toast("Copiado"));
    });
  await p;
}
const obsItem = (o) =>
  `<div class="list-item obs-${esc(o.kind)}"><div><small class="muted">${fmtDate(o.date)}</small><div>${esc(o.text)}</div></div>
   <span class="spacer"></span><button type="button" class="ghost" data-delobs="${o.id}">✕</button></div>`;

// ── Asistencia (visual)
const ATT = {
  present: { icon: "✅", label: "Presente", cls: "good" },
  absent: { icon: "❌", label: "Falta", cls: "bad" },
  late: { icon: "⏰", label: "Retraso", cls: "mid" },
  excused: { icon: "📄", label: "Justificada", cls: "info" },
};
const shiftDate = (d, n) => {
  const x = new Date(d + "T00:00:00");
  x.setDate(x.getDate() + n);
  return isoLocal(x);
};

async function tabAttendance(g, el, date = today()) {
  const [students, recs] = await Promise.all([api(`/groups/${g.id}/students`), api(`/groups/${g.id}/attendance`)]);
  const cur = {};
  const hist = {}; // student -> {date: status}
  for (const r of recs) {
    (hist[r.student_id] ||= {})[r.date] = r.status;
    if (r.date === date) cur[r.student_id] = r.status;
  }
  const dates = [...new Set(recs.map((r) => r.date))].sort();
  const lastDates = dates.slice(-12);

  const render = () => {
    const counts = Object.fromEntries(Object.keys(ATT).map((k) => [k, 0]));
    Object.values(cur).forEach((s) => counts[s]++);
    const marked = Object.keys(cur).length;
    const pctToday = marked ? Math.round(((counts.present + counts.late) / marked) * 100) : null;
    const isToday = date === today();
    el.innerHTML = `
    <div class="att-top">
      <div class="date-nav">
        <button id="prev" title="Día anterior">◀</button>
        <input type="date" id="date" value="${date}">
        <button id="next" title="Día siguiente">▶</button>
        ${isToday ? `<span class="chip">Hoy</span>` : `<button id="today">Hoy</button>`}
      </div>
      <span class="spacer"></span>
      <button class="primary" id="all">✅ Marcar resto como presentes</button>
    </div>
    ${
      !students.length
        ? `<div class="card empty">Añade alumnos primero.</div>`
        : `
    <div class="stats">
      <div class="stat"><div class="stat-icon">${pctToday == null ? "📅" : moodFor(pctToday / 100)}</div>
        <div><small>Asistencia del día</small><b class="lv-text-${level(pctToday == null ? null : pctToday / 100)}">${pctToday == null ? "—" : pctToday + "%"}</b></div></div>
      ${Object.entries(ATT)
        .map(([k, v]) => `<div class="stat"><div class="stat-icon ${v.cls}">${v.icon}</div><div><small>${v.label}</small><b>${counts[k]}</b></div></div>`)
        .join("")}
      <div class="stat"><div class="stat-icon">👥</div><div><small>Sin marcar</small><b>${students.length - marked}</b></div></div>
    </div>
    <div class="att-grid">
      ${students
        .map((s) => {
          const st = cur[s.id];
          const h = hist[s.id] || {};
          const tot = Object.values(h).length;
          const ok = Object.values(h).filter((x) => x === "present" || x === "late").length;
          const p = tot ? ok / tot : null;
          return `<div class="att-card ${st ? "st-" + ATT[st].cls : ""}" data-s="${s.id}">
            <div class="who">${avatar(s, 40)}<div><b>${shortName(s)}</b>
              <div class="muted small">${p == null ? "Sin historial" : `${moodFor(p)} ${Math.round(p * 100)}% asistencia · ${tot} días`}</div></div></div>
            <div class="att-btns">${Object.entries(ATT)
              .map(([k, v]) => `<button class="att-btn ${st === k ? "on " + v.cls : ""}" data-st="${k}" title="${v.label}"><span>${v.icon}</span><small>${v.label}</small></button>`)
              .join("")}</div>
            ${lastDates.length ? `<div class="att-strip" title="Últimos días">${lastDates
              .map((d) => {
                const x = d === date ? st : h[d];
                return `<i class="${x ? ATT[x].cls : "none"} ${d === date ? "current" : ""}" title="${fmtDate(d)}: ${x ? ATT[x].label : "sin registro"}"></i>`;
              })
              .join("")}</div>` : ""}
          </div>`;
        })
        .join("")}
    </div>
    <div class="legend"><span>Clic en un estado para guardarlo al momento.</span>
      ${Object.values(ATT).map((v) => `<span><i class="sw ${v.cls}"></i>${v.label}</span>`).join("")}<span><i class="sw none"></i>Sin registro</span></div>`
    }`;

    const go = (d) => tabAttendance(g, el, d);
    $("#date").onchange = (e) => go(e.target.value);
    $("#prev").onclick = () => go(shiftDate(date, -1));
    $("#next").onclick = () => go(shiftDate(date, 1));
    $("#today") && ($("#today").onclick = () => go(today()));
    $$(".att-btn", el).forEach(
      (b) =>
        (b.onclick = async () => {
          const sid = b.closest(".att-card").dataset.s;
          const status = b.dataset.st;
          try {
            await api(`/groups/${g.id}/attendance`, { method: "PUT", body: { date, records: [{ student_id: sid, status }] } });
            cur[sid] = status;
            (hist[sid] ||= {})[date] = status;
            if (!lastDates.includes(date)) lastDates.push(date), lastDates.sort(), lastDates.splice(0, lastDates.length - 12);
            render();
          } catch (e) {
            fail(e);
          }
        }),
    );
    $("#all").onclick = (e) =>
      busy(e.currentTarget, async () => {
        const records = students.filter((s) => !cur[s.id]).map((s) => ({ student_id: s.id, status: "present" }));
        if (!records.length) return toast("Todos ya están marcados");
        await api(`/groups/${g.id}/attendance`, { method: "PUT", body: { date, records } });
        records.forEach((r) => ((cur[r.student_id] = "present"), ((hist[r.student_id] ||= {})[date] = "present")));
        if (!lastDates.includes(date)) lastDates.push(date), lastDates.sort();
        toast(`${records.length} marcados como presentes`);
        render();
      });
  };
  render();
}

// ── Sesiones
async function tabSessions(g, el) {
  const sessions = await api(`/groups/${g.id}/sessions`);
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="muted">${sessions.length} sesiones</span><span class="spacer"></span>
      <button id="ai-plan">✨ Planificar unidad con IA</button><button class="primary" id="add-ses">＋ Sesión</button></div>
    <div class="list">${
      sessions
        .map(
          (s) => `<div class="list-item ${s.done ? "done" : ""}">
          <input type="checkbox" data-done="${s.id}" ${s.done ? "checked" : ""} title="Impartida">
          <div style="flex:1"><div class="row"><b>${esc(s.title)}</b><span class="chip">${fmtDate(s.date)}</span></div>
            ${s.objectives ? `<div class="muted">🎯 ${esc(s.objectives)}</div>` : ""}
            ${s.content ? `<div>${esc(s.content)}</div>` : ""}</div>
          <button class="ghost" data-del-ses="${s.id}">✕</button></div>`,
        )
        .join("") || `<div class="card empty">Sin sesiones planificadas.</div>`
    }</div>`;
  const reload = () => tabSessions(g, el);
  $("#add-ses").onclick = async () => {
    const v = await modal(
      "Nueva sesión",
      `<div class="form-grid"><label>Fecha<input type="date" name="date" required value="${today()}"></label>
       <label>Título<input name="title" required></label></div>
       <label>Objetivos<textarea name="objectives" rows="2"></textarea></label>
       <label>Contenido / actividades<textarea name="content" rows="4"></textarea></label>`,
    );
    if (!v) return;
    try {
      await api(`/groups/${g.id}/sessions`, { method: "POST", body: v });
      reload();
    } catch (e) {
      fail(e);
    }
  };
  $("#ai-plan").onclick = async () => {
    const v = await modal(
      "Planificar unidad con IA",
      `<label>Tema o unidad<input name="topic" required placeholder="Ecuaciones de segundo grado"></label>
       <div class="form-grid"><label>Nº de sesiones<input name="sessions" type="number" min="1" max="15" value="5"></label>
       <label>Primera sesión<input type="date" name="start" value="${today()}"></label>
       <label>Días entre sesiones<input name="gap" type="number" min="1" value="2"></label></div>`,
      { submit: "Generar" },
    );
    if (!v) return;
    toast("Generando planificación…");
    try {
      const plan = await api("/ai/plan", { method: "POST", body: { group_id: g.id, topic: v.topic, sessions: Number(v.sessions) } });
      const start = new Date(v.start + "T00:00:00");
      const ok = await modal(
        "Propuesta de la IA",
        `<div class="list">${plan
          .map((p, i) => `<div class="list-item"><div><b>${i + 1}. ${esc(p.title)}</b><div class="muted">🎯 ${esc(p.objectives)}</div><div>${esc(p.content)}</div></div></div>`)
          .join("")}</div>`,
        { submit: "Añadir todas", wide: true },
      );
      if (!ok) return;
      for (const [i, p] of plan.entries()) {
        const d = new Date(start);
        d.setDate(d.getDate() + i * (Number(v.gap) || 1));
        await api(`/groups/${g.id}/sessions`, {
          method: "POST",
          body: { date: isoLocal(d), title: String(p.title), objectives: String(p.objectives ?? ""), content: String(p.content ?? "") },
        });
      }
      toast(`${plan.length} sesiones añadidas`);
      reload();
    } catch (e) {
      fail(e);
    }
  };
  $$("[data-done]", el).forEach(
    (c) => (c.onchange = () => api(`/sessions/${c.dataset.done}`, { method: "PATCH", body: { done: c.checked ? 1 : 0 } }).then(reload, fail)),
  );
  $$("[data-del-ses]", el).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("¿Eliminar esta sesión?")) return;
        await api(`/sessions/${b.dataset.delSes}`, { method: "DELETE" }).then(reload, fail);
      }),
  );
}

// ───────── Utilidades compartidas ─────────
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const copyText = (t, msg = "Enlace copiado") => navigator.clipboard.writeText(t).then(() => toast(msg), () => prompt("Copia el enlace:", t));
const publicUrl = (kind, token) => `${location.origin}/#/${kind}/${token}`;

/** Guarda ajustes del grupo (se fusionan en el servidor) y actualiza la copia local */
async function saveSettings(g, partial) {
  const r = await api(`/groups/${g.id}`, { method: "PATCH", body: { settings: partial } });
  g.settings = r.settings;
  return r;
}

// ───────── Plano de clase ─────────
async function tabSeating(g, el) {
  const [students, gb, att] = await Promise.all([
    api(`/groups/${g.id}/students`),
    api(`/groups/${g.id}/gradebook`),
    api(`/groups/${g.id}/attendance?from=${today()}&to=${today()}`),
  ]);
  const avg = Object.fromEntries(gb.rows.map((r) => [r.student.id, r.average]));
  const attToday = Object.fromEntries(att.map((r) => [r.student_id, r.status]));
  const byId = Object.fromEntries(students.map((s) => [s.id, s]));
  const plan = { rows: 4, cols: 6, seats: {}, ...(g.settings?.seating || {}) };
  // Limpia asientos de alumnos que ya no existen o fuera de la cuadrícula
  for (const [sid, pos] of Object.entries(plan.seats)) {
    const [r, c] = pos.split("-").map(Number);
    if (!byId[sid] || r >= plan.rows || c >= plan.cols) delete plan.seats[sid];
  }
  let edit = !Object.keys(plan.seats).length;
  let selected = null;
  let saveT;
  const persist = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => saveSettings(g, { seating: plan }).catch(fail), 400);
  };
  const at = () => Object.fromEntries(Object.entries(plan.seats).map(([sid, p]) => [p, sid]));
  const place = (sid, pos) => {
    const occ = at();
    const prev = plan.seats[sid];
    if (occ[pos] && occ[pos] !== sid) {
      if (prev) plan.seats[occ[pos]] = prev; // intercambio
      else delete plan.seats[occ[pos]];
    }
    plan.seats[sid] = pos;
    persist();
  };

  const seatHtml = (sid) => {
    const s = byId[sid];
    const a = avg[sid];
    const st = attToday[sid];
    return `<div class="seat-student ${selected === sid ? "sel" : ""} ${st ? "att-" + ATT[st].cls : ""}" draggable="${edit}" data-sid="${sid}">
      ${avatar(s, 38)}<span class="seat-name">${shortName(s)}</span>
      <span class="seat-meta">${st ? ATT[st].icon : ""}${a != null ? `<span class="lv-text-${level(a / g.grading_scale)}">${moodFor(a / g.grading_scale)}</span>` : ""}</span>
    </div>`;
  };

  const render = () => {
    const occ = at();
    const bench = students.filter((s) => !plan.seats[s.id]);
    el.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <div class="seg-ctl"><button class="${!edit ? "on" : ""}" data-mode="class">🏫 Modo clase</button><button class="${edit ? "on" : ""}" data-mode="edit">✏️ Organizar</button></div>
        ${
          edit
            ? `<label class="row" style="gap:4px">Filas <input type="number" id="rows" min="1" max="12" value="${plan.rows}" style="width:60px"></label>
               <label class="row" style="gap:4px">Columnas <input type="number" id="cols" min="1" max="12" value="${plan.cols}" style="width:60px"></label>
               <button id="shuffle">🔀 Aleatorio</button><button id="alpha">🔤 Alfabético</button><button id="clear" class="danger">🧹 Vaciar</button>`
            : `<span class="muted">Toca un alumno para pasar lista o anotar 👍/👎. Hoy: ${Object.keys(attToday).length}/${students.length} con asistencia.</span>`
        }
      </div>
      <div class="classroom">
        <div class="desk">🧑‍🏫 Mesa del docente · pizarrón</div>
        <div class="seat-grid" style="grid-template-columns:repeat(${plan.cols}, minmax(84px, 1fr))">
          ${Array.from({ length: plan.rows * plan.cols }, (_, i) => {
            const pos = `${Math.floor(i / plan.cols)}-${i % plan.cols}`;
            return `<div class="seat ${occ[pos] ? "taken" : ""}" data-pos="${pos}">${occ[pos] ? seatHtml(occ[pos]) : edit ? `<span class="muted">·</span>` : ""}</div>`;
          }).join("")}
        </div>
      </div>
      ${
        edit
          ? `<div class="bench" data-pos="bench"><b>Sin asiento (${bench.length})</b> <span class="muted small">Arrastra al plano, o toca un alumno y luego un asiento.</span>
             <div class="bench-list">${bench.map((s) => seatHtml(s.id)).join("") || `<span class="muted">Todos sentados ✔</span>`}</div></div>`
          : bench.length
            ? `<p class="muted">${bench.length} alumno(s) sin asiento. Pulsa ✏️ Organizar para colocarlos.</p>`
            : ""
      }
      <div class="legend"><span>${ATT.present.icon} Presente</span><span>${ATT.absent.icon} Falta</span><span>${ATT.late.icon} Retraso</span><span>😁🙂😐😟 media actual</span></div>`;
    bind();
  };

  const bind = () => {
    $$("[data-mode]", el).forEach((b) => (b.onclick = () => ((edit = b.dataset.mode === "edit"), (selected = null), render())));
    if (edit) {
      $("#rows").onchange = (e) => ((plan.rows = Math.min(12, Math.max(1, +e.target.value || 1))), cleanup(), persist(), render());
      $("#cols").onchange = (e) => ((plan.cols = Math.min(12, Math.max(1, +e.target.value || 1))), cleanup(), persist(), render());
      $("#shuffle").onclick = () => fill(shuffle(students));
      $("#alpha").onclick = () => fill(students);
      $("#clear").onclick = () => ((plan.seats = {}), persist(), render());
      $$(".seat-student", el).forEach((d) => {
        d.ondragstart = (e) => e.dataTransfer.setData("text/plain", d.dataset.sid);
        d.onclick = (e) => {
          e.stopPropagation();
          selected = selected === d.dataset.sid ? null : d.dataset.sid;
          render();
        };
      });
      $$(".seat, .bench", el).forEach((z) => {
        z.ondragover = (e) => (e.preventDefault(), z.classList.add("over"));
        z.ondragleave = () => z.classList.remove("over");
        z.ondrop = (e) => {
          e.preventDefault();
          const sid = e.dataTransfer.getData("text/plain");
          if (!sid) return;
          if (z.dataset.pos === "bench") delete plan.seats[sid], persist();
          else place(sid, z.dataset.pos);
          render();
        };
        z.onclick = () => {
          if (!selected) return;
          if (z.dataset.pos === "bench") delete plan.seats[selected], persist();
          else if (at()[z.dataset.pos] !== selected) place(selected, z.dataset.pos);
          selected = null;
          render();
        };
      });
    } else {
      $$(".seat-student", el).forEach((d) => (d.onclick = (e) => seatMenu(e.currentTarget, byId[d.dataset.sid])));
    }
  };
  const cleanup = () => {
    for (const [sid, pos] of Object.entries(plan.seats)) {
      const [r, c] = pos.split("-").map(Number);
      if (r >= plan.rows || c >= plan.cols) delete plan.seats[sid];
    }
  };
  const fill = (list) => {
    plan.seats = {};
    list.slice(0, plan.rows * plan.cols).forEach((s, i) => (plan.seats[s.id] = `${Math.floor(i / plan.cols)}-${i % plan.cols}`));
    if (list.length > plan.rows * plan.cols) toast(`Faltan asientos: amplía filas o columnas (${list.length} alumnos)`, true);
    persist();
    render();
  };

  /** Menú rápido en modo clase: asistencia y observaciones */
  function seatMenu(node, s) {
    $(".face-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "face-pop seat-pop";
    pop.innerHTML = `<div class="seat-pop-title">${avatar(s, 26)} <b>${esc(s.first_name)} ${esc(s.last_name)}</b></div>
      <div class="row" style="gap:4px">${Object.entries(ATT)
        .map(([k, v]) => `<button data-att="${k}" class="${attToday[s.id] === k ? "on" : ""}" title="${v.label}"><span>${v.icon}</span><small>${v.label}</small></button>`)
        .join("")}</div>
      <div class="row" style="gap:4px">
        <button data-obs="positive"><span>👍</span><small>Positivo</small></button>
        <button data-obs="negative"><span>👎</span><small>A mejorar</small></button>
        <button data-sheet><span>📇</span><small>Ficha</small></button></div>`;
    document.body.append(pop);
    const r = node.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2))}px`;
    pop.style.top = `${r.bottom + window.scrollY + 6}px`;
    pop.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      pop.remove();
      try {
        if (b.dataset.att) {
          await api(`/groups/${g.id}/attendance`, { method: "PUT", body: { date: today(), records: [{ student_id: s.id, status: b.dataset.att }] } });
          attToday[s.id] = b.dataset.att;
          toast(`${s.first_name}: ${ATT[b.dataset.att].label}`);
          render();
        } else if (b.dataset.obs) {
          const text = prompt(b.dataset.obs === "positive" ? "👍 ¿Qué hizo bien?" : "👎 ¿Qué debe mejorar?", b.dataset.obs === "positive" ? "Buena participación" : "Llamada de atención");
          if (text == null) return;
          await api(`/students/${s.id}/observations`, { method: "POST", body: { text: text || "—", kind: b.dataset.obs, date: today() } });
          toast("Observación guardada");
        } else studentSheet(g, s);
      } catch (err) {
        fail(err);
      }
    };
    setTimeout(() => document.addEventListener("click", function off(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", off);
      }
    }), 0);
  }
  render();
}

// ───────── Magic box ─────────
async function magicBox(g, start = "random") {
  const students = await api(`/groups/${g.id}/students`);
  const att = await api(`/groups/${g.id}/attendance?from=${today()}&to=${today()}`).catch(() => []);
  const absent = new Set(att.filter((r) => r.status === "absent").map((r) => r.student_id));
  const TOOLS = { random: "🎲 Alumno aleatorio", teams: "👥 Equipos", timer: "⏱️ Temporizador", noise: "🔊 Ruido" };
  const p = modal(
    "🪄 Magic box",
    `<div class="seg-ctl magic-tabs">${Object.entries(TOOLS).map(([k, v]) => `<button type="button" data-tool="${k}">${v}</button>`).join("")}</div>
     <div id="tool" class="tool-area"></div>`,
    { submit: "", wide: true },
  );
  const dlg = $$("dialog").at(-1);
  const area = $("#tool", dlg);
  let cleanup = () => {};
  const usedKey = `rand-used-${g.id}`;

  const tools = {
    random() {
      const used = new Set(JSON.parse(sessionStorage.getItem(usedKey) || "[]"));
      area.innerHTML = `
        <div class="rand-stage" id="stage"><div class="rand-face">🎲</div><div class="rand-name">¿A quién le toca?</div></div>
        <div class="row" style="justify-content:center">
          <button type="button" class="primary big" id="spin">🎲 Elegir alumno</button></div>
        <div class="row" style="justify-content:center">
          <label class="row" style="gap:4px;color:inherit"><input type="checkbox" id="norep" checked> Sin repetir</label>
          <label class="row" style="gap:4px;color:inherit"><input type="checkbox" id="noabs" checked> Excluir faltas de hoy (${absent.size})</label>
          <span class="muted small" id="left"></span><button type="button" class="ghost" id="reset">↺ Reiniciar</button></div>`;
      const pool = () =>
        students.filter((s) => (!$("#noabs", area).checked || !absent.has(s.id)) && (!$("#norep", area).checked || !used.has(s.id)));
      const upd = () => ($("#left", area).textContent = `${pool().length} disponibles`);
      upd();
      $("#norep", area).onchange = $("#noabs", area).onchange = upd;
      $("#reset", area).onclick = () => (used.clear(), sessionStorage.removeItem(usedKey), upd(), toast("Lista reiniciada"));
      $("#spin", area).onclick = () => {
        const list = pool();
        if (!list.length) return toast("Ya salieron todos. Pulsa ↺ Reiniciar.", true);
        const pick = list[Math.floor(Math.random() * list.length)];
        const stage = $("#stage", area);
        let n = 0;
        const steps = 18;
        const tick = () => {
          const s = n < steps ? list[Math.floor(Math.random() * list.length)] : pick;
          stage.innerHTML = `<div class="rand-face">${avatar(s, 96)}</div><div class="rand-name ${n >= steps ? "win" : ""}">${esc(s.first_name)} ${esc(s.last_name)}</div>`;
          if (n++ < steps) setTimeout(tick, 40 + n * 9);
          else {
            used.add(pick.id);
            sessionStorage.setItem(usedKey, JSON.stringify([...used]));
            stage.insertAdjacentHTML("beforeend", `<div class="confetti">🎉</div>`);
            upd();
          }
        };
        tick();
      };
    },
    teams() {
      area.innerHTML = `
        <div class="row" style="justify-content:center">
          <select id="mode"><option value="size">Alumnos por equipo</option><option value="count">Número de equipos</option></select>
          <input type="number" id="n" min="2" max="20" value="4" style="width:70px">
          <label class="row" style="gap:4px;color:inherit"><input type="checkbox" id="noabs2" checked> Excluir faltas de hoy</label>
          <button type="button" class="primary" id="make">🔀 Formar equipos</button>
          <button type="button" id="copyteams">📋 Copiar</button></div>
        <div class="teams" id="teams"></div>`;
      let last = [];
      $("#make", area).onclick = () => {
        const list = shuffle(students.filter((s) => !$("#noabs2", area).checked || !absent.has(s.id)));
        const n = Math.max(1, +$("#n", area).value || 2);
        const count = $("#mode", area).value === "size" ? Math.max(1, Math.round(list.length / n)) : Math.min(n, list.length);
        last = Array.from({ length: count }, () => []);
        list.forEach((s, i) => last[i % count].push(s));
        $("#teams", area).innerHTML = last
          .map(
            (t, i) => `<div class="team" style="--tc:${AV_COLORS[i % AV_COLORS.length]}"><b>Equipo ${i + 1}</b>
              ${t.map((s) => `<div class="who">${avatar(s, 26)}<span>${shortName(s)}</span></div>`).join("")}</div>`,
          )
          .join("");
      };
      $("#copyteams", area).onclick = () =>
        last.length
          ? copyText(last.map((t, i) => `Equipo ${i + 1}: ${t.map((s) => `${s.first_name} ${s.last_name}`).join(", ")}`).join("\n"), "Equipos copiados")
          : toast("Forma los equipos primero", true);
      $("#make", area).click();
    },
    timer() {
      let total = 300, left = 300, run = null;
      area.innerHTML = `
        <div class="timer" id="clock">05:00</div>
        <div class="timer-bar"><span id="tbar"></span></div>
        <div class="row" style="justify-content:center">${[1, 3, 5, 10, 15]
          .map((m) => `<button type="button" data-min="${m}">${m} min</button>`)
          .join("")}<input type="number" id="custom" min="1" max="180" placeholder="min" style="width:70px"></div>
        <div class="row" style="justify-content:center">
          <button type="button" class="primary big" id="go">▶ Iniciar</button><button type="button" class="big" id="rst">↺</button>
          <button type="button" class="big" id="fs" title="Pantalla completa">⛶</button></div>`;
      const draw = () => {
        const m = Math.floor(left / 60), s = left % 60;
        $("#clock", area).textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        $("#clock", area).className = `timer ${left <= 10 && left > 0 ? "warn" : ""} ${left === 0 ? "done" : ""}`;
        $("#tbar", area).style.width = `${(left / total) * 100}%`;
      };
      const beep = () => {
        try {
          const ac = new AudioContext();
          [0, 0.35, 0.7].forEach((t) => {
            const o = ac.createOscillator(), gn = ac.createGain();
            o.frequency.value = 880;
            o.connect(gn).connect(ac.destination);
            gn.gain.setValueAtTime(0.3, ac.currentTime + t);
            gn.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.3);
            o.start(ac.currentTime + t);
            o.stop(ac.currentTime + t + 0.3);
          });
        } catch {}
      };
      const stop = () => (clearInterval(run), (run = null), ($("#go", area).textContent = "▶ Iniciar"));
      const set = (sec) => (stop(), (total = left = sec), draw());
      $$("[data-min]", area).forEach((b) => (b.onclick = () => set(+b.dataset.min * 60)));
      $("#custom", area).onchange = (e) => +e.target.value > 0 && set(Math.round(+e.target.value * 60));
      $("#rst", area).onclick = () => set(total);
      $("#fs", area).onclick = () => (document.fullscreenElement ? document.exitFullscreen() : area.requestFullscreen?.());
      $("#go", area).onclick = () => {
        if (run) return stop();
        if (left === 0) left = total;
        $("#go", area).textContent = "⏸ Pausa";
        run = setInterval(() => {
          left = Math.max(0, left - 1);
          draw();
          if (!left) (stop(), beep());
        }, 1000);
      };
      draw();
      cleanup = () => clearInterval(run);
    },
    noise() {
      area.innerHTML = `
        <div class="noise-face" id="nface">🤫</div>
        <div class="noise-meter"><span id="nbar"></span><i id="nth"></i></div>
        <div class="row" style="justify-content:center">
          <label class="row" style="gap:6px;color:inherit">Tolerancia <input type="range" id="th" min="10" max="90" value="55"></label>
          <button type="button" class="primary" id="mic">🎤 Activar micrófono</button></div>
        <p class="muted small" style="text-align:center">El audio se analiza solo en este navegador; no se graba ni se envía.</p>`;
      let stream, ac, raf;
      const th = () => +$("#th", area).value;
      $("#nth", area).style.left = th() + "%";
      $("#th", area).oninput = () => ($("#nth", area).style.left = th() + "%");
      $("#mic", area).onclick = async () => {
        if (stream) return;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          return toast("No se pudo acceder al micrófono", true);
        }
        $("#mic", area).textContent = "🎤 Escuchando…";
        ac = new AudioContext();
        const an = ac.createAnalyser();
        an.fftSize = 512;
        ac.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        let smooth = 0;
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          const lvl = Math.min(100, Math.sqrt(sum / buf.length) * 400);
          smooth = smooth * 0.85 + lvl * 0.15;
          const bar = $("#nbar", area);
          if (!bar) return;
          bar.style.width = smooth + "%";
          const t = th();
          bar.className = smooth > t ? "bad" : smooth > t * 0.7 ? "mid" : "good";
          $("#nface", area).textContent = smooth > t ? "😠" : smooth > t * 0.7 ? "😐" : "😊";
          raf = requestAnimationFrame(loop);
        };
        loop();
      };
      cleanup = () => {
        cancelAnimationFrame(raf);
        stream?.getTracks().forEach((t) => t.stop());
        ac?.close();
      };
    },
  };
  const open = (k) => {
    cleanup();
    cleanup = () => {};
    $$("[data-tool]", dlg).forEach((b) => b.classList.toggle("on", b.dataset.tool === k));
    tools[k]();
  };
  $$("[data-tool]", dlg).forEach((b) => (b.onclick = () => open(b.dataset.tool)));
  open(start);
  await p;
  cleanup();
}

// ───────── Quizzes ─────────
/** Formato de texto: pregunta en una línea, opciones debajo, la correcta con * al inicio; línea en blanco entre preguntas */
const quizToText = (qs) => qs.map((q) => [q.q, ...q.options.map((o, i) => (i === q.answer ? "*" : "") + o)].join("\n")).join("\n\n");
function textToQuiz(t) {
  const blocks = t.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  return blocks.map((b, i) => {
    const [q, ...opts] = b;
    const answer = opts.findIndex((o) => o.startsWith("*"));
    if (opts.length < 2) throw new Error(`Pregunta ${i + 1}: necesita al menos 2 opciones`);
    if (answer < 0) throw new Error(`Pregunta ${i + 1}: marca la correcta con * al inicio`);
    return { q: q.replace(/^\d+[.)]\s*/, ""), options: opts.map((o) => o.replace(/^\*\s*/, "").replace(/^[a-dA-D][.)]\s*/, "")), answer };
  });
}

async function tabQuizzes(g, el) {
  const quizzes = await api(`/groups/${g.id}/quizzes`);
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="muted">Los alumnos responden desde su celular con el enlace, eligiendo su nombre. La nota cae sola en el cuaderno.</span>
      <span class="spacer"></span><button class="primary" id="new-quiz">＋ Nuevo quiz</button></div>
    <div class="grid-cards">${
      quizzes
        .map(
          (q) => `<div class="card quiz-card">
            <div class="row"><h3>❓ ${esc(q.title)}</h3><span class="spacer"></span><span class="chip ${q.open ? "" : "closed"}">${q.open ? "🟢 Abierto" : "🔴 Cerrado"}</span></div>
            <p class="muted">${q.questions.length} preguntas · ${q.responses} respuestas · ${fmtDate(q.created_at.slice(0, 10))}</p>
            <div class="row">
              <button data-link="${q.token}">🔗 Copiar enlace</button>
              <button data-results="${q.id}">📊 Resultados</button>
              <button data-edit="${q.id}">✎</button>
              <button data-toggle="${q.id}">${q.open ? "Cerrar" : "Abrir"}</button>
              <button class="danger ghost" data-del="${q.id}">✕</button></div></div>`,
        )
        .join("") || `<div class="card empty"><div style="font-size:40px">❓</div>Crea tu primer quiz. Puedes escribirlo o generarlo con IA ✨</div>`
    }</div>`;
  const reload = () => tabQuizzes(g, el);
  $("#new-quiz").onclick = () => quizDialog(g, null, reload);
  $$("[data-link]", el).forEach((b) => (b.onclick = () => copyText(publicUrl("q", b.dataset.link))));
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => quizDialog(g, quizzes.find((q) => q.id === b.dataset.edit), reload)));
  $$("[data-results]", el).forEach((b) => (b.onclick = () => quizResults(quizzes.find((q) => q.id === b.dataset.results), reload)));
  $$("[data-toggle]", el).forEach((b) => {
    const q = quizzes.find((x) => x.id === b.dataset.toggle);
    b.onclick = () => api(`/quizzes/${q.id}`, { method: "PATCH", body: { open: !q.open } }).then(reload, fail);
  });
  $$("[data-del]", el).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("¿Eliminar el quiz y sus respuestas? (La actividad del cuaderno con las notas se conserva.)")) return;
        await api(`/quizzes/${b.dataset.del}`, { method: "DELETE" }).then(reload, fail);
      }),
  );
}

async function quizDialog(g, quiz, done) {
  const p = modal(
    quiz ? "Editar quiz" : "Nuevo quiz",
    `<label>Título<input name="title" required value="${esc(quiz?.title)}" placeholder="Repaso unidad 1"></label>
     ${
       quiz
         ? ""
         : `<div class="ai-row row"><input id="ai-topic" placeholder="✨ Tema para generar con IA (ej.: Uso básico de ChatGPT)" style="flex:1">
            <input id="ai-n" type="number" min="1" max="15" value="5" style="width:64px" title="Nº de preguntas">
            <button type="button" id="ai-gen">✨ Generar</button></div>`
     }
     <label>Preguntas <span class="muted">— una por bloque; la correcta con <b>*</b>; deja una línea en blanco entre preguntas</span>
       <textarea name="text" rows="14" required placeholder="¿Qué significa IA?&#10;*Inteligencia artificial&#10;Internet avanzado&#10;Información automática&#10;&#10;¿Siguiente pregunta?&#10;*Correcta&#10;Incorrecta">${esc(quiz ? quizToText(quiz.questions) : "")}</textarea></label>
     ${quiz?.responses ? `<p class="muted small">⚠️ Ya hay ${quiz.responses} respuestas: cambiar las preguntas no recalcula las notas ya enviadas.</p>` : ""}`,
    { submit: quiz ? "Guardar" : "Crear quiz", wide: true },
  );
  const dlg = $$("dialog").at(-1);
  $("#ai-gen", dlg) &&
    ($("#ai-gen", dlg).onclick = (e) =>
      busy(e.currentTarget, async () => {
        const topic = $("#ai-topic", dlg).value.trim();
        if (!topic) return toast("Escribe un tema", true);
        const r = await api("/ai/quiz", { method: "POST", body: { topic, count: +$("#ai-n", dlg).value || 5 } });
        $("[name=text]", dlg).value = quizToText(r.questions);
        if (!$("[name=title]", dlg).value) $("[name=title]", dlg).value = topic;
        toast("Revisa las preguntas antes de guardar");
      }));
  const v = await p;
  if (!v) return;
  let questions;
  try {
    questions = textToQuiz(v.text);
    if (!questions.length) throw new Error("Escribe al menos una pregunta");
  } catch (e) {
    return fail(e);
  }
  try {
    await api(quiz ? `/quizzes/${quiz.id}` : `/groups/${g.id}/quizzes`, { method: quiz ? "PATCH" : "POST", body: { title: v.title, questions, date: today() } });
    toast(quiz ? "Quiz actualizado" : "Quiz creado. Copia el enlace y compártelo con tu grupo 🔗");
    done();
  } catch (e) {
    fail(e);
  }
}

async function quizResults(q, done) {
  const res = await api(`/quizzes/${q.id}/responses`);
  const perQ = q.questions.map((_, i) => (res.length ? res.filter((r) => r.answers[i] === q.questions[i].answer).length / res.length : null));
  const avg = res.length ? res.reduce((t, r) => t + r.correct / r.total, 0) / res.length : null;
  const p = modal(
    `📊 ${q.title}`,
    `<div class="stats">
       <div class="stat"><div class="stat-icon">${avg == null ? "📭" : moodFor(avg)}</div><div><small>Media</small><b>${avg == null ? "—" : (avg * 10).toFixed(1)}</b></div></div>
       <div class="stat"><div class="stat-icon">👥</div><div><small>Respuestas</small><b>${res.length}</b></div></div>
       <div class="stat"><div class="stat-icon">🔗</div><div style="min-width:0"><small>Enlace para alumnos</small>
         <button type="button" id="cp">Copiar</button></div></div></div>
     <h3>Aciertos por pregunta</h3>
     <div class="list">${q.questions
       .map(
         (x, i) => `<div class="qbar"><span class="muted">${i + 1}.</span> <span style="flex:1">${esc(x.q)}</span>
           <span class="minibar"><i class="lv-bg-${level(perQ[i])}" style="width:${(perQ[i] ?? 0) * 100}%"></i></span><b>${perQ[i] == null ? "—" : Math.round(perQ[i] * 100) + "%"}</b></div>`,
       )
       .join("")}</div>
     <h3>Alumnos</h3>
     <div class="table-wrap"><table><thead><tr><th>Alumno</th><th class="num">Aciertos</th><th class="num">Nota</th>${q.questions.map((_, i) => `<th class="num">${i + 1}</th>`).join("")}<th></th></tr></thead><tbody>
     ${
       res
         .map(
           (r) => `<tr><td>${esc(r.last_name)}, ${esc(r.first_name)}</td><td class="num">${r.correct}/${r.total}</td>
             <td class="num"><span class="avg-pill lv-${level(r.correct / r.total)}">${moodFor(r.correct / r.total)} ${((r.correct / r.total) * 10).toFixed(1)}</span></td>
             ${q.questions.map((x, i) => `<td class="num">${r.answers[i] === x.answer ? "✅" : "❌"}</td>`).join("")}
             <td><button type="button" class="ghost" data-retry="${r.student_id}" title="Permitir repetir">↺</button></td></tr>`,
         )
         .join("") || `<tr><td colspan="99" class="muted">Aún nadie ha respondido.</td></tr>`
     }</tbody></table></div>`,
    { submit: "", wide: true },
  );
  const dlg = $$("dialog").at(-1);
  $("#cp", dlg).onclick = () => copyText(publicUrl("q", q.token));
  $$("[data-retry]", dlg).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("¿Borrar su respuesta para que pueda repetir? Su nota se mantiene hasta que vuelva a enviar.")) return;
        await api(`/quizzes/${q.id}/responses/${b.dataset.retry}`, { method: "DELETE" }).then(() => b.closest("tr").remove(), fail);
      }),
  );
  await p;
  done();
}

// ───────── Autoevaluación y coevaluación ─────────
async function tabEvals(g, el) {
  const [evals, rubrics] = await Promise.all([api(`/groups/${g.id}/evals`), api("/rubrics")]);
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="muted">Comparte el enlace: cada alumno elige su nombre y evalúa con una rúbrica (a sí mismo o a un compañero).</span>
      <span class="spacer"></span><button class="primary" id="new-ev">＋ Nueva</button></div>
    <div class="grid-cards">${
      evals
        .map(
          (e) => `<div class="card">
            <div class="row"><h3>${e.mode === "self" ? "🪞 Autoevaluación" : "🤝 Coevaluación"}</h3><span class="spacer"></span><span class="chip">${e.open ? "🟢 Abierta" : "🔴 Cerrada"}</span></div>
            <p><b>${esc(e.title)}</b><br><span class="muted">📐 ${esc(e.rubric_title)} · ${e.responses} respuestas</span></p>
            <div class="row"><button data-link="${e.token}">🔗 Copiar enlace</button><button data-res="${e.id}">📊 Resultados</button>
              <button data-toggle="${e.id}">${e.open ? "Cerrar" : "Abrir"}</button><button class="danger ghost" data-del="${e.id}">✕</button></div></div>`,
        )
        .join("") || `<div class="card empty"><div style="font-size:40px">🪞</div>Crea una autoevaluación o coevaluación a partir de una rúbrica.</div>`
    }</div>`;
  const reload = () => tabEvals(g, el);
  $("#new-ev").onclick = async () => {
    if (!rubrics.length) return toast("Primero crea una rúbrica en 📐 Rúbricas", true);
    const v = await modal(
      "Nueva auto/coevaluación",
      `<label>Título<input name="title" required placeholder="Exposición del proyecto"></label>
       <label>Rúbrica<select name="rubric_id">${rubrics.map((r) => `<option value="${r.id}">${esc(r.title)}</option>`).join("")}</select></label>
       <div class="kind-picker" style="grid-template-columns:1fr 1fr">
         <label class="kind-opt"><input type="radio" name="mode" value="self" checked><span class="kind-card"><b>🪞</b><span>Autoevaluación</span><small>Cada alumno se evalúa a sí mismo</small></span></label>
         <label class="kind-opt"><input type="radio" name="mode" value="peer"><span class="kind-card"><b>🤝</b><span>Coevaluación</span><small>Evalúan a sus compañeros</small></span></label></div>`,
      { submit: "Crear" },
    );
    if (!v) return;
    try {
      const e = await api(`/groups/${g.id}/evals`, { method: "POST", body: v });
      copyText(publicUrl("e", e.token), "Creada. Enlace copiado 🔗");
      reload();
    } catch (err) {
      fail(err);
    }
  };
  $$("[data-link]", el).forEach((b) => (b.onclick = () => copyText(publicUrl("e", b.dataset.link))));
  $$("[data-toggle]", el).forEach((b) => {
    const e = evals.find((x) => x.id === b.dataset.toggle);
    b.onclick = () => api(`/evals/${e.id}`, { method: "PATCH", body: { open: !e.open } }).then(reload, fail);
  });
  $$("[data-del]", el).forEach(
    (b) => (b.onclick = async () => confirm("¿Eliminar esta evaluación y sus respuestas?") && api(`/evals/${b.dataset.del}`, { method: "DELETE" }).then(reload, fail)),
  );
  $$("[data-res]", el).forEach(
    (b) =>
      (b.onclick = async () => {
        const e = evals.find((x) => x.id === b.dataset.res);
        const r = await api(`/evals/${e.id}/responses`);
        const f = (v) => (v == null ? "—" : `<span class="avg-pill lv-${level(v)}">${moodFor(v)} ${(v * 10).toFixed(1)}</span>`);
        const p = modal(
          `📊 ${e.title}`,
          `<div class="table-wrap"><table><thead><tr><th>Alumno evaluado</th><th class="num">🪞 Auto</th><th class="num">🤝 Compañeros</th><th class="num">Diferencia</th><th>Comentarios</th></tr></thead><tbody>
            ${
              r.summary
                .map((s) => {
                  const d = s.self != null && s.peers_avg != null ? (s.self - s.peers_avg) * 10 : null;
                  return `<tr><td>${esc(s.name)}</td><td class="num">${f(s.self)}</td><td class="num">${f(s.peers_avg)} <small class="muted">(${s.peers_count})</small></td>
                    <td class="num">${d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}</td><td style="white-space:normal">${s.comments.map(esc).join("<br>")}</td></tr>`;
                })
                .join("") || `<tr><td colspan="5" class="muted">Sin respuestas todavía.</td></tr>`
            }</tbody></table></div>
           <div class="row"><span class="muted">Pasar al cuaderno como actividad nueva:</span>
             <select id="src"><option value="mix">Media auto + compañeros</option><option value="self">Solo autoevaluación</option><option value="peers">Solo compañeros</option></select>
             <button type="button" class="primary" id="togb">📊 Pasar al cuaderno</button></div>`,
          { submit: "", wide: true },
        );
        const dlg = $$("dialog").at(-1);
        $("#togb", dlg).onclick = (ev) =>
          busy(ev.currentTarget, async () => {
            const x = await api(`/evals/${e.id}/to-gradebook`, { method: "POST", body: { source: $("#src", dlg).value, date: today() } });
            toast(`Actividad creada con ${x.grades} notas`);
            dlg.close();
          });
        await p;
      }),
  );
}

// ───────── Recursos ─────────
const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
const RES = {
  link: { icon: "🔗", label: "Enlace" },
  video: { icon: "🎬", label: "Video" },
  doc: { icon: "📄", label: "Documento" },
  slides: { icon: "📊", label: "Presentación" },
  image: { icon: "🖼️", label: "Imagen" },
  other: { icon: "📦", label: "Otro" },
};
const guessKind = (url) =>
  /youtu\.?be|vimeo/i.test(url) ? "video" : /\.(pdf|docx?)($|\?)|docs\.google\.com\/document/i.test(url) ? "doc"
  : /\.(pptx?)($|\?)|docs\.google\.com\/presentation|canva\.com/i.test(url) ? "slides" : /\.(png|jpe?g|gif|webp)($|\?)/i.test(url) ? "image" : "link";

async function tabResources(g, el) {
  const list = await api(`/groups/${g.id}/resources`);
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="muted">Guarda los enlaces de tu curso: manuales, videos, presentaciones, Drive…</span>
      <span class="spacer"></span><button class="primary" id="add-res">＋ Recurso</button></div>
    <div class="grid-cards">${
      list
        .map(
          (r) => `<div class="card res-card">
            <div class="res-icon">${RES[r.kind]?.icon || "🔗"}</div>
            <div style="flex:1;min-width:0"><b>${esc(r.title)}</b><div class="muted small">${RES[r.kind]?.label || ""}${r.url ? " · " + esc(hostOf(r.url)) : ""}</div>
              ${r.notes ? `<p class="small" style="margin:6px 0 0">${esc(r.notes)}</p>` : ""}
              <div class="row" style="margin-top:8px">${r.url ? `<a class="btn-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : ""}
                <button class="ghost" data-copy="${esc(r.url || "")}" ${r.url ? "" : "hidden"}>📋</button>
                <button class="ghost" data-edit="${r.id}">✎</button><button class="ghost danger" data-del="${r.id}">✕</button></div></div></div>`,
        )
        .join("") || `<div class="card empty"><div style="font-size:40px">📎</div>Aún no hay recursos.</div>`
    }</div>`;
  const reload = () => tabResources(g, el);
  const dialog = async (r) => {
    const v = await modal(
      r ? "Editar recurso" : "Nuevo recurso",
      `<label>Título<input name="title" required value="${esc(r?.title)}" placeholder="Manual ChatGPT Profesional"></label>
       <label>Enlace (URL)<input name="url" type="url" value="${esc(r?.url)}" placeholder="https://…"></label>
       <label>Tipo<select name="kind"><option value="">Detectar automáticamente</option>${Object.entries(RES)
         .map(([k, x]) => `<option value="${k}" ${r?.kind === k ? "selected" : ""}>${x.icon} ${x.label}</option>`)
         .join("")}</select></label>
       <label>Notas<textarea name="notes" rows="3">${esc(r?.notes)}</textarea></label>`,
    );
    if (!v) return;
    v.kind = v.kind || (v.url ? guessKind(v.url) : "other");
    try {
      await api(r ? `/resources/${r.id}` : `/groups/${g.id}/resources`, { method: r ? "PATCH" : "POST", body: v });
      reload();
    } catch (e) {
      fail(e);
    }
  };
  $("#add-res").onclick = () => dialog();
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => dialog(list.find((x) => x.id === b.dataset.edit))));
  $$("[data-copy]", el).forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
  $$("[data-del]", el).forEach((b) => (b.onclick = () => confirm("¿Eliminar este recurso?") && api(`/resources/${b.dataset.del}`, { method: "DELETE" }).then(reload, fail)));
}

// ───────── Páginas públicas de alumnos ─────────
function publicShell(inner) {
  $("#app").innerHTML = `<div class="pub"><div class="pub-card">${inner}</div><p class="muted small" style="text-align:center">📒 Cuaderno</p></div>`;
}
const pubErr = (e) => publicShell(`<div class="empty"><div style="font-size:48px">😕</div><h3>${esc(e.message)}</h3><p class="muted">Pide a tu docente un enlace nuevo.</p></div>`);

async function renderPublicQuiz(token) {
  let d;
  try {
    d = await api(`/p/quiz/${token}`);
  } catch (e) {
    return pubErr(e);
  }
  if (!d.open) return publicShell(`<div class="empty"><div style="font-size:48px">🔒</div><h3>${esc(d.title)}</h3><p>Este cuestionario está cerrado.</p></div>`);
  const done = new Set(d.done);
  publicShell(`<div class="pub-head"><small>${esc(d.group)}</small><h2>❓ ${esc(d.title)}</h2><p class="muted">${d.questions.length} preguntas</p></div>
    <label>¿Quién eres?<select id="who"><option value="">— Elige tu nombre —</option>${d.students
      .map((s) => `<option value="${s.id}" ${done.has(s.id) ? "disabled" : ""}>${esc(s.last_name)}, ${esc(s.first_name)}${done.has(s.id) ? " ✓ (ya respondió)" : ""}</option>`)
      .join("")}</select></label>
    <form id="qf">${d.questions
      .map(
        (q, i) => `<fieldset class="pub-q"><legend><span class="qnum">${i + 1}</span> ${esc(q.q)}</legend>
          ${q.options.map((o, j) => `<label class="pub-opt"><input type="radio" name="q${i}" value="${j}" required><span>${esc(o)}</span></label>`).join("")}</fieldset>`,
      )
      .join("")}
      <button class="primary big" type="submit" style="width:100%">Enviar respuestas</button></form>`);
  $("#qf").onsubmit = async (e) => {
    e.preventDefault();
    const sid = $("#who").value;
    if (!sid) return toast("Elige tu nombre arriba", true), $("#who").focus();
    const fd = new FormData(e.target);
    const answers = d.questions.map((_, i) => Number(fd.get(`q${i}`)));
    const st = d.students.find((s) => s.id === sid);
    if (!confirm(`Enviar como ${st.first_name} ${st.last_name}? Solo puedes enviarlo una vez.`)) return;
    try {
      const r = await api(`/p/quiz/${token}`, { method: "POST", body: { student_id: sid, answers } });
      const pct = r.correct / r.total;
      publicShell(`<div class="pub-result"><div class="big-face">${pct >= 0.9 ? "🏆" : moodFor(pct)}</div>
        <h2>${r.correct} de ${r.total} correctas</h2><p class="score">Nota: <b>${r.score}</b> / 10</p>
        <p>${pct >= 0.9 ? "¡Excelente trabajo! 🎉" : pct >= 0.6 ? "¡Bien hecho! Sigue así 💪" : "¡No te rindas! Repasa y lo lograrás 📚"}</p></div>
        <h3>Revisión</h3>${d.questions
          .map((q, i) => {
            const ok = r.review[i].yours === r.review[i].answer;
            return `<div class="pub-rev ${ok ? "ok" : "ko"}"><b>${ok ? "✅" : "❌"} ${i + 1}. ${esc(q.q)}</b>
              ${ok ? "" : `<div class="small">Tu respuesta: ${esc(q.options[r.review[i].yours])}</div>`}
              <div class="small">Correcta: <b>${esc(q.options[r.review[i].answer])}</b></div></div>`;
          })
          .join("")}`);
    } catch (err) {
      fail(err);
    }
  };
}

async function renderPublicEval(token) {
  let d;
  try {
    d = await api(`/p/eval/${token}`);
  } catch (e) {
    return pubErr(e);
  }
  if (!d.open) return publicShell(`<div class="empty"><div style="font-size:48px">🔒</div><h3>${esc(d.title)}</h3><p>Esta evaluación está cerrada.</p></div>`);
  const peer = d.mode === "peer";
  const draw = (me = "") => {
    const doneBy = new Set(d.done.filter((x) => x.evaluator_id === me).map((x) => x.target_id));
    publicShell(`<div class="pub-head"><small>${esc(d.group)}</small><h2>${peer ? "🤝 Coevaluación" : "🪞 Autoevaluación"}</h2><p><b>${esc(d.title)}</b><br><span class="muted">📐 ${esc(d.rubric.title)}</span></p></div>
      <label>¿Quién eres?<select id="me"><option value="">— Elige tu nombre —</option>${d.students
        .map((s) => `<option value="${s.id}" ${s.id === me ? "selected" : ""}>${esc(s.last_name)}, ${esc(s.first_name)}</option>`)
        .join("")}</select></label>
      ${
        peer
          ? `<label>¿A quién evalúas?<select id="target"><option value="">— Elige a tu compañero/a —</option>${d.students
              .filter((s) => s.id !== me)
              .map((s) => `<option value="${s.id}">${esc(s.last_name)}, ${esc(s.first_name)}${doneBy.has(s.id) ? " ✓ (ya lo evaluaste)" : ""}</option>`)
              .join("")}</select></label>`
          : ""
      }
      <form id="ef">${d.rubric.criteria
        .map(
          (c, i) => `<fieldset class="pub-q"><legend><span class="qnum">${i + 1}</span> ${esc(c.name)}</legend>
            ${c.levels
              .map(
                (l, j) => `<label class="pub-opt"><input type="radio" name="c${i}" value="${j}" required>
                  <span><b>${esc(l.label)}</b>${l.descriptor ? `<br><small class="muted">${esc(l.descriptor)}</small>` : ""}</span></label>`,
              )
              .join("")}</fieldset>`,
        )
        .join("")}
        <label>Comentario (opcional)<textarea name="comment" rows="3" placeholder="${peer ? "¿Qué hizo bien? ¿Qué puede mejorar?" : "¿Qué aprendiste? ¿Qué mejorarías?"}"></textarea></label>
        <button class="primary big" type="submit" style="width:100%">Enviar evaluación</button></form>`);
    $("#me").onchange = (e) => draw(e.target.value);
    $("#ef").onsubmit = async (e) => {
      e.preventDefault();
      const evaluator_id = $("#me").value;
      const target_id = peer ? $("#target").value : evaluator_id;
      if (!evaluator_id) return toast("Elige tu nombre", true);
      if (!target_id) return toast("Elige a quién evalúas", true);
      const fd = new FormData(e.target);
      const levels = d.rubric.criteria.map((_, i) => Number(fd.get(`c${i}`)));
      try {
        await api(`/p/eval/${token}`, { method: "POST", body: { evaluator_id, target_id, levels, comment: fd.get("comment") } });
        d.done = d.done.filter((x) => !(x.evaluator_id === evaluator_id && x.target_id === target_id)).concat({ evaluator_id, target_id });
        publicShell(`<div class="pub-result"><div class="big-face">🙌</div><h2>¡Gracias!</h2><p>Tu evaluación se guardó.</p>
          ${peer ? `<button class="primary big" id="again">🤝 Evaluar a otro compañero</button>` : ""}</div>`);
        $("#again") && ($("#again").onclick = () => draw(evaluator_id));
      } catch (err) {
        fail(err);
      }
    };
  };
  draw();
}

// ───────── Integraciones con LMS ─────────
const LMS = {
  google: { name: "Google Classroom", short: "Classroom", icon: "🟩", color: "#1e8e3e" },
  microsoft: { name: "Microsoft Teams", short: "Teams", icon: "🟪", color: "#5b5fc7" },
  moodle: { name: "Moodle", short: "Moodle", icon: "🟧", color: "#f98012" },
};

async function renderIntegrations(params) {
  shell("integraciones", `<div class="header"><h2>🔌 Integraciones</h2></div><div id="int"><span class="spin"></span></div>`);
  if (params.get("ok")) toast(`✅ ${LMS[params.get("ok")]?.name || "Cuenta"} conectado`);
  if (params.get("error")) toast(`No se pudo conectar: ${params.get("error")}`, true);
  if (params.toString()) history.replaceState(null, "", "#/integraciones");
  let st, keys;
  try {
    [st, keys] = await Promise.all([api("/integrations"), api("/api-keys")]);
  } catch (e) {
    return fail(e);
  }
  const linked = state.groups.filter((g) => g.settings?.lms);
  const card = (p, body) => `<div class="card lms-card" style="--lc:${LMS[p].color}">
      <div class="row"><span class="lms-logo">${LMS[p].icon}</span><h3>${LMS[p].name}</h3><span class="spacer"></span>
        ${st[p].connected ? `<span class="chip ok">● Conectado</span>` : `<span class="chip">○ Sin conectar</span>`}</div>${body}</div>`;
  const oauthBody = (p) =>
    st[p].connected
      ? `<p class="muted">Cuenta: <b>${esc(st[p].account || "—")}</b></p>
         <ul class="small muted"><li>Importa alumnos de tus clases</li><li>Envía notas como tarea calificada</li></ul>
         <div class="row"><button data-reconnect="${p}">Reconectar</button><button class="danger ghost" data-disconnect="${p}">Desconectar</button></div>`
      : st[p].configured
        ? `<p class="muted">Importa tus clases y alumnos, y envía las notas del cuaderno.</p>
           <button class="primary" data-connect="${p}">Conectar con ${LMS[p].short}</button>`
        : `<p class="muted">Falta registrar la app en ${p === "google" ? "Google Cloud" : "Microsoft Entra (Azure)"} (una sola vez, la hace el administrador del servidor).</p>
           <details><summary>Ver pasos de configuración</summary>${setupSteps(p, st.redirect_uris[p])}</details>`;
  $("#int").innerHTML = `
    <p class="muted">Conecta el cuaderno con tu plataforma educativa: importa la lista de alumnos de un curso y envía las calificaciones. Luego, en cada grupo, usa el botón <b>🔌 LMS</b>.</p>
    <div class="grid-cards lms-grid">
      ${card("google", oauthBody("google"))}
      ${card("microsoft", oauthBody("microsoft"))}
      ${card(
        "moodle",
        st.moodle.connected
          ? `<p class="muted">Sitio: <b>${esc(st.moodle.account || "—")}</b></p>
             <ul class="small muted"><li>Importa alumnos de tus cursos</li><li>Notas: descarga un CSV listo para importar en Moodle</li></ul>
             <div class="row"><button data-moodle>Cambiar</button><button class="danger ghost" data-disconnect="moodle">Desconectar</button></div>`
          : `<p class="muted">Usa la URL de tu Moodle y un <b>token de servicios web</b> (Moodle → Preferencias → Claves de seguridad).</p>
             <button class="primary" data-moodle>Conectar Moodle</button>`,
      )}
      <div class="card lms-card" style="--lc:#495057">
        <div class="row"><span class="lms-logo">🧩</span><h3>Otras plataformas</h3></div>
        <ul class="small"><li><b>Importar alumnos</b>: en un grupo → 👥 Alumnos → <b>📄 Importar CSV</b> (exportado de cualquier plataforma).</li>
          <li><b>Exportar notas</b>: botón 🔌 LMS del grupo → «CSV con email».</li>
          <li><b>Automatizaciones</b> (Zapier, Make, scripts): usa una clave de API.</li></ul>
        <div class="list">${
          keys
            .map(
              (k) => `<div class="list-item"><code>${esc(k.prefix)}…</code><div style="flex:1"><b>${esc(k.name)}</b><div class="muted small">${
                k.last_used ? "Último uso " + fmtDate(k.last_used.slice(0, 10)) : "Sin usar"
              }</div></div><button class="ghost danger" data-delkey="${k.id}">✕</button></div>`,
            )
            .join("") || `<p class="muted small">Sin claves de API.</p>`
        }</div>
        <button id="newkey">🔑 Crear clave de API</button>
      </div>
    </div>
    ${
      linked.length
        ? `<h3 style="margin-top:20px">Grupos vinculados</h3><div class="list">${linked
            .map(
              (g) => `<div class="list-item"><span>${LMS[g.settings.lms.provider]?.icon}</span><b>${esc(g.name)}</b><span class="muted">↔ ${esc(
                g.settings.lms.course_name || g.settings.lms.course_id,
              )} (${LMS[g.settings.lms.provider]?.short})</span><span class="spacer"></span><a href="#/g/${g.id}">Abrir</a></div>`,
            )
            .join("")}</div>`
        : ""
    }`;
  const reload = () => renderIntegrations(new URLSearchParams());
  $$("[data-connect], [data-reconnect]").forEach(
    (b) =>
      (b.onclick = (e) =>
        busy(e.currentTarget, async () => {
          const r = await api(`/integrations/${b.dataset.connect || b.dataset.reconnect}/start`);
          location.href = r.url;
        })),
  );
  $$("[data-disconnect]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`¿Desconectar ${LMS[b.dataset.disconnect].name}? Los grupos vinculados dejarán de sincronizar hasta que vuelvas a conectar.`)) return;
        await api(`/integrations/${b.dataset.disconnect}`, { method: "DELETE" }).then(reload, fail);
      }),
  );
  $$("[data-moodle]").forEach(
    (b) =>
      (b.onclick = async () => {
        const v = await modal(
          "Conectar Moodle",
          `<label>URL de tu Moodle<input name="url" type="url" required placeholder="https://moodle.tuescuela.edu.mx"></label>
           <label>Token de servicios web<input name="token" required autocomplete="off" placeholder="Pega aquí tu token"></label>
           <details><summary class="muted">¿Dónde consigo el token?</summary><ol class="small">
             <li>Entra a tu Moodle → menú de usuario → <b>Preferencias</b> → <b>Claves de seguridad</b>.</li>
             <li>Copia la clave del servicio <b>Moodle mobile web service</b> (o el que te indique tu administrador).</li>
             <li>Si no aparece, pide al administrador que habilite los servicios web y el protocolo REST.</li></ol></details>`,
          { submit: "Conectar" },
        );
        if (!v) return;
        try {
          const r = await api("/integrations/moodle", { method: "POST", body: v });
          toast(`✅ Moodle conectado: ${r.account}`);
          reload();
        } catch (e) {
          fail(e);
        }
      }),
  );
  $("#newkey").onclick = async () => {
    const v = await modal("Nueva clave de API", `<label>Nombre<input name="name" required placeholder="Zapier / script de notas"></label>`, { submit: "Crear" });
    if (!v) return;
    try {
      const k = await api("/api-keys", { method: "POST", body: v });
      const pk = modal(
        "🔑 Copia tu clave ahora",
        `<p>Por seguridad <b>solo se muestra esta vez</b>. Úsala como <code>Authorization: Bearer &lt;clave&gt;</code>.</p>
         <div class="row"><input readonly value="${esc(k.key)}" style="flex:1;font-family:monospace" id="keyval"><button type="button" id="cpkey">Copiar</button></div>
         <p class="muted small">Da acceso completo a tus grupos. No la compartas; si se filtra, bórrala.</p>`,
        { submit: "" },
      );
      $("#cpkey").onclick = () => copyText($("#keyval").value, "Clave copiada");
      await pk;
      reload();
    } catch (e) {
      fail(e);
    }
  };
  $$("[data-copyuri]").forEach((b) => (b.onclick = () => copyText(b.dataset.copyuri, "URI copiada")));
  $$("[data-delkey]").forEach(
    (b) => (b.onclick = async () => confirm("¿Borrar esta clave? Las automatizaciones que la usen dejarán de funcionar.") && api(`/api-keys/${b.dataset.delkey}`, { method: "DELETE" }).then(reload, fail)),
  );
}

function setupSteps(p, uri) {
  const copy = `<div class="row"><code class="uri">${esc(uri)}</code><button type="button" data-copyuri="${esc(uri)}">Copiar</button></div>`;
  return p === "google"
    ? `<ol class="small">
        <li>En <b>console.cloud.google.com</b> crea un proyecto y activa la <b>Google Classroom API</b>.</li>
        <li>Pantalla de consentimiento OAuth: tipo «Externo», añade tu correo como usuario de prueba.</li>
        <li>Credenciales → Crear ID de cliente OAuth → «Aplicación web». URI de redireccionamiento autorizado:${copy}</li>
        <li>Guarda el ID y el secreto en Cloudflare:<br><code>npx wrangler secret put GOOGLE_CLIENT_ID</code><br><code>npx wrangler secret put GOOGLE_CLIENT_SECRET</code></li></ol>`
    : `<ol class="small">
        <li>En <b>entra.microsoft.com</b> → Registros de aplicaciones → Nuevo registro (cuentas de cualquier organización).</li>
        <li>URI de redirección (Web):${copy}</li>
        <li>Permisos delegados de Microsoft Graph: <code>EduRoster.ReadBasic</code>, <code>EduAssignments.ReadWrite</code>, <code>User.Read</code>, <code>offline_access</code> (el administrador del centro debe dar consentimiento).</li>
        <li>Certificados y secretos → nuevo secreto. Guárdalos en Cloudflare:<br><code>npx wrangler secret put MS_CLIENT_ID</code><br><code>npx wrangler secret put MS_CLIENT_SECRET</code></li></ol>`;
}

/** Diálogo del grupo: vincular curso, importar alumnos y enviar notas */
async function lmsDialog(g) {
  const st = await api("/integrations").catch(fail);
  if (!st) return;
  const lms = g.settings?.lms;
  const connected = Object.keys(LMS).filter((p) => st[p].connected);
  const assessments = lms ? await api(`/groups/${g.id}/assessments`) : [];
  const p = modal(
    `🔌 ${esc(g.name)} ↔ plataforma`,
    lms
      ? `<div class="lms-linked" style="--lc:${LMS[lms.provider].color}"><span class="lms-logo">${LMS[lms.provider].icon}</span>
           <div><b>${esc(lms.course_name || lms.course_id)}</b><div class="muted small">${LMS[lms.provider].name}${st[lms.provider].connected ? "" : " · ⚠️ cuenta desconectada"}</div></div>
           <span class="spacer"></span><button type="button" class="ghost danger" id="unlink">Desvincular</button></div>
         <h3>👥 Alumnos</h3>
         <p class="muted small">Trae a los alumnos del curso. Empareja por email o nombre con los que ya tienes (no duplica ni borra a nadie).</p>
         <button type="button" class="primary" id="roster">⬇ Importar / actualizar alumnos</button>
         <div id="roster-res"></div>
         <h3>📤 Notas</h3>
         ${
           lms.provider === "moodle"
             ? `<p class="muted small">Moodle: descarga el CSV y en tu curso ve a <b>Calificaciones → Importar → Archivo CSV</b>; mapea por «Email address».</p>`
             : `<div class="row"><select id="push-a" style="flex:1">${assessments
                 .map((a) => `<option value="${a.id}">${esc(a.name)}${a.external ? " · ✓ vinculada" : ""}</option>`)
                 .join("")}</select>
                 <label class="row" style="gap:4px;color:inherit"><input type="checkbox" id="push-ret"> Devolver a los alumnos</label>
                 <button type="button" class="primary" id="push">📤 Enviar notas</button></div>
               <p class="muted small">Se crea una tarea calificada con el mismo nombre (la primera vez) y se ponen las notas de los alumnos vinculados.</p>
               <div id="push-res"></div>`
         }
         <button type="button" id="lmscsv">⬇ CSV con email (Moodle / otras plataformas)</button>`
      : connected.length
        ? `<p class="muted">Elige la plataforma y el curso que corresponde a este grupo.</p>
           <div class="row">${connected.map((x) => `<button type="button" data-prov="${x}">${LMS[x].icon} ${LMS[x].name}</button>`).join("")}</div>
           <div id="courses"></div>`
        : `<div class="empty"><div style="font-size:40px">🔌</div>Aún no conectaste ninguna plataforma.<br><a href="#/integraciones" id="go-int">Ir a Integraciones</a></div>`,
    { submit: "", wide: true },
  );
  const dlg = $$("dialog").at(-1);
  const refreshGroup = async () => {
    state.groups = await api("/groups");
    return state.groups.find((x) => x.id === g.id);
  };
  $("#go-int", dlg) && ($("#go-int", dlg).onclick = () => dlg.close());
  $$("[data-prov]", dlg).forEach(
    (b) =>
      (b.onclick = (e) =>
        busy(e.currentTarget, async () => {
          const list = await api(`/integrations/${b.dataset.prov}/courses`);
          $("#courses", dlg).innerHTML = list.length
            ? `<div class="list">${list
                .map(
                  (c) => `<div class="list-item"><div style="flex:1"><b>${esc(c.name)}</b>${c.section ? `<div class="muted small">${esc(c.section)}</div>` : ""}</div>
                    <button type="button" class="primary" data-course="${esc(c.id)}" data-cname="${esc(c.name)}">Vincular</button></div>`,
                )
                .join("")}</div>`
            : `<p class="muted">No encontré cursos activos donde seas docente.</p>`;
          $$("[data-course]", dlg).forEach(
            (cb) =>
              (cb.onclick = async () => {
                try {
                  await api(`/groups/${g.id}/lms/link`, { method: "POST", body: { provider: b.dataset.prov, course_id: cb.dataset.course, course_name: cb.dataset.cname } });
                  toast("Grupo vinculado ✔");
                  dlg.close();
                  const ng = await refreshGroup();
                  route();
                  lmsDialog(ng);
                } catch (err) {
                  fail(err);
                }
              }),
          );
        })),
  );
  $("#unlink", dlg) &&
    ($("#unlink", dlg).onclick = async () => {
      if (!confirm("¿Desvincular este grupo del curso? No se borra nada.")) return;
      await api(`/groups/${g.id}/lms/link`, { method: "POST", body: { provider: null } }).catch(fail);
      dlg.close();
      await refreshGroup();
      route();
    });
  $("#roster", dlg) &&
    ($("#roster", dlg).onclick = (e) =>
      busy(e.currentTarget, async () => {
        const r = await api(`/groups/${g.id}/lms/roster`, { method: "POST", body: {} });
        $("#roster-res", dlg).innerHTML = `<div class="ai-box">✅ ${r.total} alumnos en el curso · <b>${r.created}</b> nuevos · <b>${r.linked}</b> emparejados · ${r.unchanged} sin cambios${
          r.not_in_lms ? ` · ⚠️ ${r.not_in_lms} de tu lista no están en el curso` : ""
        }</div>`;
        if (r.created) state.groups = await api("/groups");
      }));
  $("#push", dlg) &&
    ($("#push", dlg).onclick = (e) =>
      busy(e.currentTarget, async () => {
        const r = await api(`/assessments/${$("#push-a", dlg).value}/lms/push`, { method: "POST", body: { return: $("#push-ret", dlg).checked } });
        $("#push-res", dlg).innerHTML = `<div class="ai-box">${r.pending ? "⏳ " + esc(r.message) : `✅ ${r.pushed} notas enviadas${r.returned ? " y devueltas" : ""}`}${
          r.without_link ? ` · ⚠️ ${r.without_link} alumnos con nota no están vinculados (importa alumnos primero)` : ""
        }${r.link ? ` · <a href="${esc(r.link)}" target="_blank" rel="noopener">Abrir tarea ↗</a>` : ""}</div>`;
      }));
  $("#lmscsv", dlg) &&
    ($("#lmscsv", dlg).onclick = async () => {
      const res = await fetch(`/groups/${g.id}/export/lms.csv`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (!res.ok) return toast("No se pudo descargar", true);
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: `notas-${g.name}.csv` }).click();
      URL.revokeObjectURL(url);
    });
  await p;
}

// ───────── Importar alumnos desde CSV de cualquier plataforma ─────────
function parseCSV(text) {
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function csvImportDialog(g, existing, done) {
  const p = modal(
    "📄 Importar alumnos desde CSV",
    `<p class="muted">Sirve el CSV exportado de Google Classroom, Teams, Moodle, Excel o tu sistema escolar. Detecto las columnas de nombre, apellidos y email.</p>
     <input type="file" id="csvfile" accept=".csv,.txt,text/csv">
     <div id="csvprev"></div>`,
    { submit: "" },
  );
  const dlg = $$("dialog").at(-1);
  const key = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const find = (h, words) => h.findIndex((x) => words.some((w) => key(x) === w || key(x).includes(w)));
  $("#csvfile", dlg).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rows = parseCSV((await f.text()).replace(/^﻿/, ""));
    if (rows.length < 2) return toast("El archivo no tiene filas de datos", true);
    const h = rows[0];
    const iFirst = find(h, ["first name", "given name", "nombre(s)", "nombres", "firstname", "nombre"]);
    const iLast = find(h, ["last name", "surname", "family name", "apellidos", "apellido", "lastname"]);
    const iFull = find(h, ["full name", "nombre completo", "display name", "student name", "alumno", "estudiante"]);
    const iMail = find(h, ["email", "e-mail", "correo", "mail"]);
    const sel = (name, idx) =>
      `<label>${name}<select data-col="${name}"><option value="-1">— ninguna —</option>${h.map((c, i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>`;
    $("#csvprev", dlg).innerHTML = `<div class="form-grid">${sel("Nombre", iFirst === iFull ? -1 : iFirst)}${sel("Apellidos", iLast)}${sel("Nombre completo", iFull)}${sel("Email", iMail)}</div>
      <div id="csvtable"></div><button type="button" class="primary" id="csvgo">Importar</button>`;
    let out = [];
    const build = () => {
      const col = (n) => +$(`[data-col="${n}"]`, dlg).value;
      const [cf, cl, cn, cm] = ["Nombre", "Apellidos", "Nombre completo", "Email"].map(col);
      const have = new Set(existing.map((s) => key(s.email || "")).filter(Boolean));
      const haveName = new Set(existing.map((s) => key(`${s.first_name} ${s.last_name}`)));
      out = rows.slice(1).map((r) => {
        let first = cf >= 0 ? r[cf] : "", last = cl >= 0 ? r[cl] : "";
        if ((!first || !last) && cn >= 0 && r[cn]) {
          const full = r[cn].trim();
          if (full.includes(",")) [last, first] = full.split(",").map((x) => x.trim());
          else [first, ...last] = full.split(/\s+/), (last = last.join(" "));
        }
        const email = cm >= 0 ? (r[cm] || "").trim() || null : null;
        const dup = (email && have.has(key(email))) || haveName.has(key(`${first} ${last}`));
        return { first_name: (first || "").trim(), last_name: (last || "").trim(), email, dup };
      }).filter((s) => s.first_name || s.last_name);
      const nuevos = out.filter((s) => !s.dup);
      $("#csvtable", dlg).innerHTML = `<p class="muted small">${out.length} filas · <b>${nuevos.length} nuevos</b> · ${out.length - nuevos.length} ya existen (se omiten)</p>
        <div class="table-wrap" style="max-height:240px"><table><thead><tr><th>Nombre</th><th>Apellidos</th><th>Email</th><th></th></tr></thead><tbody>${out
          .slice(0, 100)
          .map((s) => `<tr class="${s.dup ? "muted" : ""}"><td>${esc(s.first_name)}</td><td>${esc(s.last_name)}</td><td>${esc(s.email || "")}</td><td>${s.dup ? "ya existe" : "✚"}</td></tr>`)
          .join("")}</tbody></table></div>`;
    };
    $$("[data-col]", dlg).forEach((s) => (s.onchange = build));
    build();
    $("#csvgo", dlg).onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        const nuevos = out.filter((s) => !s.dup).map(({ dup, ...s }) => ({ ...s, first_name: s.first_name || "-", last_name: s.last_name || "-" }));
        if (!nuevos.length) return toast("No hay alumnos nuevos que importar", true);
        for (let i = 0; i < nuevos.length; i += 200) await api(`/groups/${g.id}/students`, { method: "POST", body: nuevos.slice(i, i + 200) });
        toast(`${nuevos.length} alumnos importados`);
        dlg.close();
      });
  };
  await p;
  done();
}

// ───────── Rúbricas ─────────
async function renderRubrics() {
  shell("rubricas", `<div class="header"><h2>📐 Rúbricas</h2><span class="spacer"></span>
    <button id="ai-rub">✨ Generar con IA</button><button class="primary" id="new-rub">＋ Nueva</button></div><div id="rubs"><span class="spin"></span></div>`);
  const rubrics = await api("/rubrics").catch(fail);
  $("#rubs").innerHTML =
    rubrics
      ?.map(
        (r) => `<div class="card stack" style="margin-bottom:14px">
      <div class="row"><h3>${esc(r.title)}</h3><span class="spacer"></span><button class="danger" data-del-rub="${r.id}">Eliminar</button></div>
      ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ""}
      ${rubricTable(r)}</div>`,
      )
      .join("") || `<div class="card empty">Sin rúbricas. Genera una con IA en segundos.</div>`;
  $("#ai-rub").onclick = async () => {
    const v = await modal(
      "Generar rúbrica con IA",
      `<label>Actividad o tema<input name="topic" required placeholder="Exposición oral sobre el ciclo del agua"></label>
       <div class="form-grid"><label>Nivel educativo<input name="level" value="Secundaria"></label>
       <label>Criterios<input name="criteria_count" type="number" min="2" max="8" value="4"></label>
       <label>Niveles<input name="levels_count" type="number" min="2" max="5" value="4"></label></div>`,
      { submit: "Generar" },
    );
    if (!v) return;
    toast("Generando rúbrica…");
    try {
      const r = await api("/ai/rubric", { method: "POST", body: { ...v, save: true } });
      toast(`Rúbrica "${r.title}" creada`);
      renderRubrics();
    } catch (e) {
      fail(e);
    }
  };
  $("#new-rub").onclick = async () => {
    const v = await modal(
      "Nueva rúbrica",
      `<label>Título<input name="title" required></label>
       <label>Descripción<input name="description"></label>
       <label>Niveles (de mayor a menor, separados por coma)<input name="levels" value="Excelente, Bien, Suficiente, Insuficiente"></label>
       <label>Criterios (uno por línea)<textarea name="criteria" rows="5" required placeholder="Contenido&#10;Expresión&#10;Organización"></textarea></label>`,
    );
    if (!v) return;
    const levels = v.levels.split(",").map((s) => s.trim()).filter(Boolean);
    const criteria = v.criteria
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, weight: 1, levels: levels.map((label, i) => ({ label, score: levels.length - i, descriptor: "" })) }));
    try {
      await api("/rubrics", { method: "POST", body: { title: v.title, description: v.description, criteria } });
      renderRubrics();
    } catch (e) {
      fail(e);
    }
  };
  $$("[data-del-rub]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("¿Eliminar esta rúbrica?")) return;
        await api(`/rubrics/${b.dataset.delRub}`, { method: "DELETE" }).then(renderRubrics, fail);
      }),
  );
}
const rubricTable = (r) =>
  `<div class="table-wrap"><table class="rubric"><thead><tr><th>Criterio</th>${r.criteria[0].levels
    .map((l) => `<th>${esc(l.label)} (${l.score})</th>`)
    .join("")}</tr></thead><tbody>${r.criteria
    .map((c) => `<tr><th>${esc(c.name)}${c.weight != 1 ? ` ×${c.weight}` : ""}</th>${c.levels.map((l) => `<td>${esc(l.descriptor || "")}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

route();

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
        <button type="button" data-cancel>Cancelar</button>
        ${submit ? `<button class="primary" type="submit">${esc(submit)}</button>` : ""}
      </div></form></div>`;
    document.body.append(d);
    const form = $("form", d);
    let result = null;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      result = Object.fromEntries(new FormData(form));
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
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!state.token) return renderAuth();
  if (parts[0] === "login") return (location.hash = "#/");
  try {
    state.groups = await api("/groups");
  } catch (e) {
    return fail(e);
  }
  if (parts[0] === "g" && parts[1]) return renderGroup(parts[1], parts[2] || "cuaderno");
  if (parts[0] === "rubricas") return renderRubrics();
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
    </div>`,
  );
  if (!v) return;
  v.grading_scale = Number(v.grading_scale) || 10;
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
const TABS = { cuaderno: "📊 Cuaderno", alumnos: "👥 Alumnos", asistencia: "✅ Asistencia", sesiones: "🗓️ Sesiones" };

async function renderGroup(gid, tab) {
  const g = state.groups.find((x) => x.id === gid);
  if (!g) return (location.hash = "#/");
  shell(
    gid,
    `<div class="header">
      <span class="dot" style="background:${esc(g.color || COLORS[0])};width:14px;height:14px"></span>
      <h2>${esc(g.name)}</h2><span class="muted">${esc(g.subject || "")}</span><span class="spacer"></span>
      <button id="edit-g">Editar</button><button class="danger" id="del-g">Eliminar</button>
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
  const fn = { cuaderno: tabGradebook, alumnos: tabStudents, asistencia: tabAttendance, sesiones: tabSessions }[tab] || tabGradebook;
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
const moodFor = (pct) => (pct == null ? "" : pct >= 0.9 ? "😁" : pct >= 0.75 ? "🙂" : pct >= 0.6 ? "😐" : "😟");
const level = (pct) => (pct == null ? "none" : pct < 0.6 ? "bad" : pct < 0.8 ? "mid" : "good");
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
  const good = avgs.filter((v) => v / scale >= 0.8).length;
  const mid = avgs.filter((v) => v / scale >= 0.6 && v / scale < 0.8).length;
  const bad = avgs.filter((v) => v / scale < 0.6).length;
  const pend = gb.rows.length - avgs.length;
  const seg = (n, c) => (n ? `<span class="seg seg-${c}" style="flex:${n}" title="${n}"></span>` : "");
  return `<div class="stats">
    <div class="stat"><div class="stat-icon">${moodFor(mean == null ? null : mean / scale) || "📊"}</div>
      <div><small>Media del grupo</small><b class="lv-text-${level(mean == null ? null : mean / scale)}">${mean == null ? "—" : mean.toFixed(1)}</b></div></div>
    <div class="stat"><div class="stat-icon good">😁</div><div><small>Van muy bien</small><b>${good}</b></div></div>
    <div class="stat"><div class="stat-icon mid">😐</div><div><small>Pueden mejorar</small><b>${mid}</b></div></div>
    <div class="stat"><div class="stat-icon bad">😟</div><div><small>En riesgo</small><b>${bad}</b></div></div>
    <div class="stat wide"><div style="flex:1"><small>Distribución · ${gb.assessments.length} actividades${pend ? ` · ${pend} sin notas` : ""}</small>
      <div class="distbar">${seg(good, "good")}${seg(mid, "mid")}${seg(bad, "bad")}${seg(pend, "none")}</div></div></div>
  </div>`;
}

// ── Cuaderno de notas
async function tabGradebook(g, el, term = "") {
  const q = term ? `?term=${encodeURIComponent(term)}` : "";
  const [gb, rubrics, all, att] = await Promise.all([
    api(`/groups/${g.id}/gradebook${q}`),
    api("/rubrics"),
    api(`/groups/${g.id}/assessments`),
    api(`/groups/${g.id}/attendance/summary`),
  ]);
  const terms = [...new Set(all.map((a) => a.term).filter(Boolean))];
  const catName = Object.fromEntries(gb.categories.map((c) => [c.id, c.name]));
  const attBy = Object.fromEntries(att.map((r) => [r.student_id, r]));
  const scale = g.grading_scale;

  el.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <select id="term"><option value="">Todas las evaluaciones</option>${terms
        .map((t) => `<option ${t === term ? "selected" : ""}>${esc(t)}</option>`)
        .join("")}</select>
      <span class="spacer"></span>
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
      <div class="table-wrap"><table class="grid gb"><thead><tr>
        <th class="sticky-col">Alumno</th>
        <th class="num" title="Asistencia">📅</th>
        ${gb.assessments
          .map(
            (a) => `<th class="num"><div class="col-head">
              <span class="kind-badge">${KIND_INFO[a.kind || "numeric"].icon}</span>
              <a href="#" data-edit-a="${a.id}" title="Editar">${esc(a.name)}</a>
              <small class="muted">${a.kind === "numeric" || !a.kind ? `/${a.max_score}` : ""}${a.weight != 1 ? ` ×${a.weight}` : ""}${a.date ? " · " + fmtDate(a.date) : ""}</small>
              ${a.category_id ? `<span class="chip">${esc(catName[a.category_id])}</span>` : ""}
              ${a.rubric_id ? `<span class="chip">📐 rúbrica</span>` : ""}</div></th>`,
          )
          .join("")}
        <th class="num">Media</th></tr></thead><tbody>
        ${gb.rows
          .map((r) => {
            const t = attBy[r.student.id];
            const ap = t?.total ? (t.present + t.late) / t.total : null;
            return `<tr><td class="sticky-col"><div class="who">${avatar(r.student)}<span>${esc(r.student.last_name)}, ${esc(r.student.first_name)}</span></div></td>
            <td class="num"><span class="att-dot lv-${level(ap)}" title="${ap == null ? "Sin registros" : Math.round(ap * 100) + "% asistencia"}">${ap == null ? "·" : Math.round(ap * 100) + "%"}</span></td>
            ${gb.assessments.map((a) => `<td class="num">${cellHtml(a, r.student.id, r.scores[a.id])}</td>`).join("")}
            <td class="num" data-avg="${r.student.id}">${avgHtml(r.average, scale)}</td></tr>`;
          })
          .join("")}
      </tbody></table></div>
      <div class="legend"><span><i class="sw good"></i>≥ 80 %</span><span><i class="sw mid"></i>60–79 %</span><span><i class="sw bad"></i>&lt; 60 %</span>
        <span>😁 Feliz · 🙂 Sonriente · 😐 Seria · 😟 Triste</span><span class="muted">Se guarda automáticamente · escala 0–${scale}</span></div>`
    }`;

  const reload = () => tabGradebook(g, el, term);
  $("#term").onchange = (e) => tabGradebook(g, el, e.target.value);
  $("#add-a").onclick = () => assessmentDialog(g, gb.categories, rubrics, null, reload);
  $("#cats").onclick = () => categoriesDialog(g, gb.categories, reload);
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
  const byId = Object.fromEntries(gb.assessments.map((a) => [a.id, a]));

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
    $$("[data-rub]", scope).forEach(
      (b) => (b.onclick = () => rubricScoreDialog(byId[b.dataset.rub], b.dataset.s, rubrics, reload)),
    );
  }
  bindCell(el);
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
    ${a ? `<button type="button" class="danger" data-del-a="${a.id}">Eliminar actividad y sus notas</button>` : ""}`,
  );
  if (!v) return;
  const body = { ...v, kind: v.kind || "numeric", max_score: Number(v.max_score), weight: Number(v.weight), category_id: v.category_id || null, rubric_id: v.rubric_id || null, date: v.date || null, term: v.term || null };
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

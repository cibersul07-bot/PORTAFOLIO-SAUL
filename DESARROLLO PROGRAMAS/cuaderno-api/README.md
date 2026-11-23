# Cuaderno API

API de cuaderno docente (grupos, alumnos, evaluación ponderada, rúbricas, asistencia, planificación, observaciones e IA) sobre Cloudflare Workers + D1 + Workers AI.

Producción: https://cuaderno-api.cibersul07.workers.dev

## Frontend
SPA sin dependencias en `public/` (index.html, app.js, styles.css), servida por el mismo Worker como assets estáticos.
Incluye: login/registro, grupos, cuaderno de notas editable (guardado automático, medias en color, CSV, categorías, evaluación por rúbrica),
alumnos (importación pegando lista, ficha con observaciones y comentario de boletín por IA), asistencia diaria con resumen,
sesiones (con planificación por IA) y rúbricas (manuales o generadas por IA). Modo oscuro y móvil.

Funciones del cuaderno:
- **Tipos de actividad**: nota, caritas (😁🙂😐😟) y hecho/no hecho (✓/✗).
- **Copia y pega desde Excel** (📋 en cada columna): solo notas en orden, o «nombre ⇥ nota».
- **Anotaciones**: clic derecho (o mantener pulsado) en una nota para comentarla.
- **Condicionales**: umbrales de color por grupo (⚙️ Ajustes).
- **Fórmulas**: media ponderada, simple o mediana, y descartar las N peores notas.
- **Competencias**: vincula actividades y consulta la media por competencia.
- **Plano de clase**: organiza asientos (arrastrar, aleatorio, alfabético) y pasa lista desde el plano.
- **Magic box**: alumno aleatorio, equipos, temporizador y medidor de ruido.
- **Quizzes** con enlace público (`/#/q/<token>`), generados por IA; la nota cae sola en el cuaderno.
- **Autoevaluación y coevaluación** con rúbrica y enlace público (`/#/e/<token>`), volcables al cuaderno.
- **Recursos** del grupo (enlaces a documentos, videos, presentaciones).
- **Copia de seguridad** del grupo en JSON (💾).

## Integraciones con LMS (🔌)
| Plataforma | Importar alumnos | Enviar notas | Requisito |
|---|---|---|---|
| Google Classroom | ✅ | ✅ crea la tarea y pone `assignedGrade` (opcional: devolver) | App OAuth en Google Cloud → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Microsoft Teams | ✅ | ✅ crea y publica la tarea, pone puntos | App en Microsoft Entra con `EduRoster.ReadBasic`, `EduAssignments.ReadWrite` → `MS_CLIENT_ID`, `MS_CLIENT_SECRET` |
| Moodle | ✅ | CSV para *Calificaciones → Importar* | URL https + token de servicios web del docente |
| Otras | CSV de cualquier plataforma | CSV con email | Claves de API `ck_…` para Zapier/Make/scripts |

URIs de redirección: `https://<tu-worker>/oauth/google/callback` y `https://<tu-worker>/oauth/microsoft/callback`.
Las credenciales de cada docente se guardan cifradas (AES-GCM) en D1; las claves de API solo se guardan como hash.

Para probar en local sin cuentas reales existen variables opcionales que apuntan a un servidor simulado:
`GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_API_BASE`, `GOOGLE_USERINFO_URL`, `MS_AUTHORITY`, `GRAPH_BASE`.

## Autenticación
- `POST /auth/register` `{email, password, name}` → `{token}`
- `POST /auth/login` `{email, password}` → `{token}`
- Resto de rutas: cabecera `Authorization: Bearer <token>` (caduca a los 7 días)

## Endpoints
| Recurso | Rutas |
|---|---|
| Perfil | `GET /me` |
| Grupos | `GET/POST /groups`, `GET/PATCH/DELETE /groups/:id` |
| Alumnos | `GET/POST /groups/:id/students` (POST acepta array), `GET/PATCH/DELETE /students/:id` |
| Categorías (peso) | `GET/POST /groups/:id/categories`, `PATCH/DELETE /categories/:id` |
| Evaluaciones | `GET/POST /groups/:id/assessments?term=`, `PATCH/DELETE /assessments/:id` |
| Notas | `GET/PUT /assessments/:id/grades` (PUT: `[{student_id, score, comment}]`) |
| Nota por rúbrica | `POST /assessments/:id/rubric-score` `{student_id, levels:[i,...]}` |
| Cuaderno + medias | `GET /groups/:id/gradebook?term=`, `GET /groups/:id/gradebook.csv` |
| Asistencia | `GET /groups/:id/attendance?from=&to=`, `PUT /groups/:id/attendance` `{date, records:[{student_id,status}]}`, `GET /groups/:id/attendance/summary` |
| Sesiones | `GET/POST /groups/:id/sessions`, `PATCH/DELETE /sessions/:id` |
| Observaciones | `GET/POST /students/:id/observations`, `DELETE /observations/:id` |
| Rúbricas | `GET/POST /rubrics`, `GET/PATCH/DELETE /rubrics/:id` |
| IA | `POST /ai/report-comment` `{student_id, term?, tone?}`, `POST /ai/rubric` `{topic, level?, criteria_count?, levels_count?, save?}`, `POST /ai/plan` `{group_id, topic, sessions?}`, `POST /ai/quiz` `{topic, count?}` |
| Ajustes de grupo | `PATCH /groups/:id` `{settings: {formula, drop_lowest, pass, good, seating}}` (se fusiona) |
| Competencias | `GET/POST /groups/:id/competencies` (POST acepta array), `PATCH/DELETE /competencies/:id` |
| Recursos | `GET/POST /groups/:id/resources`, `PATCH/DELETE /resources/:id` |
| Quizzes | `GET/POST /groups/:id/quizzes`, `PATCH/DELETE /quizzes/:id`, `GET /quizzes/:id/responses`, `DELETE /quizzes/:id/responses/:student_id` |
| Auto/coevaluación | `GET/POST /groups/:id/evals`, `PATCH/DELETE /evals/:id`, `GET /evals/:id/responses`, `POST /evals/:id/to-gradebook` `{source}` |
| Copia de seguridad | `GET /groups/:id/export` |
| Público (sin login) | `GET/POST /p/quiz/:token`, `GET/POST /p/eval/:token`, `GET /oauth/:provider/callback` |
| Integraciones | `GET /integrations`, `GET /integrations/:p/start`, `POST /integrations/moodle` `{url, token}`, `DELETE /integrations/:p`, `GET /integrations/:p/courses` |
| Sincronización | `POST /groups/:id/lms/link` `{provider, course_id, course_name}`, `POST /groups/:id/lms/roster`, `POST /assessments/:id/lms/push` `{return?}`, `GET /groups/:id/export/lms.csv` |
| Claves de API | `GET/POST /api-keys`, `DELETE /api-keys/:id` (usar como `Authorization: Bearer ck_…`) |

Estados de asistencia: `present | absent | late | excused`.
Media: promedio ponderado por evaluación dentro de cada categoría, luego ponderado por el peso de la categoría, escalado a `grading_scale` del grupo.

## Desarrollo
```
npm install
npm run db:local
npm run dev          # requiere .dev.vars con JWT_SECRET=...
npm run deploy
```
Modelo IA configurable con la variable `AI_MODEL` (por defecto `@cf/meta/llama-3.3-70b-instruct-fp8-fast`).

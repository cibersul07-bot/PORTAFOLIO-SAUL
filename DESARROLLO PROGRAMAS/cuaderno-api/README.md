# Cuaderno API

API de cuaderno docente (grupos, alumnos, evaluación ponderada, rúbricas, asistencia, planificación, observaciones e IA) sobre Cloudflare Workers + D1 + Workers AI.

Producción: https://cuaderno-api.cibersul07.workers.dev

## Frontend
SPA sin dependencias en `public/` (index.html, app.js, styles.css), servida por el mismo Worker como assets estáticos.
Incluye: login/registro, grupos, cuaderno de notas editable (guardado automático, medias en color, CSV, categorías, evaluación por rúbrica),
alumnos (importación pegando lista, ficha con observaciones y comentario de boletín por IA), asistencia diaria con resumen,
sesiones (con planificación por IA) y rúbricas (manuales o generadas por IA). Modo oscuro y móvil.

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
| IA | `POST /ai/report-comment` `{student_id, term?, tone?}`, `POST /ai/rubric` `{topic, level?, criteria_count?, levels_count?, save?}`, `POST /ai/plan` `{group_id, topic, sessions?}` |

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

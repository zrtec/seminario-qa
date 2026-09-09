# Seminario Q&A — Documento de Referencia del Proyecto

**Última actualización:** 8 de septiembre de 2026

**Estado del proyecto:** Pasos 1–11 completados y probados: Supabase, Next.js base, módulo Admin completo (conferencias/organizaciones/asistentes/check-in), formulario público de preguntas, Edge Function de moderación IA, pantalla kiosko, panel de expertos con selección al aire para el ponente, y autenticación real de staff (login + protección de rutas + permisos endurecidos a nivel de base de datos). Pendiente: pruebas integrales, rate limiting, y deploy a Vercel.

---

## 1. Resumen del proyecto

Aplicación para gestionar preguntas y comentarios en vivo durante un seminario con múltiples conferencias. Los asistentes envían preguntas desde su celular escaneando un QR específico de cada conferencia. Un modelo de IA (Gemini API) modera el contenido (bloquea ofensivo/político/religioso) y clasifica las preguntas por relevancia respecto al tema de la conferencia. Las preguntas aprobadas se muestran en una pantalla auxiliar tipo tótem junto a la presentación. Un panel separado, filtrado primero por organización estratégica y luego ordenado por relevancia, es usado por panelistas en tablet para elegir qué preguntas hacer a los ponentes.

---

## 2. Roles del sistema

| Rol | Acceso | Función |
|---|---|---|
| **Admin (root)** | Login real (Supabase Auth + `@supabase/ssr`), rol verificado contra `staff_users` | CRUD de conferencias (con activación exclusiva: solo una activa a la vez, protegido a nivel de base de datos), subida opcional de presentación a Storage, CRUD de organizaciones (marcadas como estratégicas o no), carga masiva de asistentes vía CSV, check-in de asistentes el día del evento, acceso a la pantalla pública/kiosko y a la Pantalla Principal |
| **Panelista** | Login real (Supabase Auth), rol verificado contra `staff_users` | Acceso a `/panel`: ve las preguntas filtradas por organización estratégica y ordenadas por relevancia IA, puede preseleccionar preguntas de forma colaborativa (visible para todos los panelistas en tiempo real) y elegir la pregunta que se muestra al ponente |
| **Asistente** | Sin login | Precargado (nombre, email, organización) o se registra en el check-in; recibe un código de acceso corto al confirmar asistencia; usa email o código para identificarse al preguntar |

---

## 3. Flujos principales

### 3.1 Check-in / registro de asistente (el día del evento)

```
Admin crea organizaciones primero (marca cuáles son estratégicas)
        ↓
Admin arma un CSV con columnas: nombre, email, organization_id, organization_nombre
   (organization_id se copia desde el listado de organizaciones en el admin;
    organization_nombre es solo verificación cruzada visual, no se usa para
    resolver la relación)
        ↓
Admin sube el CSV → vista previa con validación fila por fila:
   ✅ válida / ❌ error específico (id inexistente, nombre no coincide con
   el id, email duplicado, campo faltante)
        ↓
Confirma importación → inserción transaccional (todo o nada) vía función
   RPC de Postgres, generando access_code único por asistente,
   status: "precargado"
        ↓
El día del evento, el asistente llega
        ↓
Admin busca por nombre/email en pantalla de check-in
        ↓
   ¿Existe en la lista precargada?
      Sí → clic "Confirmar asistencia" → status: "presente",
           se muestra su access_code ya generado
      No → registro rápido en el momento → se crea con status "presente"
           directamente y se genera su access_code
        ↓
Pantalla de bienvenida: "Bienvenido, Juan. Tu código es AB7X92.
   Úsalo o tu email para preguntar."
```

### 3.2 Envío y procesamiento de una pregunta

```
Asistente escanea el QR de la conferencia activa
        ↓
Formulario público (/preguntar/[qr_slug]): valida que la conferencia
   exista y esté activa; se identifica con EMAIL o CÓDIGO de acceso
   (búsqueda case-insensitive) + escribe su pregunta (máx. 500 caracteres,
   con aviso visible: "No se permiten comentarios ofensivos, políticos,
    religiosos o discriminatorios")
        ↓
Se guarda la pregunta en la tabla questions (ai_status: "pendiente",
   mostrada_en_pantalla: false)
        ↓
Trigger AFTER INSERT en Postgres (trigger_moderar_pregunta) se dispara
   automáticamente:
   - Lee la service_role key desde Supabase Vault (nunca en texto plano
     en el código versionado)
   - Llama de forma asíncrona (pg_net.http_post) a la Edge Function
     moderar-pregunta, con timeout de 90s
        ↓
Edge Function moderar-pregunta (Deno):
   - Verifica idempotencia (si ya se moderó, no reprocesa)
   - Llama a Gemini API (modelo: gemini-3.5-flash-lite, configurable
     por secret GEMINI_MODEL sin necesidad de redeploy)
   - Prompt blindado contra inyección (el texto del asistente se trata
     siempre como contenido a evaluar, nunca como instrucciones) y con
     distinción explícita entre "política" partidista/ideológica
     (rechazar) vs. uso corporativo del término, ej. "política de
     precios" (aceptar)
   - Reintenta automáticamente hasta 3 veces con backoff (1.5s, 3s) ante
     errores 503/429/timeout de Gemini; errores no reintentables
     (400, 404) fallan de inmediato
   - Si falla tras todos los reintentos: la pregunta queda en "pendiente"
     para revisión manual (nunca se aprueba/rechaza a ciegas)
        ↓
   a) ¿Contenido inapropiado? → ai_status: "rechazada" (nunca se muestra)
   b) Si es válida → ai_status: "aprobada", ai_relevance_score (0-100)
      calculado vs. el resumen de la conferencia, mostrada_en_pantalla: true
   c) Cruce automático (ya resuelto desde el registro del asistente):
      ¿su organización es "estratégica"? (tabla organizations precargada)
        ↓
   ┌────────────────────────────┐         ┌──────────────────────────────────┐
   │ Pantalla auxiliar (kiosko)  │         │ Panel de expertos (panelista)      │
   │ Todas las aprobadas,        │         │ SOLO las de organizaciones          │
   │ en orden de llegada,        │         │ estratégicas, ordenadas por         │
   │ formato cintillo animado    │         │ score de relevancia (mayor primero) │
   └────────────────────────────┘         └──────────────────────────────────┘
```

**Nota técnica — por qué el trigger usa `pg_net` + Vault en vez de Database Webhook:**
El enfoque original era un Database Webhook configurado desde el dashboard de Supabase (más simple de mantener), pero un bug del lado de Supabase (`schema "supabase_functions" does not exist`) impidió crearlo. Se implementó como alternativa un trigger manual en `supabase/trigger_moderar_pregunta.sql` que usa `pg_net.http_post()`, con la `service_role key` almacenada en Supabase Vault (nunca en texto plano en el SQL versionado). Si en el futuro Supabase resuelve ese bug, este trigger podría reemplazarse de vuelta por un Webhook nativo.

### 3.3 Pantalla pública / kiosko

- Ruta: `/admin/pantalla/[qr_slug]` — **pública, sin login**, exceptuada explícitamente en `proxy.ts` (aunque cuelga de `/admin`, no requiere sesión: es la pantalla física del tótem del evento).
- Diseño **vertical (portrait)**, responsivo. Tercio superior: título/ponente + QR grande (generado con `qrcode.react`, apuntando a `/preguntar/[qr_slug]` usando `window.location.origin`, nunca localhost hardcodeado). Dos tercios inferiores: preguntas aprobadas mostradas **una a la vez**, ciclando cada 8s con animación fade-in/slide-in, mostrando texto + nombre del asistente (nunca su email).
- Botón discreto de pantalla completa (Fullscreen API).
- Tiempo real vía Supabase Realtime: al aprobarse una pregunta nueva, se suma al ciclo sin recargar.
- Lectura de datos a través de funciones `SECURITY DEFINER` (`preguntas_pantalla()`, `pregunta_pantalla_por_id()`) en vez de un `SELECT` con embed directo a `attendees` — necesario porque `anon` no tiene `GRANT SELECT` sobre esa tabla (contiene `email`/`access_code`); el embed fallaba con `permission denied` de forma silenciosa hasta que se detectó revisando el `error` de la consulta.
- No implementado: ocultar manualmente una pregunta desde esta pantalla (quedó como posible mejora futura, no bloqueante).

### 3.4 Panel de expertos y Pantalla Principal (selección para el ponente)

Requerimiento de negocio: 2 o más panelistas ven el mismo panel simultáneamente (cada uno en su tablet/laptop) y necesitan coordinarse **sin poder hablar entre sí** mientras llegan preguntas en vivo.

```
Panelista abre /panel (requiere sesión, rol admin o panelista)
        ↓
Ve 2 listados en tiempo real, ambos vía funciones SECURITY DEFINER:
   a) preguntas_panel_estrategicas(conference_id): SOLO preguntas de
      asistentes de organizaciones estratégicas, ordenadas por
      ai_relevance_score descendente
   b) preguntas_panel_respaldo(conference_id): el resto de las preguntas
      aprobadas (organizaciones no estratégicas), mismo orden — para usar
      si ningún representante estratégico ha preguntado
        ↓
Cualquier panelista puede "preseleccionar" una pregunta (togglear_preseleccion):
   marca colaborativa sin dueño/autoría, visible en tiempo real para todos
   los panelistas — ayuda a coordinarse sobre cuáles les interesan más
        ↓
Cuando le toca el turno a un panelista, "elige" una pregunta para el
   ponente (elegir_pregunta_al_ponente): swap ATÓMICO — apaga
   mostrada_al_ponente en cualquier otra pregunta de la misma conferencia
   y la prende en la elegida, garantizado por un índice único parcial
   (solo una pregunta "al aire" por conferencia a la vez, mismo patrón
   que conferences.activa)
        ↓
La Pantalla Principal (/admin/pantalla-principal/[qr_slug], también
   pública/sin login, para que la vea el ponente) se actualiza sola vía
   Realtime + pregunta_al_ponente_actual(conference_id): muestra SOLO
   título de la conferencia, ponente, y la pregunta actual — tipografía
   grande (dinámica según longitud del texto, entre text-4xl y text-8xl,
   para que preguntas largas no se desborden de la pantalla)
```

**Diseño de acceso a las funciones del panel (decisión explícita):** `preguntas_panel_estrategicas`, `preguntas_panel_respaldo`, `elegir_pregunta_al_ponente` y `togglear_preseleccion` requieren sesión de staff — el `GRANT EXECUTE` está restringido a `authenticated` (revocado de `anon` y de `public`, ya que Postgres otorga `EXECUTE` a `PUBLIC` por defecto al crear una función) y además cada función valida `is_staff()` puertas adentro. Este doble control es intencional: el `GRANT` decide quién puede *intentar* llamar la función, pero Supabase autogenera un endpoint REST por cada función, así que sin el chequeo interno cualquiera con la `anon key` (pública, va en el bundle del navegador) podría invocarla directo sin pasar por `/panel` ni por el proxy. Las funciones de lectura devuelven 0 filas si no eres staff (silencioso); las de escritura lanzan excepción (ruidoso, ya que una escritura fallida silenciosa es más peligrosa de pasar desapercibida).

En cambio, `preguntas_pantalla`, `pregunta_pantalla_por_id` y `pregunta_al_ponente_actual` **siguen abiertas a `anon`** deliberadamente: son las pantallas físicas del evento (kiosko, podio), sin ningún staff logueado del otro lado.

### 3.5 Autenticación de staff

```
Admin crea manualmente cada usuario de staff en Supabase Auth
   (Authentication → Users), y lo vincula a staff_users con su
   rol (admin/panelista) mediante un INSERT manual (ver plantilla
   en supabase/vincular_staff.sql) — no hay alta automática ni
   auto-registro, es una decisión de negocio que requiere criterio humano
        ↓
Staff inicia sesión en /login (email + contraseña, signInWithPassword())
        ↓
Redirección según rol (consultado en staff_users): admin → /admin,
   panelista → /panel; si el usuario no está vinculado en staff_users,
   mensaje claro ("Tu cuenta no está vinculada como staff...")
        ↓
proxy.ts (reemplaza a middleware.ts en Next.js 16) refresca la sesión
   en cada request y autoriza el acceso a rutas protegidas:
   - /admin/** (excepto /admin/pantalla/* y /admin/pantalla-principal/*,
     que son públicas) → requiere rol admin
   - /panel → requiere rol admin O panelista
   - Sin sesión → redirige a /login; con sesión pero rol incorrecto →
     redirige a su propia área, nunca deja pasar "por las dudas"
        ↓
Los route handlers de app/api/admin/** (que usan service_role,
   bypasean RLS por diseño) tienen su propio guard interno
   (requireAdmin()/requireStaff() en lib/auth/require-admin.ts),
   ya que el proxy protege páginas pero no automáticamente cada
   endpoint si se llamara directo
```

**Nota de arquitectura de clientes:** el proyecto usa 2 clientes de Supabase distintos y deliberadamente separados: `lib/supabase.ts` (cliente plano `@supabase/supabase-js`, sesión en `localStorage`, usado por rutas públicas sin login: `/preguntar`, pantallas de kiosko/principal) y `lib/supabase/client.ts` + `lib/supabase/server.ts` (cliente SSR de `@supabase/ssr`, sesión en cookies, usado por `/login`, `/admin`, `/panel`). Son dos storages de sesión independientes — un componente que necesite leer la sesión del usuario logueado debe usar el cliente SSR, nunca el plano (un descuido en este sentido causó que `/panel` funcionara para lectura pero fallara silenciosamente al verificar `is_staff()`, hasta que se corrigió).

## 4. Modelo de datos (Supabase / Postgres)

| Tabla | Campos clave |
|---|---|
| `organizations` | id (uuid), nombre, es_estrategica (bool) |
| `attendees` | id (uuid), nombre, email, access_code (único, autogenerado, 6 caracteres alfanumérico), organization_id, status ("precargado" / "presente") |
| `staff_users` | id (uuid, = id de `auth.users`), rol ("admin" / "panelista") — vinculación manual, ver sección 3.5 |
| `conferences` | id, título, categoría, ponente, resumen, presentacion_url (archivo opcional en Supabase Storage, bucket `presentaciones`), qr_slug (único), activa (bool, con índice único parcial que garantiza solo una activa a la vez a nivel de base de datos) |
| `questions` | id, texto, conference_id, attendee_id, ai_status ("pendiente" / "rechazada" / "aprobada"), ai_relevance_score, mostrada_en_pantalla (bool), **preseleccionada (bool, default false)**, **mostrada_al_ponente (bool, default false, con índice único parcial por conference_id — solo una "al aire" a la vez)**, created_at |

**Seguridad (RLS):** habilitado por defecto en todas las tablas, con `GRANT`/`REVOKE` explícitos a nivel de tabla además de las políticas RLS (ambas capas son necesarias en Postgres — RLS sin `GRANT` sigue bloqueando, y `service_role` también necesita `GRANT` explícito pese a bypassear RLS). Políticas explícitas:
- `attendees`: el formulario público puede leer (para autocompletar por email/código) pero no modificar datos sensibles.
- `questions`: el formulario público solo puede insertar; lectura de preguntas aprobadas es pública (para la pantalla); panel de expertos requiere sesión de staff real.
- `conferences`, `organizations`, `staff_users`: solo admin puede escribir; lectura pública limitada a campos necesarios (ej. título/qr_slug de conferencia activa).

**Funciones `SECURITY DEFINER` (patrón central de este proyecto):** en vez de dar `GRANT SELECT` directo sobre tablas con datos sensibles (`attendees` tiene email/access_code; el JOIN con `organizations` expone a qué empresa pertenece cada asistente), se usan funciones que hacen el JOIN puertas adentro y devuelven solo las columnas necesarias:

| Función | Acceso | Propósito |
|---|---|---|
| `buscar_asistente()` | público (`anon`) | Formulario de preguntas: busca por email/código |
| `preguntas_pantalla()`, `pregunta_pantalla_por_id()` | público (`anon`) | Pantalla kiosko |
| `pregunta_al_ponente_actual()` | público (`anon`) | Pantalla Principal (podio del ponente) |
| `preguntas_panel_estrategicas()`, `preguntas_panel_respaldo()` | solo staff (`authenticated` + `is_staff()` interno) | Listados del Panel de Expertos |
| `elegir_pregunta_al_ponente()`, `togglear_preseleccion()` | solo staff (`authenticated` + `is_staff()` interno) | Escrituras del Panel de Expertos (swap atómico y toggle colaborativo) |
| `activar_conferencia()` | solo admin (vía route handler con `service_role`) | Swap atómico de conferencia activa |
| `importar_asistentes()` | solo admin (vía route handler con `service_role`) | Importación transaccional de CSV |

**Patrón de escritura implementado:** las escrituras del módulo Admin (crear/editar/eliminar conferencias, organizaciones, importar asistentes, check-in) pasan por Route Handlers de Next.js (`app/api/admin/**`) que usan la `service_role key` **solo del lado del servidor** (`lib/supabase-admin.ts`), con guard de sesión+rol interno (`requireAdmin()`). Las escrituras del Panel de Expertos, en cambio, llaman los RPC `SECURITY DEFINER` **directo desde el cliente** (con el cliente SSR autenticado) sin pasar por route handler — decisión deliberada: el borde de seguridad ya está resuelto dentro de la función de Postgres (`is_staff()` + `GRANT` restringido), así que un proxy intermedio no movería el límite de confianza real, solo agregaría una capa sin beneficio. El proxy de `service_role` en `/admin` existe por una razón distinta: esas políticas RLS exigen `is_admin()` contra tablas con reglas más estrictas, y el patrón se mantuvo ahí por necesidad funcional, no como principio general de "todo pasa por backend".

**Nota de seguridad recurrente:** durante el desarrollo, un `REVOKE ALL ... FROM PUBLIC` (probablemente parte del script de seguridad inicial) quitó sin querer privilegios también a `service_role`, ya que en Postgres todo rol es miembro implícito de `PUBLIC`. Se resolvió otorgando `GRANT` explícito a `service_role` en las 5 tablas (`supabase/grants_service_role.sql`). Lo mismo aplica a funciones: Postgres otorga `EXECUTE` sobre una función nueva a `PUBLIC` por defecto, así que cerrar el acceso requiere `REVOKE ... FROM anon, public` explícito, no alcanza con no otorgarlo a `anon` si nunca se revocó de `PUBLIC`.

---

## 5. Rutas / vistas de la aplicación

| Ruta | Rol | Descripción | Estado |
|---|---|---|---|
| `/login` | Público | Login de staff (email + contraseña), redirige según rol | ✅ Implementado |
| `/admin` | Admin (protegido) | CRUD de conferencias (título, categoría, ponente, resumen, presentación opcional, qr_slug autogenerado editable, activación exclusiva) | ✅ Implementado |
| `/admin/organizaciones` | Admin (protegido) | CRUD de organizaciones, marcado de "estratégica", muestra el id (uuid) de cada una con botón copiar para usar en el CSV de asistentes | ✅ Implementado |
| `/admin/asistentes` | Admin (protegido) | Importación masiva vía CSV con vista previa validada (organization_id + organization_nombre cruzados), descarga de plantilla, listado de asistentes cargados | ✅ Implementado |
| `/admin/checkin` | Admin (protegido) | Búsqueda en vivo, confirmación de asistencia con despliegue del access_code, registro rápido de asistentes no precargados | ✅ Implementado |
| `/admin/pantalla/[qr_slug]` | Público (sin login, exceptuado del proxy) | Vista kiosko: QR + cintillo de preguntas, expandible a pantalla completa, vertical/responsiva, tiempo real | ✅ Implementado |
| `/admin/pantalla-principal/[qr_slug]` | Público (sin login, exceptuado del proxy) | Pantalla para el ponente: título, ponente, y la pregunta actualmente "al aire", tipografía dinámica según longitud, tiempo real | ✅ Implementado |
| `/panel` | Admin o Panelista (protegido) | 2 listados (estratégicas / respaldo) con preselección colaborativa y selección "al aire" para el ponente, todo en tiempo real | ✅ Implementado |
| `/preguntar/[qr_slug]` | Asistente (público) | Formulario en 2 pasos: identificación (email o código) → pregunta con aviso de reglas de contenido, límite 500 caracteres | ✅ Implementado |

---

## 6. Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend + Backend | **Next.js (TypeScript)** | Un solo proyecto para todas las vistas |
| Base de datos | **Supabase (Postgres)** | RLS activado en todas las tablas |
| Tiempo real | **Supabase Realtime** | Cintillo de la pantalla kiosko, Pantalla Principal, y los 2 listados + estado colaborativo del Panel de Expertos; requiere activar cada tabla en Database → Publications |
| Autenticación | **Supabase Auth** + `@supabase/ssr` | Roles: admin, panelista (tabla `staff_users`, alta manual); sesión en cookies vía cliente SSR, separado del cliente plano (`localStorage`) usado en rutas públicas |
| Protección de rutas | **`proxy.ts`** (reemplaza a `middleware.ts` en Next.js 16) | Refresca sesión y autoriza acceso por rol en cada request; los route handlers de `/api/admin/**` tienen guard propio (`requireAdmin()`/`requireStaff()`) |
| Generación de QR | **`qrcode.react`** | Renderizado como SVG en la pantalla kiosko |
| Almacenamiento de archivos | **Supabase Storage** | Bucket para presentaciones (archivo opcional, de referencia) |
| Moderación y ranking IA | **Gemini API** (modelo `gemini-3.5-flash-lite`), orquestada desde una **Supabase Edge Function** | Nunca se llama directamente desde el frontend (seguridad de API key); modelo configurable por secret `GEMINI_MODEL` sin redeploy |
| Disparo de la moderación | **Trigger de Postgres + `pg_net`**, con secreto en **Supabase Vault** | Alternativa a Database Webhook (bloqueado por un bug de Supabase); ver sección 3.2 |
| Estilos | **Tailwind CSS** | |
| Hosting | **Vercel** (app) + Supabase Cloud (DB/backend) | |
| Herramienta de desarrollo | **Claude Code** (cuenta Pro), recomendado desde **VS Code** | |

---

## 7. Configuración de Supabase ya realizada

- Proyecto: `seminario-qa`
- Región: South America (São Paulo)
- Seguridad al crear el proyecto:
  - Enable Data API: ✅ activado
  - Automatically expose new tables: ❌ desactivado
  - Enable automatic RLS: ✅ activado
- Credenciales obtenidas (Project Settings → Data API):
  - Project URL
  - Publishable key (equivalente actual a la "anon key")
  - ⚠️ **Nunca usar la `service_role key` en frontend**

---

## 8. Plan de desarrollo (estimado)

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Proyecto Supabase creado y configurado | ✅ Completado |
| 2 | Proyecto Next.js + Tailwind + conexión a Supabase, schema SQL de las 5 tablas + RLS | ✅ Completado |
| 3 | Módulo Admin: CRUD conferencias (con activación exclusiva y subida de presentación), CRUD organizaciones, carga CSV de asistentes, check-in en vivo | ✅ Completado |
| 4 | Formulario de asistente (`/preguntar/[qr_slug]`) con identificación por email/código | ✅ Completado |
| 5 | Edge Function de moderación + ranking con Gemini API (incluyó resolver: bug de Database Webhook, modelo deprecado, saturación 503, timeouts, prompt hardening) | ✅ Completado |
| 6 | Pantalla kiosko (`/admin/pantalla/[qr_slug]`) con QR + cintillo animado en tiempo real | ✅ Completado |
| 7 | Panel de expertos (`/panel`) con preselección colaborativa, selección "al aire", y Pantalla Principal para el ponente | ✅ Completado |
| 8 | Autenticación real de staff (Supabase Auth + `@supabase/ssr`, `proxy.ts`, guards en API, permisos SQL endurecidos) | ✅ Completado |
| 9 | Pruebas integrales, rate limiting, ajustes finales de UI | ⏳ Siguiente paso |
| 10 | Deploy a Vercel | ⏳ Pendiente |

---

## 9. Reglas de contenido para moderación IA (Gemini)

La IA debe rechazar automáticamente preguntas que contengan:
- Groserías o lenguaje ofensivo
- Contenido político
- Contenido religioso
- Discriminación de cualquier tipo

Este aviso debe mostrarse de forma visible en el formulario del asistente antes de enviar la pregunta.

La IA también debe:
- Calcular un score de relevancia de la pregunta respecto al resumen/tema de la conferencia (usado para ordenar en el panel de expertos).

---

## 10. Lecciones aprendidas / troubleshooting (referencia para el resto del proyecto)

- **RLS no es suficiente por sí sola**: además de las políticas, Postgres requiere `GRANT` explícito a nivel de tabla para cada rol (`anon`, `authenticated`, y también `service_role`, pese a que este último bypasea RLS). Un `REVOKE ALL FROM PUBLIC` afecta a todos los roles, incluido `service_role`, porque todos son miembros implícitos de `PUBLIC`.
- **JWT keys al copiar**: las keys de Supabase (`anon`/`service_role`) siempre empiezan con `eyJ`. Si una copia empieza con otra cosa, quedó truncada — usar el botón "Copy" del dashboard en vez de seleccionar el texto a mano.
- **Vault para secretos en triggers**: para llamar servicios externos desde un trigger de Postgres sin exponer credenciales en SQL versionado, usar `vault.create_secret()` + `vault.decrypted_secrets`, nunca hardcodear la key en el archivo `.sql`.
- **`.env.local` requiere reiniciar el servidor** (`npm run dev`) para tomar cambios — Next.js no relee variables de entorno en caliente.
- **Los secrets de Supabase Edge Functions requieren redeploy** (`supabase functions deploy`) después de `supabase secrets set` para que la función tome el nuevo valor.
- **Modelos de Gemini cambian con el tiempo**: `gemini-2.5-flash` fue retirado para cuentas nuevas durante el desarrollo. Por eso el modelo se dejó configurable vía secret `GEMINI_MODEL` sin necesidad de tocar código — verificar disponibilidad con `GET /v1beta/models?key=...` si vuelve a fallar con 404.
- **Modelos con `"thinking": true`** (como `gemini-3.6-flash`) pueden acercarse o superar timeouts ajustados para modelos simples — para esta tarea (clasificación + scoring corto) un modelo `-lite` sin thinking (`gemini-3.5-flash-lite`) resultó más rápido y estable.
- **Prompt hacia LLMs con contenido de usuario**: siempre incluir una instrucción explícita de que el texto del usuario es contenido a evaluar, nunca instrucciones a seguir, para mitigar inyección de prompt.
- **Reintentos con backoff**: implementados para 503/429/timeout (errores transitorios), sin reintentar errores de configuración (400/404) que no se resuelven reintentando. El timeout del trigger (`pg_net`) debe cubrir el peor caso de todos los reintentos sumados, no solo un intento.
- **Realtime requiere activar la tabla en Publications**: Supabase movió esto de "Database → Replication" (que ahora es para réplicas de lectura externas) a **Database → Publications** — hay que agregar la tabla a la publicación `supabase_realtime` (vía UI o `alter publication supabase_realtime add table <tabla>;`) para que las suscripciones `supabase.channel(...)` reciban eventos.
- **Server Components y errores silenciados**: si una consulta desestructura solo `{ data }` sin revisar `{ error }`, un `permission denied` se convierte silenciosamente en "no hay datos" (vía `?? []`) sin ningún indicio visual del problema real. Siempre loguear el `error`, incluso en consultas que "deberían funcionar".
- **RLS/GRANT no cubre JOINs embebidos de PostgREST**: un `select "..., relacion:fk ( campo )"` requiere `GRANT SELECT` sobre la tabla relacionada, no solo sobre la tabla principal. Si esa tabla relacionada tiene RLS restrictivo a propósito (como `attendees`, que expone email/access_code), el JOIN falla — la solución consistente en este proyecto fue una función `SECURITY DEFINER` que hace el JOIN puertas adentro y expone solo las columnas necesarias, replicando el mismo patrón ya usado para `buscar_asistente()`.
- **`middleware.ts` → `proxy.ts` en Next.js 16**: el archivo se renombró (y el export pasó de `middleware` a `proxy`), aunque la API de cookies (`getAll`/`setAll`) y el comportamiento general se mantienen idénticos a versiones anteriores.
- **Dos clientes de Supabase, dos sesiones independientes**: el cliente plano (`@supabase/supabase-js`, sesión en `localStorage`) y el cliente SSR (`@supabase/ssr`, sesión en cookies) no comparten sesión entre sí. Un componente que necesita leer la sesión de un usuario logueado vía `/login` debe usar el cliente SSR — usar el cliente plano ahí resulta en una sesión "anon" silenciosa aunque el usuario esté logueado en el mismo navegador.
- **`EXECUTE` sobre funciones se otorga a `PUBLIC` por defecto**: al crear una función en Postgres, el rol pseudo-`PUBLIC` recibe `EXECUTE` automáticamente (todo rol, incluido `anon`, es miembro implícito de `PUBLIC`). Restringir una función a `authenticated` requiere `REVOKE EXECUTE ... FROM anon, public`, no alcanza con simplemente no otorgar el `GRANT` a `anon`.
- **Windows/Git Bash y comandos nativos**: comandos como `taskkill /PID <n> /F` fallan en Git Bash (MINGW64) porque convierte automáticamente `/PID` en una ruta de estilo Unix. Usar doble slash (`taskkill //PID <n> //F`) o correr el comando desde una terminal de Windows nativa (CMD/PowerShell).

---

## 11. Pendientes / decisiones a confirmar más adelante

- Formato exacto del código de acceso (ya implementado: 6 caracteres alfanumérico en mayúsculas — confirmar si esto es definitivo)
- Diseño visual definitivo de la pantalla kiosko y Pantalla Principal (colores, tipografía, marca de la empresa)
- Política de rate limiting para evitar spam de preguntas (aún no implementada — pendiente antes del evento real)
- Si se requiere exportar/analizar preguntas después del evento
- Definir si cada conferencia puede tener presentación cargada o solo algunas
- Revisar límites/costos reales de la cuenta de Gemini API antes del evento en vivo (volumen esperado de preguntas)
- Considerar monitorear la tasa de preguntas que quedan en "pendiente" (fallos de moderación tras 3 reintentos) para revisión manual del admin
- Opción de que el admin oculte manualmente una pregunta de la pantalla kiosko si la IA se equivoca (mencionado como salvaguarda deseable, no implementado)
- Conectar el repositorio a GitHub (rama local ya renombrada de `master` a `main`, pendiente crear el remoto y hacer push)
- Definir estrategia de invitación de staff a futuro si el equipo crece (hoy es 100% manual vía dashboard + SQL, ver sección 3.5)

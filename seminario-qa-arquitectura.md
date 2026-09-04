# Seminario Q&A — Documento de Referencia del Proyecto

**Última actualización:** 3 de septiembre de 2026

**Estado del proyecto:** Pasos 1–8 completados y probados (Supabase, Next.js base, módulo Admin completo con conferencias/organizaciones/asistentes/check-in, formulario público de preguntas, Edge Function de moderación IA). Pendiente: pantalla kiosko (Paso 9), panel de expertos (Paso 10), autenticación real de staff, pruebas integrales y deploy.

---

## 1. Resumen del proyecto

Aplicación para gestionar preguntas y comentarios en vivo durante un seminario con múltiples conferencias. Los asistentes envían preguntas desde su celular escaneando un QR específico de cada conferencia. Un modelo de IA (Gemini API) modera el contenido (bloquea ofensivo/político/religioso) y clasifica las preguntas por relevancia respecto al tema de la conferencia. Las preguntas aprobadas se muestran en una pantalla auxiliar tipo tótem junto a la presentación. Un panel separado, filtrado primero por organización estratégica y luego ordenado por relevancia, es usado por panelistas en tablet para elegir qué preguntas hacer a los ponentes.

---

## 2. Roles del sistema

| Rol | Acceso | Función |
|---|---|---|
| **Admin (root)** | Login (Supabase Auth) — **aún no implementado, ver sección 11** | CRUD de conferencias (con activación exclusiva: solo una activa a la vez, protegido a nivel de base de datos), subida opcional de presentación a Storage, CRUD de organizaciones (marcadas como estratégicas o no), carga masiva de asistentes vía CSV, check-in de asistentes el día del evento, acceso a la pantalla pública/kiosko |
| **Panelista** | Login (Supabase Auth, rol limitado) | Solo lectura, en tablet, de preguntas filtradas por organización estratégica y ordenadas por relevancia IA |
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

- Es una **ruta protegida del Admin** (no una vista pública independiente): `/admin/pantalla/[qr_slug]`.
- El Admin la abre y la pone en modo pantalla completa en el dispositivo conectado al tótem.
- Diseño **vertical (portrait)**, responsivo.
- Parte superior: QR grande de la conferencia activa.
- Parte inferior: preguntas aprobadas apareciendo una por una en formato animado (cintillo / fade-in / slide-in).
- El Admin puede ocultar manualmente una pregunta si la IA se equivoca (salvaguarda).

---

## 4. Modelo de datos (Supabase / Postgres)

| Tabla | Campos clave |
|---|---|
| `organizations` | id (uuid), nombre, es_estrategica (bool) |
| `attendees` | id (uuid), nombre, email, access_code (único, autogenerado, 6 caracteres alfanumérico), organization_id, status ("precargado" / "presente") |
| `staff_users` | id, vinculado a Supabase Auth, rol ("admin" / "panelista") — **tabla creada, autenticación real aún no implementada** |
| `conferences` | id, título, categoría, ponente, resumen, presentacion_url (archivo opcional en Supabase Storage, bucket `presentaciones`), qr_slug (único), activa (bool, con índice único parcial que garantiza solo una activa a la vez a nivel de base de datos) |
| `questions` | id, texto, conference_id, attendee_id, ai_status ("pendiente" / "rechazada" / "aprobada"), ai_relevance_score, mostrada_en_pantalla (bool), created_at |

**Seguridad (RLS):** habilitado por defecto en todas las tablas, con `GRANT`/`REVOKE` explícitos a nivel de tabla además de las políticas RLS (ambas capas son necesarias en Postgres — RLS sin `GRANT` sigue bloqueando, y `service_role` también necesita `GRANT` explícito pese a bypassear RLS). Políticas explícitas:
- `attendees`: el formulario público puede leer (para autocompletar por email/código) pero no modificar datos sensibles.
- `questions`: el formulario público solo puede insertar; lectura de preguntas aprobadas es pública (para la pantalla); panel de expertos requiere sesión de panelista/admin.
- `conferences`, `organizations`, `staff_users`: solo admin puede escribir; lectura pública limitada a campos necesarios (ej. título/qr_slug de conferencia activa).

**Patrón de escritura implementado:** todas las escrituras desde el módulo Admin (crear/editar/eliminar conferencias, organizaciones, importar asistentes, check-in) pasan por Route Handlers de Next.js (`app/api/admin/**`) que usan la `service_role key` **solo del lado del servidor** (`lib/supabase-admin.ts`), nunca expuesta al navegador. Las lecturas y la subida de presentaciones a Storage se hacen directo desde el cliente con la `anon`/`publishable key`, protegidas por RLS. Este patrón se mantuvo consistente en todo el proyecto, incluida la Edge Function de moderación IA.

**Nota de seguridad recurrente:** durante el desarrollo, un `REVOKE ALL ... FROM PUBLIC` (probablemente parte del script de seguridad inicial) quitó sin querer privilegios también a `service_role`, ya que en Postgres todo rol es miembro implícito de `PUBLIC`. Se resolvió otorgando `GRANT` explícito a `service_role` en las 5 tablas (`supabase/grants_service_role.sql`). Tenerlo en cuenta si en el futuro se agregan más tablas: siempre otorgar `GRANT` explícito tanto a `anon`/`authenticated` como a `service_role`, no asumir que este último "ya tiene todo".

---

## 5. Rutas / vistas de la aplicación

| Ruta | Rol | Descripción | Estado |
|---|---|---|---|
| `/admin` | Admin | CRUD de conferencias (título, categoría, ponente, resumen, presentación opcional, qr_slug autogenerado editable, activación exclusiva) | ✅ Implementado (sin auth aún) |
| `/admin/organizaciones` | Admin | CRUD de organizaciones, marcado de "estratégica", muestra el id (uuid) de cada una con botón copiar para usar en el CSV de asistentes | ✅ Implementado |
| `/admin/asistentes` | Admin | Importación masiva vía CSV con vista previa validada (organization_id + organization_nombre cruzados), descarga de plantilla, listado de asistentes cargados | ✅ Implementado |
| `/admin/checkin` | Admin | Búsqueda en vivo, confirmación de asistencia con despliegue del access_code, registro rápido de asistentes no precargados | ✅ Implementado |
| `/admin/pantalla/[qr_slug]` | Admin | Vista kiosko: QR + cintillo de preguntas, expandible a pantalla completa, vertical/responsiva | ⏳ Pendiente (Paso 9) |
| `/panel` | Panelista | Login + lista de preguntas filtradas (solo estratégicas) y ordenadas por relevancia | ⏳ Pendiente (Paso 10) |
| `/preguntar/[qr_slug]` | Asistente (público) | Formulario en 2 pasos: identificación (email o código) → pregunta con aviso de reglas de contenido, límite 500 caracteres | ✅ Implementado |

---

## 6. Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend + Backend | **Next.js (TypeScript)** | Un solo proyecto para todas las vistas |
| Base de datos | **Supabase (Postgres)** | RLS activado en todas las tablas |
| Tiempo real | **Supabase Realtime** | Para el cintillo de la pantalla y la lista del panel de expertos |
| Autenticación | **Supabase Auth** | Roles: admin, panelista |
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
| 6 | Pantalla kiosko (`/admin/pantalla/[qr_slug]`) con QR + cintillo animado en tiempo real | ⏳ Siguiente paso |
| 7 | Panel de expertos (`/panel`) con filtro + orden por relevancia en tiempo real | ⏳ Pendiente |
| 8 | Autenticación real de staff (admin/panelista) vía Supabase Auth — actualmente `/admin/*` no tiene login | ⏳ Pendiente |
| 9 | Pruebas integrales, ajustes de UI, rate limiting, deploy a Vercel | ⏳ Pendiente |

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

---

## 11. Pendientes / decisiones a confirmar más adelante

- Autenticación real de Supabase Auth para `/admin/*` y `/panel` (actualmente el módulo Admin es de acceso abierto, marcado explícitamente como temporal en el código)
- Formato exacto del código de acceso (ya implementado: 6 caracteres alfanumérico en mayúsculas — confirmar si esto es definitivo)
- Diseño visual definitivo de la pantalla kiosko (colores, tipografía, marca de la empresa)
- Política de rate limiting para evitar spam de preguntas
- Si se requiere exportar/analizar preguntas después del evento
- Definir si cada conferencia puede tener presentación cargada o solo algunas
- Revisar límites/costos reales de la cuenta de Gemini API antes del evento en vivo (volumen esperado de preguntas)
- Considerar monitorear la tasa de preguntas que quedan en "pendiente" (fallos de moderación tras 3 reintentos) para revisión manual del admin

# moderar-pregunta

Edge Function que modera y puntúa una pregunta recién insertada usando la API
de Gemini. Ver `index.ts` para el detalle de la lógica y el manejo de errores.

## Cómo se dispara: Database Webhook (no pg_net a mano)

Se evaluaron las dos opciones:

**a) pg_net directo desde un trigger propio**
Requiere escribir en SQL (commiteado a este repo, en `supabase/*.sql`) la URL
del proyecto y un header `Authorization` con la `service_role key` o un
secreto equivalente, hardcodeado en el cuerpo de la función de trigger. Eso
deja una credencial de alto privilegio en texto plano dentro del control de
versiones. También hay que manejar a mano la tabla `net._http_response` para
ver si la llamada falló.

**b) Database Webhook configurado desde el dashboard — elegido**
Es lo mismo por debajo (Supabase crea el trigger + usa `pg_net`), pero:

- La URL de la función y el header `Authorization` quedan guardados en la
  configuración del proyecto (dashboard), no en un archivo SQL versionado.
- Tiene su propia vista de logs de entrega (Database → Webhooks → Logs), sin
  tener que consultar tablas internas de `pg_net`.
- Cero SQL adicional que mantener; se define y edita desde la UI.

Dado que este proyecto ya es cuidadoso con no exponer credenciales
sensibles (ver comentarios de `grants_service_role.sql` y el resto de
`supabase/*.sql`), (b) es la opción más segura por defecto sin sacrificar
nada funcional para este caso de uso.

## Pasos exactos en el dashboard de Supabase

1. **Desplegar la función** (cuando se apruebe el código):
   `supabase functions deploy moderar-pregunta`
   Dejar **activado** "Enforce JWT verification" (el valor por defecto) — es
   la única puerta de seguridad de esta función, ver el comentario al inicio
   de `index.ts`.

2. **Cargar el secret de Gemini** (una sola vez por proyecto):
   `supabase secrets set GEMINI_API_KEY=<la api key>`
   (`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles
   automáticamente dentro de toda Edge Function, no hace falta cargarlos.)

3. **Database → Webhooks → Create a new hook**
   - Name: `moderar_pregunta_on_insert`
   - Table: `public.questions`
   - Events: solo **Insert** (dejar Update/Delete sin marcar)
   - Type: **Supabase Edge Functions**
   - Edge Function: `moderar-pregunta`
   - HTTP Headers: agregar
     `Authorization: Bearer <service_role key del proyecto>`
     (esto es lo que hace pasar el chequeo de "Enforce JWT verification" del
     paso 1; sin este header la función devuelve 401 antes de ejecutar nada)
   - Timeout: dejar el default (los reintentos internos de Gemini/timeout ya
     los maneja `index.ts`)

4. Guardar. A partir de ahí, cada `INSERT` en `questions` dispara la función
   automáticamente con el payload
   `{ type: "INSERT", table: "questions", record: {...fila nueva...}, schema: "public", old_record: null }`,
   que es lo que `index.ts` espera recibir (usa `record.id`).

## Qué falta antes de que esto funcione en producción

- Correr el paso 1–3 de arriba (nada de esto se ejecutó todavía).
- Confirmar el nombre del modelo de Gemini vía el secret opcional
  `GEMINI_MODEL` (default en el código: `gemini-2.5-flash`) si en el momento
  del deploy ese modelo ya no está disponible.

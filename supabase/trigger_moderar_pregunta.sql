-- =============================================================================
-- Seminario Q&A — trigger_moderar_pregunta
--
-- REEMPLAZA al Database Webhook descrito en
-- supabase/functions/moderar-pregunta/README.md. Ese webhook no se pudo
-- crear por un bug de Supabase (error "schema \"supabase_functions\" does
-- not exist", persiste incluso con pg_net habilitado). Este archivo
-- implementa el mismo disparo (INSERT en "questions" → llamar a la Edge
-- Function moderar-pregunta) a mano, con un trigger + pg_net.
--
-- Por qué el secreto vive en Supabase Vault y no en este archivo:
-- El README de moderar-pregunta explica por qué originalmente se prefirió
-- el Database Webhook sobre pg_net directo: pg_net directo requiere poner
-- la service_role key en un header Authorization dentro del cuerpo SQL de
-- la función de trigger, y ese SQL queda versionado en el repo. Guardar la
-- key en texto plano en un archivo commiteado sería exponer una credencial
-- de alto privilegio (equivalente a bypass total de RLS) a cualquiera con
-- acceso al repositorio o su historial de git.
--
-- Supabase Vault resuelve exactamente ese problema: el secreto se guarda
-- cifrado en la base (una sola vez, a mano, desde el SQL Editor) y este
-- archivo solo referencia su NOMBRE ('service_role_key_moderar'), nunca su
-- valor. La función de trigger lee el valor descifrado en tiempo de
-- ejecución vía la vista vault.decrypted_secrets, que solo es accesible a
-- roles con privilegio suficiente en Postgres (no vía RLS/API pública).
--
-- Este archivo NO se ha ejecutado. No se debe pegar acá ninguna key real en
-- ningún momento — todo lo que sigue son placeholders o referencias.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASO 0 — hacer esto UNA SOLA VEZ, por separado, ANTES de correr el resto
-- de este archivo (NO es parte del script ejecutable de abajo):
--
--   select vault.create_secret(
--     '<LA_SERVICE_ROLE_KEY_REAL_DEL_PROYECTO>',
--     'service_role_key_moderar'
--   );
--
-- Correr esa línea a mano en el SQL Editor de Supabase, reemplazando el
-- placeholder por la key real del proyecto (Dashboard → Project Settings →
-- API → service_role secret). Nunca pegar la key real en este archivo ni
-- commitearla al repo. Si el secret ya existe con ese nombre, no hace falta
-- volver a crearlo.
-- -----------------------------------------------------------------------------

-- Requerido para net.http_post() (la extensión se llama "pg_net"; expone
-- sus funciones bajo el schema "net"). Sin esto, la llamada de más abajo
-- falla con "function net.http_post does not exist".
create extension if not exists pg_net;

-- =============================================================================
-- Función de trigger
-- =============================================================================
create or replace function trigger_moderar_pregunta()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_service_role_key text;
  v_request_id        bigint;
begin
  select decrypted_secret
    into v_service_role_key
    from vault.decrypted_secrets
   where name = 'service_role_key_moderar';

  if v_service_role_key is null then
    -- Falla ruidosa a propósito: sin este secret no hay forma de autenticar
    -- la llamada a la Edge Function (ver "Enforce JWT verification" en
    -- index.ts), así que dejar pasar el INSERT sin moderar sería peor que
    -- abortarlo. Revisar el PASO 0 de arriba si esto se dispara.
    raise exception
      'No se encontró el secret "service_role_key_moderar" en Vault. Ver PASO 0 en supabase/trigger_moderar_pregunta.sql.';
  end if;

  -- Reemplazar <TU_PROJECT_REF> por el ref real del proyecto (Dashboard →
  -- Project Settings → General → Reference ID) antes de correr este archivo.
  select net.http_post(
    url     := 'https://kjkjwvdyzdrxokiqjuwz.supabase.co/functions/v1/moderar-pregunta',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'type',       'INSERT',
      'table',      'questions',
      'record',     to_jsonb(NEW),
      'schema',     'public',
      'old_record', null
    ),
    -- Un poco por encima de GEMINI_TIMEOUT_MS (15s) en index.ts, para que
    -- pg_net no corte la espera de la respuesta antes que la propia función.
    timeout_milliseconds := 90000
  )
  into v_request_id;

  -- net.http_post() es asíncrono: solo encola el request y devuelve un id
  -- (guardado en v_request_id, no se usa más acá). La respuesta real queda
  -- en la tabla net._http_response, consultable por ese id si hace falta
  -- depurar una entrega fallida — no hay una vista de logs dedicada como la
  -- que sí tenía el Database Webhook.
  return new;
end;
$$;

-- =============================================================================
-- Trigger: dispara la función anterior después de cada INSERT en questions
-- =============================================================================
drop trigger if exists trigger_moderar_pregunta_on_insert on questions;

create trigger trigger_moderar_pregunta_on_insert
  after insert on questions
  for each row
  execute function trigger_moderar_pregunta();

-- =============================================================================
-- Notas para quien retome esto:
-- - "Enforce JWT verification" en la Edge Function debe seguir activado; el
--   header Authorization de arriba es lo que lo satisface, igual que antes
--   con el Database Webhook.
-- - Si en algún momento se resuelve el bug de Supabase ("schema
--   supabase_functions does not exist") y se puede volver a crear el
--   Database Webhook original, este trigger + función deberían eliminarse
--   (drop trigger / drop function) para no disparar la moderación dos veces
--   por el mismo INSERT.
-- =============================================================================

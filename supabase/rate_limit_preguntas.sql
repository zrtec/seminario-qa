-- =============================================================================
-- Seminario Q&A — Rate limiting: máximo 1 pregunta cada 30s por attendee_id
--
-- Contexto de negocio: un mismo attendee_id no puede enviar más de 1
-- pregunta cada 30 segundos, sin importar de qué conferencia. Hoy
-- (app/preguntar/[qr_slug]/PreguntarForm.tsx) el envío es un INSERT directo
-- del cliente contra "questions" con la anon key:
--
--   supabase.from("questions").insert({ conference_id, attendee_id, texto, ... })
--
-- Mismo principio que ya se aplicó en conferences_una_activa_idx y
-- questions_una_al_ponente_por_conferencia_idx (ver
-- supabase/panel_expertos.sql): la garantía real no puede vivir solo en el
-- frontend. Un INSERT directo desde el cliente no tiene forma de hacer
-- cumplir "máximo 1 cada 30s" — eso requiere leer el historial antes de
-- escribir, y ese "leer + decidir + escribir" tiene que ser atómico o dos
-- envíos casi simultáneos del mismo attendee_id (doble tap, dos pestañas)
-- podrían colarse los dos.
--
-- Diseño (2 funciones):
--
--   a) puede_enviar_pregunta(p_attendee_id uuid) returns boolean — el
--      chequeo en sí: ¿existe una pregunta de este attendee_id con
--      created_at > now() - 30s? Sin GRANT propio a anon/authenticated:
--      es un helper interno, se usa solo desde adentro de
--      insertar_pregunta(), mismo criterio que is_staff()/is_admin() en la
--      sección 2 (tampoco tienen GRANT directo, se llaman desde otras
--      funciones/políticas). Igual queda como función aparte y no inline
--      porque el pedido de negocio la nombra como una pieza reusable en sí
--      misma, y separarla la hace trivial de probar sola con
--      "select puede_enviar_pregunta('<uuid>')" desde el SQL Editor.
--
--   b) insertar_pregunta(p_attendee_id, p_conference_id, p_texto) returns
--      uuid — el único punto de entrada para insertar una pregunta como
--      público. Hace TRES cosas en una sola función (una sola transacción
--      implícita):
--
--        1. Bloquea la fila de attendees (p_attendee_id) con
--           "select ... for update". Esto es lo que realmente cierra la
--           carrera: si dos requests del mismo attendee_id llegan casi
--           juntas, la segunda queda esperando a que la primera termine
--           (INSERT + commit) antes de mirar el historial — así ve la
--           pregunta recién insertada por la primera y rechaza
--           correctamente. Sin este lock, aunque "chequear" e "insertar"
--           estén en la misma función, dos EJECUCIONES concurrentes de esa
--           función (una por cada request) podrían las dos leer "no hay
--           pregunta reciente" bajo READ COMMITTED y las dos insertar —
--           exactamente la misma clase de bug que el índice único parcial
--           evita para "conferencia activa" / "pregunta al aire", pero acá
--           no hay una columna booleana que un índice único pueda
--           proteger (es una ventana de tiempo móvil), así que el
--           equivalente correcto es serializar con un lock de fila.
--        2. Llama a puede_enviar_pregunta(); si no puede, aborta con
--           "raise exception" y un mensaje pensado para mostrarse tal cual
--           al usuario (ver sección "Cómo lo distingue el frontend" más
--           abajo).
--        3. Hace el INSERT (mismos valores que ya insertaba el cliente
--           directo: ai_status = 'pendiente', mostrada_en_pantalla =
--           false — nunca se salta la moderación de IA) y devuelve el id.
--
-- Cómo lo distingue el frontend (sin parsear el texto del mensaje):
-- la excepción de rate limit se lanza con "using errcode = 'RLIMT'", un
-- SQLSTATE de 5 caracteres inventado que no colisiona con ningún código
-- real de Postgres. PostgREST devuelve ese código en el campo "code" del
-- error; el cliente de Supabase-js lo expone en error.code. El frontend
-- compara error.code === 'RLIMT' para decidir si muestra el mensaje
-- amigable de la excepción (error.message, ya redactado para el usuario
-- final) o el mensaje genérico de "algo salió mal" para cualquier otro
-- error. Comparar por código y no por texto evita que un cambio futuro de
-- redacción del mensaje rompa silenciosamente esta distinción.
--
-- Cierre del bypass: revoke insert + política actualizada.
-- Con insertar_pregunta() ya validando el límite, dejar el GRANT insert
-- directo sobre "questions" abierto a "anon" (como está hoy, ver
-- supabase/grants.sql) permitiría seguir insertando por REST sin pasar por
-- esta función, dejando el rate limit de adorno — el mismo tipo de bypass
-- que se cerró para los RPC del panel en
-- supabase/endurecer_permisos_staff.sql. Por eso esta migración también:
--   - revoca "insert" sobre questions a "anon" (se queda solo con select).
--   - deja la política "questions_insert_publico" con "to authenticated"
--     únicamente (staff, ej. pruebas desde el SQL Editor); para "anon" ya
--     no hay GRANT de tabla, así que la política ni se evalúa para ese rol.
--
-- Requisito de frontend (aplicado en el mismo cambio que generó este
-- archivo, ver app/preguntar/[qr_slug]/PreguntarForm.tsx): el INSERT
-- directo del cliente contra "questions" se reemplaza por
-- supabase.rpc("insertar_pregunta", { p_attendee_id, p_conference_id,
-- p_texto }). Sin ese cambio, el envío de preguntas se rompe apenas se
-- revoca el GRANT de abajo — no correr este archivo sin haber aplicado
-- también ese cambio de frontend.
--
-- Este archivo es la migración a correr AHORA sobre el proyecto ya
-- desplegado (schema.sql ya se corrió una vez). El mismo contenido queda
-- incorporado también en supabase/schema.sql (sección 10) y
-- supabase/grants.sql, para que una instalación nueva desde cero lo tenga
-- de entrada.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. puede_enviar_pregunta: helper interno, sin GRANT propio (igual que
--    is_staff()/is_admin()) — solo lo usa insertar_pregunta() de acá abajo.
-- -----------------------------------------------------------------------------
create or replace function puede_enviar_pregunta(p_attendee_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from questions
    where attendee_id = p_attendee_id
      and created_at > now() - interval '30 seconds'
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. insertar_pregunta: único punto de entrada público para insertar una
--    pregunta. Lock de fila sobre attendees + chequeo + INSERT, en una sola
--    función. Ver el razonamiento completo del lock más arriba.
-- -----------------------------------------------------------------------------
create or replace function insertar_pregunta(
  p_attendee_id uuid,
  p_conference_id uuid,
  p_texto text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Serializa llamadas concurrentes del mismo attendee_id: la segunda
  -- espera a que la primera haga commit (INSERT incluido) antes de seguir,
  -- así el chequeo de abajo ve el estado real y no una foto vieja.
  perform 1 from attendees where id = p_attendee_id for update;

  if not found then
    raise exception 'El asistente % no existe.', p_attendee_id;
  end if;

  if not puede_enviar_pregunta(p_attendee_id) then
    raise exception 'Espera unos segundos antes de enviar otra pregunta.' using errcode = 'RLIMT';
  end if;

  insert into questions (conference_id, attendee_id, texto, ai_status, mostrada_en_pantalla)
  values (p_conference_id, p_attendee_id, p_texto, 'pendiente', false)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function insertar_pregunta(uuid, uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Cierre del bypass: revocar el INSERT directo sobre questions para
--    "anon" y dejar la política de INSERT solo para "authenticated".
-- -----------------------------------------------------------------------------
revoke insert on questions from anon;

alter policy "questions_insert_publico" on questions to authenticated;

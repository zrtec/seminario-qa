-- =============================================================================
-- Seminario Q&A — preguntas_pantalla() / pregunta_pantalla_por_id()
--
-- Contexto: app/admin/pantalla/[qr_slug] (pantalla kiosko) necesita mostrar,
-- junto al texto de cada pregunta aprobada, el nombre del asistente que la
-- hizo. El código original resolvía esto con un embed de PostgREST
-- (select "..., attendee:attendee_id ( nombre )") desde el cliente anon,
-- pero eso requiere GRANT SELECT sobre "attendees" para el rol "anon" — y
-- supabase/grants.sql deliberadamente NO se lo da (ver el comentario de esa
-- misma línea): la tabla tiene "email" y "access_code" (una credencial), y
-- el único acceso público a datos de un asistente ya pasa por
-- buscar_asistente(), una función SECURITY DEFINER que expone solo lo
-- necesario. El embed fallaba en cada request con
-- "permission denied for table attendees" (42501), y como el código no
-- revisaba "error", la falla quedaba muda y la pantalla mostraba "no hay
-- preguntas" aunque sí existieran filas aprobadas.
--
-- Esta migración sigue exactamente el mismo patrón que buscar_asistente()
-- (schema.sql): dos funciones SECURITY DEFINER que hacen el join a
-- attendees puertas adentro (bypassan RLS) y devuelven únicamente
-- id/texto/created_at/nombre — nunca email ni access_code. No hace falta
-- ningún GRANT nuevo sobre "attendees"; el único GRANT es EXECUTE sobre
-- estas funciones, igual que con buscar_asistente().
--
-- - preguntas_pantalla(): carga inicial (lista, la más reciente primero).
-- - pregunta_pantalla_por_id(): una fila puntual, usada por el handler de
--   Realtime en PantallaKiosko.tsx cuando una pregunta pasa a aprobada.
--
-- Este archivo es la migración a correr AHORA sobre el proyecto ya
-- desplegado (schema.sql ya se corrió una vez). El mismo contenido queda
-- incorporado también en supabase/schema.sql para que una instalación
-- nueva desde cero lo tenga de entrada.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

create or replace function preguntas_pantalla(
  p_conference_id uuid,
  p_limite integer default 30
)
returns table (
  id         uuid,
  texto      text,
  created_at timestamptz,
  nombre     text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and q.mostrada_en_pantalla = true
  order by q.created_at desc
  limit p_limite;
$$;

grant execute on function preguntas_pantalla(uuid, integer) to anon, authenticated;

create or replace function pregunta_pantalla_por_id(p_id uuid)
returns table (
  id         uuid,
  texto      text,
  created_at timestamptz,
  nombre     text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.id = p_id
    and q.ai_status = 'aprobada'
    and q.mostrada_en_pantalla = true
  limit 1;
$$;

grant execute on function pregunta_pantalla_por_id(uuid) to anon, authenticated;

-- =============================================================================
-- Seminario Q&A — texto_corregido (v1.2)
--
-- La edge function moderar-pregunta ahora pide a Gemini, además de la
-- moderación y la relevancia, una versión corregida de la pregunta (ortografía,
-- acentos, puntuación, lenguaje coloquial) que se muestra en el kiosko, la
-- Pantalla Principal y el Panel de Expertos.
--
-- - questions.texto  : el texto ORIGINAL tal como lo escribió el asistente.
--                      NO se modifica nunca (auditoría / trazabilidad).
-- - questions.texto_corregido : versión corregida por IA. NULL si la pregunta
--                      es anterior a este cambio, fue rechazada, o Gemini no
--                      la generó. El frontend usa texto_corregido ?? texto.
--
-- Las 5 funciones de lectura agregan la columna texto_corregido al resultado.
-- Como cambia el tipo de retorno, create or replace no alcanza: hay que
-- DROP + CREATE, lo que borra los grants. Se reaplican exactamente como
-- estaban:
--   - preguntas_pantalla / pregunta_pantalla_por_id / pregunta_al_ponente_actual:
--       execute para anon y authenticated (pantallas públicas).
--   - preguntas_panel_estrategicas / preguntas_panel_respaldo:
--       solo authenticated + is_staff() adentro (ver endurecer_permisos_staff.sql),
--       con REVOKE explícito de anon y public.
--
-- Orden de despliegue: correr esto ANTES de desplegar la nueva versión de
-- moderar-pregunta (que escribe texto_corregido).
-- =============================================================================

alter table questions add column if not exists texto_corregido text;

-- -----------------------------------------------------------------------------
-- Funciones públicas (anon + authenticated)
-- -----------------------------------------------------------------------------
drop function if exists preguntas_pantalla(uuid, integer);
create function preguntas_pantalla(
  p_conference_id uuid,
  p_limite integer default 30
)
returns table (
  id              uuid,
  texto           text,
  texto_corregido text,
  created_at      timestamptz,
  nombre          text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.texto_corregido, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and q.mostrada_en_pantalla = true
  order by q.created_at desc
  limit p_limite;
$$;

grant execute on function preguntas_pantalla(uuid, integer) to anon, authenticated;

drop function if exists pregunta_pantalla_por_id(uuid);
create function pregunta_pantalla_por_id(p_id uuid)
returns table (
  id              uuid,
  texto           text,
  texto_corregido text,
  created_at      timestamptz,
  nombre          text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.texto_corregido, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.id = p_id
    and q.ai_status = 'aprobada'
    and q.mostrada_en_pantalla = true
  limit 1;
$$;

grant execute on function pregunta_pantalla_por_id(uuid) to anon, authenticated;

drop function if exists pregunta_al_ponente_actual(uuid);
create function pregunta_al_ponente_actual(p_conference_id uuid)
returns table (
  id              uuid,
  texto           text,
  texto_corregido text,
  created_at      timestamptz,
  nombre          text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.texto_corregido, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.conference_id = p_conference_id
    and q.mostrada_al_ponente = true
  limit 1;
$$;

grant execute on function pregunta_al_ponente_actual(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Funciones del panel (solo staff)
-- -----------------------------------------------------------------------------
drop function if exists preguntas_panel_estrategicas(uuid);
create function preguntas_panel_estrategicas(p_conference_id uuid)
returns table (
  id                  uuid,
  texto               text,
  texto_corregido     text,
  created_at          timestamptz,
  nombre              text,
  nombre_organizacion text,
  ai_relevance_score  numeric,
  preseleccionada     boolean,
  mostrada_al_ponente boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id, q.texto, q.texto_corregido, q.created_at,
    a.nombre, o.nombre,
    q.ai_relevance_score, q.preseleccionada, q.mostrada_al_ponente
  from questions q
  join attendees a on a.id = q.attendee_id
  join organizations o on o.id = a.organization_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and o.es_estrategica = true
    and is_staff()
  order by q.ai_relevance_score desc;
$$;

revoke execute on function preguntas_panel_estrategicas(uuid) from anon, public;
grant execute on function preguntas_panel_estrategicas(uuid) to authenticated;

drop function if exists preguntas_panel_respaldo(uuid);
create function preguntas_panel_respaldo(p_conference_id uuid)
returns table (
  id                  uuid,
  texto               text,
  texto_corregido     text,
  created_at          timestamptz,
  nombre              text,
  nombre_organizacion text,
  ai_relevance_score  numeric,
  preseleccionada     boolean,
  mostrada_al_ponente boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id, q.texto, q.texto_corregido, q.created_at,
    a.nombre, o.nombre,
    q.ai_relevance_score, q.preseleccionada, q.mostrada_al_ponente
  from questions q
  join attendees a on a.id = q.attendee_id
  join organizations o on o.id = a.organization_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and o.es_estrategica = false
    and is_staff()
  order by q.ai_relevance_score desc;
$$;

revoke execute on function preguntas_panel_respaldo(uuid) from anon, public;
grant execute on function preguntas_panel_respaldo(uuid) to authenticated;

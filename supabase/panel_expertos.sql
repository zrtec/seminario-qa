-- =============================================================================
-- Seminario Q&A — Panel de Expertos: preselección colaborativa y selección
-- "al aire" para el ponente
--
-- Contexto de negocio: varios panelistas (2 o más) ven el mismo panel en
-- tiempo real. Cualquiera puede "preseleccionar" una pregunta como
-- interesante — es una señal compartida, sin registrar quién la marcó (no
-- hay columna de autoría; "preseleccionada" es simplemente true/false a
-- nivel de la pregunta). Cuando le toca el turno a un panelista, "elige" una
-- pregunta para mostrarla al ponente en una pantalla nueva.
--
-- Invariante de negocio: como máximo una pregunta "al aire"
-- (mostrada_al_ponente = true) a la vez POR CONFERENCIA. Mismo caso que
-- conferences.activa (ver supabase/conferencia_activa_unica.sql): no basta
-- con lógica de aplicación ("apagar la anterior + prender la elegida"),
-- porque eso deja el invariante roto ante el primer UPDATE manual desde el
-- SQL Editor o el primer bug futuro que lo pise. La garantía real es el
-- índice único parcial de más abajo — Postgres rechaza directamente
-- cualquier intento de dejar dos filas con mostrada_al_ponente = true en la
-- misma conference_id, sin importar por dónde llegue el UPDATE.
--
-- Las 3 funciones de lectura siguen exactamente el mismo patrón que
-- preguntas_pantalla() / pregunta_pantalla_por_id() (Paso 9, ver
-- supabase/preguntas_pantalla.sql): SECURITY DEFINER, hacen el JOIN a
-- attendees/organizations puertas adentro (bypassan RLS) y devuelven solo
-- los campos necesarios — así "anon" no necesita ningún GRANT directo sobre
-- attendees ni organizations (que deliberadamente no lo tienen; ver
-- supabase/grants.sql).
--
--   a) preguntas_panel_estrategicas(): preguntas aprobadas de asistentes
--      cuya organización es_estrategica = true, para la columna principal
--      del panel.
--   b) preguntas_panel_respaldo(): mismo shape, organizaciones NO
--      estratégicas, para la columna de respaldo.
--   c) pregunta_al_ponente_actual(): la única pregunta al aire de una
--      conferencia (o ninguna fila), para que la Pantalla Principal la
--      consulte.
--
-- Además, 2 funciones de escritura:
--
--   d) elegir_pregunta_al_ponente(): el swap atómico de "pregunta al
--      aire" — mismo patrón que activar_conferencia() (apagar la anterior +
--      prender la elegida dentro de una única función, que Postgres ejecuta
--      como una sola transacción implícita). Resuelve la conference_id a
--      partir de la propia pregunta (no la recibe como parámetro aparte,
--      para que no se pueda pasar una combinación inconsistente de
--      pregunta/conferencia) y valida ai_status = 'aprobada' antes de
--      prenderla, para que una pregunta rechazada o de otra conferencia
--      nunca pueda terminar mostrada al ponente por un error del caller.
--   e) togglear_preseleccion(): invierte "preseleccionada" para una
--      pregunta y devuelve el nuevo valor, así el frontend no necesita
--      conocer de antemano el estado actual (evita una carrera de
--      lectura-luego-escritura entre el SELECT del estado y el UPDATE).
--
-- Este archivo es la migración a correr AHORA sobre el proyecto ya
-- desplegado (schema.sql ya se corrió una vez). El mismo contenido queda
-- incorporado también en supabase/schema.sql para que una instalación
-- nueva desde cero lo tenga de entrada.
--
-- IMPORTANTE: si en este momento ya hubiera dos o más preguntas con
-- mostrada_al_ponente = true para la misma conferencia (no debería, la
-- columna es nueva y nace en false), la creación del índice de abajo
-- fallaría con "could not create unique index". No debería pasar en una
-- columna recién agregada con default false.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas en questions
-- -----------------------------------------------------------------------------
alter table questions
  add column if not exists preseleccionada boolean not null default false,
  add column if not exists mostrada_al_ponente boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. Invariante: una sola pregunta "al aire" por conferencia
-- -----------------------------------------------------------------------------
create unique index if not exists questions_una_al_ponente_por_conferencia_idx
  on questions (conference_id)
  where mostrada_al_ponente = true;

-- -----------------------------------------------------------------------------
-- 3. Funciones de lectura para el Panel de Expertos y la Pantalla Principal
-- -----------------------------------------------------------------------------

-- a) Columna principal del panel: preguntas aprobadas de organizaciones
--    estratégicas, ordenadas por relevancia (IA) descendente.
create or replace function preguntas_panel_estrategicas(p_conference_id uuid)
returns table (
  id                  uuid,
  texto               text,
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
    q.id, q.texto, q.created_at,
    a.nombre, o.nombre,
    q.ai_relevance_score, q.preseleccionada, q.mostrada_al_ponente
  from questions q
  join attendees a on a.id = q.attendee_id
  join organizations o on o.id = a.organization_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and o.es_estrategica = true
  order by q.ai_relevance_score desc;
$$;

grant execute on function preguntas_panel_estrategicas(uuid) to anon, authenticated;

-- b) Columna de respaldo del panel: mismo shape, organizaciones NO
--    estratégicas.
create or replace function preguntas_panel_respaldo(p_conference_id uuid)
returns table (
  id                  uuid,
  texto               text,
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
    q.id, q.texto, q.created_at,
    a.nombre, o.nombre,
    q.ai_relevance_score, q.preseleccionada, q.mostrada_al_ponente
  from questions q
  join attendees a on a.id = q.attendee_id
  join organizations o on o.id = a.organization_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and o.es_estrategica = false
  order by q.ai_relevance_score desc;
$$;

grant execute on function preguntas_panel_respaldo(uuid) to anon, authenticated;

-- c) Pantalla Principal: la pregunta al aire de esta conferencia, si hay
--    una. El índice único parcial de la sección 2 garantiza que nunca haya
--    más de una fila que matchee este filtro por conference_id.
create or replace function pregunta_al_ponente_actual(p_conference_id uuid)
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
    and q.mostrada_al_ponente = true
  limit 1;
$$;

grant execute on function pregunta_al_ponente_actual(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funciones de escritura: elegir pregunta al aire / togglear preselección
-- -----------------------------------------------------------------------------

-- d) Swap atómico de "pregunta al aire". El índice único parcial de la
--    sección 2 es la garantía real del invariante; esta función es la forma
--    correcta de respetarlo al cambiar cuál pregunta está al aire, igual
--    que activar_conferencia() con conferences.activa.
create or replace function elegir_pregunta_al_ponente(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conference_id uuid;
  v_ai_status     text;
begin
  select conference_id, ai_status
    into v_conference_id, v_ai_status
    from questions
    where id = p_question_id;

  if not found then
    raise exception 'La pregunta % no existe.', p_question_id;
  end if;

  if v_ai_status <> 'aprobada' then
    raise exception 'La pregunta % no está aprobada (ai_status = %).', p_question_id, v_ai_status;
  end if;

  update questions
    set mostrada_al_ponente = false
    where conference_id = v_conference_id
      and id <> p_question_id
      and mostrada_al_ponente = true;

  update questions
    set mostrada_al_ponente = true
    where id = p_question_id;
end;
$$;

grant execute on function elegir_pregunta_al_ponente(uuid) to anon, authenticated;

-- e) Togglear "preseleccionada" sin que el frontend necesite conocer el
--    estado actual: invierte el valor y devuelve el nuevo, en la misma
--    sentencia (sin SELECT previo, evitando una carrera lectura-escritura
--    entre dos panelistas que togglean casi al mismo tiempo).
create or replace function togglear_preseleccion(p_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo_valor boolean;
begin
  update questions
    set preseleccionada = not preseleccionada
    where id = p_question_id
    returning preseleccionada into v_nuevo_valor;

  if not found then
    raise exception 'La pregunta % no existe.', p_question_id;
  end if;

  return v_nuevo_valor;
end;
$$;

grant execute on function togglear_preseleccion(uuid) to anon, authenticated;

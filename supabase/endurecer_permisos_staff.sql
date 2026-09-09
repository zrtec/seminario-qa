-- =============================================================================
-- Seminario Q&A — Endurecer permisos de las funciones SECURITY DEFINER del
-- Panel de Expertos, ahora que existe autenticación real de staff
-- (Pasos 11.1-11.3: login con Supabase Auth, proxy.ts protegiendo /panel y
-- /admin, requireAdmin()/requireStaff() en los route handlers).
--
-- Contexto: en los Pasos 9 y 10 (supabase/preguntas_pantalla.sql y
-- supabase/panel_expertos.sql) todas las funciones del panel se dejaron con
-- "grant execute ... to anon, authenticated" de forma temporal, porque en
-- ese momento no existía ninguna sesión de staff real contra la cual
-- verificar un rol — la única alternativa a "anon" habría sido bloquear
-- todo, incluidas las pantallas públicas que sí deben ser anónimas. Ahora
-- que sí podemos verificar sesión + rol vía staff_users, corresponde
-- revisar cada función y decidir si "anon" sigue siendo necesario.
--
-- =============================================================================
-- ⚠️ DEPENDENCIA CON EL FRONTEND — leer antes de correr esto
--
-- app/panel/page.tsx llamaba a las 4 funciones que este archivo restringe
-- usando el cliente de lib/supabase.ts (@supabase/supabase-js plano, sesión
-- en localStorage), NO el cliente SSR de lib/supabase/client.ts (sesión en
-- cookies, el mismo que usa /login). Son dos storages de sesión
-- independientes: verificado en vivo que, incluso logueado, ese cliente
-- plano sigue siendo "anon" ante Postgres (falla con
-- "permission denied for table staff_users" al intentar leer su propia
-- fila). Si is_staff() se agrega a estas 4 funciones sin corregir eso,
-- /panel se rompe para TODOS — admin incluido, no solo panelista — porque
-- ninguna de sus llamadas llevaría nunca el JWT del usuario.
--
-- Ya corregido en el mismo cambio que generó este archivo:
-- app/panel/page.tsx ahora usa createClient() de lib/supabase/client.ts
-- (memoizado con useMemo) para preguntas_panel_estrategicas,
-- preguntas_panel_respaldo, togglear_preseleccion y
-- elegir_pregunta_al_ponente. Verificado que con ese cliente sí viaja la
-- sesión (misma prueba: la lectura a staff_users funciona). Sin ese cambio
-- ya aplicado, NO correr este SQL.
-- =============================================================================
--
-- =============================================================================
-- AUDITORÍA, función por función
-- =============================================================================
--
-- Pantalla kiosko / Pantalla Principal — SIGUEN públicas (sin cambios):
--
--   1. preguntas_pantalla(conference_id, limite)      [supabase/preguntas_pantalla.sql]
--   2. pregunta_pantalla_por_id(id)                    [supabase/preguntas_pantalla.sql]
--   3. pregunta_al_ponente_actual(conference_id)        [supabase/panel_expertos.sql]
--
--      1. ¿Accesible por anon? SÍ. Son las pantallas físicas del evento
--         (proyector del kiosko, pantalla del podio) — se abren en un
--         navegador sin login, del mismo modo que /preguntar/[qr_slug]. No
--         hay ningún staff logueado del otro lado; restringirlas a
--         "authenticated" rompería la funcionalidad completa.
--      2. N/A — no corresponde ningún chequeo de rol adentro: seguir
--         devolviendo exactamente lo que ya devuelven (solo preguntas
--         aprobadas y, en el caso de preguntas_pantalla/_por_id, marcadas
--         mostrada_en_pantalla = true) es la superficie pública correcta.
--
--      No se toca ningún GRANT ni definición de estas 3 funciones en este
--      archivo.
--
-- Panel de Expertos — se restringen a staff autenticado:
--
--   4. preguntas_panel_estrategicas(conference_id)
--   5. preguntas_panel_respaldo(conference_id)
--   6. elegir_pregunta_al_ponente(question_id)
--   7. togglear_preseleccion(question_id)
--
--      1. ¿Accesible por anon? NO. /panel ya está protegido por proxy.ts
--         (redirige a /login sin sesión, y a la propia área si el rol no
--         corresponde), así que no hay ningún flujo legítimo del producto
--         que llame a estas 4 funciones sin una sesión de staff. Dejarlas
--         abiertas a "anon" ya no cumple ningún propósito y expone de más:
--         preguntas_panel_* devuelven nombre del asistente + organización
--         (no son públicas como las de pantalla, que también muestran
--         nombre pero solo de preguntas ya proyectadas); elegir_pregunta_al_
--         ponente y togglear_preseleccion son ESCRITURAS que hoy cualquiera
--         con la anon key (que es pública, va en el bundle del cliente)
--         podría invocar por RPC directo sin pasar por el navegador ni por
--         /panel en absoluto.
--
--      2. ¿El chequeo de rol va DENTRO de la función, o alcanza con que el
--         frontend/proxy no deje llegar a nadie sin sesión? DENTRO de la
--         función, además de achicar el GRANT. Dos razones, mismo patrón
--         que ya usa este proyecto para otros invariantes (ver el
--         comentario de conferences_una_activa_idx / questions_una_al_
--         ponente_por_conferencia_idx en panel_expertos.sql: "no basta con
--         lógica de aplicación, la garantía real está en la base"):
--
--           a) proxy.ts protege la NAVEGACIÓN a la página /panel, pero
--              estas funciones son endpoints RPC de PostgREST expuestos
--              directamente (Supabase autogenera /rest/v1/rpc/<función> por
--              cada función con GRANT EXECUTE). Cualquiera con la anon key
--              —pública, está en el bundle JS del navegador— puede llamar
--              a ese endpoint con curl/fetch sin pasar jamás por proxy.ts,
--              por Next.js, ni por el navegador. El proxy no es una
--              barrera para ese camino.
--           b) achicar el GRANT a "authenticated" reduce la superficie a
--              "cualquier usuario logueado", pero en este proyecto no hay
--              (todavía) ningún tipo de usuario autenticado que NO sea
--              staff — attendees no tienen cuenta de Supabase Auth, se
--              identifican por access_code/email. Confiar en que
--              "authenticated" == "staff" es una coincidencia del estado
--              actual, no una garantía: alcanzaría con agregar en el futuro
--              cualquier otro flujo de login (self-signup, magic link para
--              asistentes, OAuth) para que "authenticated" deje de
--              significar "staff" sin que nadie haya tocado estas 4
--              funciones. El chequeo real e independiente de esa
--              coincidencia es is_staff() (ya definida en schema.sql,
--              valida contra staff_users vía auth.uid()), evaluado adentro
--              de la función misma.
--
--         Se aplica entonces DOBLE cinturón, igual de barato que uno solo:
--         GRANT solo a "authenticated" (ya no a "anon") + "and is_staff()"
--         (funciones de lectura) / "if not is_staff() then raise
--         exception" (funciones de escritura) adentro de cada función.
--
-- =============================================================================
-- Nota sobre PUBLIC y funciones
--
-- A diferencia de las tablas, Postgres otorga EXECUTE sobre una función
-- nueva a la pseudo-rol PUBLIC por default en el momento de crearla (todo
-- rol, incluido "anon", es miembro implícito de PUBLIC). Si ese default no
-- se revocó explícitamente en algún momento, un simple
-- "revoke ... from anon" NO alcanza para cerrar el acceso: "anon" seguiría
-- pudiendo ejecutar la función heredando el privilegio de PUBLIC. Por eso
-- cada REVOKE de abajo incluye también "from public", sea o no
-- estrictamente necesario en este proyecto — es barato y cierra ese caso
-- por las dudas, en vez de asumir que nunca pasó.
-- =============================================================================
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4. preguntas_panel_estrategicas: agrega "and is_staff()" al filtro. Quien
--    no es staff recibe 0 filas (mismo shape que "no hay preguntas
--    todavía"), sin distinguir si la conferencia existe o cuántas preguntas
--    aprobadas tiene — más seguro que devolver un error descriptivo.
-- -----------------------------------------------------------------------------
revoke execute on function preguntas_panel_estrategicas(uuid) from anon, public;

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
    and is_staff()
  order by q.ai_relevance_score desc;
$$;

grant execute on function preguntas_panel_estrategicas(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. preguntas_panel_respaldo: mismo criterio que la anterior.
-- -----------------------------------------------------------------------------
revoke execute on function preguntas_panel_respaldo(uuid) from anon, public;

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
    and is_staff()
  order by q.ai_relevance_score desc;
$$;

grant execute on function preguntas_panel_respaldo(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. elegir_pregunta_al_ponente: función de ESCRITURA. Acá sí conviene
--    fallar ruidoso (raise exception) en vez de un no-op silencioso: un
--    intento de escritura sin autorización debería ser visible/loggeable,
--    no comportarse como si hubiera tenido éxito.
-- -----------------------------------------------------------------------------
revoke execute on function elegir_pregunta_al_ponente(uuid) from anon, public;

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
  if not is_staff() then
    raise exception 'No autorizado: se requiere sesión de staff.' using errcode = '42501';
  end if;

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

grant execute on function elegir_pregunta_al_ponente(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. togglear_preseleccion: misma razón que la anterior (escritura, falla
--    ruidoso).
-- -----------------------------------------------------------------------------
revoke execute on function togglear_preseleccion(uuid) from anon, public;

create or replace function togglear_preseleccion(p_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo_valor boolean;
begin
  if not is_staff() then
    raise exception 'No autorizado: se requiere sesión de staff.' using errcode = '42501';
  end if;

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

grant execute on function togglear_preseleccion(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Sin cambios (documentado acá solo para que quede explícito en el mismo
-- lugar que se auditó todo lo demás): preguntas_pantalla(),
-- pregunta_pantalla_por_id() y pregunta_al_ponente_actual() mantienen
-- "grant execute ... to anon, authenticated" tal como quedaron en
-- supabase/preguntas_pantalla.sql y supabase/panel_expertos.sql. No hay
-- ninguna sentencia para ellas en este archivo.
-- -----------------------------------------------------------------------------

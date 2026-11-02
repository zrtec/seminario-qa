-- =============================================================================
-- Seminario Q&A — organización del asistente en la Pantalla Principal
--
-- pregunta_al_ponente_actual() ahora devuelve también nombre_organizacion,
-- para mostrar "— Nombre · Organización" bajo la pregunta en vivo.
--
-- - left join a organizations: el asistente puede no tener organización
--   (attendees.organization_id es nullable); en ese caso nombre_organizacion
--   es NULL y la pregunta se devuelve igual.
-- - Mismos filtros de siempre: la fila con mostrada_al_ponente = true.
-- - No expone email, access_code ni ningún otro dato del asistente: solo
--   a.nombre y o.nombre.
-- - Cambia el tipo de retorno, así que create or replace no alcanza: DROP +
--   CREATE, lo que borra los grants. Se reaplican (anon, authenticated),
--   igual que antes (pantalla pública).
-- - begin/commit: no hay una ventana en la que la función no exista.
-- =============================================================================

begin;

drop function if exists pregunta_al_ponente_actual(uuid);

create function pregunta_al_ponente_actual(p_conference_id uuid)
returns table (
  id                  uuid,
  texto               text,
  texto_corregido     text,
  created_at          timestamptz,
  nombre              text,
  nombre_organizacion text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.texto_corregido, q.created_at, a.nombre, o.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  left join organizations o on o.id = a.organization_id
  where q.conference_id = p_conference_id
    and q.mostrada_al_ponente = true
  limit 1;
$$;

grant execute on function pregunta_al_ponente_actual(uuid) to anon, authenticated;

commit;

-- =============================================================================
-- Seminario Q&A — Conferencia activa única (exclusividad)
--
-- Regla de negocio: como máximo una conferencia activa a la vez en todo el
-- sistema. Al activar una, todas las demás pasan a inactiva.
--
-- Se evaluaron dos enfoques:
--
--   a) Lógica solo en el route handler (UPDATE ... SET activa=false WHERE
--      activa=true; luego UPDATE de la elegida), dentro de una transacción.
--   b) Constraint a nivel de base: índice único parcial en Postgres que le
--      impide directamente tener dos filas con activa=true.
--
-- Se usan LAS DOS, no una sola:
--   - El índice único parcial (opción b) es la garantía real e imposible de
--     saltear: protege el invariante aunque en el futuro alguien edite el
--     route handler sin saber de esta regla, corra un UPDATE manual desde el
--     SQL Editor, o llegue tráfico por otro camino que no sea este código.
--     Un desarrollador que rompa la lógica de la app en el futuro se
--     encuentra con un error de Postgres, no con un bug silencioso de dos
--     conferencias activas.
--   - La función activar_conferencia() (equivalente a la opción a, pero como
--     función de Postgres en vez de código en el route handler) sigue siendo
--     necesaria: el índice por sí solo NO resuelve el caso de uso de
--     "cambiar cuál está activa", solo lo prohíbe si se intenta mal. La
--     función encapsula "desactivar la anterior + activar la nueva" en una
--     única transacción atómica (el cuerpo de una función se ejecuta como
--     una sola transacción implícita), evitando la condición de carrera de
--     hacer esos dos UPDATE sueltos desde JavaScript en el route handler.
--
-- Este archivo es la migración a correr AHORA sobre el proyecto ya
-- desplegado (schema.sql ya se corrió una vez; volver a correrlo entero
-- fallaría por las políticas RLS ya existentes). El mismo contenido ya
-- quedó incorporado en supabase/schema.sql para que una instalación nueva
-- desde cero lo tenga de entrada.
--
-- IMPORTANTE: si en este momento ya hubiera dos o más conferencias con
-- activa = true (no debería, pero por las dudas), la creación del índice
-- de abajo va a fallar con "could not create unique index". En ese caso,
-- antes de correr este archivo, dejar una sola activa a mano, por ejemplo:
--   update conferences set activa = false where activa = true;
--   update conferences set activa = true
--     where id = '<uuid de la que debería quedar activa>';
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

create unique index if not exists conferences_una_activa_idx
  on conferences (activa)
  where activa = true;

create or replace function activar_conferencia(p_conference_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from conferences where id = p_conference_id) then
    raise exception 'La conferencia % no existe.', p_conference_id;
  end if;

  update conferences set activa = false where activa = true and id <> p_conference_id;
  update conferences set activa = true where id = p_conference_id;
end;
$$;

-- TEMPORAL: se llama solo desde
-- app/api/admin/conferences/[id]/activate/route.ts con getSupabaseAdmin()
-- (service_role). Ver la misma nota en supabase/schema.sql.
grant execute on function activar_conferencia(uuid) to service_role;

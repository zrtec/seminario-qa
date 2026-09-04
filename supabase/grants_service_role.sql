-- =============================================================================
-- Seminario Q&A — GRANTs explícitos para service_role
--
-- Contexto: service_role bypassea RLS (Postgres nunca evalúa las políticas
-- para ese rol), pero RLS y GRANT son dos capas independientes: el chequeo
-- de privilegio de tabla se sigue aplicando primero. Si algún
-- "REVOKE ALL ... FROM PUBLIC" (en schema.sql o grants.sql) quitó también
-- los privilegios heredados por service_role, las queries de los route
-- handlers que usan getSupabaseAdmin() fallan con
-- "permission denied for table ..." aunque el service role role ignore RLS.
--
-- Este archivo otorga explícitamente a service_role lo necesario en las 5
-- tablas de la app, sin depender de privilegios heredados/por defecto.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase (después, o junto con, schema.sql y grants.sql).
-- =============================================================================

-- El esquema "public" necesita USAGE para que PostgREST / el cliente admin
-- puedan resolver cualquier tabla dentro de él para este rol.
grant usage on schema public to service_role;

-- -----------------------------------------------------------------------------
-- Tablas: acceso completo. service_role es el rol de backend/admin que
-- bypassea RLS por diseño, así que no tiene sentido restringirlo por
-- operación como se hace con anon/authenticated en grants.sql.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on organizations to service_role;
grant select, insert, update, delete on attendees     to service_role;
grant select, insert, update, delete on staff_users   to service_role;
grant select, insert, update, delete on conferences   to service_role;
grant select, insert, update, delete on questions     to service_role;

-- -----------------------------------------------------------------------------
-- Secuencias: por si algún default (ids, contadores) depende de una
-- secuencia en vez de gen_random_uuid(); no debería ser necesario para el
-- schema actual (todos los ids usan uuid), pero se incluye "por las dudas"
-- para evitar otro "permission denied" equivalente sobre secuencias.
-- -----------------------------------------------------------------------------
grant usage, select on all sequences in schema public to service_role;

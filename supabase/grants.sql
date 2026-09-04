-- =============================================================================
-- Seminario Q&A — GRANTs faltantes para los roles anon / authenticated
--
-- Contexto: "Automatically expose new tables" está desactivado en el
-- proyecto, así que crear una tabla + políticas RLS no alcanza. Postgres
-- primero chequea el privilegio de tabla (GRANT) del rol que ejecuta la
-- consulta; recién si ese chequeo pasa, evalúa las políticas RLS fila por
-- fila. Sin el GRANT, cualquier SELECT/INSERT falla con
-- "permission denied for table ..." aunque la política RLS sea correcta.
--
-- Los permisos de acá reflejan exactamente las políticas ya definidas en
-- schema.sql: solo se otorga a "anon" lo que sus políticas realmente
-- permiten, nunca más.
--
-- No se han ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase, después (o junto con) schema.sql.
-- =============================================================================

-- El esquema "public" necesita USAGE para que PostgREST pueda resolver
-- cualquier tabla/función dentro de él para estos roles.
grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- conferences
-- Políticas: SELECT público (anon + authenticated) de activas; SELECT
-- adicional para staff autenticado; INSERT/UPDATE/DELETE solo admin
-- (autenticado). anon nunca escribe.
-- -----------------------------------------------------------------------------
grant select on conferences to anon;
grant select, insert, update, delete on conferences to authenticated;

-- -----------------------------------------------------------------------------
-- attendees
-- No hay ninguna política que permita a "anon" tocar la tabla directamente:
-- la búsqueda pública por email/access_code pasa por la función
-- buscar_asistente() (SECURITY DEFINER), que ya tiene su propio
-- GRANT EXECUTE en schema.sql y no requiere privilegios de tabla para
-- "anon". Solo staff/admin autenticado accede a la tabla en sí.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on attendees to authenticated;

-- -----------------------------------------------------------------------------
-- organizations
-- Sin políticas para "anon" (sin acceso público directo). Solo admin
-- autenticado.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on organizations to authenticated;

-- -----------------------------------------------------------------------------
-- staff_users
-- Sin políticas para "anon". Solo lectura/escritura para staff autenticado
-- (propia fila o admin, según las políticas ya definidas).
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on staff_users to authenticated;

-- -----------------------------------------------------------------------------
-- questions
-- Políticas: INSERT público (anon + authenticated) siempre en estado
-- "pendiente"; SELECT público (anon + authenticated) solo de aprobadas y
-- mostradas en pantalla; SELECT completo + UPDATE/DELETE solo para staff/
-- admin autenticado. anon nunca actualiza ni borra.
-- -----------------------------------------------------------------------------
grant select, insert on questions to anon;
grant select, insert, update, delete on questions to authenticated;

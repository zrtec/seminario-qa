-- =============================================================================
-- Limpieza de datos de prueba antes de cargar datos reales
--
-- Vacía por completo: questions, attendees, organizations, conferences.
-- NO toca: staff_users (usuarios de staff reales), ni funciones, políticas
-- o schema.
--
-- Todos los PK de estas tablas son uuid (gen_random_uuid()), no hay columnas
-- serial/identity involucradas, así que no existen secuencias que reiniciar.
--
-- Orden de dependencias (por las FKs declaradas en supabase/schema.sql):
--   questions   -> conferences (conference_id), attendees (attendee_id)
--   attendees   -> organizations (organization_id, ON DELETE SET NULL)
--   conferences -> (sin FKs salientes a estas tablas)
--   organizations -> (sin FKs salientes)
--
-- Se truncan las 4 tablas en una sola sentencia TRUNCATE: al listarlas
-- juntas, Postgres ya resuelve el orden de dependencias dentro de esa
-- sentencia sin necesitar CASCADE. Se agrega CASCADE de todos modos como
-- red de seguridad por si en el futuro se agrega alguna FK nueva hacia
-- estas tablas que no esté listada acá explícitamente (staff_users
-- referencia auth.users, no estas tablas, así que no se ve afectada).
-- =============================================================================

begin;

truncate table
  questions,
  attendees,
  conferences,
  organizations
cascade;

commit;

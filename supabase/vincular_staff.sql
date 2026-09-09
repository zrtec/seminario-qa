-- =============================================================================
-- Seminario Q&A — Vincular usuarios de Supabase Auth con staff_users
--
-- ESTO NO ES UNA MIGRACIÓN. Es una PLANTILLA DE REFERENCIA: no se corre tal
-- cual, ni una sola vez ni contra ningún ambiente. staff_users está
-- vinculada 1:1 a auth.users (ver supabase/schema.sql) pero Supabase Auth no
-- ofrece un trigger ni una forma automática de crear esa fila — por diseño,
-- el alta de staff se hace a mano desde el dashboard, y cada vez que se
-- incorpora un nuevo miembro se repite el mismo patrón manual documentado
-- acá:
--
--   1. Crear el usuario en Authentication → Users del dashboard de
--      Supabase (con su email y contraseña, o invitación por email).
--   2. Buscar su uuid con la consulta de la sección A de abajo.
--   3. Insertar la fila en staff_users con ese uuid y el rol que le
--      corresponda, usando la sección B como modelo.
--
-- Motivo de por qué es manual y no automático: staff_users.rol distingue
-- 'admin' de 'panelista', una decisión de negocio que no puede inferirse
-- del alta en Auth — alguien con criterio (hoy, un admin operando el
-- dashboard) tiene que asignarla explícitamente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. Buscar el uuid de un usuario ya creado en Auth, por su email
--
-- El dashboard de Authentication → Users no siempre deja copiar el uuid
-- cómodamente desde la lista; esta consulta es la forma rápida de
-- obtenerlo. Correr en el SQL Editor del dashboard (requiere permisos sobre
-- el schema auth, que el SQL Editor tiene).
-- -----------------------------------------------------------------------------

select id, email
from auth.users
where email = 'mejias1405qgmail.com';


-- -----------------------------------------------------------------------------
-- B. Vincular el usuario a staff_users con su rol
--
-- Reemplazar el placeholder por el uuid obtenido en el paso A, y 'admin'
-- por 'panelista' si corresponde (son los dos únicos valores permitidos por
-- el check de staff_users.rol; ver supabase/schema.sql).
-- -----------------------------------------------------------------------------

insert into staff_users (id, rol)
values ('ab9c218f-ce50-4066-b2d2-3f7e14c2870b', 'admin');

-- insert into staff_users (id, rol)
-- values ('<uuid del usuario en auth.users>', 'panelista');

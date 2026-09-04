-- =============================================================================
-- Seminario Q&A — buscar_asistente(): case-insensitive + nombre de organización
--
-- Contexto: app/preguntar/[qr_slug] (formulario público de preguntas) permite
-- identificarse con "email o código de acceso" sin importar mayúsculas, y
-- debe mostrar "Hola, [nombre] ([organización])" sin tener acceso directo a
-- la tabla "organizations" (no tiene política de SELECT para "anon").
--
-- Cambios sobre la versión original de buscar_asistente() (schema.sql):
--   1. Comparación case-insensitive: lower(email) / upper(access_code),
--      con trim() del identificador recibido.
--   2. Se agrega la columna organization_nombre (via left join a
--      organizations), resuelta acá adentro porque la función es
--      SECURITY DEFINER y bypassa RLS.
--
-- Como cambia la forma del RETURNS TABLE, no alcanza con CREATE OR REPLACE
-- (Postgres no permite cambiar la lista de columnas de retorno de una
-- función existente): hay que borrarla y recrearla.
--
-- Este archivo es la migración a correr AHORA sobre el proyecto ya
-- desplegado (schema.sql ya se corrió una vez). El mismo contenido ya quedó
-- incorporado en supabase/schema.sql para que una instalación nueva desde
-- cero lo tenga de entrada.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

drop function if exists buscar_asistente(text);

create or replace function buscar_asistente(identificador text)
returns table (
  id                  uuid,
  nombre              text,
  email               text,
  organization_id     uuid,
  organization_nombre text,
  status              text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nombre, a.email, a.organization_id, o.nombre, a.status
  from attendees a
  left join organizations o on o.id = a.organization_id
  where lower(a.email) = lower(trim(identificador))
     or upper(a.access_code) = upper(trim(identificador))
  limit 1;
$$;

grant execute on function buscar_asistente(text) to anon, authenticated;

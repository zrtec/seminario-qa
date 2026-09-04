-- =============================================================================
-- Seminario Q&A — Check-in en vivo: registrar a alguien que no está en la lista
--
-- Caso "no está en la lista": la pantalla de check-in en vivo
-- (app/admin/checkin/page.tsx) permite dar de alta a un asistente que no
-- fue cargado por CSV, directamente con status 'presente'. Reutiliza
-- generar_access_code() (definida en importar_asistentes_csv.sql / schema.sql)
-- y repite la misma validación de organización existente / email no
-- duplicado que importar_asistentes(), pero para una sola fila. Se hace como
-- función (en vez de un INSERT suelto desde el route handler) para que la
-- generación del access_code sin colisión y el INSERT ocurran en la misma
-- transacción, con la misma garantía de atomicidad que el resto de las
-- funciones del proyecto.
--
-- Requiere que generar_access_code() ya exista (correr
-- importar_asistentes_csv.sql antes que este archivo si todavía no se corrió).
--
-- Este archivo es la migración a correr AHORA sobre el proyecto ya
-- desplegado (schema.sql ya se corrió una vez). El mismo contenido ya quedó
-- incorporado en supabase/schema.sql para que una instalación nueva desde
-- cero lo tenga de entrada.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

create or replace function checkin_registrar_asistente(
  p_nombre text,
  p_email text,
  p_organization_id uuid
)
returns attendees
language plpgsql
set search_path = public
as $$
declare
  v_nombre      text := trim(p_nombre);
  v_email       text := trim(p_email);
  v_access_code text;
  v_intentos    int := 0;
  v_asistente   attendees;
begin
  if v_nombre is null or v_nombre = '' then
    raise exception 'El nombre es requerido.';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'El email es requerido.';
  end if;
  if p_organization_id is null then
    raise exception 'La organización es requerida.';
  end if;
  if not exists (select 1 from organizations where id = p_organization_id) then
    raise exception 'La organización % no existe.', p_organization_id;
  end if;
  if exists (select 1 from attendees where lower(email) = lower(v_email)) then
    raise exception 'El email % ya existe en el sistema.', v_email;
  end if;

  loop
    v_access_code := generar_access_code();
    exit when not exists (select 1 from attendees where access_code = v_access_code);
    v_intentos := v_intentos + 1;
    if v_intentos > 20 then
      raise exception 'No se pudo generar un access_code único tras % intentos.', v_intentos;
    end if;
  end loop;

  insert into attendees (nombre, email, organization_id, access_code, status)
  values (v_nombre, v_email, p_organization_id, v_access_code, 'presente')
  returning * into v_asistente;

  return v_asistente;
end;
$$;

-- TEMPORAL: se llama solo desde app/api/admin/checkin/registrar/route.ts
-- con getSupabaseAdmin() (service_role). Ver la misma nota en
-- activar_conferencia() (conferencia_activa_unica.sql / schema.sql).
grant execute on function checkin_registrar_asistente(text, text, uuid) to service_role;

-- =============================================================================
-- Seminario Q&A — Importación masiva de asistentes (carga CSV)
--
-- Regla de negocio: la importación de un lote de asistentes debe ser
-- todo-o-nada. Si una fila falla (organización inexistente, email ya
-- existente, etc.) a mitad del lote, no debe quedar ningún INSERT parcial.
--
-- El cuerpo de una función plpgsql se ejecuta como una única transacción
-- implícita: si se levanta una excepción sin capturarla, Postgres revierte
-- todo el trabajo hecho dentro de esa invocación (mismo principio que
-- activar_conferencia() en conferencia_activa_unica.sql / schema.sql).
--
-- La vista previa del lado del cliente (app/admin/asistentes/page.tsx) ya
-- valida cada fila contra un snapshot de organizations/attendees antes de
-- confirmar, pero esa validación puede quedar desactualizada entre la
-- previsualización y la confirmación (alguien borra una organización, otro
-- admin carga un asistente con el mismo email, etc.). Por eso esta función
-- vuelve a validar todo puertas adentro, en la misma transacción que hace
-- los INSERT, para que la garantía real no dependa del cliente.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase (después, o junto con, schema.sql).
-- =============================================================================

create or replace function generar_access_code()
returns text
language plpgsql
as $$
declare
  v_chars   text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_codigo  text := '';
  i         int;
begin
  for i in 1..6 loop
    v_codigo := v_codigo || substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1);
  end loop;
  return v_codigo;
end;
$$;

-- p_asistentes: jsonb array de objetos {nombre, email, organization_id}.
-- El organization_nombre del CSV es solo verificación cruzada del lado del
-- cliente (para que quien arma el CSV note a simple vista si el id apunta a
-- la organización equivocada); no viaja hasta acá ni se usa para resolver
-- la relación, que se hace exclusivamente por organization_id.
create or replace function importar_asistentes(p_asistentes jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_item             jsonb;
  v_nombre           text;
  v_email            text;
  v_organization_id  uuid;
  v_access_code      text;
  v_intentos         int;
begin
  if exists (
    select 1
    from jsonb_array_elements(p_asistentes) e
    group by lower(trim(e ->> 'email'))
    having count(*) > 1
  ) then
    raise exception 'Hay emails duplicados dentro del lote a importar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_asistentes)
  loop
    v_nombre := trim(v_item ->> 'nombre');
    v_email := trim(v_item ->> 'email');
    v_organization_id := nullif(v_item ->> 'organization_id', '')::uuid;

    if v_nombre is null or v_nombre = '' or v_email is null or v_email = ''
       or v_organization_id is null then
      raise exception 'Fila con campos faltantes: %', v_item;
    end if;

    if not exists (select 1 from organizations where id = v_organization_id) then
      raise exception 'La organización % no existe.', v_organization_id;
    end if;

    if exists (select 1 from attendees where lower(email) = lower(v_email)) then
      raise exception 'El email % ya existe en el sistema.', v_email;
    end if;

    v_intentos := 0;
    loop
      v_access_code := generar_access_code();
      exit when not exists (select 1 from attendees where access_code = v_access_code);
      v_intentos := v_intentos + 1;
      if v_intentos > 20 then
        raise exception 'No se pudo generar un access_code único tras % intentos.', v_intentos;
      end if;
    end loop;

    insert into attendees (nombre, email, organization_id, access_code, status)
    values (v_nombre, v_email, v_organization_id, v_access_code, 'precargado');
  end loop;
end;
$$;

-- TEMPORAL: se llaman solo desde
-- app/api/admin/asistentes/import/route.ts con getSupabaseAdmin()
-- (service_role), igual que el resto de app/api/admin/**. Ver la misma nota
-- sobre grants explícitos a service_role en supabase/grants_service_role.sql.
grant execute on function generar_access_code() to service_role;
grant execute on function importar_asistentes(jsonb) to service_role;

-- =============================================================================
-- Seminario Q&A — Schema inicial (Supabase / Postgres)
-- Generado a partir de seminario-qa-arquitectura.md (sección 4)
--
-- Este archivo NO se ha ejecutado. Revisar y correr manualmente en el
-- SQL Editor de Supabase (Dashboard → SQL Editor → New query).
-- =============================================================================

-- Necesario para gen_random_uuid()
create extension if not exists pgcrypto;

-- =============================================================================
-- 1. TABLAS
-- =============================================================================

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
create table if not exists organizations (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  es_estrategica boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- attendees
-- ----------------------------------------------------------------------------
create table if not exists attendees (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  email           text not null,
  access_code     text not null unique,
  organization_id uuid references organizations (id) on delete set null,
  status          text not null default 'precargado'
                    check (status in ('precargado', 'presente')),
  created_at      timestamptz not null default now()
);

create index if not exists attendees_organization_id_idx on attendees (organization_id);
create index if not exists attendees_email_idx on attendees (lower(email));

-- ----------------------------------------------------------------------------
-- staff_users
-- Vinculada 1:1 a Supabase Auth: el id de la fila ES el id de auth.users.
-- ----------------------------------------------------------------------------
create table if not exists staff_users (
  id         uuid primary key references auth.users (id) on delete cascade,
  rol        text not null check (rol in ('admin', 'panelista')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- conferences
-- ----------------------------------------------------------------------------
create table if not exists conferences (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  categoria     text,
  ponente       text,
  resumen       text,
  presentacion_url text, -- ruta opcional en Supabase Storage
  qr_slug       text not null unique,
  activa        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Invariante de negocio: como máximo una conferencia activa a la vez en todo
-- el sistema. Este índice único parcial es la garantía real, a nivel de
-- Postgres, de esa regla: ni un bug en el código de la app, ni un UPDATE
-- manual desde el SQL Editor, ni un futuro desarrollador que edite el route
-- handler sin conocer la regla pueden dejar dos filas con activa = true —
-- Postgres directamente rechaza la operación con un error de constraint.
-- Confiar solo en lógica de aplicación (desactivar todas + activar la
-- elegida) sin este índice deja la invariante rota ante el primer código que
-- la toque sin saberlo; con el índice, es imposible violarla aunque el
-- código de arriba cambie o se llame mal.
create unique index if not exists conferences_una_activa_idx
  on conferences (activa)
  where activa = true;

-- ----------------------------------------------------------------------------
-- questions
-- ----------------------------------------------------------------------------
create table if not exists questions (
  id                  uuid primary key default gen_random_uuid(),
  texto               text not null,
  conference_id       uuid not null references conferences (id) on delete cascade,
  attendee_id         uuid not null references attendees (id) on delete cascade,
  ai_status           text not null default 'pendiente'
                         check (ai_status in ('pendiente', 'rechazada', 'aprobada')),
  ai_relevance_score  numeric,
  mostrada_en_pantalla boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists questions_conference_id_idx on questions (conference_id);
create index if not exists questions_attendee_id_idx on questions (attendee_id);
create index if not exists questions_ai_status_idx on questions (ai_status);

-- =============================================================================
-- 2. FUNCIONES AUXILIARES PARA RLS
--
-- Se definen como SECURITY DEFINER para poder consultar staff_users sin
-- quedar atrapadas en su propia política RLS (evita recursión) y para que
-- cualquier política que las use no tenga que exponer staff_users por sí
-- misma.
-- =============================================================================

create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff_users where id = auth.uid()
  );
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff_users where id = auth.uid() and rol = 'admin'
  );
$$;

-- =============================================================================
-- 3. RLS: HABILITAR EN LAS 5 TABLAS
-- =============================================================================

alter table organizations enable row level security;
alter table attendees      enable row level security;
alter table staff_users    enable row level security;
alter table conferences    enable row level security;
alter table questions      enable row level security;

-- =============================================================================
-- 4. POLÍTICAS RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- conferences
-- Lectura pública SOLO de conferencias activas (para el QR / formulario y el
-- kiosko). Escritura (insert/update/delete) solo para admin autenticado.
-- -----------------------------------------------------------------------------
create policy "conferences_select_publico_activas"
  on conferences for select
  to anon, authenticated
  using (activa = true);

create policy "conferences_select_staff_todas"
  on conferences for select
  to authenticated
  using (is_staff()); -- staff (admin o panelista) puede ver también las inactivas

create policy "conferences_insert_admin"
  on conferences for insert
  to authenticated
  with check (is_admin());

create policy "conferences_update_admin"
  on conferences for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "conferences_delete_admin"
  on conferences for delete
  to authenticated
  using (is_admin());

-- -----------------------------------------------------------------------------
-- organizations
-- Sin acceso público directo. Solo backend (service_role, que ignora RLS) o
-- admin autenticado. No se crea ninguna política para el rol "anon".
-- -----------------------------------------------------------------------------
create policy "organizations_select_admin"
  on organizations for select
  to authenticated
  using (is_admin());

create policy "organizations_insert_admin"
  on organizations for insert
  to authenticated
  with check (is_admin());

create policy "organizations_update_admin"
  on organizations for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "organizations_delete_admin"
  on organizations for delete
  to authenticated
  using (is_admin());

-- -----------------------------------------------------------------------------
-- attendees
--
-- IMPORTANTE: una política RLS de SELECT es una condición por fila, no un
-- filtro sobre la consulta del cliente. Una política "el público puede leer
-- si email = ... o access_code = ..." con USING(true) permitiría, en la
-- práctica, listar TODA la tabla (nombres, emails y access_code de todos los
-- asistentes), porque el cliente podría omitir el WHERE. Como access_code
-- funciona como credencial de acceso, esto sería un problema de seguridad.
--
-- Por eso NO se expone la tabla directamente a "anon": la búsqueda pública
-- por email o código se resuelve con la función buscar_asistente() (más
-- abajo), definida SECURITY DEFINER, que sí obliga a pasar un identificador
-- exacto y devuelve solo los campos necesarios para autocompletar el
-- formulario (no el access_code).
--
-- Escritura: solo admin (carga de CSV, check-in) o vía función controlada.
-- -----------------------------------------------------------------------------
create policy "attendees_select_staff"
  on attendees for select
  to authenticated
  using (is_staff()); -- admin (check-in) y panelista (si necesitara ver datos)

create policy "attendees_insert_admin"
  on attendees for insert
  to authenticated
  with check (is_admin());

create policy "attendees_update_admin"
  on attendees for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "attendees_delete_admin"
  on attendees for delete
  to authenticated
  using (is_admin());

-- Función controlada de búsqueda pública por email o access_code.
-- Se ejecuta con privilegios del owner (bypassa RLS) pero solo devuelve
-- una fila que coincida exactamente (case-insensitive), y nunca el
-- access_code en la salida. Incluye organization_nombre resuelto acá
-- adentro (SECURITY DEFINER) porque "organizations" no tiene política de
-- SELECT para "anon": el formulario público (app/preguntar) no podría
-- leerla por su cuenta para mostrar "Hola, X (organización)".
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

-- -----------------------------------------------------------------------------
-- questions
-- Público: puede INSERTAR preguntas (siempre en estado "pendiente", sin
-- marcar como mostrada, para que no pueda saltarse la moderación de IA).
-- Público: puede LEER solo preguntas aprobadas y marcadas para pantalla.
-- Staff (admin/panelista) autenticado: lectura completa (el panel filtra por
-- organización estratégica y ordena por relevancia en la propia consulta).
-- Actualización (ai_status, score, mostrada_en_pantalla): admin, o la Edge
-- Function de moderación que usa la service_role key (bypassa RLS).
-- -----------------------------------------------------------------------------
create policy "questions_insert_publico"
  on questions for insert
  to anon, authenticated
  with check (
    ai_status = 'pendiente'
    and mostrada_en_pantalla = false
  );

create policy "questions_select_publico_aprobadas"
  on questions for select
  to anon, authenticated
  using (
    ai_status = 'aprobada'
    and mostrada_en_pantalla = true
  );

create policy "questions_select_staff_todas"
  on questions for select
  to authenticated
  using (is_staff());

create policy "questions_update_admin"
  on questions for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "questions_delete_admin"
  on questions for delete
  to authenticated
  using (is_admin());

-- -----------------------------------------------------------------------------
-- staff_users
-- Sin acceso público. Cada staff puede leer únicamente su propia fila (para
-- que el frontend sepa su rol tras el login); is_admin()/is_staff() ya no
-- dependen de esta política porque son SECURITY DEFINER. La gestión de
-- staff (alta/baja/cambio de rol) se hace por admin o backend.
-- -----------------------------------------------------------------------------
create policy "staff_users_select_propio"
  on staff_users for select
  to authenticated
  using (id = auth.uid());

create policy "staff_users_select_admin"
  on staff_users for select
  to authenticated
  using (is_admin());

create policy "staff_users_insert_admin"
  on staff_users for insert
  to authenticated
  with check (is_admin());

create policy "staff_users_update_admin"
  on staff_users for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "staff_users_delete_admin"
  on staff_users for delete
  to authenticated
  using (is_admin());

-- =============================================================================
-- 5. FUNCIÓN: activar una conferencia en exclusividad
--
-- El índice único parcial conferences_una_activa_idx (sección 1) es quien
-- impide de verdad que existan dos filas con activa = true; esta función es
-- la forma correcta de respetarlo al cambiar cuál conferencia está activa,
-- encapsulando "desactivar todas las demás + activar esta" en una sola
-- transacción implícita (el cuerpo de una función se ejecuta atómicamente).
-- Así, dos requests concurrentes de activación nunca dejan el sistema en un
-- estado intermedio con dos activas, y ninguna de las dos puede pisar el
-- UPDATE de la otra a mitad de camino.
-- =============================================================================

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
-- (service_role), igual que el resto de app/api/admin/**. No se le otorga a
-- "authenticated" todavía porque, sin Supabase Auth, no hay forma de
-- distinguir admin de panelista acá dentro; cuando se agregue Auth, sumar
-- "and is_admin()" al chequeo de arriba y recién ahí dar grant a
-- "authenticated".
grant execute on function activar_conferencia(uuid) to service_role;

-- =============================================================================
-- 6. FUNCIÓN: importación masiva de asistentes (carga CSV), todo-o-nada
--
-- Mismo principio que activar_conferencia(): el cuerpo de una función
-- plpgsql es una única transacción implícita, así que si una fila del lote
-- falla a mitad de camino, Postgres revierte todos los INSERT ya hechos por
-- esa invocación. Ver el detalle de motivación en
-- supabase/importar_asistentes_csv.sql (migración incremental equivalente
-- para un proyecto ya desplegado).
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
-- cliente; no viaja hasta acá ni se usa para resolver la relación, que se
-- hace exclusivamente por organization_id.
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

-- TEMPORAL: se llaman solo desde app/api/admin/asistentes/import/route.ts
-- con getSupabaseAdmin() (service_role). Ver la misma nota en
-- activar_conferencia() más arriba.
grant execute on function generar_access_code() to service_role;
grant execute on function importar_asistentes(jsonb) to service_role;

-- =============================================================================
-- 7. FUNCIÓN: registrar en el check-in a alguien que no estaba precargado
--
-- Caso "no está en la lista": la pantalla de check-in en vivo
-- (app/admin/checkin/page.tsx) permite dar de alta a un asistente que no
-- fue cargado por CSV, directamente con status 'presente'. Reutiliza
-- generar_access_code() y repite la misma validación de organización
-- existente / email no duplicado que importar_asistentes(), pero para una
-- sola fila. Se hace como función (en vez de un INSERT suelto desde el
-- route handler) para que la generación del access_code sin colisión y el
-- INSERT ocurran en la misma transacción, con la misma garantía de
-- atomicidad que el resto de las funciones de este archivo.
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
-- activar_conferencia() más arriba.
grant execute on function checkin_registrar_asistente(text, text, uuid) to service_role;

-- =============================================================================
-- 8. FUNCIONES: preguntas para la pantalla kiosko, con nombre de asistente
--
-- app/admin/pantalla/[qr_slug] necesita el nombre del asistente junto a cada
-- pregunta aprobada, pero "anon" no tiene (ni debe tener) GRANT SELECT sobre
-- "attendees" (ver supabase/grants.sql: la tabla tiene email/access_code).
-- Mismo patrón que buscar_asistente(): SECURITY DEFINER, hace el join
-- puertas adentro y devuelve solo id/texto/created_at/nombre.
-- =============================================================================

create or replace function preguntas_pantalla(
  p_conference_id uuid,
  p_limite integer default 30
)
returns table (
  id         uuid,
  texto      text,
  created_at timestamptz,
  nombre     text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.conference_id = p_conference_id
    and q.ai_status = 'aprobada'
    and q.mostrada_en_pantalla = true
  order by q.created_at desc
  limit p_limite;
$$;

grant execute on function preguntas_pantalla(uuid, integer) to anon, authenticated;

-- Usada por el handler de Realtime en PantallaKiosko.tsx: trae una sola
-- fila puntual (con nombre) cuando una pregunta pasa a aprobada.
create or replace function pregunta_pantalla_por_id(p_id uuid)
returns table (
  id         uuid,
  texto      text,
  created_at timestamptz,
  nombre     text
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.texto, q.created_at, a.nombre
  from questions q
  join attendees a on a.id = q.attendee_id
  where q.id = p_id
    and q.ai_status = 'aprobada'
    and q.mostrada_en_pantalla = true
  limit 1;
$$;

grant execute on function pregunta_pantalla_por_id(uuid) to anon, authenticated;

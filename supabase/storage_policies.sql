-- =============================================================================
-- Seminario Q&A — Políticas de Storage para el bucket "presentaciones"
--
-- Contexto: Storage tiene su propio sistema de RLS sobre storage.objects,
-- independiente del RLS de las tablas de "public" (ver schema.sql / grants.sql
-- / grants_service_role.sql). El bucket "presentaciones" ya existe y está
-- marcado como público de lectura a nivel de bucket, pero storage.objects
-- tiene RLS habilitado por Supabase por defecto: sin una política explícita
-- de SELECT, las consultas directas a storage.objects fallarían igual que
-- fallaría una tabla de public sin GRANT/policy. Se agrega explícitamente
-- para dejarlo a prueba de que la config del bucket cambie.
--
-- Escritura: la subida de presentaciones se hace SIEMPRE desde
-- app/api/admin/conferences/upload/route.ts, un Route Handler que usa
-- getSupabaseAdmin() (service_role). service_role bypassea el RLS de
-- storage.objects igual que bypassea el de las tablas de public, así que
-- NO se crea ninguna política de INSERT/UPDATE/DELETE para "anon" ni
-- "authenticated": mientras no exista Supabase Auth para staff, permitir la
-- subida directa desde el navegador con la anon key dejaría el bucket
-- abierto a que cualquier visitante suba archivos.
--
-- No se ha ejecutado. Revisar y correr manualmente en el SQL Editor de
-- Supabase.
-- =============================================================================

create policy "presentaciones_select_publico"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'presentaciones');

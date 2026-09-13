-- =============================================================================
-- Seminario Q&A — Seed de datos para pruebas integrales
--
-- Este archivo NO se ejecuta automáticamente. Revisar antes de correrlo a
-- mano en el SQL Editor de Supabase (Dashboard → SQL Editor → New query).
--
-- Crea un escenario limpio y realista para probar de punta a punta:
--   1. Una conferencia activa con tema específico (para que el scoring de
--      relevancia de Gemini tenga contexto real contra el que comparar).
--   2. Dos organizaciones (una estratégica, una no) para poder probar el
--      Panel de Expertos (preguntas_panel_estrategicas / _respaldo).
--   3. Seis asistentes ya con status = 'presente' (3 por organización) para
--      poder probar el formulario de preguntas sin pasar por check-in.
--
-- Idempotencia: este script NO es re-ejecutable tal cual sin duplicar datos.
-- qr_slug y access_code tienen constraint unique, así que correrlo dos veces
-- fallará en el segundo intento (columnas duplicadas) — lo cual es la señal
-- correcta de "ya corriste este seed". Si querés recrear el escenario desde
-- cero, borrá primero las filas creadas (ver bloque de limpieza comentado al
-- final del archivo) y volvé a correr este script.
--
-- activar_conferencia() se usa (en vez de un INSERT con activa=true directo)
-- porque el índice único parcial conferences_una_activa_idx (schema.sql,
-- sección 1) rechaza el INSERT si ya hay otra conferencia activa en el
-- sistema. La función desactiva cualquier otra activa y activa esta en la
-- misma transacción — mismo patrón que usa el admin real.
-- =============================================================================

-- Todo el seed va en un solo bloque plpgsql (en vez de psql \gset, que NO
-- funciona en el SQL Editor de Supabase, solo en el cliente psql) para poder
-- encadenar los id generados por gen_random_uuid() de una tabla a la
-- siguiente sin salir de SQL puro. El cuerpo de un bloque DO es una única
-- transacción implícita: si algo falla a mitad de camino (p. ej. un
-- access_code ya usado de una corrida anterior), no queda nada a medio
-- insertar.
do $$
declare
  v_conference_id         uuid;
  v_org_estrategica_id    uuid;
  v_org_no_estrategica_id uuid;
begin
  -- ---------------------------------------------------------------------
  -- 1. Conferencia
  --
  -- Tema específico y acotado a propósito ("adopción de IA en la gestión
  -- de riesgo crediticio de bancos regionales") para que, al probar el
  -- formulario de preguntas, se pueda evaluar si el scoring de relevancia
  -- de Gemini distingue bien entre una pregunta on-topic ("¿cómo evalúan
  -- el riesgo de overfitting en los modelos de scoring?") y una fuera de
  -- tema ("¿cuál es el mejor framework de frontend?").
  --
  -- Se inserta con activa = false y se activa después vía
  -- activar_conferencia(): el índice único parcial
  -- conferences_una_activa_idx (schema.sql, sección 1) rechaza el INSERT
  -- si ya hay otra conferencia activa en el sistema, y esa función es la
  -- forma correcta de desactivar cualquier otra + activar esta en la
  -- misma transacción (mismo patrón que usa el admin real).
  -- ---------------------------------------------------------------------
  insert into conferences (titulo, categoria, ponente, resumen, qr_slug, activa)
  values (
    'Inteligencia artificial aplicada a la gestión de riesgo crediticio en bancos regionales',
    'Finanzas y Tecnología',
    'Dra. Marina Sotelo, Chief Risk Officer en Grupo Financiero Andino',
    'Un recorrido práctico por cómo los bancos regionales están incorporando '
    || 'modelos de machine learning en sus procesos de scoring crediticio: '
    || 'qué datos alternativos se están usando (comportamiento transaccional, '
    || 'huella digital, historial de pagos de servicios), cómo se mitiga el '
    || 'riesgo de sesgo y overfitting en los modelos, qué exige la regulación '
    || 'vigente en materia de explicabilidad (modelos "caja negra" vs. '
    || 'interpretables), y casos reales de reducción de mora en carteras de '
    || 'consumo tras la migración de reglas fijas a modelos de ML.',
    'ia-riesgo-crediticio-bancos-2026',
    false
  )
  returning id into v_conference_id;

  perform activar_conferencia(v_conference_id);

  -- ---------------------------------------------------------------------
  -- 2. Organizaciones
  -- ---------------------------------------------------------------------
  insert into organizations (nombre, es_estrategica)
  values ('Banco Andino S.A.', true)
  returning id into v_org_estrategica_id;

  insert into organizations (nombre, es_estrategica)
  values ('Cámara de Comercio de Villa Norte', false)
  returning id into v_org_no_estrategica_id;

  -- ---------------------------------------------------------------------
  -- 3. Asistentes (todos con status = 'presente', sin pasar por check-in)
  --
  -- access_code fijos (no generados con generar_access_code()) a
  -- propósito, para poder usarlos directamente en las pruebas sin tener
  -- que ir a consultarlos en la base después de correr el script.
  -- ---------------------------------------------------------------------

  -- 3 asistentes de la organización ESTRATÉGICA (Banco Andino S.A.)
  insert into attendees (nombre, email, access_code, organization_id, status)
  values
    ('Lucía Fernández', 'lucia.fernandez@bancoandino.test', 'BAN001', v_org_estrategica_id, 'presente'),
    ('Rodrigo Paredes', 'rodrigo.paredes@bancoandino.test', 'BAN002', v_org_estrategica_id, 'presente'),
    ('Valentina Gómez', 'valentina.gomez@bancoandino.test', 'BAN003', v_org_estrategica_id, 'presente');

  -- 3 asistentes de la organización NO estratégica (Cámara de Comercio de Villa Norte)
  insert into attendees (nombre, email, access_code, organization_id, status)
  values
    ('Martín Ibarra', 'martin.ibarra@camaravn.test', 'CVN001', v_org_no_estrategica_id, 'presente'),
    ('Sofía Castro', 'sofia.castro@camaravn.test', 'CVN002', v_org_no_estrategica_id, 'presente'),
    ('Diego Ramírez', 'diego.ramirez@camaravn.test', 'CVN003', v_org_no_estrategica_id, 'presente');
end $$;

-- =============================================================================
-- Resumen de acceso para pruebas (también recuperable después con el SELECT
-- de más abajo, por si esta salida no quedó visible):
--
-- Conferencia activa: "IA aplicada a la gestión de riesgo crediticio en
-- bancos regionales" — qr_slug = ia-riesgo-crediticio-bancos-2026
--
-- Organización ESTRATÉGICA — Banco Andino S.A.
--   access_code BAN001 — Lucía Fernández  — lucia.fernandez@bancoandino.test
--   access_code BAN002 — Rodrigo Paredes  — rodrigo.paredes@bancoandino.test
--   access_code BAN003 — Valentina Gómez  — valentina.gomez@bancoandino.test
--
-- Organización NO estratégica — Cámara de Comercio de Villa Norte
--   access_code CVN001 — Martín Ibarra   — martin.ibarra@camaravn.test
--   access_code CVN002 — Sofía Castro    — sofia.castro@camaravn.test
--   access_code CVN003 — Diego Ramírez   — diego.ramirez@camaravn.test
--
-- El formulario público de preguntas (buscar_asistente) acepta indistintamente
-- email o access_code como identificador.
-- =============================================================================

-- select a.nombre, a.email, a.access_code, o.nombre as organizacion, o.es_estrategica, a.status
-- from attendees a
-- join organizations o on o.id = a.organization_id
-- where a.email like '%.test'
-- order by o.es_estrategica desc, a.nombre;

-- =============================================================================
-- Limpieza (comentado a propósito — descomentar y correr manualmente si se
-- quiere borrar este escenario de prueba antes de recrearlo):
--
-- delete from attendees where email like '%@bancoandino.test' or email like '%@camaravn.test';
-- delete from organizations where nombre in ('Banco Andino S.A.', 'Cámara de Comercio de Villa Norte');
-- delete from conferences where qr_slug = 'ia-riesgo-crediticio-bancos-2026';
-- =============================================================================

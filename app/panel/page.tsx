"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CerrarSesionButton } from "@/components/CerrarSesionButton";

type Conference = {
  id: string;
  titulo: string;
  activa: boolean;
};

type PreguntaPanel = {
  id: string;
  texto: string;
  texto_corregido: string | null;
  created_at: string;
  nombre: string;
  nombre_organizacion: string | null;
  ai_relevance_score: number | string | null;
  preseleccionada: boolean;
  mostrada_al_ponente: boolean;
};

function formatearScore(score: PreguntaPanel["ai_relevance_score"]) {
  if (score === null || score === undefined) return null;
  const n = typeof score === "string" ? parseFloat(score) : score;
  if (Number.isNaN(n)) return null;
  return `${Math.round(n)}/100`;
}

function PreguntaCard({
  pregunta,
  procesando,
  onTogglePreseleccion,
  onElegir,
}: {
  pregunta: PreguntaPanel;
  procesando: boolean;
  onTogglePreseleccion: (id: string) => void;
  onElegir: (pregunta: PreguntaPanel) => void;
}) {
  const score = formatearScore(pregunta.ai_relevance_score);
  const preseleccionada = pregunta.preseleccionada;

  return (
    <li
      className={`flex flex-col gap-4 rounded-2xl border-2 p-5 transition sm:p-6 ${
        preseleccionada ? "border-[#cfe0ea] bg-[#eef4f8]" : "border-zinc-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {score && (
          <span className="rounded-full bg-[#22516C] px-3 py-1.5 text-sm font-bold text-white">
            {score}
          </span>
        )}
        {pregunta.mostrada_al_ponente && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#22516C] px-3 py-1.5 text-xs font-bold tracking-wide text-white uppercase">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: "#7CF29C" }}
              aria-hidden="true"
            />
            En pantalla ahora
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-lg leading-snug font-bold text-zinc-900 sm:text-xl">
          {pregunta.texto_corregido ?? pregunta.texto}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          {pregunta.nombre}
          {pregunta.nombre_organizacion ? ` · ${pregunta.nombre_organizacion}` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onTogglePreseleccion(pregunta.id)}
          disabled={procesando}
          aria-pressed={preseleccionada}
          aria-label={preseleccionada ? "Quitar preselección" : "Preseleccionar pregunta"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 bg-white px-5 py-4 text-base font-semibold transition disabled:opacity-50 ${
            preseleccionada ? "border-[#4472C4] text-[#4472C4]" : "border-[#d9d9d9] text-[#8c8c8c]"
          }`}
        >
          <span className="text-xl leading-none">{preseleccionada ? "★" : "☆"}</span>
          {preseleccionada ? "Preseleccionada" : "Preseleccionar"}
        </button>

        <button
          type="button"
          onClick={() => onElegir(pregunta)}
          disabled={procesando}
          className="flex-1 rounded-xl bg-[#22516C] px-5 py-4 text-base font-semibold text-white transition disabled:opacity-50"
        >
          {pregunta.mostrada_al_ponente ? "Volver a elegir" : "Elegir para el ponente"}
        </button>
      </div>
    </li>
  );
}

export default function PanelPage() {
  // Cliente SSR (cookies), NO el plano de lib/supabase.ts: los RPC de acá
  // abajo (preguntas_panel_*, togglear_preseleccion,
  // elegir_pregunta_al_ponente) van a requerir sesión de staff a nivel de
  // Postgres (is_staff()) — ver supabase/endurecer_permisos_staff.sql. El
  // cliente plano nunca lleva el JWT del login (sesión en localStorage vs.
  // cookies, storages separados), así que con él estas llamadas
  // funcionarían siempre como "anon" sin importar si hay sesión iniciada.
  const supabase = useMemo(() => createClient(), []);

  const [conferences, setConferences] = useState<Conference[]>([]);
  const [conferenceId, setConferenceId] = useState<string | null>(null);
  const [cargandoConferences, setCargandoConferences] = useState(true);
  const [errorConferences, setErrorConferences] = useState<string | null>(null);

  const [estrategicas, setEstrategicas] = useState<PreguntaPanel[]>([]);
  const [respaldo, setRespaldo] = useState<PreguntaPanel[]>([]);
  const [cargandoPreguntas, setCargandoPreguntas] = useState(false);
  const [errorPreguntas, setErrorPreguntas] = useState<string | null>(null);

  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  // Carga inicial de conferencias vía /api/staff/conferences (admin O
  // panelista, ver lib/auth/require-admin.ts): el panel necesita listar
  // todas para el selector, y "anon" no tiene SELECT directo sobre
  // conferences inactivas (ver conferences_select_publico_activas en
  // schema.sql). Por defecto selecciona la activa, si hay una.
  useEffect(() => {
    async function cargarConferences() {
      setCargandoConferences(true);
      setErrorConferences(null);
      try {
        const res = await fetch("/api/staff/conferences");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Error al cargar conferencias.");
        const lista: Conference[] = body.data ?? [];
        setConferences(lista);
        setConferenceId((actual) => actual ?? lista.find((c) => c.activa)?.id ?? lista[0]?.id ?? null);
      } catch (err) {
        setErrorConferences(err instanceof Error ? err.message : "Error desconocido.");
      } finally {
        setCargandoConferences(false);
      }
    }
    cargarConferences();
  }, []);

  const cargarPreguntas = useCallback(async (cid: string) => {
    setCargandoPreguntas(true);
    setErrorPreguntas(null);
    try {
      const [estRes, respRes] = await Promise.all([
        supabase.rpc("preguntas_panel_estrategicas", { p_conference_id: cid }),
        supabase.rpc("preguntas_panel_respaldo", { p_conference_id: cid }),
      ]);
      if (estRes.error) throw estRes.error;
      if (respRes.error) throw respRes.error;
      setEstrategicas(estRes.data ?? []);
      setRespaldo(respRes.data ?? []);
    } catch (err) {
      setErrorPreguntas(err instanceof Error ? err.message : "Error al cargar las preguntas.");
    } finally {
      setCargandoPreguntas(false);
    }
  }, [supabase]);

  // Al cambiar de conferencia: carga inicial + suscripción Realtime. Ante
  // cualquier cambio en "questions" de esta conferencia (nueva aprobada,
  // preselección togleada, pregunta elegida al aire por otro panelista),
  // se vuelven a pedir las 2 listas completas en vez de mergear a mano,
  // porque el orden por ai_relevance_score puede cambiar con cada evento.
  useEffect(() => {
    if (!conferenceId) return;

    cargarPreguntas(conferenceId);

    const channel = supabase
      .channel(`panel-questions-${conferenceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "questions",
          filter: `conference_id=eq.${conferenceId}`,
        },
        () => cargarPreguntas(conferenceId),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conferenceId, cargarPreguntas, supabase]);

  // Llama la función SECURITY DEFINER con la sesión de staff (requiere
  // is_staff() desde supabase/endurecer_permisos_staff.sql). No hace
  // falta actualizar el estado local a mano: el propio UPDATE dispara el
  // evento de Realtime que ya está escuchado arriba, y ese refetch alcanza
  // también a este mismo cliente.
  async function handleTogglePreseleccion(id: string) {
    setProcesandoId(id);
    try {
      const { error } = await supabase.rpc("togglear_preseleccion", { p_question_id: id });
      if (error) throw error;
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo actualizar la preselección.");
    } finally {
      setProcesandoId(null);
    }
  }

  async function handleElegirAlPonente(pregunta: PreguntaPanel) {
    const confirmado = confirm(
      `¿Mostrar esta pregunta al ponente?\n\n"${pregunta.texto_corregido ?? pregunta.texto}"\n\nEsto reemplaza la pregunta que esté actualmente en pantalla.`,
    );
    if (!confirmado) return;

    setProcesandoId(pregunta.id);
    try {
      const { error } = await supabase.rpc("elegir_pregunta_al_ponente", {
        p_question_id: pregunta.id,
      });
      if (error) throw error;
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo mostrar la pregunta al ponente.");
    } finally {
      setProcesandoId(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#f5f8fa]">
      <header
        style={{ background: "linear-gradient(135deg, #14374A 0%, #22516C 55%, #3E76A0 100%)" }}
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6 sm:px-8">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Panel de Expertos</h1>
          <CerrarSesionButton className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white disabled:opacity-50" />
        </div>

        <div className="mx-auto w-full max-w-5xl px-6 pt-5 pb-6 sm:px-8">
          <div className="w-full rounded-2xl bg-white p-4 shadow-lg sm:max-w-md sm:p-5">
            <label className="text-sm font-medium text-zinc-700" htmlFor="conferencia">
              Conferencia
            </label>
            <select
              id="conferencia"
              value={conferenceId ?? ""}
              onChange={(e) => setConferenceId(e.target.value)}
              disabled={cargandoConferences || conferences.length === 0}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-4 text-lg"
            >
              {conferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titulo}
                  {c.activa ? " (activa)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-6 sm:p-8">
        {errorConferences && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorConferences}
          </div>
        )}
        {errorPreguntas && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorPreguntas}
          </div>
        )}

        {!conferenceId && !cargandoConferences ? (
          <p className="text-zinc-500">No hay conferencias cargadas todavía.</p>
        ) : (
          <>
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-bold tracking-widest text-[#22516C] uppercase sm:text-base">
                Organizaciones estratégicas
              </h2>
              {cargandoPreguntas ? (
                <p className="text-zinc-500">Cargando...</p>
              ) : estrategicas.length === 0 ? (
                <p className="text-zinc-500">
                  No hay preguntas aprobadas de organizaciones estratégicas todavía.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {estrategicas.map((p) => (
                    <PreguntaCard
                      key={p.id}
                      pregunta={p}
                      procesando={procesandoId === p.id}
                      onTogglePreseleccion={handleTogglePreseleccion}
                      onElegir={handleElegirAlPonente}
                    />
                  ))}
                </ul>
              )}
            </section>

            <details className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4" open>
              <summary className="cursor-pointer text-sm font-bold tracking-widest text-[#8c8c8c] uppercase select-none sm:text-base">
                Preguntas de respaldo ({respaldo.length})
              </summary>
              <div className="mt-4">
                {cargandoPreguntas ? (
                  <p className="text-sm text-zinc-500">Cargando...</p>
                ) : respaldo.length === 0 ? (
                  <p className="text-sm text-zinc-500">No hay preguntas de respaldo todavía.</p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {respaldo.map((p) => (
                      <PreguntaCard
                        key={p.id}
                        pregunta={p}
                        procesando={procesandoId === p.id}
                        onTogglePreseleccion={handleTogglePreseleccion}
                        onElegir={handleElegirAlPonente}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </>
        )}
      </main>
    </div>
  );
}

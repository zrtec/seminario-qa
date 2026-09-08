"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Conference = {
  id: string;
  titulo: string;
  activa: boolean;
};

type PreguntaPanel = {
  id: string;
  texto: string;
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

function PreguntaFila({
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

  return (
    <li
      className={`flex flex-col gap-4 rounded-2xl border-2 p-5 transition sm:flex-row sm:items-center sm:justify-between ${
        pregunta.mostrada_al_ponente
          ? "border-green-500 bg-green-50"
          : pregunta.preseleccionada
            ? "border-amber-300 bg-amber-50"
            : "border-zinc-200 bg-white"
      }`}
    >
      <div className="min-w-0 flex-1">
        {pregunta.mostrada_al_ponente && (
          <span className="mb-2 inline-block rounded-full bg-green-600 px-3 py-1 text-xs font-bold tracking-wide text-white uppercase">
            En pantalla ahora
          </span>
        )}
        <p className="text-lg leading-snug font-medium text-zinc-900 sm:text-xl">
          {pregunta.texto}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          {pregunta.nombre}
          {pregunta.nombre_organizacion ? ` · ${pregunta.nombre_organizacion}` : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {score && (
          <span className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-bold text-white">
            {score}
          </span>
        )}

        <button
          type="button"
          onClick={() => onTogglePreseleccion(pregunta.id)}
          disabled={procesando}
          aria-pressed={pregunta.preseleccionada}
          aria-label={pregunta.preseleccionada ? "Quitar preselección" : "Preseleccionar pregunta"}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 text-2xl transition disabled:opacity-50 ${
            pregunta.preseleccionada
              ? "border-amber-400 bg-amber-400 text-white"
              : "border-zinc-300 bg-white text-zinc-400"
          }`}
        >
          {pregunta.preseleccionada ? "★" : "☆"}
        </button>

        <button
          type="button"
          onClick={() => onElegir(pregunta)}
          disabled={procesando || pregunta.mostrada_al_ponente}
          className="shrink-0 rounded-xl bg-zinc-900 px-5 py-4 text-base font-semibold text-white transition disabled:opacity-40"
        >
          {pregunta.mostrada_al_ponente ? "En pantalla" : "Elegir para el ponente"}
        </button>
      </div>
    </li>
  );
}

export default function PanelPage() {
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [conferenceId, setConferenceId] = useState<string | null>(null);
  const [cargandoConferences, setCargandoConferences] = useState(true);
  const [errorConferences, setErrorConferences] = useState<string | null>(null);

  const [estrategicas, setEstrategicas] = useState<PreguntaPanel[]>([]);
  const [respaldo, setRespaldo] = useState<PreguntaPanel[]>([]);
  const [cargandoPreguntas, setCargandoPreguntas] = useState(false);
  const [errorPreguntas, setErrorPreguntas] = useState<string | null>(null);

  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  // Carga inicial de conferencias, resuelta vía el mismo endpoint que ya usa
  // /admin (getSupabaseAdmin(), sin filtro de "activa") — el panel necesita
  // listar todas para el selector, y "anon" no tiene SELECT directo sobre
  // conferences inactivas (ver conferences_select_publico_activas en
  // schema.sql). Por defecto selecciona la activa, si hay una.
  useEffect(() => {
    async function cargarConferences() {
      setCargandoConferences(true);
      setErrorConferences(null);
      try {
        const res = await fetch("/api/admin/conferences");
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
  }, []);

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
  }, [conferenceId, cargarPreguntas]);

  // Llama la función SECURITY DEFINER directo desde el cliente (anon key):
  // ya está otorgado GRANT EXECUTE a "anon" en supabase/panel_expertos.sql,
  // mismo criterio que preguntas_pantalla()/buscar_asistente(). No hace
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
    if (pregunta.mostrada_al_ponente) return;
    const confirmado = confirm(
      `¿Mostrar esta pregunta al ponente?\n\n"${pregunta.texto}"\n\nEsto reemplaza la pregunta que esté actualmente en pantalla.`,
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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-6 sm:p-8">
      <div>
        <h1 className="text-3xl font-semibold">Panel de expertos</h1>
        <p className="mt-1 text-sm text-amber-600">
          ⚠️ Página temporal sin autenticación. El acceso de panelista real se agrega en un paso
          posterior.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-700" htmlFor="conferencia">
          Conferencia
        </label>
        <select
          id="conferencia"
          value={conferenceId ?? ""}
          onChange={(e) => setConferenceId(e.target.value)}
          disabled={cargandoConferences || conferences.length === 0}
          className="w-full rounded-xl border border-zinc-300 px-4 py-4 text-lg sm:max-w-md"
        >
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titulo}
              {c.activa ? " (activa)" : ""}
            </option>
          ))}
        </select>
      </section>

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
            <h2 className="text-xl font-bold text-zinc-900">
              Preguntas de organizaciones estratégicas
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
                  <PreguntaFila
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
            <summary className="cursor-pointer text-base font-semibold text-zinc-600 select-none">
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
                    <PreguntaFila
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
  );
}

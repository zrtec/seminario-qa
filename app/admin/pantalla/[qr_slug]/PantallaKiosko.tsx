"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";

const CICLO_MS = 8_000;
const MAX_PREGUNTAS_EN_CICLO = 30;

type Pregunta = {
  id: string;
  texto: string;
  created_at: string;
  nombre: string;
};

// Forma de la fila cruda de "questions" que llega por Realtime (sin el join
// a attendees: postgres_changes solo manda columnas de la tabla, hay que
// resolver el nombre con una consulta aparte antes de mostrarla).
type PreguntaRow = {
  id: string;
  ai_status: string;
  mostrada_en_pantalla: boolean;
};

export default function PantallaKiosko({
  conferenceId,
  titulo,
  ponente,
  qrSlug,
  preguntasIniciales,
}: {
  conferenceId: string;
  titulo: string;
  ponente: string | null;
  qrSlug: string;
  preguntasIniciales: Pregunta[];
}) {
  const [preguntas, setPreguntas] = useState<Pregunta[]>(preguntasIniciales);
  const [index, setIndex] = useState(0);
  // Se incrementa cada vez que llega una pregunta nueva por Realtime, para
  // reiniciar el temporizador del ciclo y que la nueva pregunta (mostrada de
  // inmediato en el índice 0) tenga su tiempo completo en pantalla en vez de
  // cortarse a mitad de camino por un ciclo ya en curso.
  const [cicloKey, setCicloKey] = useState(0);
  const [urlPreguntar, setUrlPreguntar] = useState<string | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // La URL del QR depende del origin real del deployment, que solo se
  // conoce en el cliente (evita hardcodear localhost o el dominio).
  useEffect(() => {
    setUrlPreguntar(`${window.location.origin}/preguntar/${qrSlug}`);
  }, [qrSlug]);

  useEffect(() => {
    if (preguntas.length === 0) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % preguntas.length);
    }, CICLO_MS);
    return () => clearInterval(id);
  }, [preguntas.length, cicloKey]);

  useEffect(() => {
    async function agregarSiAprobada(fila: PreguntaRow) {
      if (fila.ai_status !== "aprobada" || !fila.mostrada_en_pantalla) return;

      // El payload de Realtime no trae el nombre del asistente; se vuelve a
      // pedir la fila completa vía pregunta_pantalla_por_id() (SECURITY
      // DEFINER, ver supabase/preguntas_pantalla.sql) antes de mostrarla —
      // un select con embed a "attendees" fallaría acá igual que en la
      // carga inicial, porque "anon" no tiene GRANT SELECT sobre esa tabla.
      const { data, error } = await supabase
        .rpc("pregunta_pantalla_por_id", { p_id: fila.id })
        .maybeSingle<Pregunta>();

      if (error) {
        console.error(
          `[pantalla] No se pudo cargar la pregunta ${fila.id} tras el cambio de Realtime:`,
          error,
        );
        return;
      }
      if (!data) return;

      setPreguntas((prev) => {
        if (prev.some((p) => p.id === data.id)) return prev;
        return [data, ...prev].slice(0, MAX_PREGUNTAS_EN_CICLO);
      });
      setIndex(0);
      setCicloKey((k) => k + 1);
    }

    const channel = supabase
      .channel(`pantalla-questions-${conferenceId}`)
      .on<PreguntaRow>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "questions",
          filter: `conference_id=eq.${conferenceId}`,
        },
        (payload) => agregarSiAprobada(payload.new),
      )
      .on<PreguntaRow>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "questions",
          filter: `conference_id=eq.${conferenceId}`,
        },
        (payload) => agregarSiAprobada(payload.new),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conferenceId]);

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await contenedorRef.current?.requestFullscreen();
      setPantallaCompleta(true);
    } else {
      await document.exitFullscreen();
      setPantallaCompleta(false);
    }
  }

  const preguntaActual = preguntas[index] ?? null;

  return (
    <div
      ref={contenedorRef}
      className="relative flex min-h-screen flex-1 flex-col bg-zinc-950 text-white"
    >
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/60 backdrop-blur transition hover:bg-white/20 hover:text-white"
      >
        {pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
      </button>

      {/* Tercio superior: título/ponente + QR */}
      <header className="flex flex-col items-center gap-6 border-b border-white/10 px-8 py-10 sm:flex-row sm:items-center sm:justify-between sm:gap-10 lg:min-h-[33vh] lg:py-0">
        <div className="text-center sm:text-left">
          <h1 className="text-3xl leading-tight font-bold sm:text-4xl lg:text-5xl">{titulo}</h1>
          {ponente && <p className="mt-2 text-xl text-white/70 sm:text-2xl">{ponente}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          {urlPreguntar ? (
            <div className="rounded-2xl bg-white p-4">
              <QRCodeSVG value={urlPreguntar} size={180} level="M" />
            </div>
          ) : (
            <div className="h-[212px] w-[212px] rounded-2xl bg-white/10" />
          )}
          <p className="text-sm font-medium tracking-wide text-white/60 uppercase">
            Escaneá para preguntar
          </p>
        </div>
      </header>

      {/* Dos tercios inferiores: preguntas, una a la vez */}
      <main className="flex flex-1 flex-col items-center justify-center px-8 py-12 lg:min-h-[67vh]">
        {preguntaActual ? (
          <div
            key={preguntaActual.id}
            className="w-full max-w-4xl animate-[fadeSlideIn_0.7s_ease-out] text-center"
          >
            <p className="text-4xl leading-snug font-semibold sm:text-5xl lg:text-6xl">
              &ldquo;{preguntaActual.texto}&rdquo;
            </p>
            <p className="mt-8 text-2xl font-medium text-white/60 sm:text-3xl">
              — {preguntaActual.nombre}
            </p>
          </div>
        ) : (
          <p className="max-w-2xl text-center text-2xl font-medium text-white/50 sm:text-3xl">
            Todavía no hay preguntas aprobadas. ¡Escaneá el QR y sé el primero en preguntar!
          </p>
        )}
      </main>
    </div>
  );
}

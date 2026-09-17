"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { tamanoTextoPregunta } from "@/lib/tamanoTextoPregunta";

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
      className="fixed inset-0 flex flex-col overflow-hidden bg-white"
    >
      {/* Marca de agua institucional — muy sutil, igual que en Pantalla
          Principal. Decorativa: alt vacío. */}
      <Image
        src="/branding/fondo.png"
        alt=""
        fill
        priority
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 object-cover opacity-[0.13]"
      />

      {/* El botón flota siempre sobre el header con degradado oscuro (nunca
          sobre el fondo blanco de main/footer), así que usa estilo claro
          sobre oscuro (blanco/10, texto blanco) en vez del bg-[#22516C]/10
          con texto oscuro que se usaba cuando el header era blanco. */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute right-3 top-3 z-20 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
      >
        {pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
      </button>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* Header: título/ponente + QR. Padding vertical reducido respecto a
            la versión anterior para dejarle más alto disponible a "main" en
            viewports bajos (ventanas angostas de desktop redimensionadas),
            ahora que el pie.png ya no le resta más espacio en el medio.
            pt-14 en mobile (debajo de sm, cuando el header pasa a flex-col y
            el título ocupa todo el ancho) es el mínimo para que el título
            empiece por debajo del botón "Pantalla completa" (absolute
            top-3, ~40px de borde inferior): así, sin importar cuántas
            líneas ocupe al envolverse, nunca queda debajo del botón. A
            partir de sm el header es flex-row con el título a la izquierda
            y el QR a la derecha, lejos de esa esquina, así que ahí alcanza
            con menos padding. */}
        <header
          className="flex shrink-0 flex-col items-center gap-2 px-8 pt-14 pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:pt-6 sm:pb-4"
          style={{
            background: "linear-gradient(135deg, #14374A 0%, #22516C 55%, #3E76A0 100%)",
          }}
        >
          <div className="text-center sm:text-left">
            <h1
              className="text-xl leading-tight text-white sm:text-2xl lg:text-3xl"
              style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
            >
              {titulo}
            </h1>
            {ponente && <p className="mt-1 text-base text-[#bcd6e6] sm:text-lg">{ponente}</p>}
          </div>

          <div className="flex shrink-0 flex-col items-center gap-2">
            {urlPreguntar ? (
              <div className="rounded-2xl border border-[#4472C4]/15 bg-white p-3 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.45)]">
                <QRCodeSVG value={urlPreguntar} size={200} level="M" />
              </div>
            ) : (
              <div className="h-[224px] w-[224px] rounded-2xl bg-white/10" />
            )}
            <p className="text-xs font-semibold tracking-wide text-white uppercase sm:text-sm">
              Escaneá para preguntar
            </p>
          </div>
        </header>

        {/* Zona de preguntas: min-h-0 es necesario porque, por default, un
            item flex tiene min-height:auto — sin esto, overflow-y-auto no
            tiene efecto y el contenido empuja todo (incluido el footer)
            fuera del viewport en vez de contenerse/scrollear acá adentro. */}
        <main
          className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-4 text-center sm:py-6"
          style={{ background: "linear-gradient(to bottom, #eef4f8 0%, #ffffff 100%)" }}
        >
          {preguntaActual ? (
            <div
              key={preguntaActual.id}
              className="w-full max-w-5xl animate-[fadeSlideIn_0.7s_ease-out]"
            >
              <p
                className={`leading-tight text-[#595959] ${tamanoTextoPregunta(preguntaActual.texto, true)}`}
                style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
              >
                {preguntaActual.texto}
              </p>
              <p className="mt-4 text-xl font-normal text-[#A6A6A6] sm:mt-8 sm:text-2xl">
                <span className="text-[#4472C4]">— </span>
                {preguntaActual.nombre}
              </p>
            </div>
          ) : (
            <p className="max-w-2xl text-center text-xl font-medium text-[#595959] sm:text-2xl">
              Todavía no hay preguntas aprobadas. ¡Escaneá el QR y sé el primero en preguntar!
            </p>
          )}
        </main>

        {/* Footer institucional: barra de logos a ancho completo, anclada al
            final real de la pantalla — mismo patrón que PantallaPrincipal.
            Padding vertical notoriamente mayor que antes; el ancho del logo
            se mantiene al 100% porque ya es el máximo posible sin desbordar
            horizontalmente, así que el único margen para "agrandarlo" es el
            aire alrededor. */}
        <footer className="w-full shrink-0 bg-white px-0 py-6 sm:py-8 md:py-10">
          <Image
            src="/branding/pie.png"
            alt=""
            width={1812}
            height={106}
            aria-hidden="true"
            className="h-auto w-full opacity-100"
          />
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type PreguntaAlAire = {
  id: string;
  texto: string;
  created_at: string;
  nombre: string;
};

// Tamaño de fuente dinámico según longitud: una pregunta larga con text-8xl
// fijo se desborda de la pantalla (ver captura del bug). Los umbrales priorizan
// que quepa sin cortarse, con overflow-y-auto en el contenedor como salvaguarda
// adicional para el caso extremo que ni así entre.
function tamanoTextoPregunta(texto: string): string {
  const len = texto.length;
  if (len < 80) return "text-6xl sm:text-7xl lg:text-8xl";
  if (len <= 160) return "text-4xl sm:text-5xl lg:text-6xl";
  return "text-3xl sm:text-4xl lg:text-4xl";
}

export default function PantallaPrincipal({
  conferenceId,
  titulo,
  ponente,
  preguntaInicial,
}: {
  conferenceId: string;
  titulo: string;
  ponente: string | null;
  preguntaInicial: PreguntaAlAire | null;
}) {
  const [pregunta, setPregunta] = useState<PreguntaAlAire | null>(preguntaInicial);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // Ante cualquier cambio en "questions" de esta conferencia (elección nueva,
  // swap atómico a otra pregunta), se vuelve a pedir pregunta_al_ponente_actual()
  // en vez de intentar reconstruir el estado a mano con el payload de
  // Realtime: esa función ya devuelve exactamente la fila "al aire" vigente
  // (o ninguna), sin importar cuál de las 2 filas del swap disparó el evento.
  useEffect(() => {
    async function recargarPreguntaAlAire() {
      const { data, error } = await supabase
        .rpc("pregunta_al_ponente_actual", { p_conference_id: conferenceId })
        .maybeSingle<PreguntaAlAire>();

      if (error) {
        console.error(
          "[pantalla-principal] No se pudo recargar la pregunta al aire:",
          error,
        );
        return;
      }
      setPregunta(data ?? null);
    }

    const channel = supabase
      .channel(`pantalla-principal-questions-${conferenceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "questions",
          filter: `conference_id=eq.${conferenceId}`,
        },
        () => recargarPreguntaAlAire(),
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

      <header className="px-8 pt-10 text-center">
        <h1 className="text-2xl leading-tight font-semibold text-white/80 sm:text-3xl">
          {titulo}
        </h1>
        {ponente && <p className="mt-1 text-base text-white/50 sm:text-lg">{ponente}</p>}
      </header>

      <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-10 py-16 text-center">
        {pregunta ? (
          <div key={pregunta.id} className="w-full max-w-6xl animate-[fadeSlideIn_0.7s_ease-out]">
            <p className={`leading-tight font-bold ${tamanoTextoPregunta(pregunta.texto)}`}>
              &ldquo;{pregunta.texto}&rdquo;
            </p>
            <p className="mt-10 text-3xl font-medium text-white/60 sm:text-4xl">
              — {pregunta.nombre}
            </p>
          </div>
        ) : (
          <p className="max-w-3xl text-3xl font-medium text-white/50 sm:text-4xl">
            Esperando la primera pregunta...
          </p>
        )}
      </main>
    </div>
  );
}

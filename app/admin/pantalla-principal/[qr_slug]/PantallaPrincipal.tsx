"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { tamanoTextoPregunta } from "@/lib/tamanoTextoPregunta";

type PreguntaAlAire = {
  id: string;
  texto: string;
  created_at: string;
  nombre: string;
};

export default function PantallaPrincipal({
  conferenceId,
  titulo,
  ponente,
  qrSlug,
  preguntaInicial,
}: {
  conferenceId: string;
  titulo: string;
  ponente: string | null;
  qrSlug: string;
  preguntaInicial: PreguntaAlAire | null;
}) {
  const [pregunta, setPregunta] = useState<PreguntaAlAire | null>(preguntaInicial);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [urlPreguntar, setUrlPreguntar] = useState<string | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // La URL del QR depende del origin real del deployment, que solo se
  // conoce en el cliente (evita hardcodear localhost o el dominio) — mismo
  // patrón que PantallaKiosko.
  useEffect(() => {
    setUrlPreguntar(`${window.location.origin}/preguntar/${qrSlug}`);
  }, [qrSlug]);

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
      className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-white pb-3"
    >
      {/* Marca de agua institucional — muy sutil, igual que en la portada de
          las presentaciones del seminario. Decorativa: alt vacío. */}
      <Image
        src="/branding/fondo.png"
        alt=""
        fill
        priority
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 object-cover opacity-[0.13]"
      />

      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute right-3 top-3 z-20 rounded-full bg-[#22516C]/10 px-3 py-1.5 text-xs font-medium text-[#22516C]/70 backdrop-blur transition hover:bg-[#22516C]/20 hover:text-[#22516C]"
      >
        {pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
      </button>

      <div className="relative z-10 flex flex-1 flex-col">
        {pregunta ? (
          <>
            {/* pt-14: el botón "Pantalla completa" es absolute top-3 con
                ~40px de borde inferior; con este padding la insignia
                siempre arranca por debajo, sin importar el ancho. */}
            <header className="flex justify-center px-8 pt-14">
              <span className="rounded-full bg-[#22516C] px-6 py-2 text-sm font-bold tracking-widest text-[#F2F2F2] uppercase sm:text-base">
                Pregunta en vivo
              </span>
            </header>

            <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-10 py-12 text-center">
              <div
                key={pregunta.id}
                className="w-full max-w-6xl animate-[fadeSlideIn_0.7s_ease-out]"
              >
                <p
                  className={`leading-tight text-[#595959] ${tamanoTextoPregunta(pregunta.texto)}`}
                  style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
                >
                  {pregunta.texto}
                </p>
                <p className="mt-10 text-2xl font-normal text-[#A6A6A6] sm:text-3xl">
                  <span className="text-[#4472C4]">— </span>
                  {pregunta.nombre}
                </p>
              </div>
            </main>
          </>
        ) : (
          <>
            <header className="px-8 pt-20 text-center sm:pt-16">
              <h1 className="text-2xl leading-tight font-semibold text-[#595959] sm:text-3xl">
                {titulo}
              </h1>
              {ponente && (
                <p className="mt-2 text-lg text-[#A6A6A6] sm:text-xl">{ponente}</p>
              )}
            </header>

            <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-10 py-12 text-center">
              {urlPreguntar ? (
                <div className="rounded-3xl border border-[#4472C4]/15 bg-white p-8 shadow-[0_0_40px_-15px_rgba(34,81,108,0.35)]">
                  <QRCodeSVG value={urlPreguntar} size={280} level="M" />
                </div>
              ) : (
                <div className="h-[344px] w-[344px] rounded-3xl bg-[#22516C]/5" />
              )}
              <p className="text-2xl font-semibold text-[#22516C] sm:text-3xl">
                Escanea y envía tu pregunta
              </p>
            </main>
          </>
        )}

        {/* Footer institucional: barra de logos a ancho completo, discreta. */}
        <footer className="w-full px-0 pb-0">
          <Image
            src="/branding/pie.png"
            alt=""
            width={1812}
            height={106}
            aria-hidden="true"
            className="h-auto w-full opacity-90"
          />
        </footer>
      </div>
    </div>
  );
}

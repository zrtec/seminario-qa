import { supabase } from "@/lib/supabase";
import PantallaKiosko from "./PantallaKiosko";

const LIMITE_PREGUNTAS_INICIALES = 30;

type Conferencia = {
  id: string;
  titulo: string;
  ponente: string | null;
};

type PreguntaInicial = {
  id: string;
  texto: string;
  created_at: string;
  nombre: string;
};

export default async function PantallaPage({
  params,
}: {
  params: Promise<{ qr_slug: string }>;
}) {
  const { qr_slug } = await params;

  const { data: conferencia } = await supabase
    .from("conferences")
    .select("id, titulo, ponente")
    .eq("qr_slug", qr_slug)
    .eq("activa", true)
    .maybeSingle<Conferencia>();

  if (!conferencia) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-white p-6 text-center">
        <p className="text-3xl font-semibold text-[#595959]">Esta conferencia no está activa</p>
        <p className="mt-3 max-w-md text-lg text-[#A6A6A6]">
          Verificá el código QR o activá la conferencia correspondiente desde el panel de admin.
        </p>
      </main>
    );
  }

  // Preguntas aprobadas ya existentes al momento de cargar la pantalla; las
  // que se aprueben después llegan por Realtime (ver PantallaKiosko).
  //
  // Se usa preguntas_pantalla() (SECURITY DEFINER, ver
  // supabase/preguntas_pantalla.sql) en vez de un select con embed a
  // "attendees": el rol "anon" no tiene GRANT SELECT sobre esa tabla (a
  // propósito, ver supabase/grants.sql), así que el embed fallaba con
  // "permission denied for table attendees" en cada request.
  const { data: preguntasData, error: errorPreguntas } = await supabase.rpc(
    "preguntas_pantalla",
    {
      p_conference_id: conferencia.id,
      p_limite: LIMITE_PREGUNTAS_INICIALES,
    },
  );

  if (errorPreguntas) {
    console.error(
      `[pantalla/${qr_slug}] No se pudieron cargar las preguntas iniciales:`,
      errorPreguntas,
    );
  }

  // El cliente de supabase-js no tiene un tipo de Database generado (ver
  // lib/supabase.ts), así que el retorno de .rpc() no se tipa solo; se
  // castea a mano, igual que ya se hace con otros rpc() en este proyecto
  // (ver PreguntarForm.tsx).
  const preguntasIniciales = (preguntasData ?? []) as PreguntaInicial[];

  return (
    <PantallaKiosko
      conferenceId={conferencia.id}
      titulo={conferencia.titulo}
      ponente={conferencia.ponente}
      qrSlug={qr_slug}
      preguntasIniciales={preguntasIniciales}
    />
  );
}

import { supabase } from "@/lib/supabase";
import PantallaPrincipal from "./PantallaPrincipal";

type Conferencia = {
  id: string;
  titulo: string;
  ponente: string | null;
};

type PreguntaAlAire = {
  id: string;
  texto: string;
  texto_corregido: string | null;
  created_at: string;
  nombre: string;
};

// TEMPORAL: sin autenticación todavía, igual que /admin/pantalla (Paso 9).
// Cuando se agregue Supabase Auth para staff, hay que validar acá que quien
// abre esta URL sea del equipo organizador.
export default async function PantallaPrincipalPage({
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
          Verifica el código QR o activa la conferencia correspondiente desde el panel de admin.
        </p>
      </main>
    );
  }

  // Pregunta al aire al momento de cargar la pantalla, si el panel ya eligió
  // una; los cambios posteriores llegan por Realtime (ver PantallaPrincipal).
  // Se usa pregunta_al_ponente_actual() (SECURITY DEFINER, ver
  // supabase/panel_expertos.sql) en vez de un select con embed a
  // "attendees": el rol "anon" no tiene GRANT SELECT sobre esa tabla a
  // propósito (ver supabase/grants.sql).
  const { data: preguntaData, error: errorPregunta } = await supabase
    .rpc("pregunta_al_ponente_actual", { p_conference_id: conferencia.id })
    .maybeSingle<PreguntaAlAire>();

  if (errorPregunta) {
    console.error(
      `[pantalla-principal/${qr_slug}] No se pudo cargar la pregunta al aire inicial:`,
      errorPregunta,
    );
  }

  return (
    <PantallaPrincipal
      conferenceId={conferencia.id}
      titulo={conferencia.titulo}
      ponente={conferencia.ponente}
      qrSlug={qr_slug}
      preguntaInicial={preguntaData ?? null}
    />
  );
}

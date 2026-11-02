import Image from "next/image";
import { supabase } from "@/lib/supabase";
import PreguntarForm from "./PreguntarForm";

type Conferencia = {
  id: string;
  titulo: string;
  ponente: string | null;
};

export default async function PreguntarPage({
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
      <main className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <p className="text-xl font-semibold text-[#22516C]">
          Esta conferencia no está disponible en este momento
        </p>
        <p className="mt-2 text-base text-[#595959]">
          Verifica el código QR o consulta con el staff del evento.
        </p>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="flex shrink-0 flex-col items-center gap-1 px-6 py-6 text-center"
        style={{
          background: "linear-gradient(135deg, #14374A 0%, #22516C 55%, #3E76A0 100%)",
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-[#bcd6e6]/80">
          Estás preguntando en
        </p>
        <h1
          className="mt-1 text-xl leading-tight text-white sm:text-2xl"
          style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
        >
          {conferencia.titulo}
        </h1>
        {conferencia.ponente && (
          <p className="mt-1 text-sm text-[#bcd6e6] sm:text-base">{conferencia.ponente}</p>
        )}
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <PreguntarForm conferenceId={conferencia.id} />
      </main>

      {/* Footer institucional en flujo normal (no fixed): esta página sí
          scrollea, a diferencia de Pantalla Principal / Pantalla Kiosko. */}
      <footer className="w-full shrink-0 bg-white px-0 py-6">
        <Image
          src="/branding/pie.png"
          alt=""
          width={1812}
          height={106}
          aria-hidden="true"
          className="h-auto w-full"
        />
      </footer>
    </div>
  );
}

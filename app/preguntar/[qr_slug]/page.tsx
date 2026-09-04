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
        <p className="text-xl font-semibold text-zinc-800">
          Esta conferencia no está disponible en este momento
        </p>
        <p className="mt-2 text-base text-zinc-500">
          Verificá el código QR o consultá con el staff del evento.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-10">
      <header className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Estás preguntando en
        </p>
        <h1 className="mt-1 text-xl font-bold text-zinc-900">{conferencia.titulo}</h1>
        {conferencia.ponente && (
          <p className="mt-1 text-base text-zinc-600">{conferencia.ponente}</p>
        )}
      </header>

      <PreguntarForm conferenceId={conferencia.id} />
    </main>
  );
}

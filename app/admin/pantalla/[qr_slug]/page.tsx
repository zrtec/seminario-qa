export default async function PantallaPage({
  params,
}: {
  params: Promise<{ qr_slug: string }>;
}) {
  const { qr_slug } = await params;

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-16">
      <h1 className="text-3xl font-semibold">Pantalla kiosko</h1>
      <p className="mt-2 text-zinc-500">Conferencia: {qr_slug}</p>
    </main>
  );
}

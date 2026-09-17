import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "./SidebarNav";
import { CerrarSesionButton } from "@/components/CerrarSesionButton";

// Layout exclusivo del grupo (dashboard): solo envuelve las páginas admin
// con sidebar (Conferencias, Organizaciones, Asistentes, Check-in). Al vivir
// dentro de app/admin/(dashboard)/, Next.js NO lo aplica a app/admin/pantalla
// ni a app/admin/pantalla-principal (quedan fuera del grupo, como hermanas
// de este layout) — esas 2 pantallas públicas de kiosko/podio siguen sin
// ningún elemento de navegación administrativa.
//
// proxy.ts ya exige rol admin para llegar hasta acá, así que este layout no
// vuelve a autorizar: solo lee sesión+rol para mostrar "nombre del usuario +
// rol" en la barra. Si por algún motivo llegara sin sesión (llamada directa
// server-side, etc.), redirige a /login como red de seguridad adicional.
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: staffRow } = await supabase
    .from("staff_users")
    .select("rol")
    .eq("id", user.id)
    .single();

  const rol = staffRow?.rol ?? null;
  const rolLabel = rol === "admin" ? "Administrador" : rol === "panelista" ? "Panelista" : "Staff";

  return (
    <div className="flex min-h-screen">
      <aside
        className="flex w-[180px] shrink-0 flex-col justify-between px-4 py-6"
        style={{
          background: "linear-gradient(180deg, #14374A 0%, #22516C 60%, #2c5f80 100%)",
        }}
      >
        <div className="flex flex-col gap-8">
          <div className="px-1">
            <p className="text-xs leading-tight font-bold tracking-wide text-white uppercase">
              Ministerio Hidrocarburos
            </p>
            <p className="mt-1 text-xs leading-tight font-semibold text-[#cddce6]">PDVSA</p>
          </div>

          <SidebarNav />
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
          <div className="px-1">
            <p className="truncate text-xs font-medium text-white" title={user.email ?? ""}>
              {user.email}
            </p>
            <p className="text-xs text-[#cddce6]">{rolLabel}</p>
          </div>
          <CerrarSesionButton className="w-full rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white disabled:opacity-50" />
        </div>
      </aside>

      <main className="min-h-screen flex-1 bg-white">{children}</main>
    </div>
  );
}

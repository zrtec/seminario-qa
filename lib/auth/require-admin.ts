import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Guards para los route handlers de app/api/admin/** y app/api/staff/**, que
// usan getSupabaseAdmin() (service_role, bypassa RLS por completo — ver
// lib/supabase-admin.ts). proxy.ts ya protege la navegación a /admin/** y
// /panel, pero no cubre estos endpoints si se llaman directo (fetch, curl,
// etc.), así que cada handler debe llamar a requireAdmin() o requireStaff()
// como primera línea y retornar tal cual la respuesta si no es null.
//
// Usan el cliente de servidor (lib/supabase/server.ts, sujeto a RLS) solo
// para leer la sesión y el rol — nunca para las queries de negocio del
// handler, que siguen yendo por getSupabaseAdmin().
type Rol = "admin" | "panelista";

async function sesionYRol(): Promise<{ autenticado: boolean; rol: Rol | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { autenticado: false, rol: null };
  }

  const { data: staffRow } = await supabase
    .from("staff_users")
    .select("rol")
    .eq("id", user.id)
    .single();

  return { autenticado: true, rol: (staffRow?.rol as Rol | undefined) ?? null };
}

// Para endpoints exclusivos de admin (app/api/admin/**).
export async function requireAdmin(): Promise<NextResponse | null> {
  const { autenticado, rol } = await sesionYRol();

  if (!autenticado) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (rol !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  return null;
}

// Para endpoints de solo-lectura compartidos entre admin y panelista
// (app/api/staff/**), como el listado de conferencias que usa /panel.
export async function requireStaff(): Promise<NextResponse | null> {
  const { autenticado, rol } = await sesionYRol();

  if (!autenticado) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (rol !== "admin" && rol !== "panelista") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  return null;
}

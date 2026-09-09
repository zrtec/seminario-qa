import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff } from "@/lib/auth/require-admin";

// Listado de solo-lectura de TODAS las conferencias (activas e inactivas),
// para el selector de /panel. Existe aparte de GET /api/admin/conferences
// (que es admin-only) porque un panelista también necesita elegir
// conferencia ahí, y "anon"/RLS solo deja ver las conferencias activas (ver
// conferences_select_publico_activas en supabase/schema.sql) — no alcanza
// con hacer la query directo desde el browser client.
export async function GET() {
  const noAutorizado = await requireStaff();
  if (noAutorizado) return noAutorizado;

  const { data, error } = await getSupabaseAdmin()
    .from("conferences")
    .select("id, titulo, activa")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

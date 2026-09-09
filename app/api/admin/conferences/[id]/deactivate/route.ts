import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth/require-admin";

type Params = { params: Promise<{ id: string }> };

// Desactivar no compite con el índice único parcial (activa = false nunca
// choca con ninguna otra fila), así que alcanza con un UPDATE directo, sin
// pasar por activar_conferencia().
export async function POST(_request: Request, { params }: Params) {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const { id } = await params;

  const { error } = await getSupabaseAdmin()
    .from("conferences")
    .update({ activa: false })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

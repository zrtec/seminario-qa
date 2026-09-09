import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth/require-admin";

type Params = { params: Promise<{ id: string }> };

// Activar una conferencia es una operación EXCLUSIVA: como máximo una
// conferencia activa a la vez en todo el sistema. Esa regla la garantiza de
// verdad un índice único parcial en Postgres (conferences_una_activa_idx,
// ver supabase/schema.sql y supabase/conferencia_activa_unica.sql), que le
// impide a la base tener dos filas con activa = true sin importar qué
// código la toque. Este endpoint delega en la función activar_conferencia()
// para que "desactivar la anterior + activar esta" ocurra en una sola
// transacción atómica, en vez de hacer dos updates sueltos desde acá que
// podrían competir con otra request concurrente.
export async function POST(_request: Request, { params }: Params) {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const { id } = await params;

  const { error } = await getSupabaseAdmin().rpc("activar_conferencia", {
    p_conference_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

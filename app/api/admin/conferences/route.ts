import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth/require-admin";

const CAMPOS_REQUERIDOS = ["titulo", "categoria", "ponente", "resumen", "qr_slug"] as const;

function validarBody(body: Record<string, unknown>) {
  for (const campo of CAMPOS_REQUERIDOS) {
    if (typeof body[campo] !== "string" || body[campo as string] === "") {
      return `El campo "${campo}" es requerido.`;
    }
  }
  return null;
}

export async function GET() {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const { data, error } = await getSupabaseAdmin()
    .from("conferences")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const body = await request.json();
  const errorValidacion = validarBody(body);
  if (errorValidacion) {
    return NextResponse.json({ error: errorValidacion }, { status: 400 });
  }

  const { titulo, categoria, ponente, resumen, qr_slug, presentacion_url } = body;

  // activa NO se acepta acá: una conferencia siempre se crea inactiva.
  // Activarla es una operación exclusiva aparte (ver [id]/activate/route.ts)
  // que desactiva a la vez cualquier otra conferencia activa.
  const { data, error } = await getSupabaseAdmin()
    .from("conferences")
    .insert({
      titulo,
      categoria,
      ponente,
      resumen,
      qr_slug,
      activa: false,
      presentacion_url: presentacion_url ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

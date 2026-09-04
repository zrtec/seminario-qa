import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const CAMPOS_REQUERIDOS = ["titulo", "categoria", "ponente", "resumen", "qr_slug"] as const;

function validarBody(body: Record<string, unknown>) {
  for (const campo of CAMPOS_REQUERIDOS) {
    if (typeof body[campo] !== "string" || body[campo as string] === "") {
      return `El campo "${campo}" es requerido.`;
    }
  }
  return null;
}

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin. Cuando se agregue Supabase Auth para staff, hay que
// validar la sesión/rol acá antes de usar supabaseAdmin.
export async function GET() {
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

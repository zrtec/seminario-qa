import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function validarBody(body: Record<string, unknown>) {
  if (typeof body.nombre !== "string" || body.nombre.trim() === "") {
    return 'El campo "nombre" es requerido.';
  }
  if (typeof body.es_estrategica !== "boolean") {
    return 'El campo "es_estrategica" debe ser booleano.';
  }
  return null;
}

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin. Cuando se agregue Supabase Auth para staff, hay que
// validar la sesión/rol acá antes de usar supabaseAdmin.
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("organizations")
    .select("*")
    .order("nombre", { ascending: true });

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

  const { nombre, es_estrategica } = body;

  const { data, error } = await getSupabaseAdmin()
    .from("organizations")
    .insert({ nombre, es_estrategica })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

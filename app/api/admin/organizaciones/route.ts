import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth/require-admin";

function validarBody(body: Record<string, unknown>) {
  if (typeof body.nombre !== "string" || body.nombre.trim() === "") {
    return 'El campo "nombre" es requerido.';
  }
  if (typeof body.es_estrategica !== "boolean") {
    return 'El campo "es_estrategica" debe ser booleano.';
  }
  return null;
}

export async function GET() {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

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
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

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

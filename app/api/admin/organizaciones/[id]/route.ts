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

type Params = { params: Promise<{ id: string }> };

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin. Cuando se agregue Supabase Auth para staff, hay que
// validar la sesión/rol acá antes de usar supabaseAdmin.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const errorValidacion = validarBody(body);
  if (errorValidacion) {
    return NextResponse.json({ error: errorValidacion }, { status: 400 });
  }

  const { nombre, es_estrategica } = body;

  const { data, error } = await getSupabaseAdmin()
    .from("organizations")
    .update({ nombre, es_estrategica })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const admin = getSupabaseAdmin();

  // La FK attendees.organization_id es "on delete set null", por lo que la
  // base de datos permitiría el delete sin bloquear. Se valida acá para no
  // dejar attendees huérfanos de organización sin que el admin lo sepa.
  const { count, error: errorConteo } = await admin
    .from("attendees")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", id);

  if (errorConteo) {
    return NextResponse.json({ error: errorConteo.message }, { status: 500 });
  }
  if (count && count > 0) {
    return NextResponse.json(
      {
        error: `No se puede eliminar: hay ${count} asistente(s) asociado(s) a esta organización.`,
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("organizations").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

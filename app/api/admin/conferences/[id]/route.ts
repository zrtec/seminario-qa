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

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const { id } = await params;
  const body = await request.json();
  const errorValidacion = validarBody(body);
  if (errorValidacion) {
    return NextResponse.json({ error: errorValidacion }, { status: 400 });
  }

  const { titulo, categoria, ponente, resumen, qr_slug, presentacion_url } = body;

  // activa NO se toca acá: se cambia únicamente vía los endpoints dedicados
  // activate/deactivate, para no pisar sin querer el estado de "cuál
  // conferencia está activa" al editar otros campos del formulario.
  const { data, error } = await getSupabaseAdmin()
    .from("conferences")
    .update({
      titulo,
      categoria,
      ponente,
      resumen,
      qr_slug,
      presentacion_url: presentacion_url ?? null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const { id } = await params;

  const { error } = await getSupabaseAdmin().from("conferences").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

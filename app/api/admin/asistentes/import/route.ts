import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type AsistenteImport = {
  nombre: string;
  email: string;
  organization_id: string;
};

function validarBody(body: unknown): AsistenteImport[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;

  for (const item of body) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).nombre !== "string" ||
      typeof (item as Record<string, unknown>).email !== "string" ||
      typeof (item as Record<string, unknown>).organization_id !== "string"
    ) {
      return null;
    }
  }
  return body as AsistenteImport[];
}

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin. Cuando se agregue Supabase Auth para staff, hay que
// validar la sesión/rol acá antes de usar supabaseAdmin.
//
// La validación real de cada fila (organización existente, email no
// duplicado, generación de access_code sin colisión) y la atomicidad de la
// importación las hace la función importar_asistentes() en Postgres — ver
// supabase/importar_asistentes_csv.sql. Este handler es solo el puente.
export async function POST(request: Request) {
  const body = await request.json();
  const asistentes = validarBody(body);
  if (!asistentes) {
    return NextResponse.json(
      {
        error:
          'Body inválido: se espera un array no vacío de {nombre, email, organization_id}.',
      },
      { status: 400 }
    );
  }

  const { error } = await getSupabaseAdmin().rpc("importar_asistentes", {
    p_asistentes: asistentes,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, count: asistentes.length }, { status: 201 });
}

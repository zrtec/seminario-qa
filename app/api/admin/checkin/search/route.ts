import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Los filtros combinados de PostgREST (.or()) usan "," para separar
// condiciones y "()" para agrupar; si el término de búsqueda trae esos
// caracteres literales, romperían la sintaxis del filtro (o cambiarían qué
// se está filtrando) en vez de buscarse como texto. Ninguno de los dos es
// relevante para buscar por nombre/email, así que se descartan.
function sanitizarTermino(termino: string) {
  return termino.replace(/[,()]/g, "").trim();
}

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin/staff. Cuando se agregue Supabase Auth, hay que validar
// la sesión/rol acá antes de usar supabaseAdmin.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = sanitizarTermino(searchParams.get("q") ?? "");

  if (q === "") {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("attendees")
    .select("id, nombre, email, status, access_code, organization_id, organizations(nombre)")
    .or(`nombre.ilike.%${q}%,email.ilike.%${q}%`)
    .order("nombre", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

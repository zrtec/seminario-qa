import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin. Cuando se agregue Supabase Auth para staff, hay que
// validar la sesión/rol acá antes de usar supabaseAdmin.
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("attendees")
    .select("id, nombre, email, status, access_code, organization_id, organizations(nombre)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

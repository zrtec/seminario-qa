import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function GET() {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const { data, error } = await getSupabaseAdmin()
    .from("attendees")
    .select("id, nombre, email, status, access_code, organization_id, organizations(nombre)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin/staff. Cuando se agregue Supabase Auth, hay que validar
// la sesión/rol acá antes de usar supabaseAdmin.
//
// La validación (organización existente, email no duplicado) y la
// generación del access_code sin colisión las hace, atómicamente, la
// función checkin_registrar_asistente() en Postgres — ver
// supabase/checkin_registrar_asistente.sql. Este handler es solo el puente.
export async function POST(request: Request) {
  const body = await request.json();
  const { nombre, email, organization_id } = body;

  if (
    typeof nombre !== "string" ||
    nombre.trim() === "" ||
    typeof email !== "string" ||
    email.trim() === "" ||
    typeof organization_id !== "string" ||
    organization_id.trim() === ""
  ) {
    return NextResponse.json(
      { error: "nombre, email y organization_id son requeridos." },
      { status: 400 }
    );
  }

  const { data, error } = await getSupabaseAdmin().rpc("checkin_registrar_asistente", {
    p_nombre: nombre,
    p_email: email,
    p_organization_id: organization_id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

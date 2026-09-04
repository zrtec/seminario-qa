import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const SELECT_ASISTENTE =
  "id, nombre, email, status, access_code, organization_id, organizations(nombre)";

// TEMPORAL: sin autenticación todavía, este endpoint no verifica que quien
// llama sea admin/staff. Cuando se agregue Supabase Auth, hay que validar
// la sesión/rol acá antes de usar supabaseAdmin.
export async function POST(request: Request) {
  const body = await request.json();
  const attendeeId = body.attendee_id;
  if (typeof attendeeId !== "string" || attendeeId === "") {
    return NextResponse.json({ error: "attendee_id es requerido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // El .eq("status", "precargado") hace que el UPDATE solo pegue si todavía
  // no estaba confirmado: si otra persona ya hizo el check-in un instante
  // antes, esto no actualiza ninguna fila en vez de pisar el cambio ajeno.
  const { data: actualizado, error: errorUpdate } = await admin
    .from("attendees")
    .update({ status: "presente" })
    .eq("id", attendeeId)
    .eq("status", "precargado")
    .select(SELECT_ASISTENTE)
    .maybeSingle();

  if (errorUpdate) {
    return NextResponse.json({ error: errorUpdate.message }, { status: 500 });
  }

  if (actualizado) {
    return NextResponse.json({ data: actualizado, yaEstabaPresente: false });
  }

  // No se actualizó nada: puede ser porque ya estaba "presente" (no es un
  // error, el admin solo quiere volver a ver el código) o porque el id no
  // existe.
  const { data: existente, error: errorFetch } = await admin
    .from("attendees")
    .select(SELECT_ASISTENTE)
    .eq("id", attendeeId)
    .maybeSingle();

  if (errorFetch) {
    return NextResponse.json({ error: errorFetch.message }, { status: 500 });
  }
  if (!existente) {
    return NextResponse.json({ error: "El asistente no existe." }, { status: 404 });
  }

  return NextResponse.json({ data: existente, yaEstabaPresente: true });
}

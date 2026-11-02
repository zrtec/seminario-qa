import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth/require-admin";

const EXTENSIONES_PERMITIDAS = ["pdf", "ppt", "pptx"] as const;
const BUCKET = "presentaciones";

function extensionDe(nombreArchivo: string): string {
  const partes = nombreArchivo.split(".");
  return partes.length > 1 ? partes.pop()!.toLowerCase() : "";
}

// La subida se hace acá, server-side con getSupabaseAdmin() (service_role),
// en vez de directo desde el navegador con la anon key, para no tener que
// abrir el bucket "presentaciones" a INSERT público. Ver
// supabase/storage_policies.sql.
export async function POST(request: Request) {
  const noAutorizado = await requireAdmin();
  if (noAutorizado) return noAutorizado;

  const formData = await request.formData();
  const archivo = formData.get("file");
  const qrSlug = formData.get("qr_slug");

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo a subir." }, { status: 400 });
  }
  if (typeof qrSlug !== "string" || qrSlug === "") {
    return NextResponse.json({ error: "Falta el qr_slug de la conferencia." }, { status: 400 });
  }

  const extension = extensionDe(archivo.name);
  if (!EXTENSIONES_PERMITIDAS.includes(extension as (typeof EXTENSIONES_PERMITIDAS)[number])) {
    return NextResponse.json(
      { error: "Formato no permitido. Sube un archivo .pdf, .ppt o .pptx." },
      { status: 400 }
    );
  }

  // qr_slug + timestamp evita colisiones si se sube más de una vez para la
  // misma conferencia, sin necesidad de borrar el archivo anterior.
  const nombreUnico = `${qrSlug}-${Date.now()}.${extension}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .upload(nombreUnico, archivo, {
      contentType: archivo.type || undefined,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data } = getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(nombreUnico);

  return NextResponse.json({ url: data.publicUrl }, { status: 201 });
}

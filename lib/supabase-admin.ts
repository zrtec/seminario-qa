import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// ADVERTENCIA: este cliente usa la service_role key y bypassa RLS por
// completo. Llamar getSupabaseAdmin() SOLO desde código que corre en el
// servidor (Route Handlers como app/api/admin/**/route.ts, Server Actions,
// Server Components). Nunca importar este archivo desde un componente
// marcado "use client": la key terminaría en el bundle del navegador.
//
// La inicialización es perezosa (recién al invocar la función) para no
// romper `next build`: Next.js evalúa los módulos de los Route Handlers al
// recolectar su configuración durante el build, antes de que exista ninguna
// request, así que validar las env vars a nivel de módulo tumbaría el build
// completo si SUPABASE_SERVICE_ROLE_KEY todavía no está seteada.
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. Definilas en .env.local."
    );
  }

  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}

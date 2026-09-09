import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. Definilas en .env.local."
  );
}

// Cliente para Server Components y Route Handlers. `cookies()` de next/headers
// es async desde Next 15 (sigue siéndolo en Next 16), por eso esta función
// también lo es y hay que hacer `await createClient()` en el caller.
//
// `setAll` puede fallar cuando se llama desde un Server Component (que no
// puede escribir cookies): se ignora a propósito porque proxy.ts ya se
// encarga de refrescar la sesión y reescribir las cookies en cada request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Llamado desde un Server Component: no se pueden escribir cookies
          // aquí. Se puede ignorar porque proxy.ts refresca la sesión.
        }
      },
    },
  });
}

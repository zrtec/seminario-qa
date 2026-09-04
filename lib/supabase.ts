import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. Definilas en .env.local."
  );
}

// Cliente único basado en la anon key (segura para el navegador).
// Al ser NEXT_PUBLIC_*, estas variables se resuelven tanto en Server
// Components / Route Handlers (Node) como al inlinearse en el bundle
// del cliente, por lo que esta misma instancia sirve para ambos casos.
// No persiste sesión de Auth en el servidor: para flujos de login de
// staff (admin/panelista) que dependan de cookies de sesión, se necesita
// un cliente aparte basado en @supabase/ssr.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

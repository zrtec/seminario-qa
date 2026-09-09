import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. Definilas en .env.local."
  );
}

// Cliente para Client Components ("use client"). A diferencia de lib/supabase.ts
// (createClient de @supabase/supabase-js, sin sesión persistida en cookies),
// este usa createBrowserClient de @supabase/ssr: persiste la sesión de Auth en
// cookies (no en localStorage) para que server.ts y proxy.ts puedan leerla en
// el servidor. Es el cliente que debe usar cualquier flujo de login/logout de
// staff (admin/panelista).
export function createClient() {
  return createBrowserClient(supabaseUrl!, supabaseAnonKey!);
}

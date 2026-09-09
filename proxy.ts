import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// NOTA: en Next.js 16 el archivo `middleware.ts` fue deprecado y renombrado a
// `proxy.ts` (la función exportada pasó de `middleware` a `proxy`); la API y
// el comportamiento son los mismos. Ver node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md.
//
// Este proxy hace dos cosas en cada request:
//   1. Refresca la sesión de Supabase Auth (patrón estándar de @supabase/ssr
//      para App Router): lee las cookies, llama a supabase.auth.getUser()
//      para renovar el token si hace falta, y reescribe las cookies
//      actualizadas en la respuesta.
//   2. Autoriza el acceso a las rutas de staff (/admin/** y /panel) según el
//      rol en staff_users. Solo se consulta staff_users para esas rutas —
//      cualquier otra (/, /preguntar/*, /login, y las 2 pantallas públicas de
//      /admin/pantalla y /admin/pantalla-principal) no paga ese costo extra.
//      Es un select por primary key (staff_users.id), tan barato como un
//      lookup se puede pedir; no hace falta cachearlo para el volumen de
//      staff de este proyecto. La alternativa "sin round-trip" sería meter el
//      rol como custom claim del JWT vía un Auth Hook de Supabase, pero eso
//      demora la propagación de un cambio de rol hasta el próximo refresh
//      del token — no vale esa complejidad acá.
//
// Los route handlers de app/api/admin/** NO pasan por esta lógica de
// autorización (solo por el refresco de sesión, ya que matchean el patrón):
// cada uno valida sesión+rol por su cuenta con requireAdmin() (ver
// lib/auth/require-admin.ts), porque una API debe responder 401/403 en JSON,
// no redirigir a una página HTML.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type RolRequerido = "admin" | "staff" | null;

function rolRequeridoPara(pathname: string): RolRequerido {
  // Pantallas públicas del kiosko/podio: nunca requieren sesión, aunque
  // cuelguen de /admin.
  if (
    pathname === "/admin/pantalla" ||
    pathname.startsWith("/admin/pantalla/") ||
    pathname === "/admin/pantalla-principal" ||
    pathname.startsWith("/admin/pantalla-principal/")
  ) {
    return null;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return "admin";
  }

  if (pathname === "/panel" || pathname.startsWith("/panel/")) {
    return "staff"; // admin o panelista
  }

  return null;
}

function redirigirCon(pathname: string, request: NextRequest, base: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const redirect = NextResponse.redirect(url);
  // Preserva las cookies de sesión que getUser() pudo haber refrescado en
  // `base`; si se pierden acá, el navegador se queda con un token vencido.
  base.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  const rolRequerido = rolRequeridoPara(pathname);

  // app/api/admin/** hace su propio chequeo de sesión/rol (requireAdmin());
  // acá solo nos importan las páginas de staff.
  const esApi = pathname.startsWith("/api/");

  if (!supabaseUrl || !supabaseAnonKey) {
    // Si faltan las env vars, no rompemos el request: simplemente no hay
    // refresco de sesión ni autorización (el resto de la app ya valida estas
    // variables).
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // No agregar lógica entre createServerClient() y getUser(): getUser() es
  // lo que efectivamente refresca el token y dispara setAll() con las
  // cookies nuevas.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (rolRequerido && !esApi) {
    if (!user) {
      return redirigirCon("/login", request, supabaseResponse);
    }

    // Falla cerrado: si la consulta da error (red, timeout), tratamos el rol
    // como inexistente en vez de dejar pasar por las dudas.
    const { data: staffRow } = await supabase
      .from("staff_users")
      .select("rol")
      .eq("id", user.id)
      .single();

    const rol = staffRow?.rol ?? null;
    const autorizado =
      rolRequerido === "admin" ? rol === "admin" : rol === "admin" || rol === "panelista";

    if (!autorizado) {
      // Con sesión pero rol equivocado (o sin fila en staff_users): en vez
      // de un error, lo mandamos a su propia área si tiene una, o a /login
      // si no está vinculado como staff.
      const destino = rol === "admin" ? "/admin" : rol === "panelista" ? "/panel" : "/login";
      return redirigirCon(destino, request, supabaseResponse);
    }
  }

  // Importante devolver supabaseResponse tal cual (no una nueva
  // NextResponse), o las cookies recién seteadas se pierden.
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    try {
      const supabase = createClient();

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw new Error(
          signInError.message === "Invalid login credentials"
            ? "Email o contraseña incorrectos."
            : signInError.message
        );
      }

      const userId = signInData.user?.id;
      if (!userId) {
        throw new Error("No se pudo obtener el usuario tras iniciar sesión.");
      }

      const { data: staffRow, error: staffError } = await supabase
        .from("staff_users")
        .select("rol")
        .eq("id", userId)
        .single();

      if (staffError || !staffRow) {
        await supabase.auth.signOut();
        throw new Error(
          "Tu cuenta no está vinculada como staff. Contactá a un administrador."
        );
      }

      const destino = staffRow.rol === "admin" ? "/admin" : "/panel";
      router.push(destino);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
      setCargando(false);
    }
  }

  return (
    <main
      className="flex min-h-screen flex-1 flex-col items-center justify-center p-6"
      style={{ background: "linear-gradient(135deg, #14374A 0%, #22516C 55%, #3E76A0 100%)" }}
    >
      <div className="w-full max-w-sm">
        <p className="mb-4 text-center text-xs font-bold tracking-widest text-white/80 uppercase">
          Ministerio Hidrocarburos · PDVSA
        </p>

        <div className="rounded-2xl bg-white p-8 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)]">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-zinc-900">Ingresar</h1>
            <p className="mt-1 text-sm text-zinc-600">Acceso de staff (admin / panelista).</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-[#595959]" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-[#595959]" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="mt-2 rounded-md bg-[#22516C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1b4258] disabled:opacity-50"
            >
              {cargando ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

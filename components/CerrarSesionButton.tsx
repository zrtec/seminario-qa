"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CerrarSesionButton() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function handleClick() {
    setSaliendo(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saliendo}
      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      {saliendo ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}

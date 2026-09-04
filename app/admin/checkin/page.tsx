"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

type Organizacion = {
  id: string;
  nombre: string;
};

type AsistenteBusqueda = {
  id: string;
  nombre: string;
  email: string;
  status: string;
  access_code: string;
  organization_id: string | null;
  organizations: { nombre: string } | null;
};

type AsistenteConfirmado = {
  nombre: string;
  access_code: string;
};

type FormRegistro = {
  nombre: string;
  email: string;
  organization_id: string;
};

const FORM_REGISTRO_VACIO: FormRegistro = {
  nombre: "",
  email: "",
  organization_id: "",
};

export default function CheckinAdminPage() {
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<AsistenteBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [asistenteConfirmado, setAsistenteConfirmado] = useState<AsistenteConfirmado | null>(null);

  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([]);
  const [mostrarFormularioRegistro, setMostrarFormularioRegistro] = useState(false);
  const [formRegistro, setFormRegistro] = useState<FormRegistro>(FORM_REGISTRO_VACIO);
  const [registrando, setRegistrando] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const idBusquedaRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/admin/organizaciones")
      .then((res) => res.json())
      .then((body) => setOrganizaciones(body.data ?? []))
      .catch(() => {
        // El select de organizaciones queda vacío; el registro manual no
        // puede completarse hasta refrescar la página.
      });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleTerminoChange(valor: string) {
    setTermino(valor);
    setAsistenteConfirmado(null);
    setMostrarFormularioRegistro(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const terminoLimpio = valor.trim();
    if (terminoLimpio === "") {
      setResultados([]);
      setBusquedaHecha(false);
      setBuscando(false);
      return;
    }

    setBuscando(true);
    const idPropia = ++idBusquedaRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/checkin/search?q=${encodeURIComponent(terminoLimpio)}`
        );
        const body = await res.json();
        if (idPropia !== idBusquedaRef.current) return; // respuesta obsoleta
        if (!res.ok) throw new Error(body.error ?? "Error al buscar asistentes.");
        setResultados(body.data ?? []);
        setBusquedaHecha(true);
      } catch (err) {
        if (idPropia !== idBusquedaRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido.");
      } finally {
        if (idPropia === idBusquedaRef.current) setBuscando(false);
      }
    }, 300);
  }

  function actualizarResultadoLocal(id: string, cambios: Partial<AsistenteBusqueda>) {
    setResultados((prev) => prev.map((r) => (r.id === id ? { ...r, ...cambios } : r)));
  }

  async function handleConfirmar(asistente: AsistenteBusqueda) {
    setError(null);
    setConfirmandoId(asistente.id);
    try {
      const res = await fetch("/api/admin/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendee_id: asistente.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al confirmar la asistencia.");

      actualizarResultadoLocal(asistente.id, {
        status: body.data.status,
        access_code: body.data.access_code,
      });
      setAsistenteConfirmado({ nombre: body.data.nombre, access_code: body.data.access_code });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setConfirmandoId(null);
    }
  }

  function handleVerCodigoDeNuevo(asistente: AsistenteBusqueda) {
    setAsistenteConfirmado({ nombre: asistente.nombre, access_code: asistente.access_code });
  }

  function handleAbrirRegistro() {
    setFormRegistro({
      ...FORM_REGISTRO_VACIO,
      nombre: termino.includes("@") ? "" : termino,
    });
    setMostrarFormularioRegistro(true);
  }

  async function handleSubmitRegistro(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRegistrando(true);
    try {
      const res = await fetch("/api/admin/checkin/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formRegistro),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al registrar el asistente.");

      setMostrarFormularioRegistro(false);
      setFormRegistro(FORM_REGISTRO_VACIO);
      setTermino("");
      setResultados([]);
      setBusquedaHecha(false);
      setAsistenteConfirmado({ nombre: body.data.nombre, access_code: body.data.access_code });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setRegistrando(false);
    }
  }

  function handleCerrarBienvenida() {
    setAsistenteConfirmado(null);
    setTermino("");
    setResultados([]);
    setBusquedaHecha(false);
    inputRef.current?.focus();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Admin — Check-in</h1>
          <Link href="/admin" className="text-sm font-medium text-blue-600 hover:underline">
            Volver a Conferencias
          </Link>
        </div>
        <p className="mt-1 text-sm text-amber-600">
          ⚠️ Página temporal sin autenticación. El acceso de admin real se agrega en un paso posterior.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {asistenteConfirmado && (
        <section className="rounded-lg border-2 border-green-400 bg-green-50 p-8 text-center">
          <p className="text-lg text-green-800">
            Bienvenido/a <span className="font-semibold">{asistenteConfirmado.nombre}</span>.
          </p>
          <p className="mt-4 text-sm text-green-800">Tu código es</p>
          <p className="mt-1 font-mono text-6xl font-bold tracking-widest text-green-900">
            {asistenteConfirmado.access_code}
          </p>
          <p className="mt-4 text-sm text-green-800">
            Úsalo o tu email para hacer preguntas durante las conferencias.
          </p>
          <button
            type="button"
            onClick={handleCerrarBienvenida}
            className="mt-6 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Buscar otra persona
          </button>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold">Buscar asistente</h2>
        <input
          ref={inputRef}
          type="text"
          value={termino}
          onChange={(e) => handleTerminoChange(e.target.value)}
          placeholder="Nombre o email..."
          className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          autoFocus
        />

        {buscando && <p className="mt-3 text-sm text-zinc-500">Buscando...</p>}

        {!buscando && busquedaHecha && resultados.length === 0 && (
          <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <p className="text-zinc-600">No se encontró a nadie con &quot;{termino}&quot;.</p>
            <button
              type="button"
              onClick={handleAbrirRegistro}
              className="mt-2 text-sm font-medium text-blue-600 hover:underline"
            >
              No está en la lista, registrar ahora
            </button>
          </div>
        )}

        {!buscando && resultados.length > 0 && (
          <ul className="mt-4 divide-y divide-zinc-100 rounded-md border border-zinc-200">
            {resultados.map((asistente) => (
              <li
                key={asistente.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{asistente.nombre}</p>
                  <p className="text-xs text-zinc-500">
                    {asistente.email} · {asistente.organizations?.nombre ?? "Sin organización"}
                  </p>
                </div>
                {asistente.status === "presente" ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                      Ya registrado
                    </span>
                    <button
                      type="button"
                      onClick={() => handleVerCodigoDeNuevo(asistente)}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Ver código de nuevo
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleConfirmar(asistente)}
                    disabled={confirmandoId === asistente.id}
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {confirmandoId === asistente.id ? "Confirmando..." : "Confirmar asistencia"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mostrarFormularioRegistro && (
        <section className="rounded-lg border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">Registrar asistente nuevo</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Se registra directamente como &quot;presente&quot;, generando su código de acceso.
          </p>

          <form onSubmit={handleSubmitRegistro} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Nombre *
              <input
                required
                value={formRegistro.nombre}
                onChange={(e) =>
                  setFormRegistro((prev) => ({ ...prev, nombre: e.target.value }))
                }
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Email *
              <input
                required
                type="email"
                value={formRegistro.email}
                onChange={(e) =>
                  setFormRegistro((prev) => ({ ...prev, email: e.target.value }))
                }
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Organización *
              <select
                required
                value={formRegistro.organization_id}
                onChange={(e) =>
                  setFormRegistro((prev) => ({ ...prev, organization_id: e.target.value }))
                }
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">Seleccionar organización...</option>
                {organizaciones.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.nombre}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={registrando}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {registrando ? "Registrando..." : "Registrar y hacer check-in"}
              </button>
              <button
                type="button"
                onClick={() => setMostrarFormularioRegistro(false)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

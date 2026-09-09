"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Organization = {
  id: string;
  nombre: string;
  es_estrategica: boolean;
  created_at: string;
};

type FormState = {
  nombre: string;
  es_estrategica: boolean;
};

const FORM_VACIO: FormState = {
  nombre: "",
  es_estrategica: false,
};

export default function OrganizacionesAdminPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [idCopiadoId, setIdCopiadoId] = useState<string | null>(null);

  async function cargarOrganizations() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/organizaciones");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al cargar organizaciones.");
      setOrganizations(body.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarOrganizations();
  }, []);

  function resetForm() {
    setForm(FORM_VACIO);
    setEditandoId(null);
  }

  function handleEditar(org: Organization) {
    setEditandoId(org.id);
    setForm({ nombre: org.nombre, es_estrategica: org.es_estrategica });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleCopiarId(org: Organization) {
    try {
      await navigator.clipboard.writeText(org.id);
      setIdCopiadoId(org.id);
      setTimeout(() => setIdCopiadoId((actual) => (actual === org.id ? null : actual)), 1500);
    } catch {
      setError("No se pudo copiar el ID al portapapeles.");
    }
  }

  async function handleEliminar(org: Organization) {
    if (!confirm(`¿Eliminar la organización "${org.nombre}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/organizaciones/${org.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al eliminar la organización.");
      if (editandoId === org.id) resetForm();
      await cargarOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);

    try {
      const url = editandoId
        ? `/api/admin/organizaciones/${editandoId}`
        : "/api/admin/organizaciones";
      const method = editandoId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al guardar la organización.");

      resetForm();
      await cargarOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Admin — Organizaciones</h1>
          <Link href="/admin" className="text-sm font-medium text-blue-600 hover:underline">
            Volver a Conferencias
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold">
          {editandoId ? "Editar organización" : "Nueva organización"}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Nombre *
            <input
              required
              value={form.nombre}
              onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.es_estrategica}
              onChange={(e) => setForm((prev) => ({ ...prev, es_estrategica: e.target.checked }))}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Es organización estratégica
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={guardando}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {guardando ? "Guardando..." : editandoId ? "Guardar cambios" : "Crear organización"}
            </button>
            {editandoId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-zinc-200">
        <h2 className="border-b border-zinc-200 p-4 text-lg font-semibold">Organizaciones</h2>

        {cargando ? (
          <p className="p-4 text-sm text-zinc-500">Cargando...</p>
        ) : organizations.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No hay organizaciones cargadas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Nombre</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {organizations.map((org) => (
                  <tr key={org.id}>
                    <td className="px-4 py-2">{org.nombre}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          org.es_estrategica
                            ? "bg-blue-100 text-blue-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {org.es_estrategica ? "Estratégica" : "Regular"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-zinc-400">{org.id}</span>
                        <button
                          onClick={() => handleCopiarId(org)}
                          className="text-xs font-medium text-zinc-500 hover:underline"
                        >
                          {idCopiadoId === org.id ? "¡Copiado!" : "Copiar ID"}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => handleEditar(org)}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleEliminar(org)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

type Conference = {
  id: string;
  titulo: string;
  categoria: string | null;
  ponente: string | null;
  resumen: string | null;
  qr_slug: string;
  activa: boolean;
  presentacion_url: string | null;
  created_at: string;
};

type FormState = {
  titulo: string;
  categoria: string;
  ponente: string;
  resumen: string;
  qr_slug: string;
};

const FORM_VACIO: FormState = {
  titulo: "",
  categoria: "",
  ponente: "",
  resumen: "",
  qr_slug: "",
};

function slugify(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes/diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function AdminPage() {
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(FORM_VACIO);
  const [qrSlugEditadoManualmente, setQrSlugEditadoManualmente] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [presentacionUrlActual, setPresentacionUrlActual] = useState<string | null>(null);
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function cargarConferences() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/conferences");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al cargar conferencias.");
      setConferences(body.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarConferences();
  }, []);

  function resetForm() {
    setForm(FORM_VACIO);
    setQrSlugEditadoManualmente(false);
    setEditandoId(null);
    setPresentacionUrlActual(null);
    setArchivoSeleccionado(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleTituloChange(valor: string) {
    setForm((prev) => ({
      ...prev,
      titulo: valor,
      qr_slug: qrSlugEditadoManualmente ? prev.qr_slug : slugify(valor),
    }));
  }

  function handleQrSlugChange(valor: string) {
    setQrSlugEditadoManualmente(true);
    setForm((prev) => ({ ...prev, qr_slug: valor }));
  }

  function handleEditar(conf: Conference) {
    setEditandoId(conf.id);
    setQrSlugEditadoManualmente(true);
    setForm({
      titulo: conf.titulo,
      categoria: conf.categoria ?? "",
      ponente: conf.ponente ?? "",
      resumen: conf.resumen ?? "",
      qr_slug: conf.qr_slug,
    });
    setPresentacionUrlActual(conf.presentacion_url);
    setArchivoSeleccionado(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleEliminar(conf: Conference) {
    if (!confirm(`¿Eliminar la conferencia "${conf.titulo}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/conferences/${conf.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al eliminar la conferencia.");
      if (editandoId === conf.id) resetForm();
      await cargarConferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    }
  }

  async function handleActivar(conf: Conference) {
    const otraActiva = conferences.find((c) => c.activa && c.id !== conf.id);
    const mensaje = otraActiva
      ? `Esto desactivará "${otraActiva.titulo}" (activa actualmente) y activará "${conf.titulo}". Solo puede haber una conferencia activa a la vez. ¿Continuar?`
      : `¿Activar "${conf.titulo}"?`;
    if (!confirm(mensaje)) return;

    setError(null);
    try {
      const res = await fetch(`/api/admin/conferences/${conf.id}/activate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al activar la conferencia.");
      await cargarConferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    }
  }

  async function handleDesactivar(conf: Conference) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/conferences/${conf.id}/deactivate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al desactivar la conferencia.");
      await cargarConferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);

    try {
      let presentacionUrl = presentacionUrlActual;

      if (archivoSeleccionado) {
        try {
          const datosArchivo = new FormData();
          datosArchivo.append("file", archivoSeleccionado);
          datosArchivo.append("qr_slug", form.qr_slug);

          const resUpload = await fetch("/api/admin/conferences/upload", {
            method: "POST",
            body: datosArchivo,
          });
          const bodyUpload = await resUpload.json();
          if (!resUpload.ok) throw new Error(bodyUpload.error ?? "Error al subir el archivo.");

          presentacionUrl = bodyUpload.url;
        } catch (uploadErr) {
          const mensaje =
            uploadErr instanceof Error ? uploadErr.message : "Error al subir el archivo.";
          const continuarSinArchivo = confirm(
            `${mensaje}\n\n¿Guardar la conferencia igual, sin actualizar el archivo de presentación?`
          );
          if (!continuarSinArchivo) {
            setGuardando(false);
            return;
          }
          // presentacionUrl queda como estaba (presentacionUrlActual): el resto
          // de los campos se guarda igual, sin bloquear por el fallo de subida.
        }
      }

      const url = editandoId ? `/api/admin/conferences/${editandoId}` : "/api/admin/conferences";
      const method = editandoId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, presentacion_url: presentacionUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al guardar la conferencia.");

      resetForm();
      await cargarConferences();
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
          <h1 className="text-3xl font-semibold">Admin — Conferencias</h1>
          <div className="flex gap-4">
            <Link
              href="/admin/organizaciones"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Organizaciones
            </Link>
            <Link
              href="/admin/asistentes"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Asistentes
            </Link>
            <Link
              href="/admin/checkin"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Check-in
            </Link>
          </div>
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

      <section className="rounded-lg border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold">
          {editandoId ? "Editar conferencia" : "Nueva conferencia"}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Título *
              <input
                required
                value={form.titulo}
                onChange={(e) => handleTituloChange(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Categoría *
              <input
                required
                value={form.categoria}
                onChange={(e) => setForm((prev) => ({ ...prev, categoria: e.target.value }))}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Ponente *
              <input
                required
                value={form.ponente}
                onChange={(e) => setForm((prev) => ({ ...prev, ponente: e.target.value }))}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              QR slug *
              <input
                required
                value={form.qr_slug}
                onChange={(e) => handleQrSlugChange(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Resumen *
            <textarea
              required
              rows={3}
              value={form.resumen}
              onChange={(e) => setForm((prev) => ({ ...prev, resumen: e.target.value }))}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Presentación (PDF, PPT o PPTX — opcional)
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.ppt,.pptx"
              onChange={(e) => setArchivoSeleccionado(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {presentacionUrlActual && (
              <a
                href={presentacionUrlActual}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Ver presentación actual
              </a>
            )}
            {archivoSeleccionado && (
              <span className="text-xs text-zinc-500">
                Se subirá &quot;{archivoSeleccionado.name}&quot; al guardar
                {presentacionUrlActual ? " (reemplaza la actual)." : "."}
              </span>
            )}
          </label>

          <p className="text-xs text-zinc-500">
            La activación de la conferencia se maneja desde la lista de abajo,
            con el botón &quot;Activar conferencia&quot; de cada fila.
          </p>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={guardando}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {guardando ? "Guardando..." : editandoId ? "Guardar cambios" : "Crear conferencia"}
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
        <h2 className="border-b border-zinc-200 p-4 text-lg font-semibold">Conferencias</h2>

        {cargando ? (
          <p className="p-4 text-sm text-zinc-500">Cargando...</p>
        ) : conferences.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No hay conferencias cargadas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Título</th>
                  <th className="px-4 py-2 font-medium">Ponente</th>
                  <th className="px-4 py-2 font-medium">Categoría</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">QR slug</th>
                  <th className="px-4 py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {conferences.map((conf) => (
                  <tr key={conf.id}>
                    <td className="px-4 py-2">{conf.titulo}</td>
                    <td className="px-4 py-2">{conf.ponente}</td>
                    <td className="px-4 py-2">{conf.categoria}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          conf.activa
                            ? "bg-green-100 text-green-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {conf.activa ? "ACTIVA" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{conf.qr_slug}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {conf.activa ? (
                          <button
                            onClick={() => handleDesactivar(conf)}
                            className="text-xs font-medium text-amber-600 hover:underline"
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivar(conf)}
                            className="text-xs font-medium text-green-700 hover:underline"
                          >
                            Activar conferencia
                          </button>
                        )}
                        <button
                          onClick={() => handleEditar(conf)}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleEliminar(conf)}
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

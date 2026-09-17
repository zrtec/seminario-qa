"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

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
      <h1
        className="text-3xl text-[#595959]"
        style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
      >
        Conferencias
      </h1>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-[#e5e5e5] p-6">
        <h2
          className="text-lg text-[#595959]"
          style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
        >
          {editandoId ? "Editar conferencia" : "Nueva conferencia"}
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-[#595959]">
              Título *
              <input
                required
                value={form.titulo}
                onChange={(e) => handleTituloChange(e.target.value)}
                className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm focus:border-[#4472C4] focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-[#595959]">
              Categoría *
              <input
                required
                value={form.categoria}
                onChange={(e) => setForm((prev) => ({ ...prev, categoria: e.target.value }))}
                className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm focus:border-[#4472C4] focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-[#595959]">
              Ponente *
              <input
                required
                value={form.ponente}
                onChange={(e) => setForm((prev) => ({ ...prev, ponente: e.target.value }))}
                className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm focus:border-[#4472C4] focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-[#595959]">
              QR slug *
              <input
                required
                value={form.qr_slug}
                onChange={(e) => handleQrSlugChange(e.target.value)}
                className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm font-mono focus:border-[#4472C4] focus:outline-none"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm text-[#595959]">
            Resumen *
            <textarea
              required
              rows={3}
              value={form.resumen}
              onChange={(e) => setForm((prev) => ({ ...prev, resumen: e.target.value }))}
              className="rounded-md border border-[#d9d9d9] px-3 py-2 text-sm focus:border-[#4472C4] focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-[#595959]">
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
                className="text-xs text-[#4472C4] hover:underline"
              >
                Ver presentación actual
              </a>
            )}
            {archivoSeleccionado && (
              <span className="text-xs text-[#A6A6A6]">
                Se subirá &quot;{archivoSeleccionado.name}&quot; al guardar
                {presentacionUrlActual ? " (reemplaza la actual)." : "."}
              </span>
            )}
          </label>

          <p className="text-xs text-[#A6A6A6]">
            La activación de la conferencia se maneja desde la lista de abajo,
            con el botón &quot;Activar conferencia&quot; de cada fila.
          </p>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={guardando}
              className="rounded-md bg-[#22516C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1b4258] disabled:opacity-50"
            >
              {guardando ? "Guardando..." : editandoId ? "Guardar cambios" : "Crear conferencia"}
            </button>
            {editandoId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-[#d9d9d9] px-4 py-2 text-sm font-medium text-[#595959] hover:bg-zinc-50"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-[#e5e5e5]">
        <h2
          className="border-b border-[#e5e5e5] p-4 text-lg text-[#595959]"
          style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900 }}
        >
          Conferencias
        </h2>

        {cargando ? (
          <p className="p-4 text-sm text-[#A6A6A6]">Cargando...</p>
        ) : conferences.length === 0 ? (
          <p className="p-4 text-sm text-[#A6A6A6]">No hay conferencias cargadas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-[#A6A6A6]">
                <tr>
                  <th className="px-4 py-2 font-medium">Título</th>
                  <th className="px-4 py-2 font-medium">Ponente</th>
                  <th className="px-4 py-2 font-medium">Categoría</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">QR slug</th>
                  <th className="px-4 py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee]">
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
                            : "bg-[#f2f2f2] text-[#8c8c8c]"
                        }`}
                      >
                        {conf.activa ? "ACTIVA" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-[#A6A6A6]">{conf.qr_slug}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {conf.activa ? (
                          <button
                            onClick={() => handleDesactivar(conf)}
                            className="rounded-md border border-[#d9d9d9] px-3 py-1.5 text-xs font-medium text-[#595959] hover:bg-zinc-50"
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivar(conf)}
                            className="rounded-md bg-[#22516C] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1b4258]"
                          >
                            Activar conferencia
                          </button>
                        )}
                        <button
                          onClick={() => handleEditar(conf)}
                          className="rounded-md border border-[#d9d9d9] px-3 py-1.5 text-xs font-medium text-[#595959] hover:bg-zinc-50"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleEliminar(conf)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
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

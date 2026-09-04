"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Organizacion = {
  id: string;
  nombre: string;
};

type AsistenteConOrganizacion = {
  id: string;
  nombre: string;
  email: string;
  status: string;
  access_code: string;
  organization_id: string | null;
  organizations: { nombre: string } | null;
};

type FilaCSV = {
  numeroLinea: number;
  nombre: string;
  email: string;
  organization_id: string;
  organization_nombre: string;
};

type FilaPreview = FilaCSV & {
  valida: boolean;
  error: string | null;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizar(texto: string) {
  return texto.replace(/\s+/g, " ").trim().toLowerCase();
}

function parsearCSV(texto: string): FilaCSV[] {
  const lineas = texto.split(/\r\n|\n|\r/).filter((linea) => linea.trim() !== "");
  const filas: FilaCSV[] = [];

  // La primera línea es el encabezado (nombre,email,organization_id,
  // organization_nombre); el formato de columnas es fijo, así que no hace
  // falta validar su contenido, solo saltearla.
  for (let i = 1; i < lineas.length; i++) {
    const columnas = lineas[i].split(",").map((columna) => columna.trim());
    filas.push({
      numeroLinea: i + 1,
      nombre: columnas[0] ?? "",
      email: columnas[1] ?? "",
      organization_id: columnas[2] ?? "",
      organization_nombre: columnas[3] ?? "",
    });
  }
  return filas;
}

function validarFilas(
  filas: FilaCSV[],
  organizacionesPorId: Map<string, string>,
  emailsExistentes: Set<string>
): FilaPreview[] {
  const conteoEmails = new Map<string, number>();
  for (const fila of filas) {
    const clave = normalizar(fila.email);
    conteoEmails.set(clave, (conteoEmails.get(clave) ?? 0) + 1);
  }

  return filas.map((fila) => {
    if (!fila.nombre || !fila.email || !fila.organization_id || !fila.organization_nombre) {
      return { ...fila, valida: false, error: "campo faltante" };
    }

    if (!UUID_REGEX.test(fila.organization_id)) {
      return { ...fila, valida: false, error: "organization_id no es un uuid válido" };
    }

    const nombreReal = organizacionesPorId.get(fila.organization_id.toLowerCase());
    if (nombreReal === undefined) {
      return { ...fila, valida: false, error: "organization_id no existe en la base de datos" };
    }

    if (normalizar(nombreReal) !== normalizar(fila.organization_nombre)) {
      return {
        ...fila,
        valida: false,
        error: `organization_nombre no coincide con el nombre real (dice "${fila.organization_nombre}" pero la organización con ese id se llama "${nombreReal}")`,
      };
    }

    if ((conteoEmails.get(normalizar(fila.email)) ?? 0) > 1) {
      return { ...fila, valida: false, error: "email duplicado en el CSV" };
    }

    if (emailsExistentes.has(normalizar(fila.email))) {
      return { ...fila, valida: false, error: "email ya existe en el sistema" };
    }

    return { ...fila, valida: true, error: null };
  });
}

function handleDescargarPlantilla() {
  const contenido =
    "nombre,email,organization_id,organization_nombre\n" +
    "Juan Pérez,juan.perez@ejemplo.com,00000000-0000-0000-0000-000000000000,Empresa Ejemplo S.A.\n";
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = "plantilla_asistentes.csv";
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

export default function AsistentesAdminPage() {
  const [asistentes, setAsistentes] = useState<AsistenteConOrganizacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filaPreview, setFilaPreview] = useState<FilaPreview[] | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [procesandoArchivo, setProcesandoArchivo] = useState(false);
  const [importando, setImportando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function cargarAsistentes() {
    const res = await fetch("/api/admin/asistentes");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Error al cargar asistentes.");
    setAsistentes(body.data ?? []);
  }

  async function cargarTodo() {
    setCargando(true);
    setError(null);
    try {
      await cargarAsistentes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarTodo();
  }, []);

  function resetImportacion() {
    setFilaPreview(null);
    setNombreArchivo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleArchivoChange(archivo: File | null) {
    if (!archivo) return;
    setError(null);
    setNombreArchivo(archivo.name);
    setProcesandoArchivo(true);
    setFilaPreview(null);

    try {
      const texto = await archivo.text();
      const filas = parsearCSV(texto);

      // Se resuelve contra un snapshot fresco de organizations/attendees
      // (no el que ya está en pantalla) para minimizar el desfasaje entre
      // esta previsualización y la confirmación real.
      const [resOrgs, resAsistentes] = await Promise.all([
        fetch("/api/admin/organizaciones"),
        fetch("/api/admin/asistentes"),
      ]);
      const bodyOrgs = await resOrgs.json();
      const bodyAsistentes = await resAsistentes.json();
      if (!resOrgs.ok) throw new Error(bodyOrgs.error ?? "Error al cargar organizaciones.");
      if (!resAsistentes.ok) throw new Error(bodyAsistentes.error ?? "Error al cargar asistentes.");

      const organizaciones: Organizacion[] = bodyOrgs.data ?? [];
      const asistentesActuales: AsistenteConOrganizacion[] = bodyAsistentes.data ?? [];

      const organizacionesPorId = new Map(
        organizaciones.map((org) => [org.id.toLowerCase(), org.nombre])
      );
      const emailsExistentes = new Set(
        asistentesActuales.map((a) => normalizar(a.email))
      );

      setFilaPreview(validarFilas(filas, organizacionesPorId, emailsExistentes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar el archivo.");
      resetImportacion();
    } finally {
      setProcesandoArchivo(false);
    }
  }

  const resumenPorOrganizacion = useMemo(() => {
    if (!filaPreview) return [];
    const mapa = new Map<string, number>();
    for (const fila of filaPreview) {
      if (!fila.valida) continue;
      mapa.set(fila.organization_nombre, (mapa.get(fila.organization_nombre) ?? 0) + 1);
    }
    return Array.from(mapa.entries());
  }, [filaPreview]);

  const hayFilasInvalidas = filaPreview?.some((fila) => !fila.valida) ?? true;
  const totalValidas = filaPreview?.filter((fila) => fila.valida).length ?? 0;

  async function handleConfirmarImportacion() {
    if (!filaPreview || hayFilasInvalidas || totalValidas === 0) return;
    setError(null);
    setImportando(true);

    try {
      const payload = filaPreview
        .filter((fila) => fila.valida)
        .map((fila) => ({
          nombre: fila.nombre,
          email: fila.email,
          organization_id: fila.organization_id,
        }));

      const res = await fetch("/api/admin/asistentes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error al importar los asistentes.");

      resetImportacion();
      await cargarAsistentes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setImportando(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Admin — Asistentes</h1>
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

      <section className="rounded-lg border border-zinc-200 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cargar asistentes desde CSV</h2>
          <button
            type="button"
            onClick={handleDescargarPlantilla}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Descargar plantilla CSV
          </button>
        </div>

        <p className="mt-1 text-xs text-zinc-500">
          Columnas esperadas: <code className="font-mono">nombre,email,organization_id,organization_nombre</code>.
          El <code className="font-mono">organization_id</code> debe ser el uuid real de una organización
          existente; <code className="font-mono">organization_nombre</code> es solo verificación cruzada.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleArchivoChange(e.target.files?.[0] ?? null)}
          className="mt-4 text-sm"
        />

        {procesandoArchivo && (
          <p className="mt-3 text-sm text-zinc-500">Procesando &quot;{nombreArchivo}&quot;...</p>
        )}

        {filaPreview && !procesandoArchivo && (
          <div className="mt-6 flex flex-col gap-4">
            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Línea</th>
                    <th className="px-3 py-2 font-medium">Nombre</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Organización (CSV)</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filaPreview.map((fila) => (
                    <tr key={fila.numeroLinea} className={fila.valida ? "" : "bg-red-50"}>
                      <td className="px-3 py-2 text-zinc-500">{fila.numeroLinea}</td>
                      <td className="px-3 py-2">{fila.nombre}</td>
                      <td className="px-3 py-2">{fila.email}</td>
                      <td className="px-3 py-2">{fila.organization_nombre}</td>
                      <td className="px-3 py-2">
                        {fila.valida ? (
                          <span className="text-green-700">✅ Válida</span>
                        ) : (
                          <span className="text-red-700">❌ {fila.error}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hayFilasInvalidas ? (
              <p className="text-sm text-red-700">
                Hay filas con error. Corregí el CSV y volvé a subirlo antes de poder importar.
              </p>
            ) : (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <p className="font-medium">
                  {totalValidas} asistente{totalValidas === 1 ? "" : "s"} listo
                  {totalValidas === 1 ? "" : "s"} para importar, agrupados por organización:
                </p>
                <ul className="mt-2 list-disc pl-5">
                  {resumenPorOrganizacion.map(([nombreOrg, cantidad]) => (
                    <li key={nombreOrg}>
                      {nombreOrg}: {cantidad}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmarImportacion}
                disabled={hayFilasInvalidas || totalValidas === 0 || importando}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {importando ? "Importando..." : "Confirmar importación"}
              </button>
              <button
                type="button"
                onClick={resetImportacion}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200">
        <h2 className="border-b border-zinc-200 p-4 text-lg font-semibold">Asistentes cargados</h2>

        {cargando ? (
          <p className="p-4 text-sm text-zinc-500">Cargando...</p>
        ) : asistentes.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No hay asistentes cargados todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Nombre</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Organización</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">Código de acceso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {asistentes.map((asistente) => (
                  <tr key={asistente.id}>
                    <td className="px-4 py-2">{asistente.nombre}</td>
                    <td className="px-4 py-2">{asistente.email}</td>
                    <td className="px-4 py-2">{asistente.organizations?.nombre ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          asistente.status === "presente"
                            ? "bg-green-100 text-green-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {asistente.status === "presente" ? "Presente" : "Precargado"}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{asistente.access_code}</td>
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

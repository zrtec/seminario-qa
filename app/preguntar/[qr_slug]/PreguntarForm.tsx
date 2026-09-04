"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

const LIMITE_CARACTERES = 500;

type Asistente = {
  id: string;
  nombre: string;
  organization_nombre: string | null;
};

type Paso = "identificar" | "pregunta" | "enviada";

export default function PreguntarForm({ conferenceId }: { conferenceId: string }) {
  const [paso, setPaso] = useState<Paso>("identificar");

  const [identificador, setIdentificador] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [asistente, setAsistente] = useState<Asistente | null>(null);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  async function handleBuscar(e: FormEvent) {
    e.preventDefault();
    const valor = identificador.trim();
    if (!valor) return;

    setBuscando(true);
    setErrorBusqueda(null);
    setNoEncontrado(false);

    try {
      const { data, error } = await supabase.rpc("buscar_asistente", {
        identificador: valor,
      });
      if (error) throw error;

      const encontrado = Array.isArray(data) ? data[0] : null;
      if (!encontrado) {
        setNoEncontrado(true);
        setAsistente(null);
        return;
      }

      setAsistente({
        id: encontrado.id,
        nombre: encontrado.nombre,
        organization_nombre: encontrado.organization_nombre,
      });
      setPaso("pregunta");
    } catch {
      setErrorBusqueda("No pudimos verificar tu registro. Intentá de nuevo.");
    } finally {
      setBuscando(false);
    }
  }

  function handleNoSoyYo() {
    setAsistente(null);
    setIdentificador("");
    setNoEncontrado(false);
    setPaso("identificar");
  }

  async function handleEnviar(e: FormEvent) {
    e.preventDefault();
    const contenido = texto.trim();
    if (!contenido || !asistente) return;

    setEnviando(true);
    setErrorEnvio(null);

    try {
      const { error } = await supabase.from("questions").insert({
        conference_id: conferenceId,
        attendee_id: asistente.id,
        texto: contenido,
        ai_status: "pendiente",
        mostrada_en_pantalla: false,
      });
      if (error) throw error;

      setTexto("");
      setPaso("enviada");
    } catch {
      setErrorEnvio("No pudimos enviar tu pregunta. Intentá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  function handleEnviarOtra() {
    setTexto("");
    setErrorEnvio(null);
    setPaso("pregunta");
  }

  return (
    <div className="flex flex-col gap-6">
      {paso === "identificar" && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Identificate</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Ingresá el email o el código de acceso con el que te registraste.
            </p>
          </div>

          <form onSubmit={handleBuscar} className="flex flex-col gap-3">
            <input
              type="text"
              value={identificador}
              onChange={(e) => {
                setIdentificador(e.target.value);
                setNoEncontrado(false);
                setErrorBusqueda(null);
              }}
              placeholder="Tu email o código de acceso"
              autoFocus
              autoCapitalize="none"
              autoComplete="off"
              className="w-full rounded-xl border border-zinc-300 px-4 py-4 text-lg"
            />
            <button
              type="submit"
              disabled={buscando || !identificador.trim()}
              className="w-full rounded-xl bg-zinc-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {buscando ? "Buscando..." : "Continuar"}
            </button>
          </form>

          {noEncontrado && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-800">
              No encontramos tu registro. Por favor acércate al staff para
              confirmar tu asistencia.
            </div>
          )}

          {errorBusqueda && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-base text-red-700">
              {errorBusqueda}
            </div>
          )}
        </section>
      )}

      {paso !== "identificar" && asistente && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-green-300 bg-green-50 p-4">
          <p className="text-base text-green-800">
            Hola, <span className="font-semibold">{asistente.nombre}</span>
            {asistente.organization_nombre ? ` (${asistente.organization_nombre})` : ""}
          </p>
          <button
            type="button"
            onClick={handleNoSoyYo}
            className="shrink-0 text-sm font-medium text-green-700 underline"
          >
            No soy yo
          </button>
        </div>
      )}

      {paso === "pregunta" && (
        <section className="flex flex-col gap-4">
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-base font-medium text-amber-900">
            No se permiten comentarios ofensivos, groserías, contenido político,
            religioso o discriminatorio. Las preguntas que no cumplan estas
            reglas no serán mostradas.
          </div>

          <form onSubmit={handleEnviar} className="flex flex-col gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, LIMITE_CARACTERES))}
              maxLength={LIMITE_CARACTERES}
              rows={5}
              placeholder="Escribí tu pregunta..."
              autoFocus
              className="w-full resize-none rounded-xl border border-zinc-300 px-4 py-3 text-lg"
            />
            <p className="self-end text-sm text-zinc-400">
              {texto.length}/{LIMITE_CARACTERES}
            </p>

            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              className="w-full rounded-xl bg-zinc-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {enviando ? "Enviando..." : "Enviar pregunta"}
            </button>
          </form>

          {errorEnvio && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-base text-red-700">
              {errorEnvio}
            </div>
          )}
        </section>
      )}

      {paso === "enviada" && (
        <section className="flex flex-col items-center gap-4 rounded-xl border-2 border-green-400 bg-green-50 p-6 text-center">
          <p className="text-xl font-semibold text-green-900">
            ¡Pregunta enviada!
          </p>
          <p className="text-base text-green-800">
            Puede tardar unos segundos en revisarse.
          </p>
          <button
            type="button"
            onClick={handleEnviarOtra}
            className="w-full rounded-xl bg-zinc-900 px-4 py-4 text-lg font-semibold text-white"
          >
            Enviar otra pregunta
          </button>
        </section>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

const LIMITE_CARACTERES = 500;
const COOLDOWN_SEGUNDOS = 30;

// SQLSTATE inventado que insertar_pregunta() usa específicamente para la
// excepción de rate limit (ver supabase/rate_limit_preguntas.sql) — se
// compara por código, no por el texto del mensaje, para no depender de que
// la redacción de la excepción en SQL no cambie nunca.
const CODIGO_RATE_LIMIT = "RLIMT";

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
  const [cooldown, setCooldown] = useState(0);

  // Mejora de UX, no la garantía real (esa vive en insertar_pregunta(), ver
  // supabase/rate_limit_preguntas.sql): cuenta regresiva de 1s mientras
  // cooldown > 0, para que la persona no tenga que descubrir el límite de
  // 30s por prueba y error. Se reinicia solo si recarga la página.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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
      setErrorBusqueda("No pudimos verificar tu registro. Intenta de nuevo.");
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
      const { error } = await supabase.rpc("insertar_pregunta", {
        p_attendee_id: asistente.id,
        p_conference_id: conferenceId,
        p_texto: contenido,
      });
      if (error) throw error;

      setTexto("");
      setPaso("enviada");
      setCooldown(COOLDOWN_SEGUNDOS);
    } catch (err) {
      const { code, message } = err as { code?: string; message?: string };
      if (code === CODIGO_RATE_LIMIT && message) {
        // Mensaje ya redactado para el usuario final por insertar_pregunta().
        setErrorEnvio(message);
      } else {
        setErrorEnvio("No pudimos enviar tu pregunta. Intenta de nuevo.");
      }
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
    <div className="flex flex-col gap-5">
      {paso === "identificar" && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#22516C]">Identificate</h2>
            <p className="mt-1 text-sm text-[#595959]">
              Ingresa el email o el código de acceso con el que te registraste.
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
              className="w-full rounded-xl border border-[#d9e2e8] px-4 py-4 text-lg text-[#22516C] outline-none focus:border-[#4472C4] focus:ring-2 focus:ring-[#4472C4]/20"
            />
            <button
              type="submit"
              disabled={buscando || !identificador.trim()}
              className="w-full rounded-xl bg-[#22516C] px-4 py-4 text-lg font-semibold text-white transition hover:bg-[#1b4258] disabled:opacity-50"
            >
              {buscando ? "Buscando..." : "Continuar"}
            </button>
          </form>

          {noEncontrado && (
            <div className="rounded-xl border border-[#e8c9a0] bg-[#fdf5ea] p-4 text-base text-[#8a5a1f]">
              No encontramos tu registro. Por favor acércate al staff para
              confirmar tu asistencia.
            </div>
          )}

          {errorBusqueda && (
            <div className="rounded-xl border border-[#f0c4c4] bg-[#fdf2f2] p-4 text-base text-[#a83a3a]">
              {errorBusqueda}
            </div>
          )}
        </section>
      )}

      {paso !== "identificar" && asistente && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f8fa] p-4">
          <p className="text-base text-[#22516C]">
            Hola, <span className="font-semibold">{asistente.nombre}</span>
            {asistente.organization_nombre ? ` · ${asistente.organization_nombre}` : ""}
          </p>
          <button
            type="button"
            onClick={handleNoSoyYo}
            className="shrink-0 text-sm font-medium text-[#4472C4] underline"
          >
            No soy yo
          </button>
        </div>
      )}

      {paso === "pregunta" && (
        <section className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-xl bg-[#eef4f8] p-4 text-sm text-[#22516C]">
            <span aria-hidden="true" className="mt-0.5 text-base leading-none">
              ⓘ
            </span>
            <p>
              No se permiten comentarios ofensivos, groserías, contenido político,
              religioso o discriminatorio. Las preguntas que no cumplan estas
              reglas no serán mostradas.
            </p>
          </div>

          <form onSubmit={handleEnviar} className="flex flex-col gap-2">
            <label className="text-sm font-bold text-[#595959]">Tu pregunta</label>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, LIMITE_CARACTERES))}
              maxLength={LIMITE_CARACTERES}
              rows={5}
              placeholder="Escribe tu pregunta..."
              autoFocus
              className="w-full resize-none rounded-xl border border-[#d9e2e8] px-4 py-3 text-lg text-[#22516C] outline-none focus:border-[#4472C4] focus:ring-2 focus:ring-[#4472C4]/20"
            />
            <p className="self-end text-sm text-[#A6A6A6]">
              {texto.length}/{LIMITE_CARACTERES}
            </p>

            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              className="w-full rounded-xl bg-[#22516C] px-4 py-4 text-lg font-semibold text-white transition hover:bg-[#1b4258] disabled:opacity-50"
            >
              {enviando ? "Enviando..." : "Enviar pregunta"}
            </button>
          </form>

          {errorEnvio && (
            <div className="rounded-xl border border-[#f0c4c4] bg-[#fdf2f2] p-4 text-base text-[#a83a3a]">
              {errorEnvio}
            </div>
          )}
        </section>
      )}

      {paso === "enviada" && (
        <section className="flex flex-col items-center gap-3 rounded-xl bg-[#f5f8fa] p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eef4f8] text-2xl text-[#22516C]">
            ✓
          </div>
          <p className="text-xl font-semibold text-[#595959]">¡Pregunta enviada!</p>
          <p className="text-base text-[#A6A6A6]">
            Puede tardar unos segundos en revisarse.
          </p>
          <button
            type="button"
            onClick={handleEnviarOtra}
            disabled={cooldown > 0}
            className={
              cooldown > 0
                ? "w-full rounded-xl bg-[#e9edf0] px-4 py-4 text-lg font-semibold text-[#a6a6a6]"
                : "w-full rounded-xl bg-[#22516C] px-4 py-4 text-lg font-semibold text-white transition hover:bg-[#1b4258]"
            }
          >
            Enviar otra pregunta
          </button>
          {cooldown > 0 && (
            <p className="text-sm text-[#22516C]">
              Podrás enviar otra pregunta en {cooldown}s...
            </p>
          )}
        </section>
      )}
    </div>
  );
}

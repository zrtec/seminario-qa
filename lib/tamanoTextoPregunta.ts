// Tamaño de fuente dinámico según longitud: una pregunta larga con un tamaño
// fijo se desborda de la pantalla. Los umbrales priorizan que quepa sin
// cortarse, con overflow-y-auto en el contenedor como salvaguarda adicional
// para el caso extremo que ni así entre. Compartido por PantallaPrincipal y
// PantallaKiosko.
//
// PantallaKiosko usa compacto=true: una escala más chica y comprimida (sin
// tramo lg, tope en sm) para que (a) el texto quepa en su "main", más bajo
// que el de PantallaPrincipal, y (b) la diferencia visual entre una pregunta
// corta y una larga sea sutil en vez de dramática, como pidió el usuario
// tras ver la escala original demasiado agresiva. PantallaPrincipal sigue
// usando la escala original (compacto=false, default).
export function tamanoTextoPregunta(texto: string, compacto = false): string {
  const len = texto.length;
  if (compacto) {
    if (len < 80) return "text-4xl sm:text-5xl";
    if (len <= 160) return "text-3xl sm:text-4xl";
    return "text-2xl sm:text-3xl";
  }
  if (len < 80) return "text-6xl sm:text-7xl lg:text-8xl";
  if (len <= 160) return "text-4xl sm:text-5xl lg:text-6xl";
  return "text-3xl sm:text-4xl lg:text-4xl";
}

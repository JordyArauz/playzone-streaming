/**
 * Suprime metadatos automáticos del antiguo Excel solo al mostrar datos.
 * NO modifica los registros guardados en Supabase.
 * Conserva el texto escrito antes de las etiquetas técnicas de importación.
 */
export function visibleNote(value) {
  const text = String(value ?? '').replace(/\r/g, '').trim();
  if (!text) return '';
  const technical = /(?:\bID\s+del\s+Excel\s*:|\bOrigen\s*:\s*Streaming\.xlsx\b|\bForma\s+de\s+pago\s+no\s+documentada\b|\bEstado\s+de\s+pago\s+no\s+documentado\b)/i;
  const match = technical.exec(text);
  return (match ? text.slice(0, match.index) : text)
    .replace(/[\s\-|;—–:,]+$/g, '')
    .trim();
}

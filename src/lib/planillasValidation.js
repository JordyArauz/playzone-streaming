/**
 * Validaciones de los campos editables de Planillas.
 * Las fechas se presentan en DD/MM (o DD/MM/AAAA para cuentas existentes).
 * Se almacena también su equivalente ISO para un futuro guardado en Supabase.
 * Esta biblioteca no renueva suscripciones ni modifica registros remotos.
 */

const ONLY_PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;

/** Devuelve el formato visible y el número internacional para WhatsApp. */
export function validateContact(rawValue, { required = false } = {}) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    return required
      ? { valid: false, message: 'El cliente debe tener un número de contacto.' }
      : { valid: true, display: '', international: null, country: null };
  }

  if (!ONLY_PHONE_CHARACTERS.test(raw) || (raw.match(/\+/g) || []).length > 1) {
    return { valid: false, message: 'Usa solo números, espacios, guiones, paréntesis o + al principio.' };
  }

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Bolivia: 8 dígitos que empiezan en 6 o 7 (local o con +591).
  if (/^[67]\d{7}$/.test(digits)) {
    return { valid: true, display: digits, international: `591${digits}`, country: 'BO' };
  }
  if (/^591[67]\d{7}$/.test(digits)) {
    return { valid: true, display: `+${digits}`, international: digits, country: 'BO' };
  }

  // Perú: móvil de 9 dígitos que empieza por 9.
  if (/^9\d{8}$/.test(digits)) {
    return { valid: true, display: digits, international: `51${digits}`, country: 'PE' };
  }
  if (/^519\d{8}$/.test(digits)) {
    return { valid: true, display: `+${digits}`, international: digits, country: 'PE' };
  }

  // Argentina: formato internacional para móviles: +54 9 + 10 dígitos.
  if (/^549[1-9]\d{9}$/.test(digits)) {
    return { valid: true, display: `+${digits}`, international: digits, country: 'AR' };
  }

  // También aceptar +54 (código de área) 15 (abonado doméstico).
  const argWith15 = digits.match(/^54(\d{2,4})15(\d{6,8})$/);
  if (argWith15 && (argWith15[1].length + argWith15[2].length === 10)) {
    const international = `549${argWith15[1]}${argWith15[2]}`;
    return { valid: true, display: `+${international}`, international, country: 'AR' };
  }

  return {
    valid: false,
    message: 'Número inválido. Bolivia: 6/7 + 7 dígitos; Perú: 9 dígitos desde 9; Argentina: +549 y 10 dígitos.',
  };
}

export function normalizeWhatsAppNumber(value) {
  const result = validateContact(value);
  return result.valid ? result.international : null;
}

const pad = (value) => String(value).padStart(2, '0');

function makeDate(day, month, year) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? date : null;
}

const formatIso = (date) => date.toISOString().slice(0, 10);

function parsePart(source) {
  const matched = source.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  return matched ? {
    day: Number(matched[1]),
    month: Number(matched[2]),
    year: matched[3] ? Number(matched[3]) : null,
  } : null;
}

/**
 * Interpreta años ocultos de DD/MM usando el año actual o el año ya guardado.
 * Solo un intervalo que cruza noviembre/diciembre -> enero/febrero puede
 * pasar al año siguiente, y se limita a 92 días para no reinterpretar errores.
 */
export function validateDateRange(rawValue, { referenceStartISO = null, required = false, today = new Date() } = {}) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    return required
      ? { valid: false, message: 'Debes indicar las fechas de inicio y fin.' }
      : { valid: true, display: '', startISO: null, endISO: null };
  }

  const match = raw.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s*[-–—]\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?)$/);
  if (!match) {
    return { valid: false, message: 'Formato: DD/MM - DD/MM (o DD/MM/AAAA - DD/MM/AAAA).' };
  }

  const start = parsePart(match[1]);
  const end = parsePart(match[2]);
  if (!start || !end || (start.year === null) !== (end.year === null)) {
    return { valid: false, message: 'Usa el mismo formato en las dos fechas.' };
  }

  const hasYear = start.year !== null;
  const yearStored = /^\d{4}-\d{2}-\d{2}$/.test(String(referenceStartISO ?? ''))
    ? Number(referenceStartISO.slice(0, 4)) : null;

  // Si aún no existe el año oculto, escoger el ciclo más cercano a hoy.
  // Ejemplo: en enero, 25/12 - 24/01 pertenece a diciembre anterior.
  let anchorYear = yearStored ?? today.getFullYear();
  if (!hasYear && yearStored === null) {
    const crossing = end.month < start.month && start.month >= 11 && end.month <= 2;
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const candidates = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]
      .map((year) => {
        const from = makeDate(start.day, start.month, year);
        const to = makeDate(end.day, end.month, year + (crossing ? 1 : 0));
        if (!from || !to || to.getTime() < from.getTime()) return null;
        const duration = (to.getTime() - from.getTime()) / 86400000;
        if (crossing && duration > 92) return null;
        const distance = todayUTC < from.getTime()
          ? from.getTime() - todayUTC
          : (todayUTC > to.getTime() ? todayUTC - to.getTime() : 0);
        return { year, distance };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);
    if (candidates.length) anchorYear = candidates[0].year;
  }
  const startYear = hasYear ? start.year : anchorYear;
  let endYear = hasYear ? end.year : anchorYear;
  const startDate = makeDate(start.day, start.month, startYear);
  if (!startDate) {
    return { valid: false, message: 'La fecha de inicio no existe en el calendario.' };
  }

  if (!hasYear && end.month < start.month) {
    // Diferenciar cambio de año auténtico de una fecha final anterior.
    if (start.month < 11 || end.month > 2) {
      return { valid: false, message: 'La fecha final no puede ser anterior a la inicial.' };
    }
    endYear += 1;
  }

  const endDate = makeDate(end.day, end.month, endYear);
  if (!endDate) {
    return { valid: false, message: 'La fecha final no existe en el calendario.' };
  }
  const elapsedDays = (endDate.getTime() - startDate.getTime()) / 86400000;
  if (elapsedDays < 0 || (!hasYear && endYear > startYear && elapsedDays > 92)) {
    return { valid: false, message: 'La fecha final no puede ser anterior a la inicial.' };
  }

  const format = (item, year) => `${pad(item.day)}/${pad(item.month)}${hasYear ? `/${year}` : ''}`;
  return {
    valid: true,
    display: `${format(start, startYear)} - ${format(end, endYear)}`,
    startISO: formatIso(startDate),
    endISO: formatIso(endDate),
  };
}

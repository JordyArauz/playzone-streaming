import { validateDateRange } from './planillasValidation.js';

// Zona horaria operativa de PlayZone. No depende de la zona horaria del navegador.
export function businessDateISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (name) => parts.find((part) => part.type === name)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (value) => isoPattern.test(String(value || ''))
  ? new Date(`${value}T12:00:00Z`) : null;
const pad = (n) => String(n).padStart(2, '0');
const toISO = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
export function daysUntil(date, todayISO = businessDateISO()) {
  if (!isoPattern.test(String(date)) || !isoPattern.test(String(todayISO))) return null;
  const target = isoDate(date), today = isoDate(todayISO);
  if (!target || !today || Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
export function periodOf(entity, kind, todayISO = businessDateISO()) {
  const isAccount = kind === 'account';
  const startKey = isAccount ? 'subscriptionStartISO' : 'periodStartISO';
  const endKey = isAccount ? 'subscriptionEndISO' : 'periodEndISO';
  const display = isAccount ? entity.subscription : entity.dateRange;
  const saved = entity[startKey] && entity[endKey];
  if (saved && isoPattern.test(entity[startKey]) && isoPattern.test(entity[endKey])) {
    return { startISO: entity[startKey], endISO: entity[endKey] };
  }
  const checked = validateDateRange(display, { today: isoDate(todayISO) });
  return checked.valid && checked.startISO && checked.endISO ? checked : null;
}
export function effectiveStatus(entity, kind, todayISO = businessDateISO()) {
  const status = entity.status || 'Pendiente';
  if (status === 'Disponible' || status === 'Deshabilitado') return status;
  const period = periodOf(entity, kind, todayISO);
  // Cualquier estado habilitado o pendiente vence al llegar su último día,
  // pero no se modifica el registro original hasta confirmar el pago.
  if (period && daysUntil(period.endISO, todayISO) <= 0) return 'Pendiente';
  return status;
}
function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
function plusUtcMonth(date) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  const nextMonthFirst = new Date(Date.UTC(year, month + 1, 1));
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(nextMonthFirst.getUTCFullYear(), nextMonthFirst.getUTCMonth(),
    Math.min(date.getUTCDate(), lastDay)));
}

/** Nuevo ciclo: día posterior al fin anterior, hasta el día anterior a un mes después. */
export function extendPeriodOneMonth(startISO, endISO) {
  if (!isoPattern.test(startISO) || !isoPattern.test(endISO)) throw new Error('Fechas incompletas.');
  const end = isoDate(endISO);
  const newStart = addUtcDays(end, 1);
  const newEnd = addUtcDays(plusUtcMonth(newStart), -1);
  return { startISO: toISO(newStart), endISO: toISO(newEnd) };
}
function formatPeriod(from, to, includeYear) {
  const fmt = (iso) => `${iso.slice(8,10)}/${iso.slice(5,7)}${includeYear ? `/${iso.slice(0,4)}` : ''}`;
  return `${fmt(from)} - ${fmt(to)}`;
}
export function confirmPaidRenewal(entity, kind, todayISO = businessDateISO()) {
  if (entity.status === 'Disponible') {
    return { ok: false, message: 'Primero asigna el perfil disponible a un cliente.' };
  }
  if (kind === 'member' && !String(entity.name || '').trim()) {
    return { ok: false, message: 'Registra primero el nombre del cliente.' };
  }
  const period = periodOf(entity, kind, todayISO);
  if (!period) return { ok: false, message: 'Primero registra un período válido para poder renovarlo.' };
  // Bloquea dobles pulsaciones y confirmaciones repetidas en el mismo día,
  // incluyendo después de recargar (si existe el respaldo local de pruebas).
  if (entity.lastPaymentConfirmedISO === todayISO) {
    return { ok: false, message: 'Ya confirmaste un pago para esta cuenta o cliente hoy. No se sumó otro mes.' };
  }
  const next = extendPeriodOneMonth(period.startISO, period.endISO);
  const account = kind === 'account';
  const hasYear = account && /\d{4}/.test(String(entity.subscription || ''));
  return {
    ok: true, previousEndISO: period.endISO,
    fields: {
      status: 'Habilitado',
      ...(account ? {
        subscription: formatPeriod(next.startISO, next.endISO, hasYear),
        subscriptionStartISO: next.startISO, subscriptionEndISO: next.endISO,
      } : {
        dateRange: formatPeriod(next.startISO, next.endISO, false),
        periodStartISO: next.startISO, periodEndISO: next.endISO,
      }),
      lastPaymentConfirmedISO: todayISO,
      lastRenewedFromEndISO: period.endISO,
      renewalCount: (entity.renewalCount || 0) + 1,
    },
  };
}

// Este respaldo SOLO incluye fechas, estados, IDs y pagos de prueba;
// no almacena contraseñas, teléfonos ni nombres reales en localStorage.
export const RENEWAL_DEMO_PREFIX = 'playzone_renewal_demo_v1:';
export function restoreRenewalDemo(initial, userId = 'local') {
  if (typeof window === 'undefined' || !userId) return initial;
  let overrides;
  try { overrides = JSON.parse(window.localStorage.getItem(RENEWAL_DEMO_PREFIX + userId) || '{}'); }
  catch { return initial; }
  const apply = (entity, key) => ({ ...entity, ...(overrides[key] || {}) });
  return Object.fromEntries(Object.entries(initial).map(([sheet, accounts]) => [sheet,
    accounts.map((account) => ({
      ...apply(account, `account:${sheet}:${account.id}`),
      members: account.members.map((member) => apply(member, `member:${sheet}:${account.id}:${member.id}`)),
    })),
  ]));
}
export function saveRenewalDemo(data, userId = 'local') {
  if (typeof window === 'undefined' || !userId) return;
  const payload = {};
  for (const [sheet, accounts] of Object.entries(data)) for (const account of accounts) {
    const fields = (entity, kind) => {
      if (!entity.lastPaymentConfirmedISO) return null;
      const names = kind === 'account'
        ? ['status','subscription','subscriptionStartISO','subscriptionEndISO','lastPaymentConfirmedISO','lastRenewedFromEndISO','renewalCount']
        : ['status','dateRange','periodStartISO','periodEndISO','lastPaymentConfirmedISO','lastRenewedFromEndISO','renewalCount'];
      return Object.fromEntries(names.filter((name) => entity[name] !== undefined).map((name) => [name, entity[name]]));
    };
    const accountResult = fields(account,'account');
    if (accountResult) payload[`account:${sheet}:${account.id}`] = accountResult;
    for (const member of account.members) {
      const result = fields(member,'member');
      if (result) payload[`member:${sheet}:${account.id}:${member.id}`] = result;
    }
  }
  try { window.localStorage.setItem(RENEWAL_DEMO_PREFIX + userId, JSON.stringify(payload)); } catch { /* privados */ }
}
export function localPlanillasDueItems(groupedData, todayISO = businessDateISO()) {
  const results = [];
  const add = (entity, kind, sheet, accountId) => {
    if (entity.status === 'Disponible' || entity.status === 'Deshabilitado') return;
    if (kind === 'member' && !String(entity.name || '').trim()) return;
    const period = periodOf(entity, kind, todayISO);
    if (!period) return;
    const days = daysUntil(period.endISO, todayISO);
    if (days === null || days > 1 || days < -7) return;
    const label = kind === 'account' ? (entity.email || entity.cardName || 'Cuenta') : entity.name;
    results.push({
      id: `demo-${kind}-${sheet}-${accountId}-${entity.id}`,
      days, date: period.endISO,
      category: kind === 'account' ? 'Cuenta · Planillas local' : 'Cliente · Planillas local',
      title: `${sheet} · ${label}`,
    });
  };
  for (const [sheet, accounts] of Object.entries(groupedData)) for (const account of accounts) {
    add(account, 'account', sheet, account.id);
    for (const member of account.members) add(member, 'member', sheet, account.id);
  }
  return results.sort((a,b) => a.days - b.days);
}

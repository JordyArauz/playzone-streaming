import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveStatus } from '../src/lib/planillasRenewal.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const account = {status:'Habilitado',subscriptionStartISO:'2026-09-14',subscriptionEndISO:'2026-10-13'};
const member = {status:'Habilitado',periodStartISO:'2026-09-14',periodEndISO:'2026-10-13'};
test('cuenta y cliente cambian a pendiente al vencer sin tocar Supabase', () => {
  assert.equal(effectiveStatus(account,'account','2026-10-12'),'Habilitado');
  assert.equal(effectiveStatus(account,'account','2026-10-13'),'Pendiente');
  assert.equal(effectiveStatus(member,'member','2026-10-13'),'Pendiente');
  assert.equal(effectiveStatus(member,'member','2026-10-14'),'Pendiente');
  assert.equal(account.status,'Habilitado');
  assert.equal(member.status,'Habilitado');
});
test('deshabilitado y disponible permanecen intactos incluso si vencieron', () => {
  assert.equal(effectiveStatus({...member,status:'Deshabilitado'},'member','2026-10-14'),'Deshabilitado');
  assert.equal(effectiveStatus({...member,status:'Disponible'},'member','2026-10-14'),'Disponible');
});
test('no quedan botones de renovación de cuentas en ninguna planilla', () => {
  const page = read('src/pages/Planillas.jsx');
  assert.doesNotMatch(page,/Pago recibido · Renovar cuenta|planilla-confirm-payment-btn/);
  assert.match(page,/function changePaidStatus/);
});
test('eliminar historial afecta reminders finalizados, nunca pagos o renovación', () => {
  const code = read('src/components/ReminderCenter.jsx');
  const fn = code.split('async function deleteHistory(items) {')[1].split('async function togglePush()')[0];
  assert.match(fn,/from\('reminders'\)/);
  assert.match(fn,/\.eq\('user_id', userId\)/);
  assert.match(fn,/\.neq\('status', 'pendiente'\)/);
  assert.match(fn,/window\.confirm/);
  assert.doesNotMatch(fn,/renewal_history|notification_deliveries/);
  assert.match(code,/Borrar tareas finalizadas mostradas/);
  assert.match(code,/Eliminar del historial/);
});

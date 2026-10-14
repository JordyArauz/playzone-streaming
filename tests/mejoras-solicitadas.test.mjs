import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mapSupabaseToPlanillas,
  profileNumber,
  orderMembersByProfile,
} from '../src/lib/planillasFromSupabase.js';
import { clientPatch } from '../src/lib/planillasWrite.js';
import { validateContact } from '../src/lib/planillasValidation.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const member = (id, profile) => ({ id, accountId: 'a1', clientName: id, profileName: profile, status: 'Habilitado' });

test('Netflix Compartido: un perfil 1 agregado después vuelve a quedar primero', () => {
  const accounts = [{ id: 'a1', platform: 'Netflix', type: 'Compartido' }];
  const clients = [member('dos','Perfil 2'),member('tres','Perfil 3'),member('cuatro','Perfil 4'),member('cinco','Perfil 5'),member('uno','Perfil 1')];
  const { groupedData } = mapSupabaseToPlanillas(accounts, clients);
  assert.deepEqual(groupedData['Netflix Compartido'][0].members.map(x=>x.name), ['uno','dos','tres','cuatro','cinco']);
});

test('los clientes del mismo perfil conservan su orden interno', () => {
  const input = [{ id:'dos', profile:'Perfil 2' },{ id:'uno-A', profile:'Perfil 1' },{ id:'uno-B', profile:'Perfil 1' }];
  assert.deepEqual(orderMembersByProfile(input).map(x=>x.id),['uno-A','uno-B','dos']);
  assert.equal(profileNumber('Perfil 1 - nuevo'),1);
  assert.equal(profileNumber('Perfil Libre'),null);
});

test('Netflix Privado: plaza vacía es virtual y se muestra Disponible en su posición', () => {
  const accounts = [{ id: 'a1', platform: 'Netflix', type: 'Privado' }];
  const { groupedData } = mapSupabaseToPlanillas(accounts, [member('dos','Perfil 2')]);
  const members = groupedData['Netflix Privado'][0].members;
  assert.deepEqual(members.map(x=>x.profile),['Perfil 1','Perfil 2','Perfil 3','Perfil 4','Perfil 5']);
  assert.equal(members[0].status,'Disponible');
  assert.match(members[0].id,/^empty-profile:/);
});

test('los contactos solicitados pasan la validación y se guardan con el formato correcto', () => {
  for (const [input, expected] of [['57721230','57721230'], ['+591 57721230','+59157721230'], ['+56 9 8480 9740','+56984809740']]) {
    assert.equal(validateContact(input).valid, true);
    assert.deepEqual(clientPatch('contact', input, {}), {contact:expected});
  }
});

test('el cambio de Habilitado es independiente de una confirmación de pago', () => {
  const page = read('src/pages/Planillas.jsx');
  const statusFunction = page.match(/function changePaidStatus\([\s\S]*?\n  }/);
  assert.ok(statusFunction);
  assert.doesNotMatch(statusFunction[0],/confirmPaymentAndRenew/);
  assert.match(statusFunction[0],/editClient/);
  assert.match(statusFunction[0],/editAccount/);
  assert.doesNotMatch(page,/Pago recibido · Renovar cuenta/);
});

test('creación rápida de recordatorios deja vacías las observaciones', () => {
  const page = read('src/pages/Planillas.jsx');
  const reminders = read('src/components/ReminderCenter.jsx');
  assert.match(page,/details: '', \/\/ Observaciones/);
  assert.match(reminders,/details: '', \/\/ Siempre vacío/);
  assert.match(reminders,/<details className="reminder-section" open>/);
  assert.match(reminders,/<details className="reminder-history reminder-section">/);
});

test('resaltado busca la clase real de la tabla, y pestañas tienen sticky', () => {
  const css = read('src/styles.css');
  assert.match(css,/\.planilla-main-table \.planilla-row-match > td/);
  assert.match(css,/\.planillas-tabs\s*\{\s*position: sticky;/);
});

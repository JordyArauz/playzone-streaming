import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isChatGPTPlatform, clientDueLabel, netflixDueClass } from '../src/lib/noticeLabels.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('marca verde solo para ChatGPT, independientemente de mayúsculas y espacios', () => {
  for (const platform of ['ChatGPT Plus', 'chat gpt', 'CHAT-GPT']) {
    assert.equal(isChatGPTPlatform(platform), true, platform);
  }
  for (const platform of ['Netflix Privado', 'Netflix Compartido', 'HBO Max', 'Prime Video', '', null]) {
    assert.equal(isChatGPTPlatform(platform), false, String(platform));
  }
});

test('clientes asociados identifican su cuenta por accountId', () => {
  const accounts = [{ id: 'a1', platform: 'ChatGPT Plus', email: 'ejemplo@correo.com' }];
  assert.equal(clientDueLabel({ accountId: 'a1', clientName: 'Alejandra' }, accounts), 'Alejandra · ChatGPT Plus · ejemplo@correo.com');
});

test('vencimientos ChatGPT tienen marca visual sin cambiar los avisos de fecha', () => {
  const code = read('src/components/ReminderCenter.jsx');
  const styles = read('src/styles.css');
  assert.match(code, /platform: linkedAccount\?\.platform \|\| client\.platform/);
  assert.match(code, /isChatGPTPlatform\(item\.platform\)/);
  assert.match(styles, /\.reminder-item--chatgpt\s*\{[^}]*border-left:\s*3px solid #22c55e/);
  assert.match(code, /'Vence hoy'/);
  assert.match(code, /'Vence mañana'/);
});

test('no se muestran notas informativas ni éxito verde al guardar; se conservan errores', () => {
  const code = read('src/components/ReminderCenter.jsx');
  assert.doesNotMatch(code, /Los vencimientos provienen de Supabase/);
  assert.doesNotMatch(code, /Tarea guardada en Supabase\. Para recibir un aviso/);
  assert.doesNotMatch(code, /className="reminder-footnote"/);
  assert.match(code, /setSaveFeedback\(''\)/);
  assert.match(code, /No se guardó la tarea:/);
  assert.match(code, /Tarea guardada solo en este navegador/);
});


test('Netflix Privado rojo y Netflix Compartido naranja según cuenta relacionada', () => {
  assert.equal(netflixDueClass('Netflix', 'Privado'), ' reminder-item--netflix-privado');
  assert.equal(netflixDueClass('Netflix', 'Compartido'), ' reminder-item--netflix-compartido');
  assert.equal(netflixDueClass('Netflix Privado'), ' reminder-item--netflix-privado');
  assert.equal(netflixDueClass('Netflix Compartido'), ' reminder-item--netflix-compartido');
  assert.equal(netflixDueClass('NETFLIX', 'compartido'), ' reminder-item--netflix-compartido');
  assert.equal(netflixDueClass('Netflix'), ' reminder-item--netflix');
  assert.equal(netflixDueClass('ChatGPT Plus', 'Compartido'), '');
  assert.equal(netflixDueClass('Prime Video', 'Privado'), '');
});

test('cuenta y cliente heredan el tipo de Netflix sin cambiar los mensajes de vencimiento', () => {
  const code = read('src/components/ReminderCenter.jsx');
  const css = read('src/styles.css');
  assert.match(code, /type: account\.type \|\| ''/);
  assert.match(code, /type: linkedAccount\?\.type \|\| ''/);
  assert.match(code, /netflixDueClass\(item\.platform, item\.type\)/);
  assert.match(css, /\.reminder-item--netflix-privado[\s\S]*?border-left:\s*3px solid #e50914/);
  assert.match(css, /\.reminder-item--netflix-compartido\s*\{[^}]*border-left:\s*3px solid #f59e0b/);
  assert.match(code, /'Vence hoy'/);
  assert.match(code, /'Vence mañana'/);
  assert.doesNotMatch(code, /Los vencimientos provienen de Supabase/);
  assert.doesNotMatch(code, /Tarea guardada en Supabase\. Para recibir un aviso/);
});

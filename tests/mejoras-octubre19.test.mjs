import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientDueLabel } from '../src/lib/noticeLabels.js';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('aviso cliente usa el email y tipo de su cuenta asociada por id', () => {
  const accounts = [
    { id: 'a1', platform: 'Netflix', type: 'Compartido', email: 'cuenta-netflix@ejemplo.com' },
    { id: 'a2', platform: 'ChatGPT Plus', email: 'chatgpt@ejemplo.com' },
  ];
  assert.equal(clientDueLabel({ clientName: 'Carlos Daza', platform: 'Netflix', accountId: 'a1' }, accounts),
    'Carlos Daza · Netflix Compartido · cuenta-netflix@ejemplo.com');
  assert.equal(clientDueLabel({ clientName: 'Alejandra Velarde', platform: 'ChatGPT Plus', accountId: 'a2' }, accounts),
    'Alejandra Velarde · ChatGPT Plus · chatgpt@ejemplo.com');
  assert.equal(clientDueLabel({ clientName: 'Sin enlace', platform: 'Netflix', accountId: 'otra' }, accounts),
    'Sin enlace · Netflix', 'nunca inventar el tipo ni el correo');
  assert.equal(accounts[0].email, 'cuenta-netflix@ejemplo.com');
});

test('notificaciones secciones cerradas al abrir el panel', () => {
  const code = source('src/components/ReminderCenter.jsx');
  assert.equal((code.match(/<details className="reminder-section">/g) || []).length, 2);
  assert.match(code, /<details className="reminder-history reminder-section">/);
  assert.doesNotMatch(code, /<details className="reminder-section" open>/);
  assert.match(code, /clientDueLabel\(client, accounts\)/);
});

test('búsqueda móvil cierra el teclado con Buscar sin borrar el filtro', () => {
  const code = source('src/pages/Planillas.jsx');
  assert.match(code, /role="search"/);
  assert.match(code, /enterKeyHint="search"/);
  assert.match(code, /event\.currentTarget\.blur\(\)/);
  assert.match(code, /event\.currentTarget\.querySelector\('input'\)\?\.blur\(\)/);
});

test('identidad PlayZone para pestaña, inicio y push', () => {
  const html = source('index.html');
  assert.match(html, /rel="icon"/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  const manifest = JSON.parse(source('public/playzone.webmanifest'));
  assert.equal(manifest.short_name, 'PlayZone');
  assert.equal(manifest.icons.length, 2);
  assert.match(source('public/playzone-sw.js'), /playzone-icon-192\.png/);
});

test('envío de tareas independiente de resumen y sin duplicar eventos', () => {
  const edge = source('supabase/functions/dispatch-reminders/index.ts');
  const sql = source('supabase/cron/20261019_programar_tareas_push.sql');
  assert.match(edge, /mode !== 'dispatch' && mode !== 'tasks'/);
  assert.match(edge, /mode === 'dispatch' && hour >= 9/);
  assert.match(edge, /mode === 'tasks' \? tenMinutes : oneDay/);
  assert.match(edge, /notification_deliveries/);
  assert.match(edge, /onConflict: 'subscription_id,event_key'/);
  assert.match(sql, /\* \* \* \* \*/);
  assert.match(sql, /'playzone-tareas-cada-minuto'/);
  assert.match(sql, /playzone_project_url/);
  assert.match(sql, /playzone_cron_secret/);
  assert.doesNotMatch(sql, /cron\.unschedule|DROP TABLE|TRUNCATE/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Estas pruebas revisan la integración y toleran saltos de línea o espacios
// introducidos por Prettier. No necesitan acceder a Supabase.
const get = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('campana de Planillas integrada arriba y sin franja de avisos', () => {
  const planillas = get('src/pages/Planillas.jsx');
  const app = get('src/App.jsx');

  assert.match(
    planillas,
    /className\s*=\s*["']planillas-notification-slot["'][^>]*>\s*\{\s*notificationCenter\s*\}/,
    'La campana debe renderizarse dentro del espacio de Planillas.',
  );
  assert.doesNotMatch(
    planillas,
    /className\s*=\s*["']planilla-due-notice["']/,
    'No debe reaparecer la franja duplicada de avisos.',
  );
  assert.match(
    app,
    /activeTab\s*!==\s*["']dashboard["']\s*&&\s*activeTab\s*!==\s*["']planillas["']/,
  );
  assert.match(app, /notificationCenter\s*=\s*\{/);
});

test('avisos de vencimiento dentro de Notificaciones e incluye atrasados', () => {
  const src = get('src/components/ReminderCenter.jsx');

  assert.match(src, /\bNotificaciones\b/);
  assert.match(src, /reminder-due-summary/);
  assert.match(src, /const\s+urgent\s*=\s*dueItems\.length/);
  assert.match(
    src,
    /days\s*<\s*-7/,
    'Se revisa el intervalo de vencimientos atrasados.',
  );
});

test('prioridades baja, media y alta almacenadas y representadas', () => {
  const src = get('src/components/ReminderCenter.jsx');

  for (const value of ['baja', 'media', 'alta']) {
    assert.match(src, new RegExp(`\\b${value}\\s*:`));
  }
  assert.match(
    src,
    /<input\b[^>]*\btype\s*=\s*["']radio["'][^>]*\bname\s*=\s*["']reminder-priority["']/,
    'El selector de importancia debe conservar sus botones de opción.',
  );
  assert.match(src, /\bpriority\s*:\s*form\.priority\b/);
  assert.match(src, /reminder-item--priority-/);

  const css = get('src/styles.css');
  for (const value of ['baja', 'media', 'alta']) {
    assert.match(css, new RegExp(`\\.reminder-item--priority-${value}\\b`));
  }
});

test('migración SQL idempotente, no destructiva y compatible con datos existentes', () => {
  const sql = get('supabase/migrations/20261002_prioridad_recordatorios.sql');

  assert.match(
    sql,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+priority\s+text\s+NOT\s+NULL\s+DEFAULT\s+'media'/i,
  );
  assert.match(
    sql,
    /CHECK\s*\(\s*priority\s+IN\s*\(\s*'baja'\s*,\s*'media'\s*,\s*'alta'\s*\)\s*\)/i,
  );
  assert.doesNotMatch(
    sql,
    /(?:DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\s+public\.reminders/i,
  );
});

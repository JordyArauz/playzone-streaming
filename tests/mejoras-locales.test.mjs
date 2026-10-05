import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleNote } from '../src/lib/visibleNote.js';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('observaciones: conserva texto humano sin mostrar metadatos del Excel', () => {
  assert.equal(visibleNote('Le escribí y respondió. ID del Excel: 11 Origen: Streaming.xlsx — Forma de pago no documentada.'), 'Le escribí y respondió.');
  assert.equal(visibleNote('ID del Excel: 23. Forma de pago no documentada.'), '');
  assert.equal(visibleNote('Forma de pago no documentada. Estado de pago no documentado.'), '');
  assert.equal(visibleNote('Llamar después de las 5'), 'Llamar después de las 5');
  assert.equal(visibleNote(''), '');
  assert.equal(visibleNote(null), '');
});

test('consultas estables por created_at e id, sin estado como criterio de orden', () => {
  const app = source('src/App.jsx');
  assert.match(app, /\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: true \}\)/);
  assert.doesNotMatch(app, /\.sort\(\(a, b\) =>\s*(?:\{|\()\s*(?:normalizeDate\(a\.endDate|normalizePlatformName\(a\.platform)/);
});

test('móvil: cada tabla tiene su propio contenedor deslizante y panel de avisos externo', () => {
  const page = source('src/pages/Planillas.jsx');
  const reminders = source('src/components/ReminderCenter.jsx');
  const css = source('src/styles.css');
  assert.equal((page.match(/className="planilla-table-scroll"/g) || []).length, 2);
  assert.match(page, /<nav className="planillas-tabs"/);
  assert.doesNotMatch(page, /✅ Supabase · Edición activa/);
  assert.match(reminders, /createPortal\(/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.planilla-table-scroll\s*\{[\s\S]*?overflow-x: auto/);
});

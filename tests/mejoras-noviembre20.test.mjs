import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { profileKey, sharedProfilePin } from '../src/lib/sharedProfilePin.js';
import { mapSupabaseToPlanillas } from '../src/lib/planillasFromSupabase.js';
import { createClient, deleteSharedClientPreservingPin } from '../src/lib/planillasWrite.js';

const text = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('el PIN compartido se identifica por perfil normalizado y cuenta', () => {
  assert.equal(profileKey(' Perfil   3 '), 'perfil 3');
  const members = [
    { id: 'a', profile: 'Perfil 3', pin: '4312' },
    { id: 'b', profile: 'Perfil 3', pin: '' },
    { id: 'c', profile: 'Perfil 4', pin: '9999' },
  ];
  assert.equal(sharedProfilePin(members, 'perfil 3', 'a'), '');
  assert.equal(sharedProfilePin(members, ' PERFIL 3 '), '4312');
  assert.equal(sharedProfilePin(members, 'Perfil 4'), '9999');
  assert.equal(sharedProfilePin(members, ''), '');
});

test('la lectura de Netflix Compartido preserva PIN visible al borrar primero', () => {
  const accounts = [{ id: 'cuenta-1', platform: 'Netflix', type: 'Compartido' }];
  const clients = [
    { id: 'cliente-a', accountId: 'cuenta-1', clientName: 'Primero', profileName: 'Perfil 3', pin: '4312' },
    { id: 'cliente-b', accountId: 'cuenta-1', clientName: 'Segundo', profileName: 'Perfil 3', pin: '' },
  ];
  const view = mapSupabaseToPlanillas(accounts, clients).groupedData['Netflix Compartido'];
  assert.equal(view[0].members[1].pin, '4312');
  const after = mapSupabaseToPlanillas(accounts, [
    { ...clients[1], pin: '4312' },
  ]).groupedData['Netflix Compartido'];
  assert.equal(after[0].members[0].pin, '4312');
});

test('nuevo cliente de Netflix Compartido hereda PIN solo si se proporciona', async () => {
  let inserted;
  const db = { from(table) {
    assert.equal(table, 'clients');
    return { insert(row) {
      inserted = row;
      return { select() { return { single: async () => ({data:{id:'creado'},error:null}) }; } };
    } };
  } };
  await createClient(db, 'usuario', 'Netflix Compartido', {id:'cuenta'}, 'Nuevo', 'Perfil 3', '4312');
  assert.equal(inserted.pin, '4312');
  assert.equal(inserted.profile_name, 'Perfil 3');
  assert.equal(inserted.account_id, 'cuenta');
  await createClient(db, 'usuario', 'Netflix Privado', {id:'cuenta'}, 'Otro', 'Perfil 1', '4312');
  assert.equal(inserted.pin, null);
});

test('antes de eliminar primer cliente compartido se guarda PIN en sobreviviente', async () => {
  const operations = [];
  const db = { from(table) {
    assert.equal(table, 'clients');
    return {
      update(patch) {
        operations.push(['update', patch.pin]);
        return { eq() { return this; }, in(field, ids) {
          assert.equal(field,'id');
          assert.deepEqual(ids,['segundo']);
          return this;
        }, select: async () => ({ data: [{ id:'segundo' }], error:null }) };
      },
      delete() {
        operations.push(['delete']);
        return { eq() { return this; }, select() { return {maybeSingle: async()=>({data:{id:'primero'},error:null})}; } };
      },
    };
  } };
  const source = {id:'primero', accountId:'cuenta', profileName:'Perfil 3', pin:'4312'};
  const other = {id:'segundo', accountId:'cuenta', profileName:' Perfil   3 ', pin:''};
  await deleteSharedClientPreservingPin(db,'usuario',source,[source,other]);
  assert.deepEqual(operations, [['update','4312'],['delete']]);
});

test('si no puede conservar PIN, no permite eliminar cliente', async () => {
  let deleted = false;
  const db = { from() {
    return {
      update() { return {eq(){return this;},in(){return this;},select:async()=>({data:[],error:null})}; },
      delete(){ deleted=true; throw new Error('No debería borrar'); },
    };
  } };
  const source = {id:'1',accountId:'a',profileName:'Perfil 1',pin:'4312'};
  const peer = {id:'2',accountId:'a',profileName:'Perfil 1',pin:''};
  await assert.rejects(
    deleteSharedClientPreservingPin(db,'usuario',source,[source,peer]),
    /No se pudo conservar el PIN/,
  );
  assert.equal(deleted,false);
});

test('dashboard sin Ver todos ni subtitulo, mantiene los botones individuales', () => {
  const app = text('src/App.jsx');
  const dashboard = app.split('className="panel dashboard-platforms-panel"')[1]
    .split('      </main>')[0];
  assert.doesNotMatch(dashboard, /Vista rápida de las cuentas registradas/);
  assert.doesNotMatch(dashboard, /\bVer todas?\b/);
  assert.match(dashboard, /onClick=\{\(\) => viewRecord\(record\)\}/);
  assert.match(dashboard, /onClick=\{\(\) => viewAccount\(account\)\}/);
});

test('selector de estado usa portal fuera de las tablas y tres opciones', () => {
  const panel = text('src/pages/Planillas.jsx');
  const css = text('src/styles.css');
  assert.match(panel, /createPortal\(/);
  assert.match(panel, /document\.body/);
  assert.match(panel, /\['Habilitado', 'Pendiente', 'Deshabilitado'\]/);
  assert.match(css, /\.member-status-picker\s*\{\s*position: fixed !important/);
});

test('la edicion se estabiliza y distingue error de lectura del guardado', () => {
  const panel = text('src/pages/Planillas.jsx');
  const app = text('src/App.jsx');
  assert.match(panel,/const PlanillasEditContext = createContext\(null\)/);
  assert.match(panel,/onEditingActiveChange\?\.\(Boolean\(editing\) \|\| busy\)/);
  assert.match(panel,/Guardado en Supabase, pero falló la actualización visual/);
  assert.match(app,/editingPlanillasRef\.current/);
  assert.doesNotMatch(panel,/key=\{`\$\{member\.id\}:\$\{search\}`\}/);
});

test('resumen diario agrupado, tareas con hora separadas y deduplicadas', () => {
  const edge = text('supabase/functions/dispatch-reminders/index.ts');
  assert.match(edge,/eventKey: `resumen-v2:\$\{today\}`/);
  assert.match(edge,/title: 'PlayZone · Resumen de vencimientos'/);
  assert.match(edge,/if \(mode === 'tasks'\)/);
  assert.match(edge,/onConflict: 'subscription_id,event_key'/);
  assert.doesNotMatch(edge,/title: `Cliente que vence/);
  assert.doesNotMatch(edge,/title: `Cuenta que vence/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';

const validation = fs.readFileSync('src/lib/planillasValidation.js', 'utf8');
const validationURL = `data:text/javascript;base64,${Buffer.from(validation).toString('base64')}`;
const renewal = fs.readFileSync('src/lib/planillasRenewal.js', 'utf8')
  .replace("from './planillasValidation.js'", `from '${validationURL}'`);
const funcs = await import(`data:text/javascript;base64,${Buffer.from(renewal).toString('base64')}`);
const { periodOf, effectiveStatus, confirmPaidRenewal, extendPeriodOneMonth, daysUntil,
  localPlanillasDueItems, businessDateISO } = funcs;
const checks = [];
const check = (title, fn) => checks.push([title, fn]);

for (const [start, end, newStart, newEnd] of [
  ['2026-09-25','2026-10-24','2026-10-25','2026-11-24'],
  ['2026-12-25','2027-01-24','2027-01-25','2027-02-24'],
  ['2027-01-01','2027-01-31','2027-02-01','2027-02-28'],
  ['2028-01-31','2028-02-29','2028-03-01','2028-03-31'],
  ['2026-10-05','2026-10-13','2026-10-14','2026-11-13'],
]) check(`renueva ${start} - ${end}`, () =>
  assert.deepEqual(extendPeriodOneMonth(start,end),{startISO:newStart,endISO:newEnd}));
const account = {
  id:'np-1', status:'Habilitado',
  subscription:'25/09/2026 - 24/10/2026',
};
const member = { id:'np-1-m1', name:'Cliente prueba', status:'Habilitado', dateRange:'25/09 - 24/10' };
check('cálculo de cuenta con año explícito',()=> assert.equal(periodOf(account,'account','2026-10-01').endISO,'2026-10-24'));
check('cálculo de cliente con año oculto',()=> assert.equal(periodOf(member,'member','2026-10-01').endISO,'2026-10-24'));
check('verde activo antes del vencimiento',()=> assert.equal(effectiveStatus(member,'member','2026-10-23'),'Habilitado'));
check('naranja al llegar al último día',()=> assert.equal(effectiveStatus(member,'member','2026-10-24'),'Pendiente'));
check('naranja tras el último día',()=> assert.equal(effectiveStatus(member,'member','2026-11-01'),'Pendiente'));
check('deshabilitado no cambia de color',()=> assert.equal(effectiveStatus({...member,status:'Deshabilitado'},'member','2026-11-01'),'Deshabilitado'));
check('disponible no cambia de color',()=> assert.equal(effectiveStatus({...member,status:'Disponible'},'member','2026-11-01'),'Disponible'));
check('un año sin fecha permanece editable',()=> assert.equal(effectiveStatus({status:'Habilitado'},'account','2026-11-01'),'Habilitado'));
check('renovación anticipada conserva el vencimiento original',()=> {
  const result = confirmPaidRenewal(member,'member','2026-10-10');
  assert.equal(result.ok,true);
  assert.equal(result.fields.dateRange,'25/10 - 24/11');
  assert.equal(result.fields.lastRenewedFromEndISO,'2026-10-24');
});
check('renovación al vencer actualiza fechas',()=> {
  const result = confirmPaidRenewal(member,'member','2026-10-24');
  assert.equal(result.fields.periodEndISO,'2026-11-24');
  assert.equal(effectiveStatus({...member,...result.fields},'member','2026-10-24'),'Habilitado');
});
check('no confirma dos pagos en un mismo día',()=> {
  const first = confirmPaidRenewal(member,'member','2026-10-24');
  assert.equal(confirmPaidRenewal({...member,...first.fields},'member','2026-10-24').ok,false);
});
check('el siguiente día sí puede confirmar otro pago',()=> {
  const first = confirmPaidRenewal(member,'member','2026-10-24');
  assert.equal(confirmPaidRenewal({...member,...first.fields},'member','2026-10-25').ok,true);
});
check('solo un clic no modifica el objeto original',()=> {
  const source = {...member};confirmPaidRenewal(source,'member','2026-10-24');
  assert.deepEqual(source,member);
});
check('sin fecha se rechaza pago',()=> assert.equal(confirmPaidRenewal({...member,dateRange:''},'member','2026-10-24').ok,false));
check('sin nombre no se renueva un cliente',()=> assert.equal(confirmPaidRenewal({...member,name:''},'member','2026-10-24').ok,false));
check('deshabilitado solo se renueva si confirma pago explícitamente',()=> assert.equal(confirmPaidRenewal({...member,status:'Deshabilitado'},'member','2026-10-24').ok,true));
check('cuenta: renovación conserva años visibles',()=> {
  const result=confirmPaidRenewal(account,'account','2026-10-24');
  assert.equal(result.fields.subscription,'25/10/2026 - 24/11/2026');
});
check('cuenta: deuda antigua avanza solo un mes',()=> {
  const result=confirmPaidRenewal(account,'account','2027-01-01');
  assert.equal(result.fields.subscriptionEndISO,'2026-11-24');
  assert.equal(effectiveStatus({...account,...result.fields},'account','2027-01-01'),'Pendiente');
});
check('a un día del vencimiento se avisa',()=> {
  const due = localPlanillasDueItems({'Netflix Privado':[{...account,members:[member]}]},'2026-10-23');
  assert.equal(due.length,2);
  assert.deepEqual(due.map(({days})=>days),[1,1]);
});
check('en fecha de vencimiento se avisa',()=> {
  const due = localPlanillasDueItems({'Netflix Privado':[{...account,members:[member]}]},'2026-10-24');
  assert.equal(due.length,2);
  assert.deepEqual(due.map(({days})=>days),[0,0]);
});
check('no se notifica un perfil disponible',()=> {
  const due = localPlanillasDueItems({'Prime Video':[{...account,members:[{...member,status:'Disponible'}]}]},'2026-10-24');
  assert.equal(due.length,1);
});
check('no se notifica un perfil deshabilitado',()=> {
  const due = localPlanillasDueItems({'Prime Video':[{...account,members:[{...member,status:'Deshabilitado'}]}]},'2026-10-24');
  assert.equal(due.length,1);
});
check('no se notifica el período ya renovado',()=> {
  const paid=confirmPaidRenewal(member,'member','2026-10-24');
  assert.equal(localPlanillasDueItems({'Netflix Privado':[{...account,status:'Deshabilitado',members:[{...member,...paid.fields}]}]},'2026-10-24').length,0);
});
check('días calendario alrededor de año nuevo',()=> assert.equal(daysUntil('2027-01-01','2026-12-31'),1));
check('fecha de negocio tiene formato ISO',()=> assert.match(businessDateISO(new Date('2026-10-02T02:00:00Z')), /^2026-10-01$/));

for (const [title,fn] of checks) {try {fn();} catch(e){console.error(`ERROR: ${title}`);throw e;}}
console.log(`PRUEBAS OK: ${checks.length} casos de renovaciones y vencimientos.`);

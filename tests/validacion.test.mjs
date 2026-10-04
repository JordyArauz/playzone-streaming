import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const validationFile = path.resolve('src/lib/planillasValidation.js');
const code = fs.readFileSync(validationFile, 'utf8');
const { validateContact, normalizeWhatsAppNumber, validateDateRange } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const cases = [];
const check = (title, fn) => cases.push([title, fn]);

for (const [input, expected] of [
  ['70000001', '59170000001'],
  ['61234567', '59161234567'],
  ['+591 7123 4567', '59171234567'],
  ['987654321', '51987654321'],
  ['+51 987 654 321', '51987654321'],
  ['+5491123456789', '5491123456789'],
  ['005491123456789', '5491123456789'],
  ['+54 11 15 2345 6789', '5491123456789'],
]) check(`teléfono válido ${input}`, () => {
  assert.equal(validateContact(input).valid, true);
  assert.equal(normalizeWhatsAppNumber(input), expected);
});
for (const invalid of [
  '81234567', '7123456', '712345678', '7123456a', '+59181234567',
  '+5198765432', '+519876543210', '549112345678', '+54911234567890',
  '+123000000000', '7100+001', '','   '
]) check(`teléfono inválido ${JSON.stringify(invalid)}`, () => {
  if (invalid.trim() === '') {
    assert.equal(validateContact(invalid, {required:true}).valid, false);
    assert.equal(validateContact(invalid).valid, true); // fila vacía de una cuenta nueva
  } else {
    assert.equal(validateContact(invalid).valid, false);
    assert.equal(normalizeWhatsAppNumber(invalid), null);
  }
});
for (const [input, start, end, format] of [
  ['21/09 - 20/10', '2026-09-21','2026-10-20','21/09 - 20/10'],
  ['25/08/2026 - 24/09/2026', '2026-08-25','2026-09-24','25/08/2026 - 24/09/2026'],
  ['25/12 - 24/01', '2026-12-25','2027-01-24','25/12 - 24/01'],
  ['30/11 - 29/01', '2026-11-30','2027-01-29','30/11 - 29/01'],
  ['29/02/2028 - 28/03/2028', '2028-02-29','2028-03-28','29/02/2028 - 28/03/2028'],
  ['05/10-13/10','2026-10-05','2026-10-13','05/10 - 13/10'],
  ['01/12/2026 - 01/01/2027','2026-12-01','2027-01-01','01/12/2026 - 01/01/2027'],
]) check(`período válido ${input}`, () => {
  const result = validateDateRange(input, { today:new Date(2026, 9, 1) });
  assert.equal(result.valid, true, result.message);
  assert.deepEqual([result.startISO,result.endISO,result.display], [start,end,format]);
});
for (const invalid of [
  '31/02 - 25/03', '25/12/2026 - 24/01/2026', '20/10 - 19/10',
  '25/10 - 24/09', '25/03 - 24/02', '31/04 - 30/05',
  '01/11 - 15/02', '32/01 - 01/02', '01/00 - 03/05',
  '29/02/2026 - 28/03/2026', '21/09 - 20/10/2026', '21/09/2026 - 20/10',
  '01/12 - 01/10', '25/09',
]) check(`período inválido ${invalid}`, () => {
  assert.equal(validateDateRange(invalid,{today:new Date(2026,9,1)}).valid,false);
});
check('una fecha ya guardada conserva su año oculto',()=> {
  const r=validateDateRange('25/12 - 24/01',{referenceStartISO:'2027-12-25',today:new Date(2026,9,1)});
  assert.deepEqual([r.startISO,r.endISO],['2027-12-25','2028-01-24']);
});
check('DD/MM de diciembre editado en enero se ancla al año anterior',()=> {
  const r = validateDateRange('25/12 - 24/01', { today: new Date(2027,0,4) });
  assert.deepEqual([r.startISO,r.endISO], ['2026-12-25','2027-01-24']);
});
check('DD/MM de enero editado en noviembre se ancla al año próximo',()=> {
  const r = validateDateRange('05/01 - 04/02', { today: new Date(2026,10,5) });
  assert.deepEqual([r.startISO,r.endISO], ['2027-01-05','2027-02-04']);
});
check('vacío editable en fila libre; obligatorio por nombre asignado',()=> {
  assert.equal(validateDateRange('').valid,true);
  assert.equal(validateDateRange('',{required:true}).valid,false);
});
for (const [title, callback] of cases) {
  try {callback();} catch(error) { console.error('ERROR:',title); throw error; }
}
console.log(`PRUEBAS OK: ${cases.length} casos de teléfonos y fechas.`);

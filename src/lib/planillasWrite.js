import { validateContact, validateDateRange } from './planillasValidation.js';

// Mapeo de campos permitido explícitamente; nunca enviamos todo el objeto del navegador.
const ACCOUNT_FIELDS = {
  email: 'email', password: 'password', cardName: 'card_name',
  location: 'location',
};
const CLIENT_FIELDS = {
  name: 'client_name', profile: 'profile_name', pin: 'pin',
  device: 'devices', note: 'notes', loginRecord: 'login_record',
};
const PLATFORMS = {
  'Netflix Privado': ['Netflix', 'Privado'],
  'Netflix Compartido': ['Netflix', 'Compartido'],
  'Prime Video': ['Prime Video', 'Compartido'],
  'HBO Max': ['Max', 'Compartido'],
  'ChatGPT Plus': ['ChatGPT Plus', 'Compartido'],
};

function failIf(error) { if (error) throw new Error(error.message); }
function requiredAdmin(userId) { if (!userId) throw new Error('Debes iniciar sesión de administrador.'); }
function asNullable(value) { const text = String(value ?? '').trim(); return text || null; }
function currentRow(result) {
  failIf(result.error);
  if (!result.data) throw new Error('Supabase no devolvió la fila modificada. Comprueba los permisos y vuelve a cargar.');
  return result.data;
}
function savedDate(value, referenceStartISO) {
  const checked = validateDateRange(value, { referenceStartISO });
  if (!checked.valid) throw new Error(checked.message);
  return checked;
}
export function sheetPlatform(sheet) {
  const mapping = PLATFORMS[sheet];
  if (!mapping) throw new Error('Plataforma no admitida para editar.');
  return mapping;
}
export function accountPatch(field, value, account) {
  if (field === 'subscription') {
    const date = savedDate(value, account.subscriptionStartISO);
    return { subscription_start: date.startISO, subscription_end: date.endISO };
  }
  if (field === 'status') {
    const states = { Habilitado: 'Activa', Pendiente: 'Pendiente', Deshabilitado: 'Suspendida' };
    if (!states[value]) throw new Error('Estado de cuenta no admitido.');
    return { status: states[value] };
  }
  if (ACCOUNT_FIELDS[field]) return { [ACCOUNT_FIELDS[field]]: asNullable(value) };
  throw new Error(`Campo de cuenta no admitido: ${field}`);
}
export function clientPatch(field, value, member) {
  if (field === 'contact') {
    // Un contacto desconocido puede quedar NULL, también para clientes con nombre.
    const result = validateContact(value, { required: false });
    if (!result.valid) throw new Error(result.message);
    return { contact: asNullable(result.display) };
  }
  if (field === 'dateRange') {
    const date = savedDate(value, member.periodStartISO);
    return { start_date: date.startISO, end_date: date.endISO };
  }
  if (field === 'payment') {
    const text = String(value ?? '').trim();
    if (!text) return { price: null };
    const amount = Number(text.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) throw new Error('El pago debe ser un número igual o mayor a cero.');
    return { price: amount };
  }
  if (field === 'status') {
    if (!['Habilitado', 'Pendiente', 'Deshabilitado'].includes(value))
      throw new Error('Solo los espacios sin cliente pueden estar disponibles.');
    return { status: value };
  }
  if (CLIENT_FIELDS[field]) {
    if (field === 'name' && !String(value ?? '').trim())
      throw new Error('El nombre del cliente no puede quedar vacío. Elimina al cliente si corresponde.');
    return { [CLIENT_FIELDS[field]]: field === 'name' ? String(value).trim() : asNullable(value) };
  }
  throw new Error(`Campo de cliente no admitido: ${field}`);
}
export async function createAccount(db, userId, sheet, email) {
  requiredAdmin(userId);
  const [platform, type] = sheetPlatform(sheet);
  const stamp = new Date().toISOString();
  const row = { id: crypto.randomUUID(), platform, type, email: asNullable(email), status: 'Pendiente', owner_id: userId, created_at: stamp, updated_at: stamp };
  return currentRow(await db.from('accounts').insert(row).select('id').single());
}
export async function createClient(db, userId, sheet, account, name, profile = '') {
  requiredAdmin(userId);
  if (!String(name ?? '').trim()) throw new Error('Es necesario escribir el nombre del cliente.');
  const [platform] = sheetPlatform(sheet);
  const stamp = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(), created_at: stamp, updated_at: stamp,
    account_id: account.id, platform, client_name: String(name).trim(),
    profile_name: sheet === 'ChatGPT Plus' ? null : asNullable(profile),
    pin: null, contact: null, status: 'Pendiente', owner_id: userId,
    payment_method: 'Sin especificar', payment_status: 'Sin verificar',
  };
  return currentRow(await db.from('clients').insert(row).select('id').single());
}
export async function editAccount(db, userId, account, field, value) {
  requiredAdmin(userId);
  const patch = { ...accountPatch(field, value, account), updated_at: new Date().toISOString() };
  return currentRow(await db.from('accounts').update(patch).eq('id', account.id).eq('owner_id', userId).select('id').maybeSingle());
}
export async function editClient(db, userId, member, field, value) {
  requiredAdmin(userId);
  const patch = { ...clientPatch(field, value, member), updated_at: new Date().toISOString() };
  return currentRow(await db.from('clients').update(patch).eq('id', member.id).eq('owner_id', userId).select('id').maybeSingle());
}
export async function editProfileGroup(db, userId, members, field, value) {
  requiredAdmin(userId);
  if (!['pin', 'profile'].includes(field)) throw new Error('Solo PIN o perfil compartido.');
  if (!members.length || members.some((member) => String(member.id).startsWith('empty-profile:')))
    throw new Error('No se pueden modificar huecos vacíos. Asigna antes los nombres.');
  const ids = members.map((member) => member.id);
  if (new Set(ids).size !== ids.length) throw new Error('Hay miembros repetidos en el grupo.');
  const patch = { [field === 'pin' ? 'pin' : 'profile_name']: asNullable(value), updated_at: new Date().toISOString() };
  const response = await db.from('clients').update(patch)
    .in('id', ids).eq('owner_id', userId).select('id');
  failIf(response.error);
  if ((response.data || []).length !== ids.length)
    throw new Error('No se actualizaron todos los clientes del grupo. Recarga Planillas y revisa los datos.');
}
export async function deleteClient(db, userId, member) {
  requiredAdmin(userId);
  return currentRow(await db.from('clients').delete().eq('id', member.id).eq('owner_id', userId).select('id').maybeSingle());
}
export async function deleteAccount(db, userId, account, clients) {
  requiredAdmin(userId);
  if (clients.some((member) => member.accountId === account.id)) {
    throw new Error('La cuenta tiene clientes asociados. Para evitar dejarlos sin cuenta, reubícalos o elimínalos primero.');
  }
  const response = await db.rpc('pz_delete_account_safe', { p_id: account.id });
  failIf(response.error);
  if (!response.data) throw new Error('No se pudo eliminar la cuenta.');
  return response.data;
}
export async function renewPaid(db, kind, id, expectedEnd) {
  if (!['account', 'client'].includes(kind) || !id || !/^\d{4}-\d{2}-\d{2}$/.test(String(expectedEnd)))
    throw new Error('Renovación sin identificación o período completo.');
  const response = await db.rpc('pz_confirm_renewal', {
    p_kind: kind, p_id: id, p_expected_end: expectedEnd,
  });
  failIf(response.error);
  if (!response.data) throw new Error('No se confirmó la renovación.');
  return response.data;
}

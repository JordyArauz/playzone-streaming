// Adaptador de lectura. NO realiza consultas, escrituras ni genera datos de prueba.
// Recibe únicamente los registros ya cargados y autorizados por App.jsx (RLS).
export const PLANILLA_SHEETS = [
  'Netflix Privado',
  'Netflix Compartido',
  'Prime Video',
  'HBO Max',
  'ChatGPT Plus',
];

function clean(value) {
  return String(value ?? '').trim();
}

export function sheetForAccount(account) {
  const platform = clean(account.platform).toLowerCase();
  const type = clean(account.type).toLowerCase();
  if (platform === 'netflix') {
    if (type === 'privado') return 'Netflix Privado';
    if (type === 'compartido') return 'Netflix Compartido';
    return null; // Sin tipo reconocido: nunca adivinar.
  }
  if (platform === 'prime video') return 'Prime Video';
  if (platform === 'max' || platform === 'hbo max') return 'HBO Max';
  if (platform === 'chatgpt plus' || platform === 'chatgpt')
    return 'ChatGPT Plus';
  return null;
}

function viewDate(iso, year = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(iso))) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}${year ? `/${iso.slice(0, 4)}` : ''}`;
}

function viewPeriod(start, end, year = false) {
  const from = viewDate(start, year),
    to = viewDate(end, year);
  return from && to ? `${from} - ${to}` : '';
}

function accountStatus(value) {
  switch (value) {
    case 'Activa':
    case 'Habilitado':
      return 'Habilitado';
    case 'Suspendida':
    case 'Deshabilitado':
      return 'Deshabilitado';
    case 'Vencida':
    case 'Pendiente':
      return 'Pendiente';
    default:
      return 'Pendiente';
  }
}

function clientStatus(value) {
  if (value === 'Disponible') return 'Disponible';
  if (value === 'Deshabilitado') return 'Deshabilitado';
  if (value === 'Vencido' || value === 'Pendiente') return 'Pendiente';
  return 'Habilitado';
}

function memberFromClient(row) {
  return {
    id: row.id,
    name: row.clientName || '',
    profile: row.profileName || '',
    pin: row.pin || '',
    device: row.devices || '',
    contact: row.contact || '',
    dateRange: viewPeriod(row.startDate, row.endDate),
    periodStartISO: row.startDate || null,
    periodEndISO: row.endDate || null,
    note: row.notes || '',
    status: clientStatus(row.status),
    loginRecord: row.loginRecord || '',
    payment: row.price == null ? '' : String(row.price),
  };
}

// Los huecos visuales de perfiles fijos nunca se inventan como clientes de DB.
function blankProfile(accountId, slot) {
  return {
    id: `empty-profile:${accountId}:${slot}`,
    name: '',
    profile: `Perfil ${slot}`,
    pin: '',
    device: '',
    contact: '',
    dateRange: '',
    periodStartISO: null,
    periodEndISO: null,
    note: '',
    status: 'Disponible',
  };
}

function membersWithFixedSlots(members, accountId, count) {
  const used = new Set();
  const result = [...members];
  for (const member of members) {
    const match = /^Perfil\s+(\d+)$/i.exec(clean(member.profile));
    if (match) used.add(Number(match[1]));
  }
  // Si un cliente real no tiene profile_name, ocupa una plaza sin que
  // adivinemos su perfil. Nunca superamos el cupo solo por rellenar huecos.
  for (let slot = 1; slot <= count && result.length < count; slot += 1) {
    if (!used.has(slot)) result.push(blankProfile(accountId, slot));
  }
  return result;
}

/** Recibe el formato normalizado que ya utiliza App.jsx, sin mutarlo. */
export function mapSupabaseToPlanillas(accounts = [], clients = []) {
  const groupedData = Object.fromEntries(
    PLANILLA_SHEETS.map((sheet) => [sheet, []]),
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const clientsByAccountId = new Map();
  const unlinkedClients = [];
  const unsupportedAccounts = [];

  for (const client of clients) {
    const id = client.accountId;
    if (!id || !accountById.has(id)) {
      unlinkedClients.push(client);
      continue;
    }
    if (!clientsByAccountId.has(id)) clientsByAccountId.set(id, []);
    clientsByAccountId.get(id).push(client);
  }

  for (const a of accounts) {
    const sheet = sheetForAccount(a);
    if (!sheet) {
      unsupportedAccounts.push(a);
      continue;
    }
    let members = (clientsByAccountId.get(a.id) || []).map(memberFromClient);
    const fixedSlots = { 'Netflix Privado': 5, 'Prime Video': 6, 'HBO Max': 5 }[
      sheet
    ];
    if (fixedSlots) members = membersWithFixedSlots(members, a.id, fixedSlots);
    groupedData[sheet].push({
      id: a.id,
      email: a.email || '',
      password: a.password || '',
      subscription: viewPeriod(a.subscriptionStart, a.subscriptionEnd, true),
      subscriptionStartISO: a.subscriptionStart || null,
      subscriptionEndISO: a.subscriptionEnd || null,
      status: accountStatus(a.status),
      cardName: a.cardName || '',
      location: a.location || '',
      members,
    });
  }

  return { groupedData, unsupportedAccounts, unlinkedClients };
}

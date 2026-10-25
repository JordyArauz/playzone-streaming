// Etiquetas de vencimientos. Solo lectura: no modifica cuentas ni clientes.
// La relación exacta se determina por accountId, nunca por coincidencia de nombre.
export function clientDueLabel(client, accounts = []) {
  const account = accounts.find((item) => item.id === client.accountId);
  const name = String(client.clientName || 'Cliente').trim();
  const platform = String(account?.platform || client.platform || 'Plataforma').trim();
  const type = String(account?.type || '').trim();
  const email = String(account?.email || '').trim();
  const label = [platform, type].filter(Boolean).join(' ');
  return [name, label, email].filter(Boolean).join(' · ');
}

// Clasificación visual, sin alterar estados, fechas ni información almacenada.
export function isChatGPTPlatform(platform) {
  return /\bchat[\s-]*gpt\b/i.test(String(platform || ''));
}


// Diferenciación visual de Netflix, sin confundir tipo de cuenta con vencimiento.
// El tipo de cuenta proviene de la cuenta relacionada, no de texto del cliente.
export function netflixDueClass(platform, type = '') {
  const platformText = String(platform || '').trim();
  if (!/\bnetflix\b/i.test(platformText)) return '';
  const description = `${platformText} ${String(type || '')}`;
  if (/\bcompartid[oa]\b/i.test(description)) return ' reminder-item--netflix-compartido';
  if (/\bprivad[oa]\b/i.test(description)) return ' reminder-item--netflix-privado';
  return ' reminder-item--netflix';
}

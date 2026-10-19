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

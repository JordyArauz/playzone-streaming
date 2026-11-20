// PIN heredado de otros clientes del mismo perfil de la MISMA cuenta.
// Nunca se mezcla entre cuentas ni se altera la informacion en Supabase al leer.
export function profileKey(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

export function sharedProfilePin(members, profile, excludedId = null) {
  const key = profileKey(profile);
  if (!key) return '';
  const match = (members || []).find((member) =>
    member.id !== excludedId &&
    profileKey(member.profile ?? member.profileName) === key &&
    String(member.pin ?? '').trim() !== '',
  );
  return match ? String(match.pin) : '';
}

import { supabase } from './supabaseClient';

function decodeVapidKey(key) {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function isPushConfigured() {
  return Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim());
}

export function supportsPushNotifications() {
  return typeof window !== 'undefined' && window.isSecureContext &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getCurrentPushSubscription() {
  if (!supportsPushNotifications()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePlayZonePush(userId) {
  if (!supportsPushNotifications()) {
    throw new Error('Este navegador necesita HTTPS (o localhost) y soporte para notificaciones push.');
  }
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) throw new Error('Push pendiente de configurar. Se requiere la clave pública VAPID y un servicio de envío.');
  if (Notification.permission === 'denied') {
    throw new Error('Las notificaciones están bloqueadas. Habilítalas en los permisos de Chrome.');
  }
  if (Notification.permission !== 'granted') {
    const granted = await Notification.requestPermission();
    if (granted !== 'granted') throw new Error('No se autorizó enviar notificaciones.');
  }
  // register() no garantiza que el worker ya se haya activado.
  // PushManager.subscribe() requiere una registration con Service Worker activo.
  await navigator.serviceWorker.register('/playzone-sw.js', { scope: '/' });
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        'El Service Worker no se activó a tiempo. Recarga localhost y comprueba en Chrome > F12 > Application > Service Workers si /playzone-sw.js tiene errores.',
      )), 20000),
    ),
  ]);
  if (!reg.active) {
    throw new Error('El Service Worker todavía no está activo. Recarga PlayZone e inténtalo nuevamente.');
  }
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(key),
  });
  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth_secret: json.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(`No se pudo guardar el dispositivo: ${error.message}`);
  return true;
}

export async function disablePlayZonePush() {
  const sub = await getCurrentPushSubscription();
  if (!sub) return;
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  if (error) throw new Error(`No se pudo desactivar: ${error.message}`);
  await sub.unsubscribe();
}

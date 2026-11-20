// Solo invocación privada desde Supabase Dashboard o pg_cron/pg_net.
// PRUEBA SEGURA: mode=test solo envía a 1 dispositivo si existe exactamente uno.
// DESPACHO AUTOMÁTICO BLOQUEADO mientras PLAYZONE_AUTOMATIC_PUSH_ENABLED no sea true.
// No exponer PLAYZONE_CRON_SECRET ni VAPID_PRIVATE_KEY a Vite o GitHub.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function bytes64url(encoded: string) {
  const base64 = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function b64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function createPushServer() {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  const priv = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  const subject = Deno.env.get('VAPID_SUBJECT') || '';
  const full = bytes64url(pub);
  const privateRaw = bytes64url(priv);
  if (
    full.length !== 65 ||
    privateRaw.length !== 32 ||
    full[0] !== 4 ||
    !subject.startsWith('mailto:')
  ) {
    throw new Error(
      'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT inválido',
    );
  }
  const x = b64url(full.slice(1, 33));
  const y = b64url(full.slice(33, 65));
  const vapidKeys = await webpush.importVapidKeys(
    {
      publicKey: {
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        x,
        y,
        key_ops: ['verify'],
        ext: true,
      },
      privateKey: {
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        x,
        y,
        d: b64url(privateRaw),
        key_ops: ['sign'],
        ext: true,
      },
    },
    { extractable: false },
  );
  return webpush.ApplicationServer.new({
    contactInformation: subject,
    vapidKeys,
  });
}

function boliviaDateKey(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  };
}

function addDay(dateKey: string, offset: number) {
  return new Date(Date.parse(`${dateKey}T12:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}

type Event = { userId: string; eventKey: string; title: string; body: string };

Deno.serve(async (request) => {
  const secret = Deno.env.get('PLAYZONE_CRON_SECRET') || '';
  if (
    request.method !== 'POST' ||
    secret.length < 24 ||
    !constantTimeEqual(request.headers.get('x-cron-secret') || '', secret)
  ) {
    return new Response('No autorizado', { status: 401 });
  }

  const url = Deno.env.get('SUPABASE_URL') || '';
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  const key = legacyKey || keys.default || '';
  if (!url || !key)
    return Response.json(
      { error: 'Faltan secretos de Supabase' },
      { status: 500 },
    );
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Sin "mode" explícito, NO se procesa ningún vencimiento.
  let mode = '';
  try {
    const payload = await request.json();
    mode = typeof payload?.mode === 'string' ? payload.mode : '';
  } catch {
    return Response.json(
      { error: 'Se requiere JSON válido con mode' },
      { status: 400 },
    );
  }
  if (mode === 'test') {
    // IMPORTANTE: un único dispositivo, cuerpo genérico, sin escribir deliveries.
    const { data: devices, error: devicesError } = await admin
      .from('push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth_secret')
      .limit(2);
    if (devicesError) {
      console.error(
        'No se pudo consultar push_subscriptions',
        devicesError.message,
      );
      return Response.json(
        { error: 'No se pudieron consultar los dispositivos' },
        { status: 500 },
      );
    }
    if (devices?.length !== 1) {
      return Response.json(
        {
          error: 'La prueba necesita exactamente un dispositivo registrado',
          dispositivos:
            devices?.length === 2 ? '2 o más' : devices?.length || 0,
        },
        { status: 409 },
      );
    }
    try {
      const server = await createPushServer();
      const sub = devices[0];
      const subscriber = server.subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
      });
      await subscriber.pushTextMessage(
        JSON.stringify({
          title: 'PlayZone · Prueba push',
          body: 'Notificación de prueba: configuración correcta.',
          tag: `playzone-test-${Date.now()}`,
        }),
        {},
      );
      return Response.json({ ok: true, modo: 'test', enviados: 1 });
    } catch (error) {
      console.error('Error en prueba de push', error);
      return Response.json(
        { error: 'Falló el envío de prueba; revisa los logs de la función' },
        { status: 502 },
      );
    }
  }
  if (mode !== 'dispatch' && mode !== 'tasks') {
    return Response.json(
      { error: 'Modo no permitido. Usa mode=test, mode=dispatch o mode=tasks.' },
      { status: 400 },
    );
  }
  if (Deno.env.get('PLAYZONE_AUTOMATIC_PUSH_ENABLED') !== 'true') {
    return Response.json(
      { error: 'Envíos automáticos desactivados' },
      { status: 403 },
    );
  }
  const now = new Date();
  const { date: today, hour } = boliviaDateKey(now);
  const tomorrow = addDay(today, 1);
  const events: Event[] = [];

  // Un unico resumen por administrador y dia, no una notificacion por cliente.
  // Las tareas con hora siguen siendo independientes en mode=tasks.
  if (mode === 'dispatch' && hour >= 9) {
    const { data: dueAccounts, error: accountError } = await admin
      .from('accounts')
      .select('id,owner_id,subscription_end')
      .not('owner_id', 'is', null)
      .in('subscription_end', [today, tomorrow])
      .limit(10000);
    if (accountError) throw accountError;
    const { data: dueClients, error: clientsError } = await admin
      .from('clients')
      .select('id,owner_id,end_date')
      .not('owner_id', 'is', null)
      .in('end_date', [today, tomorrow])
      .limit(10000);
    if (clientsError) throw clientsError;
    const counts = new Map<string, { accountsToday: number; accountsTomorrow: number; clientsToday: number; clientsTomorrow: number }>();
    const getCounts = (userId: string) => {
      if (!counts.has(userId)) counts.set(userId, {
        accountsToday: 0, accountsTomorrow: 0,
        clientsToday: 0, clientsTomorrow: 0,
      });
      return counts.get(userId)!;
    };
    for (const account of dueAccounts || []) {
      const current = getCounts(account.owner_id);
      if (account.subscription_end === today) current.accountsToday += 1;
      else current.accountsTomorrow += 1;
    }
    for (const client of dueClients || []) {
      const current = getCounts(client.owner_id);
      if (client.end_date === today) current.clientsToday += 1;
      else current.clientsTomorrow += 1;
    }
    for (const [userId, countsForUser] of counts) {
      events.push({
        userId,
        // EventKey diario y unico por suscripcion/dispositivo.
        eventKey: `resumen-v2:${today}`,
        title: 'PlayZone · Resumen de vencimientos',
        body: `Hoy: ${countsForUser.accountsToday} cuentas y ${countsForUser.clientsToday} clientes. Mañana: ${countsForUser.accountsTomorrow} cuentas y ${countsForUser.clientsTomorrow} clientes.`,
      });
    }
  }

  // mode=tasks se invoca cada minuto mediante un cron INDEPENDIENTE.
  // Solo tareas pendientes con hora, nunca vencimientos de cuentas/clientes.
  // Ventana de recuperación de 10 min por retrasos breves del programador.
  // La clave eventKey y notification_deliveries evitan duplicados por dispositivo.
  if (mode === 'tasks') {
    const tenMinutes = 10 * 60 * 1000;
    const rangeStart = new Date(now.getTime() - tenMinutes).toISOString();
    const rangeEnd = now.toISOString();
    const { data: tasks, error: taskError } = await admin
      .from('reminders')
      .select('id,user_id,kind,title,due_at')
      .eq('status', 'pendiente')
      .not('due_at', 'is', null)
      .gte('due_at', rangeStart)
      .lte('due_at', rangeEnd)
      .limit(10000);
    if (taskError) throw taskError;
    for (const task of tasks || []) {
      const due = Date.parse(task.due_at);
      if (!Number.isFinite(due) || due > now.getTime() || due < now.getTime() - tenMinutes) continue;
      events.push({
        userId: task.user_id,
        eventKey: `tarea:${task.id}:${task.due_at}:vence`,
        title: 'PlayZone · Tarea programada',
        body: task.title,
      });
    }
  }

  // No enviar a dispositivos de otros usuarios.
  const { data: subscriptions, error: subError } = await admin
    .from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth_secret')
    .limit(10000);
  if (subError) throw subError;
  if (!(subscriptions || []).length || !events.length)
    return Response.json({ events: events.length, sent: 0 });
  const byUser = new Map<string, typeof subscriptions>();
  for (const subscription of subscriptions || []) {
    if (!byUser.has(subscription.user_id)) byUser.set(subscription.user_id, []);
    byUser.get(subscription.user_id)?.push(subscription);
  }
  const server = await createPushServer();
  let sent = 0;
  let failed = 0;
  for (const event of events) {
    for (const sub of byUser.get(event.userId) || []) {
      const { data: claimed, error: claimError } = await admin
        .from('notification_deliveries')
        .upsert(
          {
            user_id: event.userId,
            subscription_id: sub.id,
            event_key: event.eventKey,
          },
          { onConflict: 'subscription_id,event_key', ignoreDuplicates: true },
        )
        .select('id');
      if (claimError) {
        failed++;
        console.error('Error reservando entrega', claimError.message);
        continue;
      }
      if (!claimed?.length) continue; // Ya enviada por este dispositivo.
      try {
        const pushSubscriber = server.subscribe({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
        });
        await pushSubscriber.pushTextMessage(
          JSON.stringify({
            title: event.title,
            body: event.body,
            tag: event.eventKey,
          }),
          {},
        );
        sent++;
      } catch (error) {
        failed++;
        console.error('Error enviando push', error);
        // La reserva se libera para reintentar; si expiró, se revoca la suscripción.
        await admin
          .from('notification_deliveries')
          .delete()
          .eq('id', claimed[0].id);
        const status =
          error && typeof error === 'object' && 'status' in error
            ? Number((error as { status?: number }).status)
            : 0;
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    }
  }
  return Response.json({ events: events.length, sent, failed });
});

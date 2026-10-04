-- PlayZone: instalar tras revisar el esquema existente y realizar backup.
-- No borra ni modifica registros existentes de accounts/clients.
-- Los registros actuales con owner_id NULL NO reciben push hasta asignar su propietario.

create extension if not exists pgcrypto;

alter table public.accounts add column if not exists owner_id uuid references auth.users(id);
alter table public.clients add column if not exists owner_id uuid references auth.users(id);
create index if not exists idx_playzone_accounts_due_owner on public.accounts (subscription_end, owner_id);
create index if not exists idx_playzone_clients_due_owner on public.clients (end_date, owner_id);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'tarea' check (kind in ('tarea','cobro','pago')),
  priority text not null default 'media' check (priority in ('baja','media','alta')),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  details text not null default '',
  due_at timestamptz,
  source_ref text,
  status text not null default 'pendiente' check (status in ('pendiente','completado','archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reminders_user_status_due on public.reminders(user_id,status,due_at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);

-- Entregas guardadas para evitar enviar dos veces el mismo aviso/dispositivo.
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  event_key text not null,
  created_at timestamptz not null default now(),
  unique(subscription_id,event_key)
);
create index if not exists idx_deliveries_created on public.notification_deliveries(created_at);

alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;

-- RLS estricta para datos personales y de cada dispositivo.
drop policy if exists playzone_reminders_select on public.reminders;
create policy playzone_reminders_select on public.reminders for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists playzone_reminders_insert on public.reminders;
create policy playzone_reminders_insert on public.reminders for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists playzone_reminders_update on public.reminders;
create policy playzone_reminders_update on public.reminders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists playzone_reminders_delete on public.reminders;
create policy playzone_reminders_delete on public.reminders for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists playzone_push_select on public.push_subscriptions;
create policy playzone_push_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists playzone_push_insert on public.push_subscriptions;
create policy playzone_push_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists playzone_push_update on public.push_subscriptions;
create policy playzone_push_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists playzone_push_delete on public.push_subscriptions;
create policy playzone_push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- No exponer los logs de entrega a navegadores ni a usuarios autenticados.
revoke all on public.notification_deliveries from anon, authenticated;
revoke all on public.reminders from anon;
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

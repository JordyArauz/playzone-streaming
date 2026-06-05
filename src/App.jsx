import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabaseClient';

const STORAGE_KEYS = {
  records: 'playzone_streaming_records_v1',
  accounts: 'playzone_streaming_accounts_v1',
  theme: 'playzone_streaming_theme_v1',
};

const platforms = ['Netflix', 'Prime Video', 'ChatGPT Plus', 'Disney+', 'Max', 'Spotify', 'YouTube Premium', 'Otro'];
const recordStatuses = ['Habilitado', 'Pendiente', 'Vencido', 'Deshabilitado'];
const paymentStatuses = ['Pagado', 'Pendiente'];
const accountTypes = ['Compartido', 'Privado'];
const accountStatuses = ['Activa', 'Pendiente', 'Suspendida', 'Vencida'];
const paymentMethods = ['QR', 'Efectivo'];
const ACCOUNT_COLUMNS = 'id, platform, type, card_name, email, password, subscription_start, subscription_end, status, notes, created_at, updated_at';
const CLIENT_COLUMNS = 'id, client_name, contact, platform, account_id, profile_name, pin, devices, start_date, end_date, price, payment_method, payment_status, status, notes, created_at, updated_at';
const menuItems = [
  { id: 'dashboard', label: '📊 Dashboard', short: 'D' },
  { id: 'records', label: '👤 Registrar Cliente', short: 'C' },
  { id: 'accounts', label: '🔐 Cuentas', short: 'A' },
  { id: 'accountList', label: '📋 Lista de Cuentas', short: 'L' },
  { id: 'clientList', label: '👥 Lista de Clientes', short: 'P' },
];

const emptyRecordForm = {
  clientName: '',
  contact: '',
  platform: 'Netflix',
  accountId: '',
  profileName: '',
  pin: '',
  devices: '',
  startDate: '',
  endDate: '',
  price: '',
  paymentMethod: 'QR',
  paymentStatus: 'Pendiente',
  status: 'Habilitado',
  notes: '',
};

const emptyAccountForm = {
  platform: 'Netflix',
  type: 'Compartido',
  cardName: '',
  email: '',
  password: '',
  subscriptionStart: '',
  subscriptionEnd: '',
  status: 'Activa',
  notes: '',
};

function safeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.error(`No se pudo leer ${key}`, error);
    return fallback;
  }
}

function normalizeDate(date) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function daysBetweenToday(date) {
  const target = normalizeDate(date);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function formatDate(date) {
  if (!date) return 'Sin fecha';
  const parsed = normalizeDate(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `Bs ${number.toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function normalizePlatformName(platform) {
  return platform === 'ChatGPT' ? 'ChatGPT Plus' : platform;
}

function isChatGPTPlus(platform) {
  return normalizePlatformName(platform) === 'ChatGPT Plus';
}

function platformMatches(left, right) {
  return normalizePlatformName(left) === normalizePlatformName(right);
}

function validateBolivianContact(contact) {
  return /^[67]\d{7}$/.test(contact);
}

function isEndDateBeforeStartDate(startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  return Boolean(start && end && end < start);
}

function getAlertClass(daysLeft) {
  if (daysLeft === 0) return 'alert-today';
  if (daysLeft === 1 || daysLeft === 2) return 'alert-soon';
  return 'alert-normal';
}

function getRecordStatus(record) {
  if (record.status === 'Deshabilitado') return 'Deshabilitado';
  const days = daysBetweenToday(record.endDate);
  if (days !== null && days < 0) return 'Vencido';
  if (record.status === 'Pendiente') return 'Pendiente';
  return record.status || 'Habilitado';
}

function getAccountLabel(account) {
  if (!account) return 'Sin cuenta';
  const platform = normalizePlatformName(account.platform);
  const type = account.type && !isChatGPTPlus(platform) ? `(${account.type})` : '';
  const email = account.email ? ` · ${account.email}` : '';
  return [platform, type].filter(Boolean).join(' ') + email;
}

function mapAccountFromSupabase(row) {
  return {
    id: row.id,
    platform: row.platform,
    type: row.type,
    cardName: row.card_name || '',
    email: row.email || '',
    password: row.password || '',
    subscriptionStart: row.subscription_start || '',
    subscriptionEnd: row.subscription_end || '',
    status: row.status,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAccountToSupabase(form) {
  const platform = normalizePlatformName(form.platform);
  return {
    platform,
    type: isChatGPTPlus(platform) ? 'Compartido' : form.type,
    card_name: form.cardName.trim(),
    email: form.email.trim(),
    password: form.password.trim(),
    subscription_start: form.subscriptionStart || null,
    subscription_end: form.subscriptionEnd || null,
    status: form.status,
    notes: form.notes.trim(),
  };
}

function mapClientFromSupabase(row) {
  return {
    id: row.id,
    clientName: row.client_name || '',
    contact: row.contact || '',
    platform: normalizePlatformName(row.platform || 'Netflix'),
    accountId: row.account_id || '',
    profileName: row.profile_name || '',
    pin: row.pin || '',
    devices: row.devices || '',
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    price: row.price ?? '',
    paymentMethod: row.payment_method || 'QR',
    paymentStatus: row.payment_status || 'Pendiente',
    status: row.status || 'Habilitado',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClientToSupabase(form) {
  const platform = normalizePlatformName(form.platform);
  const isChatGpt = isChatGPTPlus(platform);

  return {
    client_name: form.clientName.trim(),
    contact: form.contact.trim(),
    platform,
    account_id: form.accountId || null,
    profile_name: isChatGpt ? '' : form.profileName.trim(),
    pin: isChatGpt ? '' : form.pin.trim(),
    devices: form.devices.trim(),
    start_date: form.startDate || null,
    end_date: form.endDate || null,
    price: form.price === '' ? null : Number(form.price),
    payment_method: form.paymentMethod,
    payment_status: form.paymentStatus,
    status: form.status,
    notes: form.notes.trim(),
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [records, setRecords] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [recordForm, setRecordForm] = useState(emptyRecordForm);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('Todas');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [clientAccountFilter, setClientAccountFilter] = useState('Todas');
  const [accountPlatformFilter, setAccountPlatformFilter] = useState('Todas');
  const [accountStatusFilter, setAccountStatusFilter] = useState('Todos');
  const [accountTypeFilter, setAccountTypeFilter] = useState('Todos');
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('success');
  const [theme, setTheme] = useState(() => readStorage(STORAGE_KEYS.theme, 'dark'));
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [copiedRecordId, setCopiedRecordId] = useState(null);

  useEffect(() => {
    async function loadClients() {
      const { data, error } = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase clients] Error cargando clientes:', error.message);
        showNotice('No se pudieron cargar los clientes desde Supabase.', 'error');
        setRecords([]);
        return;
      }

      setRecords((data || []).map(mapClientFromSupabase));
    }

    loadClients();
  }, []);

  useEffect(() => {
    async function loadAccounts() {
      const { data, error } = await supabase
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase accounts] Error cargando cuentas:', error.message);
        showNotice('No se pudieron cargar las cuentas desde Supabase.', 'error');
        setAccounts([]);
        return;
      }

      setAccounts((data || []).map(mapAccountFromSupabase));
    }

    loadAccounts();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice('');
      setNoticeType('success');
    }, 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!copiedRecordId) return;
    const timer = setTimeout(() => setCopiedRecordId(null), 1800);
    return () => clearTimeout(timer);
  }, [copiedRecordId]);

  const accountById = useMemo(() => {
    return accounts.reduce((map, account) => {
      map[account.id] = account;
      return map;
    }, {});
  }, [accounts]);

  const isRecordChatGPTPlus = isChatGPTPlus(recordForm.platform);
  const filteredAccountsForRecord = useMemo(() => {
    return accounts.filter((account) => platformMatches(account.platform, recordForm.platform));
  }, [accounts, recordForm.platform]);
  const selectedAccountMatchesRecordPlatform = !recordForm.accountId || filteredAccountsForRecord.some((account) => account.id === recordForm.accountId);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...records]
      .filter((record) => {
        const account = accountById[record.accountId];
        const accountLabel = getAccountLabel(account).toLowerCase();
        const text = [
          record.clientName,
          record.contact,
          normalizePlatformName(record.platform),
          record.profileName,
          record.devices,
          record.notes,
          accountLabel,
        ]
          .join(' ')
          .toLowerCase();
        const matchesSearch = !term || text.includes(term);
        const matchesPlatform = platformFilter === 'Todas' || platformMatches(record.platform, platformFilter);
        const matchesStatus = statusFilter === 'Todos' || getRecordStatus(record) === statusFilter;
        const matchesAccount = clientAccountFilter === 'Todas' || record.accountId === clientAccountFilter;
        return matchesSearch && matchesPlatform && matchesStatus && matchesAccount;
      })
      .sort((a, b) => {
        const dateA = normalizeDate(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const dateB = normalizeDate(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return dateA - dateB;
      });
  }, [records, search, platformFilter, statusFilter, clientAccountFilter, accountById]);

  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...accounts]
      .filter((account) => {
        const text = [
          normalizePlatformName(account.platform),
          account.type,
          account.cardName,
          account.email,
          account.notes,
          account.status,
        ]
          .join(' ')
          .toLowerCase();
        const matchesSearch = !term || text.includes(term);
        const matchesPlatform = accountPlatformFilter === 'Todas' || platformMatches(account.platform, accountPlatformFilter);
        const normalizedType = isChatGPTPlus(account.platform) ? 'Compartido' : account.type;
        const matchesType = accountTypeFilter === 'Todos' || normalizedType === accountTypeFilter;
        const matchesStatus = accountStatusFilter === 'Todos' || account.status === accountStatusFilter;
        return matchesSearch && matchesPlatform && matchesType && matchesStatus;
      })
      .sort((a, b) => normalizePlatformName(a.platform).localeCompare(normalizePlatformName(b.platform), 'es'));
  }, [accounts, search, accountPlatformFilter, accountStatusFilter, accountTypeFilter]);

  const stats = useMemo(() => {
    const enriched = records.map((record) => ({ ...record, computedStatus: getRecordStatus(record), daysLeft: daysBetweenToday(record.endDate) }));
    const active = enriched.filter((record) => record.computedStatus === 'Habilitado').length;
    const pending = enriched.filter((record) => record.computedStatus === 'Pendiente').length;
    const expired = enriched.filter((record) => record.computedStatus === 'Vencido').length;
    const near = enriched.filter((record) => record.daysLeft !== null && record.daysLeft >= 0 && record.daysLeft <= 7 && record.computedStatus !== 'Deshabilitado').length;
    const month = new Date().getMonth();
    const year = new Date().getFullYear();
    const monthIncome = records
      .filter((record) => record.paymentStatus === 'Pagado')
      .filter((record) => {
        const baseDate = normalizeDate(record.startDate) || normalizeDate(record.endDate);
        return baseDate && baseDate.getMonth() === month && baseDate.getFullYear() === year;
      })
      .reduce((sum, record) => sum + Number(record.price || 0), 0);

    return { total: records.length, active, pending, expired, near, monthIncome };
  }, [records]);

  const upcomingRecords = useMemo(() => {
    return records
      .map((record) => ({ ...record, daysLeft: daysBetweenToday(record.endDate), computedStatus: getRecordStatus(record) }))
      .filter((record) => record.daysLeft !== null && record.daysLeft >= 0 && record.daysLeft <= 2 && record.computedStatus !== 'Deshabilitado')
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 6);
  }, [records]);

  const upcomingAccounts = useMemo(() => {
    return accounts
      .map((account) => ({ ...account, daysLeft: daysBetweenToday(account.subscriptionEnd) }))
      .filter((account) => account.daysLeft !== null && account.daysLeft >= 0 && account.daysLeft <= 2 && account.status !== 'Vencida' && account.status !== 'Suspendida')
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 6);
  }, [accounts]);

  const upcomingClientsCount = upcomingRecords.length;
  const upcomingAccountsCount = upcomingAccounts.length;
  const hasUpcomingDueDates = upcomingClientsCount + upcomingAccountsCount > 0;

  function showNotice(message, type = 'success') {
    setNotice(message);
    setNoticeType(type);
  }

  async function copyContact(record) {
    const contact = record.contact?.trim() || '';
    if (!validateBolivianContact(contact)) {
      showNotice('Este cliente no tiene un número boliviano válido para copiar.', 'error');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contact);
      } else {
        const input = document.createElement('textarea');
        input.value = contact;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopiedRecordId(record.id);
      showNotice('Número copiado.');
    } catch (error) {
      console.error(error);
      showNotice('No se pudo copiar el número.', 'error');
    }
  }

  function openWhatsApp(contact) {
    const cleanContact = contact?.trim() || '';
    if (!validateBolivianContact(cleanContact)) return;
    window.open(`https://wa.me/591${cleanContact}`, '_blank', 'noopener,noreferrer');
  }

  function updateRecordField(field, value) {
    setRecordForm((form) => {
      if (field === 'platform') {
        const nextForm = { ...form, platform: value, accountId: '' };
        if (isChatGPTPlus(value)) {
          nextForm.profileName = '';
          nextForm.pin = '';
        }
        return nextForm;
      }
      return { ...form, [field]: value };
    });
  }

  function updateAccountField(field, value) {
    setAccountForm((form) => {
      if (field === 'platform' && isChatGPTPlus(value)) {
        return { ...form, platform: value, type: 'Compartido' };
      }
      return { ...form, [field]: value };
    });
  }

  function goToTab(tab) {
    setActiveTab(tab);
    setIsSidebarOpen(false);
  }

  async function handleRecordSubmit(event) {
    event.preventDefault();
    if (!recordForm.clientName.trim()) {
      showNotice('Agrega el nombre del cliente antes de guardar.', 'error');
      return;
    }
    if (!validateBolivianContact(recordForm.contact.trim())) {
      showNotice('El contacto debe tener exactamente 8 dígitos y empezar con 6 o 7. Ej: 71234567.', 'error');
      return;
    }
    if (isEndDateBeforeStartDate(recordForm.startDate, recordForm.endDate)) {
      showNotice('La fecha de fin no puede ser anterior a la fecha de inicio.', 'error');
      return;
    }
    if (!selectedAccountMatchesRecordPlatform) {
      showNotice('La cuenta asociada debe pertenecer a la misma plataforma seleccionada.', 'error');
      return;
    }

    const payload = mapClientToSupabase(recordForm);

    if (editingRecordId) {
      const { data, error } = await supabase
        .from('clients')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingRecordId)
        .select(CLIENT_COLUMNS)
        .single();

      if (error) {
        console.error('[Supabase clients] Error actualizando cliente:', error.message);
        showNotice('No se pudo actualizar el cliente en Supabase.', 'error');
        return;
      }

      const updatedRecord = mapClientFromSupabase(data);
      setRecords((items) => items.map((item) => (item.id === editingRecordId ? updatedRecord : item)));
      showNotice('Registro actualizado correctamente.');
    } else {
      const { data, error } = await supabase
        .from('clients')
        .insert(payload)
        .select(CLIENT_COLUMNS)
        .single();

      if (error) {
        console.error('[Supabase clients] Error creando cliente:', error.message);
        showNotice('No se pudo guardar el cliente en Supabase.', 'error');
        return;
      }

      setRecords((items) => [mapClientFromSupabase(data), ...items]);
      showNotice('Registro guardado correctamente.');
    }

    setRecordForm(emptyRecordForm);
    setEditingRecordId(null);
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    if (!accountForm.email.trim() && !accountForm.cardName.trim()) {
      showNotice('Agrega al menos una tarjeta/nombre o email para identificar la cuenta.', 'error');
      return;
    }
    if (isEndDateBeforeStartDate(accountForm.subscriptionStart, accountForm.subscriptionEnd)) {
      showNotice('La fecha de fin de la suscripción no puede ser anterior a la fecha de inicio.', 'error');
      return;
    }

    const payload = mapAccountToSupabase(accountForm);

    if (editingAccountId) {
      const { data, error } = await supabase
        .from('accounts')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingAccountId)
        .select(ACCOUNT_COLUMNS)
        .single();

      if (error) {
        console.error('[Supabase accounts] Error actualizando cuenta:', error.message);
        showNotice('No se pudo actualizar la cuenta en Supabase.', 'error');
        return;
      }

      const updatedAccount = mapAccountFromSupabase(data);
      setAccounts((items) => items.map((item) => (item.id === editingAccountId ? updatedAccount : item)));
      showNotice('Cuenta actualizada correctamente.');
    } else {
      const { data, error } = await supabase
        .from('accounts')
        .insert(payload)
        .select(ACCOUNT_COLUMNS)
        .single();

      if (error) {
        console.error('[Supabase accounts] Error creando cuenta:', error.message);
        showNotice('No se pudo guardar la cuenta en Supabase.', 'error');
        return;
      }

      setAccounts((items) => [mapAccountFromSupabase(data), ...items]);
      showNotice('Cuenta guardada correctamente.');
    }

    setAccountForm(emptyAccountForm);
    setEditingAccountId(null);
  }

  function editRecord(record) {
    const platform = normalizePlatformName(record.platform);
    setRecordForm({
      ...emptyRecordForm,
      ...record,
      platform,
      paymentMethod: paymentMethods.includes(record.paymentMethod) ? record.paymentMethod : 'QR',
      profileName: isChatGPTPlus(platform) ? '' : record.profileName || '',
      pin: isChatGPTPlus(platform) ? '' : record.pin || '',
      price: record.price ?? '',
    });
    setEditingRecordId(record.id);
    setActiveTab('records');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editAccount(account) {
    const platform = normalizePlatformName(account.platform);
    setAccountForm({
      ...emptyAccountForm,
      ...account,
      platform,
      type: isChatGPTPlus(platform) ? 'Compartido' : accountTypes.includes(account.type) ? account.type : 'Compartido',
    });
    setEditingAccountId(account.id);
    setActiveTab('accounts');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteRecord(id) {
    const ok = window.confirm('¿Eliminar este registro? Esta acción no se puede deshacer.');
    if (!ok) return;

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Supabase clients] Error eliminando cliente:', error.message);
      showNotice('No se pudo eliminar el cliente en Supabase.', 'error');
      return;
    }

    setRecords((items) => items.filter((item) => item.id !== id));
    showNotice('Registro eliminado.');
  }

  async function deleteAccount(id) {
    const used = records.some((record) => record.accountId === id);
    const message = used
      ? 'Esta cuenta está asociada a uno o más registros. Si la eliminas, esos registros quedarán sin cuenta. ¿Continuar?'
      : '¿Eliminar esta cuenta?';
    const ok = window.confirm(message);
    if (!ok) return;

    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Supabase accounts] Error eliminando cuenta:', error.message);
      showNotice('No se pudo eliminar la cuenta en Supabase.', 'error');
      return;
    }

    setAccounts((items) => items.filter((item) => item.id !== id));
    setRecords((items) => items.map((record) => (record.accountId === id ? { ...record, accountId: '' } : record)));
    showNotice('Cuenta eliminada.');
  }

  return (
    <div className={isSidebarCollapsed ? 'app-shell app-shell--collapsed' : 'app-shell'}>
      <button className="mobile-menu-btn" type="button" onClick={() => { setIsSidebarCollapsed(false); setIsSidebarOpen(true); }}>Menú</button>
      <aside className={isSidebarOpen ? 'sidebar sidebar--open' : 'sidebar'} aria-label="Menú principal">
        <div className="sidebar__brand">
          <img src="/playzone-icon.svg" alt="PlayZone" />
          <div>
            <strong>PlayZone</strong>
            <span>Streaming</span>
          </div>
        </div>
        <button className="sidebar-toggle" type="button" onClick={() => setIsSidebarCollapsed((value) => !value)}>
          {isSidebarCollapsed ? 'Abrir' : 'Contraer'}
        </button>
        <nav className="sidebar__nav">
          {menuItems.map((item) => {
            const tab = item.tab || item.id;
            return (
              <button key={item.id} className={activeTab === tab ? 'side-link active' : 'side-link'} data-short={item.short} title={item.label} onClick={() => goToTab(tab)}>
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="theme-toggle" aria-label="Cambiar tema">
          <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Claro</button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Oscuro</button>
        </div>
        <button className="btn btn--ghost sidebar__close" type="button" onClick={() => setIsSidebarOpen(false)}>Cerrar</button>
      </aside>
      {isSidebarOpen && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setIsSidebarOpen(false)} />}
      <div className="app-content">
        <header className="hero">
        <div className="hero__brand">
          <img src="/playzone-icon.svg" alt="PlayZone" />
          <div>
            <p className="eyebrow">Panel personal de Jordy</p>
            <h1>PlayZone - Streaming</h1>
            <p className="hero__text">Gestiona cuentas, clientes, perfiles, pagos y vencimientos desde una sola pantalla.</p>
          </div>
        </div>
        <div className="hero__actions">
          <button className="btn btn--dark" onClick={() => goToTab('records')}>👤 Registrar Cliente</button>
        </div>
      </header>

      {notice && <div className={noticeType === 'error' ? 'notice notice--error error-message' : 'notice'}>{notice}</div>}

      {activeTab === 'dashboard' && (
        <main className="page-grid">
          <section className={hasUpcomingDueDates ? 'dashboard-alert alert-soon' : 'dashboard-alert alert-normal'}>
            <strong>{hasUpcomingDueDates ? '⚠️ Atención' : '✅ Todo al día'}</strong>
            <span>
              {hasUpcomingDueDates
                ? `Tienes ${upcomingClientsCount} ${upcomingClientsCount === 1 ? 'cliente' : 'clientes'} y ${upcomingAccountsCount} ${upcomingAccountsCount === 1 ? 'cuenta' : 'cuentas'} por vencer en los próximos 2 días.`
                : 'No tienes vencimientos próximos.'}
            </span>
          </section>

          <section className="stats-grid">
            <StatCard label="📋 Registros totales" value={stats.total} helper="Clientes/perfiles guardados" />
            <StatCard label="✅ Clientes activos" value={stats.active} helper="Servicios activos" tone="success" />
            <StatCard label="Por vencer" value={stats.near} helper="Próximos 7 días" tone="warning" />
            <StatCard label="Vencidos" value={stats.expired} helper="Revisar renovación" tone="danger" />
            <StatCard label="Pendientes" value={stats.pending} helper="Pago o activación pendiente" />
            <StatCard label="💰 Ingresos" value={formatMoney(stats.monthIncome)} helper="Solo registros pagados" tone="success" />
          </section>

          <section className="panel panel--wide">
            <div className="section-title">
              <div>
                <h2>⏰ Vencimientos próximos de clientes</h2>
                <p>Clientes que vencen hoy, mañana o pasado mañana.</p>
              </div>
              <button className="btn btn--ghost" onClick={() => setActiveTab('clientList')}>Ver todos</button>
            </div>
            {upcomingRecords.length === 0 ? (
              <EmptyState title="No hay vencimientos cercanos" text="Cuando agregues registros con fecha de fin, aparecerán aquí automáticamente." />
            ) : (
              <div className="cards-list">
                {upcomingRecords.map((record) => (
                  <RecordMiniCard key={record.id} record={record} account={accountById[record.accountId]} onEdit={() => editRecord(record)} />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-title">
              <div>
                <h2>🔐 Vencimientos próximos de cuentas</h2>
                <p>Cuentas que vencen hoy, mañana o pasado mañana.</p>
              </div>
              <button className="btn btn--ghost" onClick={() => setActiveTab('accountList')}>Ver cuentas</button>
            </div>
            {upcomingAccounts.length === 0 ? (
              <EmptyState title="No hay cuentas por vencer" text="Las cuentas con vencimiento en los próximos 2 días aparecerán aquí." />
            ) : (
              <div className="cards-list">
                {upcomingAccounts.map((account) => (
                  <AccountMiniCard key={account.id} account={account} onEdit={() => editAccount(account)} />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-title compact">
              <h2>🔐 Resumen de cuentas</h2>
              <button className="btn btn--ghost" onClick={() => setActiveTab('accounts')}>Gestionar</button>
            </div>
            {accounts.length === 0 ? (
              <EmptyState title="Sin cuentas registradas" text="Agrega tus cuentas de Netflix, Prime Video, ChatGPT Plus u otras plataformas." />
            ) : (
              <div className="summary-list">
                {accounts.slice(0, 5).map((account) => (
                  <div className="summary-row" key={account.id}>
                    <div>
                      <strong>{normalizePlatformName(account.platform)}</strong>
                      <span>{account.email || account.cardName || 'Sin identificador'}</span>
                    </div>
                    <Badge label={account.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {activeTab === 'records' && (
        <main className="page-grid page-grid--single">
          <section className="panel form-panel">
            <div className="section-title">
              <div>
                <h2>{editingRecordId ? '👤 Editar registro' : '👤 Registrar Cliente'}</h2>
                <p>Guarda datos del cliente, perfil, fechas, pago y estado.</p>
              </div>
            </div>

            <form className="form-grid" onSubmit={handleRecordSubmit}>
              <Field label="Cliente / nombre completo" required>
                <input value={recordForm.clientName} onChange={(e) => updateRecordField('clientName', e.target.value)} placeholder="Ej: Juan Pérez" />
              </Field>
              <Field label="Contacto">
                <input value={recordForm.contact} onChange={(e) => updateRecordField('contact', e.target.value)} placeholder="Ej: 70000000" />
              </Field>
              <Field label="Plataforma">
                <select value={recordForm.platform} onChange={(e) => updateRecordField('platform', e.target.value)}>
                  {platforms.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Cuenta asociada">
                <select value={selectedAccountMatchesRecordPlatform ? recordForm.accountId : ''} onChange={(e) => updateRecordField('accountId', e.target.value)}>
                  <option value="">Sin cuenta</option>
                  {filteredAccountsForRecord.map((account) => <option key={account.id} value={account.id}>{getAccountLabel(account)}</option>)}
                </select>
              </Field>
              {!isRecordChatGPTPlus && (
                <>
                  <Field label="Perfil / ID">
                    <input value={recordForm.profileName} onChange={(e) => updateRecordField('profileName', e.target.value)} placeholder="Ej: Perfil 1 / Jordy" />
                  </Field>
                  <Field label="PIN">
                    <input value={recordForm.pin} onChange={(e) => updateRecordField('pin', e.target.value)} placeholder="Ej: 1234" />
                  </Field>
                </>
              )}
              <Field label="Dispositivos">
                <input value={recordForm.devices} onChange={(e) => updateRecordField('devices', e.target.value)} placeholder="Ej: Celular y PC" />
              </Field>
              <Field label="Fecha de inicio">
                <input type="date" value={recordForm.startDate} onChange={(e) => updateRecordField('startDate', e.target.value)} />
              </Field>
              <Field label="Fecha de fin / vencimiento">
                <input type="date" value={recordForm.endDate} onChange={(e) => updateRecordField('endDate', e.target.value)} />
              </Field>
              <Field label="Pago / precio">
                <input type="number" min="0" step="0.01" value={recordForm.price} onChange={(e) => updateRecordField('price', e.target.value)} placeholder="Ej: 25" />
              </Field>
              <Field label="Método de pago">
                <select value={recordForm.paymentMethod} onChange={(e) => updateRecordField('paymentMethod', e.target.value)}>
                  {paymentMethods.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Estado de pago">
                <select value={recordForm.paymentStatus} onChange={(e) => updateRecordField('paymentStatus', e.target.value)}>
                  {paymentStatuses.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Estado del servicio">
                <select value={recordForm.status} onChange={(e) => updateRecordField('status', e.target.value)}>
                  {recordStatuses.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Observaciones" full>
                <textarea value={recordForm.notes} onChange={(e) => updateRecordField('notes', e.target.value)} placeholder="Ej: Renovará el próximo mes, no pagará, pidió un dispositivo extra..." rows="3" />
              </Field>
              <div className="form-actions">
                {editingRecordId && (
                  <button type="button" className="btn btn--ghost" onClick={() => { setEditingRecordId(null); setRecordForm(emptyRecordForm); }}>Cancelar edición</button>
                )}
                <button className="btn btn--dark" type="submit">{editingRecordId ? 'Guardar cambios' : 'Registrar cliente'}</button>
              </div>
            </form>
          </section>
        </main>
      )}

      {activeTab === 'accounts' && (
        <main className="page-grid page-grid--single">
          <section className="panel form-panel">
            <div className="section-title">
              <div>
                <h2>{editingAccountId ? '🔐 Editar cuenta' : '🔐 Cuentas'}</h2>
                <p>Guarda las cuentas/plataformas que usas para tus clientes.</p>
              </div>
            </div>

            <form className="form-grid" onSubmit={handleAccountSubmit}>
              <Field label="Plataforma">
                <select value={accountForm.platform} onChange={(e) => updateAccountField('platform', e.target.value)}>
                  {platforms.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Tipo">
                <select value={accountForm.type} onChange={(e) => updateAccountField('type', e.target.value)} disabled={isChatGPTPlus(accountForm.platform)}>
                  {accountTypes.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Tarjeta / nombre de referencia">
                <input value={accountForm.cardName} onChange={(e) => updateAccountField('cardName', e.target.value)} placeholder="Ej: Jordy - Takenos" />
              </Field>
              <Field label="Email / usuario">
                <input value={accountForm.email} onChange={(e) => updateAccountField('email', e.target.value)} placeholder="Ej: correo@gmail.com" />
              </Field>
              <Field label="Contraseña">
                <input value={accountForm.password} onChange={(e) => updateAccountField('password', e.target.value)} placeholder="Puedes dejarlo vacío por seguridad" />
              </Field>
              <Field label="Fecha suscripción inicio">
                <input type="date" value={accountForm.subscriptionStart} onChange={(e) => updateAccountField('subscriptionStart', e.target.value)} />
              </Field>
              <Field label="Fecha suscripción fin">
                <input type="date" value={accountForm.subscriptionEnd} onChange={(e) => updateAccountField('subscriptionEnd', e.target.value)} />
              </Field>
              <Field label="Estado de cuenta">
                <select value={accountForm.status} onChange={(e) => updateAccountField('status', e.target.value)}>
                  {accountStatuses.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Observaciones" full>
                <textarea value={accountForm.notes} onChange={(e) => updateAccountField('notes', e.target.value)} placeholder="Ej: Renovar con tal tarjeta, cuenta compartida, revisar pago..." rows="3" />
              </Field>
              <div className="form-actions">
                {editingAccountId && (
                  <button type="button" className="btn btn--ghost" onClick={() => { setEditingAccountId(null); setAccountForm(emptyAccountForm); }}>Cancelar edición</button>
                )}
                <button className="btn btn--dark" type="submit">{editingAccountId ? 'Guardar cambios' : 'Guardar cuenta'}</button>
              </div>
            </form>
          </section>
        </main>
      )}

      {activeTab === 'clientList' && (
        <main className="page-grid page-grid--stacked">
          <section className="panel panel--wide list-panel">
            <div className="section-title">
              <div>
                <h2>👥 Lista de Clientes</h2>
                <p>Busca por nombre, contacto, plataforma, perfil o cuenta asociada.</p>
              </div>
            </div>

            <div className="filters filters--clients">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cliente, contacto, cuenta o plataforma..." />
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                <option>Todas</option>
                {platforms.map((item) => <option key={item}>{item}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option>Todos</option>
                {recordStatuses.map((item) => <option key={item}>{item}</option>)}
              </select>
              <select value={clientAccountFilter} onChange={(e) => setClientAccountFilter(e.target.value)}>
                <option value="Todas">Todas las cuentas</option>
                <option value="">Sin cuenta</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{getAccountLabel(account)}</option>)}
              </select>
            </div>

            {filteredRecords.length === 0 ? (
              <EmptyState title="No hay registros para mostrar" text="Registra un cliente o cambia los filtros de búsqueda." />
            ) : (
              <div className="records-table">
                {filteredRecords.map((record) => (
                  <article className="record-card" key={record.id}>
                    <div className="record-card__main">
                      <div>
                        <div className="record-title-row">
                          <h3>{record.clientName}</h3>
                          <Badge label={getRecordStatus(record)} />
                        </div>
                        <p className="muted">{normalizePlatformName(record.platform)} · {isChatGPTPlus(record.platform) ? 'Sin perfil requerido' : record.profileName || 'Sin perfil'} · {record.devices || 'Sin dispositivos'}</p>
                        <p className="muted small">Cuenta: {getAccountLabel(accountById[record.accountId])}</p>
                      </div>
                      <div className="record-money">
                        <strong>{formatMoney(record.price)}</strong>
                        <span>{record.paymentStatus}</span>
                      </div>
                    </div>
                    <div className="record-details">
                      <span className="contact-detail">
                        <span>Contacto: <strong>{record.contact || 'Sin dato'}</strong></span>
                        {validateBolivianContact(record.contact || '') && (
                          <span className="quick-actions">
                            <button type="button" className="btn btn--tiny btn--ghost" onClick={() => copyContact(record)}>
                              {copiedRecordId === record.id ? 'Copiado' : 'Copiar'}
                            </button>
                            <button type="button" className="btn btn--tiny btn--whatsapp" onClick={() => openWhatsApp(record.contact)}>
                              WhatsApp
                            </button>
                          </span>
                        )}
                      </span>
                      <span>Inicio: <strong>{formatDate(record.startDate)}</strong></span>
                      <span>Fin: <strong>{formatDate(record.endDate)}</strong></span>
                      {!isChatGPTPlus(record.platform) && <span>PIN: <strong>{record.pin || 'Sin dato'}</strong></span>}
                    </div>
                    {record.notes && <p className="record-notes">{record.notes}</p>}
                    <div className="record-actions">
                      <button className="btn btn--ghost" onClick={() => editRecord(record)}>Editar</button>
                      <button className="btn btn--danger" onClick={() => deleteRecord(record.id)}>Eliminar</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {activeTab === 'accountList' && (
        <main className="page-grid page-grid--stacked">
          <section className="panel panel--wide list-panel">
            <div className="section-title">
              <div>
                <h2>📋 Lista de Cuentas</h2>
                <p>Administra plataformas, correos, fechas, tipo, estado y observaciones.</p>
              </div>
            </div>

            <div className="filters filters--accounts">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cuenta, email, plataforma u observación..." />
              <select value={accountPlatformFilter} onChange={(e) => setAccountPlatformFilter(e.target.value)}>
                <option>Todas</option>
                {platforms.map((item) => <option key={item}>{item}</option>)}
              </select>
              <select value={accountStatusFilter} onChange={(e) => setAccountStatusFilter(e.target.value)}>
                <option>Todos</option>
                {accountStatuses.map((item) => <option key={item}>{item}</option>)}
              </select>
              <select value={accountTypeFilter} onChange={(e) => setAccountTypeFilter(e.target.value)}>
                <option>Todos</option>
                {accountTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>

            {filteredAccounts.length === 0 ? (
              <EmptyState title="No hay cuentas para mostrar" text="Registra una cuenta o cambia los filtros de búsqueda." />
            ) : (
              <div className="account-grid">
                {filteredAccounts.map((account) => {
                  const usedCount = records.filter((record) => record.accountId === account.id).length;
                  return (
                    <article className="account-card" key={account.id}>
                      <div className="account-card__header">
                        <div>
                          <h3>{normalizePlatformName(account.platform)}</h3>
                          <p>{isChatGPTPlus(account.platform) ? account.cardName || 'Sin tarjeta/ref.' : `${account.type} · ${account.cardName || 'Sin tarjeta/ref.'}`}</p>
                        </div>
                        <Badge label={account.status} />
                      </div>
                      <div className="account-data">
                        <span>Email</span>
                        <strong>{account.email || 'Sin dato'}</strong>
                        <span>Contraseña</span>
                        <strong>{account.password ? 'Guardada' : 'Sin dato'}</strong>
                        <span>Suscripción</span>
                        <strong>{formatDate(account.subscriptionStart)} - {formatDate(account.subscriptionEnd)}</strong>
                        <span>Clientes/perfiles</span>
                        <strong>{usedCount}</strong>
                      </div>
                      {account.notes && <p className="record-notes">{account.notes}</p>}
                      <div className="record-actions">
                        <button className="btn btn--ghost" onClick={() => editAccount(account)}>Editar</button>
                        <button className="btn btn--danger" onClick={() => deleteAccount(account.id)}>Eliminar</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      )}
      </div>
    </div>
  );
}

function StatCard({ label, value, helper, tone = 'neutral' }) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function Badge({ label }) {
  const key = String(label || '').toLowerCase();
  let className = 'badge';
  if (key.includes('habilitado') || key.includes('activa') || key.includes('pagado')) className += ' badge--success';
  if (key.includes('pendiente')) className += ' badge--warning';
  if (key.includes('vencido') || key.includes('deshabilitado') || key.includes('suspendida')) className += ' badge--danger';
  return <span className={className}>{label}</span>;
}

function Field({ label, children, full = false, required = false }) {
  return (
    <label className={full ? 'field field--full' : 'field'}>
      <span>{label}{required && <b> *</b>}</span>
      {children}
    </label>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">▶</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function RecordMiniCard({ record, account, onEdit }) {
  const days = record.daysLeft;
  return (
    <article className={`mini-card ${getAlertClass(days)}`}>
      <div>
        <h3>{record.clientName}</h3>
        <p>{normalizePlatformName(record.platform)} · {isChatGPTPlus(record.platform) ? 'Sin perfil requerido' : record.profileName || 'Sin perfil'}</p>
        <span>{getAccountLabel(account)}</span>
      </div>
      <div className="mini-card__side">
        <strong>{days === 0 ? 'Hoy' : `${days} días`}</strong>
        <button className="btn btn--ghost" onClick={onEdit}>Editar</button>
      </div>
    </article>
  );
}

function AccountMiniCard({ account, onEdit }) {
  const days = account.daysLeft;
  return (
    <article className={`mini-card ${getAlertClass(days)}`}>
      <div>
        <h3>{normalizePlatformName(account.platform)}</h3>
        <p>{account.email || account.cardName || 'Sin identificador'}</p>
        <span>Fin: {formatDate(account.subscriptionEnd)}</span>
      </div>
      <div className="mini-card__side">
        <strong>{days === 0 ? 'Hoy' : `${days} días`}</strong>
        <button className="btn btn--ghost" onClick={onEdit}>Editar</button>
      </div>
    </article>
  );
}

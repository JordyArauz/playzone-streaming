import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import Planillas, { getInitialPlanillasDueItems } from './pages/Planillas';
import ReminderCenter from './components/ReminderCenter';
import { disablePlayZonePush } from './lib/pushNotifications';
import { visibleNote } from './lib/visibleNote';
import netflixLogo from './assets/brands/netflix.jpg';
import primeVideoLogo from './assets/brands/prime-video.webp';
import hboMaxLogo from './assets/brands/hbo-max.png';
import chatgptLogo from './assets/brands/chatgpt-plus.jpg';

const STORAGE_KEYS = {
  records: 'playzone_streaming_records_v1',
  accounts: 'playzone_streaming_accounts_v1',
  theme: 'playzone_streaming_theme_v1',
};

const platforms = [
  'Netflix',
  'Prime Video',
  'Disney+',
  'HBO Max',
  'ChatGPT Plus',
  'Crunchyroll',
  'Spotify',
];
const recordStatuses = ['Habilitado', 'Pendiente', 'Vencido', 'Deshabilitado'];
const accountTypes = ['Compartido', 'Privado'];
const accountStatuses = ['Activa', 'Pendiente', 'Suspendida', 'Vencida'];
const ACCOUNT_COLUMNS =
  'id, platform, type, card_name, email, password, subscription_start, subscription_end, status, notes, location, created_at, updated_at';
const CLIENT_COLUMNS =
  'id, client_name, contact, platform, account_id, profile_name, pin, devices, start_date, end_date, price, payment_method, payment_status, status, notes, login_record, created_at, updated_at';
const menuItems = [
  { id: 'dashboard', label: '📊 Dashboard', short: 'D' },
  { id: 'planillas', label: '📑 Planillas', short: 'P' },
  { id: 'accountList', label: '📋 Lista de Cuentas', short: 'C' },
  { id: 'clientList', label: '👥 Lista de Clientes', short: 'L' },
];
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
  return parsed.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `Bs ${number.toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatActivityDate(value) {
  if (!value) return 'Sin fecha';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha';
  }

  return date.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: 'short',
  });
}

function normalizePlatformName(platform) {
  if (platform === 'ChatGPT') return 'ChatGPT Plus';
  if (platform === 'Max') return 'HBO Max';
  return platform;
}

function getPlatformClass(platform) {
  const normalized = normalizePlatformName(platform);
  const slug = normalized
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return `platform-tag platform-tag--${slug}`;
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
  const type =
    account.type && !isChatGPTPlus(platform) ? `(${account.type})` : '';
  const email = account.email ? ` · ${account.email}` : '';
  return [platform, type].filter(Boolean).join(' ') + email;
}

function getAccountDetailLabel(account) {
  if (!account) return '';
  const platform = normalizePlatformName(account.platform);
  const type =
    account.type && !isChatGPTPlus(platform) ? `(${account.type})` : '';
  const identifier = account.email || account.cardName || '';
  return [type, identifier].filter(Boolean).join(' - ');
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
    notes: visibleNote(row.notes),
    location: row.location || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    loginRecord: row.login_record || '',
    status: row.status || 'Habilitado',
    notes: visibleNote(row.notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [records, setRecords] = useState([]);
  const [accounts, setAccounts] = useState([]);
  // Estos indicadores evitan mostrar una Planilla vacía si falla la consulta.
  const [remoteLoading, setRemoteLoading] = useState({
    accounts: true,
    clients: true,
  });
  const [remoteErrors, setRemoteErrors] = useState({
    accounts: '',
    clients: '',
  });
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('Todas');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [clientAccountFilter, setClientAccountFilter] = useState('Todas');
  const [accountPlatformFilter, setAccountPlatformFilter] = useState('Todas');
  const [accountStatusFilter, setAccountStatusFilter] = useState('Todos');
  const [accountTypeFilter, setAccountTypeFilter] = useState('Todos');
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('success');
  const [theme, setTheme] = useState(() =>
    readStorage(STORAGE_KEYS.theme, 'dark'),
  );
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    password: '',
    confirmPassword: '',
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [copiedRecordId, setCopiedRecordId] = useState(null);
  const sidebarTouchStart = useRef(null);
  const [detailView, setDetailView] = useState(null);
  const [reminderDraft, setReminderDraft] = useState(null);
  const [planillasDueItems, setPlanillasDueItems] = useState([]);
  useEffect(() => {
    if (session?.user?.id)
      setPlanillasDueItems(getInitialPlanillasDueItems(session.user.id));
    else setPlanillasDueItems([]);
  }, [session?.user?.id]);
  useEffect(() => {
    // La campana vuelve a calcular los avisos incluso si estás en Dashboard
    // cuando llega medianoche en Bolivia.
    if (!session?.user?.id || activeTab === 'planillas') return undefined;
    const refresh = () =>
      setPlanillasDueItems(getInitialPlanillasDueItems(session.user.id));
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [session?.user?.id, activeTab]);

  useEffect(() => {
    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error(
          '[Supabase auth] Error obteniendo sesión:',
          error.message,
        );
        showNotice('No se pudo verificar la sesión.', 'error');
      }
      setSession(data?.session || null);
      setAuthLoading(false);
    }

    loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        setSession(currentSession);
        setAuthLoading(false);

        if (event === 'PASSWORD_RECOVERY') {
          setShowPasswordChange(true);
        }

        if (!currentSession) {
          setRecords([]);
          setAccounts([]);
          setRemoteLoading({ accounts: true, clients: true });
          setRemoteErrors({ accounts: '', clients: '' });
        }
      },
    );

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    async function loadClients() {
      const { data, error } = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .order('excel_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      setRemoteLoading((state) => ({ ...state, clients: false }));
      setRemoteErrors((state) => ({ ...state, clients: error?.message || '' }));
      if (error) {
        console.error(
          '[Supabase clients] Error cargando clientes:',
          error.message,
        );
        showNotice(
          'No se pudieron cargar los clientes desde Supabase.',
          'error',
        );
        setRecords([]);
        return;
      }

      setRecords((data || []).map(mapClientFromSupabase));
    }

    loadClients();
    const onFocus = () => {
      if (!document.hidden) loadClients();
    };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 120000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;

    async function loadAccounts() {
      const { data, error } = await supabase
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .order('excel_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      setRemoteLoading((state) => ({ ...state, accounts: false }));
      setRemoteErrors((state) => ({
        ...state,
        accounts: error?.message || '',
      }));
      if (error) {
        console.error(
          '[Supabase accounts] Error cargando cuentas:',
          error.message,
        );
        showNotice(
          'No se pudieron cargar las cuentas desde Supabase.',
          'error',
        );
        setAccounts([]);
        return;
      }

      setAccounts((data || []).map(mapAccountFromSupabase));
    }

    loadAccounts();
    const onFocus = () => {
      if (!document.hidden) loadAccounts();
    };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 120000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [session]);

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

  function handleSidebarTouchStart(event) {
    const touch = event.touches[0];
    sidebarTouchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleSidebarTouchEnd(event) {
    if (
      !sidebarTouchStart.current ||
      !window.matchMedia('(max-width: 1080px)').matches
    )
      return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - sidebarTouchStart.current.x;
    const deltaY = touch.clientY - sidebarTouchStart.current.y;
    const isLeftSwipe =
      deltaX < -70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4;

    if (isLeftSwipe) setIsSidebarOpen(false);
    sidebarTouchStart.current = null;
  }

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
        const matchesPlatform =
          platformFilter === 'Todas' ||
          platformMatches(record.platform, platformFilter);
        const matchesStatus =
          statusFilter === 'Todos' || getRecordStatus(record) === statusFilter;
        const matchesAccount =
          clientAccountFilter === 'Todas' ||
          record.accountId === clientAccountFilter;
        return (
          matchesSearch && matchesPlatform && matchesStatus && matchesAccount
        );
      });
  }, [
    records,
    search,
    platformFilter,
    statusFilter,
    clientAccountFilter,
    accountById,
  ]);

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
        const matchesPlatform =
          accountPlatformFilter === 'Todas' ||
          platformMatches(account.platform, accountPlatformFilter);
        const normalizedType = isChatGPTPlus(account.platform)
          ? 'Compartido'
          : account.type;
        const matchesType =
          accountTypeFilter === 'Todos' || normalizedType === accountTypeFilter;
        const matchesStatus =
          accountStatusFilter === 'Todos' ||
          account.status === accountStatusFilter;
        return matchesSearch && matchesPlatform && matchesType && matchesStatus;
      });
  }, [
    accounts,
    search,
    accountPlatformFilter,
    accountStatusFilter,
    accountTypeFilter,
  ]);

  const stats = useMemo(() => {
    const enriched = records.map((record) => ({
      ...record,
      computedStatus: getRecordStatus(record),
      daysLeft: daysBetweenToday(record.endDate),
    }));
    const active = enriched.filter(
      (record) => record.computedStatus === 'Habilitado',
    ).length;
    const pending = enriched.filter(
      (record) => record.computedStatus === 'Pendiente',
    ).length;
    const expired = enriched.filter(
      (record) => record.computedStatus === 'Vencido',
    ).length;
    const near = enriched.filter(
      (record) =>
        record.daysLeft !== null &&
        record.daysLeft >= 0 &&
        record.daysLeft <= 7 &&
        record.computedStatus !== 'Deshabilitado',
    ).length;
    const monthIncome = records
      .filter(
        (record) =>
          String(record.paymentStatus || '')
            .trim()
            .toLowerCase() === 'pagado',
      )
      .reduce((sum, record) => {
        const price = Number(record.price);
        return sum + (Number.isFinite(price) ? price : 0);
      }, 0);

    return {
      total: records.length,
      active,
      pending,
      expired,
      near,
      monthIncome,
    };
  }, [records]);

  const dashboardPlatforms = useMemo(() => {
    const definitions = [
      {
        key: 'netflix-private',
        logo: netflixLogo,
        label: 'Netflix Privado',
        short: 'N',
        className: 'dashboard-platform-card--netflix-private',
        count: accounts.filter(
          (account) =>
            normalizePlatformName(account.platform) === 'Netflix' &&
            account.type === 'Privado',
        ).length,
      },
      {
        key: 'netflix-shared',
        logo: netflixLogo,
        label: 'Netflix Compartido',
        short: 'N',
        className: 'dashboard-platform-card--netflix-shared',
        count: accounts.filter(
          (account) =>
            normalizePlatformName(account.platform) === 'Netflix' &&
            account.type === 'Compartido',
        ).length,
      },
      {
        key: 'prime-video',
        logo: primeVideoLogo,
        label: 'Prime Video',
        short: '▶',
        className: 'dashboard-platform-card--prime',
        count: accounts.filter(
          (account) =>
            normalizePlatformName(account.platform) === 'Prime Video',
        ).length,
      },
      {
        key: 'hbo-max',
        logo: hboMaxLogo,
        label: 'HBO Max',
        short: 'H',
        className: 'dashboard-platform-card--hbo',
        count: accounts.filter(
          (account) => normalizePlatformName(account.platform) === 'HBO Max',
        ).length,
      },
      {
        key: 'chatgpt-plus',
        logo: chatgptLogo,
        label: 'ChatGPT Plus',
        short: '✦',
        className: 'dashboard-platform-card--chatgpt',
        count: accounts.filter(
          (account) =>
            normalizePlatformName(account.platform) === 'ChatGPT Plus',
        ).length,
      },
    ];

    return definitions;
  }, [accounts]);

  const recentActivity = useMemo(() => {
    const accountActivity = accounts.map((account) => ({
      id: `account-${account.id}`,
      kind: 'Cuenta',
      title: normalizePlatformName(account.platform),
      detail: account.email || account.cardName || 'Cuenta registrada',
      createdAt: account.createdAt,
      sortValue: new Date(account.createdAt || 0).getTime(),
    }));

    const clientActivity = records.map((record) => ({
      id: `client-${record.id}`,
      kind: 'Cliente',
      title: record.clientName || 'Cliente',
      detail: normalizePlatformName(record.platform),
      createdAt: record.createdAt,
      sortValue: new Date(record.createdAt || 0).getTime(),
    }));

    return [...accountActivity, ...clientActivity]
      .sort((a, b) => b.sortValue - a.sortValue)
      .slice(0, 5);
  }, [accounts, records]);

  const upcomingRecords = useMemo(() => {
    return records
      .map((record) => ({
        ...record,
        daysLeft: daysBetweenToday(record.endDate),
        computedStatus: getRecordStatus(record),
      }))
      .filter(
        (record) =>
          record.daysLeft !== null &&
          record.daysLeft >= 0 &&
          record.daysLeft <= 2 &&
          record.computedStatus !== 'Deshabilitado',
      )
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 6);
  }, [records]);

  const upcomingAccounts = useMemo(() => {
    return accounts
      .map((account) => ({
        ...account,
        daysLeft: daysBetweenToday(account.subscriptionEnd),
      }))
      .filter(
        (account) =>
          account.daysLeft !== null &&
          account.daysLeft >= 0 &&
          account.daysLeft <= 2 &&
          account.status !== 'Vencida' &&
          account.status !== 'Suspendida',
      )
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 6);
  }, [accounts]);

  const upcomingClientsCount = upcomingRecords.length;
  const upcomingAccountsCount = upcomingAccounts.length;
  const hasUpcomingDueDates = upcomingClientsCount + upcomingAccountsCount > 0;
  const currentRecordDetail =
    detailView?.type === 'record'
      ? records.find((record) => record.id === detailView.id)
      : null;
  const currentAccountDetail =
    detailView?.type === 'account'
      ? accounts.find((account) => account.id === detailView.id)
      : null;

  async function reloadPlanillas() {
    if (!session?.user?.id)
      throw new Error('La sesión terminó. Inicia sesión nuevamente.');
    const [accountReply, clientReply] = await Promise.all([
      supabase
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .order('excel_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .order('excel_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ]);
    if (accountReply.error || clientReply.error) {
      const message = accountReply.error?.message || clientReply.error?.message;
      setRemoteErrors({
        accounts: accountReply.error?.message || '',
        clients: clientReply.error?.message || '',
      });
      throw new Error(`No se pudo comprobar el guardado: ${message}`);
    }
    setAccounts((accountReply.data || []).map(mapAccountFromSupabase));
    setRecords((clientReply.data || []).map(mapClientFromSupabase));
    setRemoteErrors({ accounts: '', clients: '' });
  }

  function showNotice(message, type = 'success') {
    setNotice(message);
    setNoticeType(type);
  }

  async function copyContact(record) {
    const contact = record.contact?.trim() || '';
    if (!validateBolivianContact(contact)) {
      showNotice(
        'Este cliente no tiene un número boliviano válido para copiar.',
        'error',
      );
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
    window.open(
      `https://wa.me/591${cleanContact}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  function goToTab(tab) {
    if (tab !== 'dashboard') {
      setDetailView(null);
    }

    // Cambiar de sección no altera si el menú está visible u oculto.
    setActiveTab(tab);
    setIsSidebarOpen(false);
  }

  function collapseSidebarMenu() {
    setIsSidebarCollapsed(true);
    setIsSidebarOpen(false);
  }

  function openSidebarMenu() {
    setIsSidebarCollapsed(false);

    if (window.matchMedia('(max-width: 1080px)').matches) {
      setIsSidebarOpen(true);
    }
  }

  function viewRecord(record) {
    setDetailView({ type: 'record', id: record.id });
    setActiveTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function viewAccount(account) {
    setDetailView({ type: 'account', id: account.id });
    setActiveTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = loginForm.email.trim();
    const password = loginForm.password;

    if (!email || !password) {
      showNotice('Ingresa email y contraseña para iniciar sesión.', 'error');
      return;
    }

    setLoginLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoginLoading(false);

    if (error) {
      console.error('[Supabase auth] Error iniciando sesión:', error.message);
      showNotice('Email o contraseña incorrectos.', 'error');
      return;
    }

    setLoginForm({ email: '', password: '' });
    showNotice('Sesión iniciada correctamente.');
  }

  async function handlePasswordRecoveryRequest() {
    const email = loginForm.email.trim();

    if (!email) {
      showNotice(
        'Escribe primero tu email para enviarte el enlace de recuperación.',
        'error',
      );
      return;
    }

    setRecoveryLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    setRecoveryLoading(false);

    if (error) {
      console.error(
        '[Supabase auth] Error enviando recuperación:',
        error.message,
      );
      showNotice('No se pudo enviar el correo de recuperación.', 'error');
      return;
    }

    showNotice('Te enviamos un enlace de recuperación al correo indicado.');
  }

  async function handlePasswordChange(event) {
    event.preventDefault();

    const password = passwordForm.password;
    const confirmPassword = passwordForm.confirmPassword;

    if (!password || !confirmPassword) {
      showNotice('Completa los dos campos de contraseña.', 'error');
      return;
    }

    if (password.length < 8) {
      showNotice('La contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showNotice('Las contraseñas no coinciden.', 'error');
      return;
    }

    setPasswordLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setPasswordLoading(false);

    if (error) {
      console.error(
        '[Supabase auth] Error cambiando contraseña:',
        error.message,
      );
      showNotice('No se pudo cambiar la contraseña.', 'error');
      return;
    }

    setPasswordForm({
      password: '',
      confirmPassword: '',
    });

    setShowPasswordChange(false);
    showNotice('Contraseña actualizada correctamente.');
  }

  async function handleSignOut() {
    // Revoca el token del dispositivo para evitar notificaciones de otro usuario al cambiar de cuenta.
    try {
      await disablePlayZonePush();
    } catch (error) {
      console.warn('No se pudo revocar push:', error);
    }
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('[Supabase auth] Error cerrando sesión:', error.message);
      showNotice('No se pudo cerrar sesión.', 'error');
      return;
    }

    setActiveTab('dashboard');
    setIsSidebarOpen(false);
    showNotice('Sesión cerrada.');
  }

  async function deleteRecord(id) {
    const ok = window.confirm(
      '¿Eliminar este registro? Esta acción no se puede deshacer.',
    );
    if (!ok) return;

    const { error } = await supabase.from('clients').delete().eq('id', id);

    if (error) {
      console.error(
        '[Supabase clients] Error eliminando cliente:',
        error.message,
      );
      showNotice('No se pudo eliminar el cliente en Supabase.', 'error');
      return;
    }

    setRecords((items) => items.filter((item) => item.id !== id));
    showNotice('Registro eliminado.');
  }

  async function deleteAccount(id) {
    if (records.some((record) => record.accountId === id)) {
      showNotice(
        'La cuenta tiene clientes asociados. No se eliminará ni se desvincularán clientes.',
        'error',
      );
      return;
    }
    if (
      !window.confirm(
        '¿Eliminar esta cuenta sin clientes? Esta acción no se puede deshacer.',
      )
    )
      return;
    const { data, error } = await supabase.rpc('pz_delete_account_safe', {
      p_id: id,
    });
    if (error || !data?.deleted_id) {
      showNotice(
        `No se pudo eliminar la cuenta: ${error?.message || 'Operación no confirmada'}`,
        'error',
      );
      return;
    }
    try {
      await reloadPlanillas();
      showNotice('Cuenta eliminada.');
    } catch (reloadError) {
      showNotice(reloadError.message, 'error');
    }
  }

  if (authLoading) {
    return (
      <div className="auth-page">
        <section className="panel auth-panel">
          <div className="auth-panel__brand">
            <img src="/playzone-icon.svg" alt="PlayZone" />
            <div>
              <p className="eyebrow">PlayZone - Streaming</p>
              <h1>Verificando sesión...</h1>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-page">
        <section className="panel auth-panel">
          <div className="auth-panel__brand">
            <img src="/playzone-icon.svg" alt="PlayZone" />
            <div>
              <p className="eyebrow">Acceso privado</p>
              <h1>PlayZone - Streaming</h1>
              <p className="hero__text">
                Inicia sesión para administrar cuentas, clientes, pagos y
                vencimientos.
              </p>
            </div>
          </div>

          {notice && (
            <div
              className={
                noticeType === 'error'
                  ? 'notice notice--error error-message'
                  : 'notice'
              }
            >
              {notice}
            </div>
          )}

          <form className="form-grid auth-form" onSubmit={handleLogin}>
            <Field label="Email">
              <input
                type="email"
                inputMode="email"
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((form) => ({
                    ...form,
                    email: event.target.value,
                  }))
                }
                placeholder="correo@ejemplo.com"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
              />
            </Field>
            <Field label="Contraseña">
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((form) => ({
                    ...form,
                    password: event.target.value,
                  }))
                }
                placeholder="Tu contraseña"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
              />
            </Field>
            <div className="form-actions">
              <button
                className="btn btn--ghost"
                type="button"
                onClick={handlePasswordRecoveryRequest}
                disabled={recoveryLoading}
              >
                {recoveryLoading ? 'Enviando...' : '¿Olvidaste tu contraseña?'}
              </button>
              <button
                className="btn btn--dark"
                type="submit"
                disabled={loginLoading}
              >
                {loginLoading ? 'Ingresando...' : 'Iniciar sesión'}
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div
      className={
        isSidebarCollapsed ? 'app-shell app-shell--collapsed' : 'app-shell'
      }
    >
      <button
        className="mobile-menu-btn"
        type="button"
        onClick={openSidebarMenu}
      >
        ☰ Menú
      </button>
      <aside
        className={isSidebarOpen ? 'sidebar sidebar--open' : 'sidebar'}
        aria-label="Menú principal"
        onTouchStart={handleSidebarTouchStart}
        onTouchEnd={handleSidebarTouchEnd}
      >
        <div className="sidebar__brand">
          <img src="/playzone-icon.svg" alt="PlayZone" />
          <div>
            <strong>PlayZone</strong>
            <span>Streaming</span>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          onClick={collapseSidebarMenu}
        >
          Contraer
        </button>
        <nav className="sidebar__nav">
          {menuItems.map((item) => {
            const tab = item.tab || item.id;
            return (
              <button
                key={item.id}
                className={activeTab === tab ? 'side-link active' : 'side-link'}
                data-short={item.short}
                title={item.label}
                onClick={() => goToTab(tab)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="theme-toggle" aria-label="Cambiar tema">
          <button
            className={theme === 'light' ? 'active' : ''}
            onClick={() => setTheme('light')}
          >
            Claro
          </button>
          <button
            className={theme === 'dark' ? 'active' : ''}
            onClick={() => setTheme('dark')}
          >
            Oscuro
          </button>
        </div>
        <button
          className="btn btn--ghost"
          type="button"
          onClick={() => setShowPasswordChange(true)}
        >
          Cambiar contraseña
        </button>
        <button
          className="btn btn--ghost sidebar-signout"
          type="button"
          onClick={handleSignOut}
        >
          Cerrar sesión
        </button>
        <button
          className="btn btn--ghost sidebar__close"
          type="button"
          onClick={() => setIsSidebarOpen(false)}
        >
          Cerrar
        </button>
      </aside>
      {isSidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div
        className={
          activeTab === 'planillas'
            ? 'app-content app-content--planillas'
            : 'app-content'
        }
      >
        {isSidebarCollapsed && activeTab !== 'planillas' && (
          <div className="collapsed-page-menu">
            <button
              type="button"
              className="planillas-menu-btn"
              onClick={openSidebarMenu}
            >
              ☰ Menú
            </button>
          </div>
        )}

        {activeTab !== 'dashboard' && activeTab !== 'planillas' && (
          <div className="reminder-secondary-topbar">
            <ReminderCenter
              userId={session.user.id}
              accounts={accounts}
              clients={records}
              localDueItems={planillasDueItems}
              quickDraft={reminderDraft}
              onQuickDraftConsumed={() => setReminderDraft(null)}
            />
          </div>
        )}

        {showPasswordChange && (
          <section className="panel form-panel">
            <div className="section-title">
              <div>
                <h2>🔐 Cambiar contraseña</h2>
                <p>Crea una nueva contraseña para ingresar a PlayZone.</p>
              </div>
            </div>

            <form className="form-grid" onSubmit={handlePasswordChange}>
              <Field label="Nueva contraseña">
                <input
                  type="password"
                  value={passwordForm.password}
                  onChange={(event) =>
                    setPasswordForm((form) => ({
                      ...form,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                />
              </Field>

              <Field label="Confirmar contraseña">
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((form) => ({
                      ...form,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="Repite la contraseña"
                  autoComplete="new-password"
                />
              </Field>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setShowPasswordChange(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn--dark"
                  disabled={passwordLoading}
                >
                  {passwordLoading
                    ? 'Guardando...'
                    : 'Guardar nueva contraseña'}
                </button>
              </div>
            </form>
          </section>
        )}
        {activeTab === 'dashboard' && (
          <>
            <div className="dashboard-topbar">
              <ReminderCenter
                userId={session.user.id}
                accounts={accounts}
                clients={records}
                localDueItems={planillasDueItems}
                quickDraft={reminderDraft}
                onQuickDraftConsumed={() => setReminderDraft(null)}
              />
              <button
                className="btn btn--tiny btn--ghost dashboard-signout"
                type="button"
                onClick={handleSignOut}
              >
                Cerrar sesión
              </button>
            </div>
            <header className="hero">
              <div className="hero__brand">
                <img src="/playzone-icon.svg" alt="PlayZone" />
                <div>
                  <p className="eyebrow">Panel personal de Jordy</p>
                  <h1>PlayZone - Streaming</h1>
                </div>
              </div>
              <div className="hero__actions">
                <span className="session-email">{session.user?.email}</span>
                <button
                  className="btn btn--dark"
                  onClick={() => goToTab('planillas')}
                >
                  📑 Abrir Planillas
                </button>
              </div>
            </header>
          </>
        )}

        {notice && (
          <div
            className={
              noticeType === 'error'
                ? 'notice notice--error error-message'
                : 'notice'
            }
          >
            {notice}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <main className="page-grid dashboard-grid">
            <section
              className={
                hasUpcomingDueDates
                  ? 'dashboard-alert alert-soon'
                  : 'dashboard-alert alert-normal'
              }
            >
              <strong>
                {hasUpcomingDueDates ? '⚠️ Atención' : '✅ Todo al día'}
              </strong>
              <span>
                {hasUpcomingDueDates
                  ? `Tienes ${upcomingClientsCount} ${
                      upcomingClientsCount === 1 ? 'cliente' : 'clientes'
                    } y ${upcomingAccountsCount} ${
                      upcomingAccountsCount === 1 ? 'cuenta' : 'cuentas'
                    } por vencer en los próximos 2 días.`
                  : 'No tienes vencimientos próximos.'}
              </span>
            </section>

            <section className="stats-grid">
              <StatCard
                label="📋 Registros totales"
                value={stats.total}
                helper="Clientes/perfiles guardados"
              />
              <StatCard
                label="✅ Clientes activos"
                value={stats.active}
                helper="Servicios activos"
                tone="success"
              />
              <StatCard
                label="Por vencer"
                value={stats.near}
                helper="Próximos 7 días"
                tone="warning"
              />
              <StatCard
                label="Vencidos"
                value={stats.expired}
                helper="Revisar renovación"
                tone="danger"
              />
              <StatCard
                label="Pendientes"
                value={stats.pending}
                helper="Pago o activación pendiente"
              />
              <StatCard
                label="💰 Ingresos"
                value={formatMoney(stats.monthIncome)}
                helper="Solo registros pagados"
                tone="success"
              />
            </section>

            <section className="panel dashboard-platforms-panel">
              <div className="section-title compact">
                <div>
                  <h2>📺 Cuentas por plataforma</h2>
                  <p>Vista rápida de las cuentas registradas.</p>
                </div>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => goToTab('accountList')}
                >
                  Ver todas
                </button>
              </div>

              <div className="dashboard-platform-grid">
                {dashboardPlatforms.map((platform) => (
                  <article
                    className={`dashboard-platform-card ${platform.className}`}
                    key={platform.key}
                  >
                    <div className="dashboard-platform-card__icon">
                      <img src={platform.logo} alt="" aria-hidden="true" />
                    </div>
                    <strong>{platform.count}</strong>
                    <span>{platform.label}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel dashboard-activity-panel">
              <div className="section-title compact">
                <h2>🕘 Actividad reciente</h2>
              </div>

              {recentActivity.length === 0 ? (
                <div className="dashboard-compact-empty">
                  Todavía no hay actividad registrada.
                </div>
              ) : (
                <div className="dashboard-activity-list">
                  {recentActivity.map((item) => (
                    <div className="dashboard-activity-row" key={item.id}>
                      <div className="dashboard-activity-icon">
                        {item.kind === 'Cuenta' ? '🔐' : '👤'}
                      </div>

                      <div className="dashboard-activity-copy">
                        <strong>{item.title}</strong>
                        <span>
                          {item.kind} · {item.detail}
                        </span>
                      </div>

                      <time>{formatActivityDate(item.createdAt)}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel dashboard-due-panel">
              <div className="section-title compact">
                <div>
                  <h2>⏰ Clientes por vencer</h2>
                  <p>Hoy, mañana o pasado mañana.</p>
                </div>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => goToTab('clientList')}
                >
                  Ver todos
                </button>
              </div>

              {upcomingRecords.length === 0 ? (
                <div className="dashboard-compact-empty">
                  No hay clientes con vencimiento cercano.
                </div>
              ) : (
                <div className="dashboard-due-list">
                  {upcomingRecords.slice(0, 3).map((record) => (
                    <div className="dashboard-due-row" key={record.id}>
                      <div>
                        <strong>{record.clientName}</strong>
                        <span>{normalizePlatformName(record.platform)}</span>
                      </div>

                      <div className="dashboard-due-side">
                        <span className="dashboard-days-badge">
                          {record.daysLeft === 0
                            ? 'Hoy'
                            : `${record.daysLeft} d`}
                        </span>
                        <button
                          className="btn btn--tiny btn--ghost"
                          type="button"
                          onClick={() => viewRecord(record)}
                        >
                          Ver
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel dashboard-due-panel">
              <div className="section-title compact">
                <div>
                  <h2>🔐 Cuentas por vencer</h2>
                  <p>Hoy, mañana o pasado mañana.</p>
                </div>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => goToTab('accountList')}
                >
                  Ver todas
                </button>
              </div>

              {upcomingAccounts.length === 0 ? (
                <div className="dashboard-compact-empty">
                  No hay cuentas con vencimiento cercano.
                </div>
              ) : (
                <div className="dashboard-due-list">
                  {upcomingAccounts.slice(0, 3).map((account) => (
                    <div className="dashboard-due-row" key={account.id}>
                      <div>
                        <strong>
                          {normalizePlatformName(account.platform)}
                        </strong>
                        <span>
                          {account.email ||
                            account.cardName ||
                            'Sin identificador'}
                        </span>
                      </div>

                      <div className="dashboard-due-side">
                        <span className="dashboard-days-badge">
                          {account.daysLeft === 0
                            ? 'Hoy'
                            : `${account.daysLeft} d`}
                        </span>
                        <button
                          className="btn btn--tiny btn--ghost"
                          type="button"
                          onClick={() => viewAccount(account)}
                        >
                          Ver
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </main>
        )}

        {activeTab === 'clientList' && (
          <main className="page-grid page-grid--stacked">
            <section className="panel panel--wide list-panel">
              <div className="section-title">
                <div>
                  <h2>👥 Lista de Clientes</h2>
                  <p>
                    Busca por nombre, contacto, plataforma, perfil o cuenta
                    asociada.
                  </p>
                </div>
              </div>

              <div className="filters filters--clients">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por cliente, contacto, cuenta o plataforma..."
                />
                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value)}
                >
                  <option>Todas</option>
                  {platforms.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option>Todos</option>
                  {recordStatuses.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  value={clientAccountFilter}
                  onChange={(e) => setClientAccountFilter(e.target.value)}
                >
                  <option value="Todas">Todas las cuentas</option>
                  <option value="">Sin cuenta</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {getAccountLabel(account)}
                    </option>
                  ))}
                </select>
              </div>

              {filteredRecords.length === 0 ? (
                <EmptyState
                  title="No hay registros para mostrar"
                  text="Agrega clientes desde Planillas o cambia los filtros de búsqueda."
                />
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
                          <p className="muted">
                            <PlatformTag platform={record.platform} /> ·{' '}
                            {isChatGPTPlus(record.platform)
                              ? 'Sin perfil requerido'
                              : record.profileName || 'Sin perfil'}{' '}
                            · {record.devices || 'Sin dispositivos'}
                          </p>
                          <p className="muted small">
                            Cuenta:{' '}
                            <AccountLabel
                              account={accountById[record.accountId]}
                            />
                          </p>
                        </div>
                        <div className="record-money">
                          <strong>{formatMoney(record.price)}</strong>
                          <span>{record.paymentStatus}</span>
                        </div>
                      </div>
                      <div className="record-details">
                        <span className="contact-detail">
                          <span>
                            Contacto:{' '}
                            <strong>{record.contact || 'Sin dato'}</strong>
                          </span>
                          {validateBolivianContact(record.contact || '') && (
                            <span className="quick-actions">
                              <button
                                type="button"
                                className="btn btn--tiny btn--ghost"
                                onClick={() => copyContact(record)}
                              >
                                {copiedRecordId === record.id
                                  ? 'Copiado'
                                  : 'Copiar'}
                              </button>
                              <button
                                type="button"
                                className="btn btn--tiny btn--whatsapp"
                                onClick={() => openWhatsApp(record.contact)}
                              >
                                WhatsApp
                              </button>
                            </span>
                          )}
                        </span>
                        <span>
                          Inicio:{' '}
                          <strong>{formatDate(record.startDate)}</strong>
                        </span>
                        <span>
                          Fin: <strong>{formatDate(record.endDate)}</strong>
                        </span>
                        {!isChatGPTPlus(record.platform) && (
                          <span>
                            PIN: <strong>{record.pin || 'Sin dato'}</strong>
                          </span>
                        )}
                      </div>
                      {record.notes && (
                        <p className="record-notes">{record.notes}</p>
                      )}
                      <div className="record-actions">
                        <button
                          className="btn btn--ghost"
                          onClick={() => goToTab('planillas')}
                        >
                          Abrir Planillas
                        </button>
                        <button
                          className="btn btn--danger"
                          onClick={() => deleteRecord(record.id)}
                        >
                          Eliminar
                        </button>
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
                  <p>
                    Administra plataformas, correos, fechas, tipo, estado y
                    observaciones.
                  </p>
                </div>
              </div>

              <div className="filters filters--accounts">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cuenta, email, plataforma u observación..."
                />
                <select
                  value={accountPlatformFilter}
                  onChange={(e) => setAccountPlatformFilter(e.target.value)}
                >
                  <option>Todas</option>
                  {platforms.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  value={accountStatusFilter}
                  onChange={(e) => setAccountStatusFilter(e.target.value)}
                >
                  <option>Todos</option>
                  {accountStatuses.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  value={accountTypeFilter}
                  onChange={(e) => setAccountTypeFilter(e.target.value)}
                >
                  <option>Todos</option>
                  {accountTypes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>

              {filteredAccounts.length === 0 ? (
                <EmptyState
                  title="No hay cuentas para mostrar"
                  text="Agrega cuentas desde Planillas o cambia los filtros de búsqueda."
                />
              ) : (
                <div className="account-grid">
                  {filteredAccounts.map((account) => {
                    const usedCount = records.filter(
                      (record) => record.accountId === account.id,
                    ).length;
                    return (
                      <article className="account-card" key={account.id}>
                        <div className="account-card__header">
                          <div>
                            <h3>
                              <PlatformTag platform={account.platform} />
                            </h3>
                            <p>
                              {isChatGPTPlus(account.platform)
                                ? account.cardName || 'Sin tarjeta/ref.'
                                : `${account.type} · ${account.cardName || 'Sin tarjeta/ref.'}`}
                            </p>
                          </div>
                          <Badge label={account.status} />
                        </div>
                        <div className="account-data">
                          <span>Email</span>
                          <strong>{account.email || 'Sin dato'}</strong>
                          <span>Contraseña</span>
                          <strong>
                            {account.password ? 'Guardada' : 'Sin dato'}
                          </strong>
                          <span>Suscripción</span>
                          <strong>
                            {formatDate(account.subscriptionStart)} -{' '}
                            {formatDate(account.subscriptionEnd)}
                          </strong>
                          <span>Clientes/perfiles</span>
                          <strong>{usedCount}</strong>
                        </div>
                        {account.notes && (
                          <p className="record-notes">{account.notes}</p>
                        )}
                        <div className="record-actions">
                          <button
                            className="btn btn--ghost"
                            onClick={() => goToTab('planillas')}
                          >
                            Abrir Planillas
                          </button>
                          <button
                            className="btn btn--danger"
                            onClick={() => deleteAccount(account.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        )}

        {activeTab === 'planillas' && (
          <Planillas
            onOpenMenu={openSidebarMenu}
            onCreateReminder={(draft) =>
              setReminderDraft({
                ...draft,
                requestId: Date.now() + Math.random(),
              })
            }
            onDueItemsChange={setPlanillasDueItems}
            userId={session.user.id}
            remoteAccounts={accounts}
            remoteClients={records}
            onReload={reloadPlanillas}
            remoteLoading={remoteLoading.accounts || remoteLoading.clients}
            remoteError={[remoteErrors.accounts, remoteErrors.clients]
              .filter(Boolean)
              .join(' / ')}
            notificationCenter={
              <ReminderCenter
                userId={session.user.id}
                accounts={accounts}
                clients={records}
                localDueItems={planillasDueItems}
                quickDraft={reminderDraft}
                onQuickDraftConsumed={() => setReminderDraft(null)}
              />
            }
          />
        )}
      </div>
      {currentRecordDetail && (
        <RecordDetailModal
          record={currentRecordDetail}
          account={accountById[currentRecordDetail.accountId]}
          onClose={() => setDetailView(null)}
          onWhatsApp={() => openWhatsApp(currentRecordDetail.contact)}
          onOpenPlanillas={() => goToTab('planillas')}
        />
      )}
      {currentAccountDetail && (
        <AccountDetailModal
          account={currentAccountDetail}
          usedCount={
            records.filter(
              (record) => record.accountId === currentAccountDetail.id,
            ).length
          }
          onClose={() => setDetailView(null)}
          onOpenPlanillas={() => goToTab('planillas')}
        />
      )}
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
  if (
    key.includes('habilitado') ||
    key.includes('activa') ||
    key.includes('pagado')
  )
    className += ' badge--success';
  if (key.includes('pendiente')) className += ' badge--warning';
  if (
    key.includes('vencido') ||
    key.includes('deshabilitado') ||
    key.includes('suspendida')
  )
    className += ' badge--danger';
  return <span className={className}>{label}</span>;
}

function PlatformTag({ platform }) {
  return (
    <span className={getPlatformClass(platform)}>
      {normalizePlatformName(platform)}
    </span>
  );
}

function AccountLabel({ account }) {
  if (!account) return 'Sin cuenta';
  const detail = getAccountDetailLabel(account);

  return (
    <>
      <PlatformTag platform={account.platform} />
      {detail && <span className="account-label-detail"> {detail}</span>}
    </>
  );
}

function Field({ label, children, full = false, required = false }) {
  return (
    <label className={full ? 'field field--full' : 'field'}>
      <span>
        {label}
        {required && <b> *</b>}
      </span>
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

function DetailModal({
  title,
  children,
  onClose,
  onWhatsApp,
  canUseWhatsApp = false,
  onOpenPlanillas,
}) {
  return (
    <div className="detail-backdrop" role="presentation" onClick={onClose}>
      <article
        className="detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-modal__header">
          <h2>{title}</h2>
          <button
            className="btn btn--tiny btn--ghost"
            type="button"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        {children}
        <div className="detail-modal__actions">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Volver
          </button>
          {onWhatsApp && (
            <button
              className="btn btn--whatsapp"
              type="button"
              onClick={onWhatsApp}
              disabled={!canUseWhatsApp}
            >
              WhatsApp
            </button>
          )}
          <button
            className="btn btn--dark"
            type="button"
            onClick={onOpenPlanillas}
          >
            Abrir Planillas
          </button>
        </div>
      </article>
    </div>
  );
}

function DetailItem({ label, value }) {
  const displayValue = value === 0 ? 0 : value || 'Sin dato';

  return (
    <>
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </>
  );
}

function RecordDetailModal({
  record,
  account,
  onClose,
  onWhatsApp,
  onOpenPlanillas,
}) {
  const canUseWhatsApp = validateBolivianContact(record.contact || '');

  return (
    <DetailModal
      title="Detalle del cliente"
      onClose={onClose}
      onWhatsApp={onWhatsApp}
      canUseWhatsApp={canUseWhatsApp}
      onOpenPlanillas={onOpenPlanillas}
    >
      <div className="detail-title-row">
        <div>
          <h3>{record.clientName}</h3>
          <p>
            <PlatformTag platform={record.platform} /> ·{' '}
            {isChatGPTPlus(record.platform)
              ? 'Sin perfil requerido'
              : record.profileName || 'Sin perfil'}
          </p>
        </div>
        <Badge label={getRecordStatus(record)} />
      </div>
      <div className="detail-data">
        <DetailItem label="Cuenta" value={<AccountLabel account={account} />} />
        <DetailItem label="Contacto" value={record.contact} />
        <DetailItem label="Dispositivos" value={record.devices} />
        <DetailItem label="Inicio" value={formatDate(record.startDate)} />
        <DetailItem label="Fin" value={formatDate(record.endDate)} />
        {!isChatGPTPlus(record.platform) && (
          <DetailItem label="PIN" value={record.pin} />
        )}
        <DetailItem label="Pago" value={formatMoney(record.price)} />
        <DetailItem label="Estado de pago" value={record.paymentStatus} />
      </div>
      {record.notes && <p className="record-notes">{record.notes}</p>}
    </DetailModal>
  );
}

function AccountDetailModal({ account, usedCount, onClose, onOpenPlanillas }) {
  return (
    <DetailModal
      title="Detalle de la cuenta"
      onClose={onClose}
      onOpenPlanillas={onOpenPlanillas}
    >
      <div className="detail-title-row">
        <div>
          <h3>
            <PlatformTag platform={account.platform} />
          </h3>
          <p>
            {isChatGPTPlus(account.platform)
              ? account.cardName || 'Sin tarjeta/ref.'
              : `${account.type} · ${account.cardName || 'Sin tarjeta/ref.'}`}
          </p>
        </div>
        <Badge label={account.status} />
      </div>
      <div className="detail-data">
        <DetailItem label="Email" value={account.email} />
        <DetailItem
          label="Contraseña"
          value={account.password ? 'Guardada' : 'Sin dato'}
        />
        <DetailItem
          label="Inicio"
          value={formatDate(account.subscriptionStart)}
        />
        <DetailItem label="Fin" value={formatDate(account.subscriptionEnd)} />
        <DetailItem label="Clientes/perfiles" value={usedCount} />
      </div>
      {account.notes && <p className="record-notes">{account.notes}</p>}
    </DetailModal>
  );
}

function RecordMiniCard({ record, account, onView }) {
  const days = record.daysLeft;
  return (
    <article className={`mini-card ${getAlertClass(days)}`}>
      <div>
        <h3>{record.clientName}</h3>
        <p>
          <PlatformTag platform={record.platform} /> ·{' '}
          {isChatGPTPlus(record.platform)
            ? 'Sin perfil requerido'
            : record.profileName || 'Sin perfil'}
        </p>
        <span>
          <AccountLabel account={account} />
        </span>
      </div>
      <div className="mini-card__side">
        <strong>{days === 0 ? 'Hoy' : `${days} días`}</strong>
        <button className="btn btn--ghost" onClick={onView}>
          Ver
        </button>
      </div>
    </article>
  );
}

function AccountMiniCard({ account, onView }) {
  const days = account.daysLeft;
  return (
    <article className={`mini-card ${getAlertClass(days)}`}>
      <div>
        <h3>
          <PlatformTag platform={account.platform} />
        </h3>
        <p>{account.email || account.cardName || 'Sin identificador'}</p>
        <span>Fin: {formatDate(account.subscriptionEnd)}</span>
      </div>
      <div className="mini-card__side">
        <strong>{days === 0 ? 'Hoy' : `${days} días`}</strong>
        <button className="btn btn--ghost" onClick={onView}>
          Ver
        </button>
      </div>
    </article>
  );
}

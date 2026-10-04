import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  disablePlayZonePush,
  enablePlayZonePush,
  getCurrentPushSubscription,
  supportsPushNotifications,
} from '../lib/pushNotifications';

const blankForm = {
  kind: 'tarea',
  priority: 'media',
  title: '',
  details: '',
  dueAt: '',
  sourceRef: '',
};
const PRIORITIES = {
  baja: { label: 'Baja', className: 'baja', rank: 1 },
  media: { label: 'Media', className: 'media', rank: 2 },
  alta: { label: 'Alta', className: 'alta', rank: 3 },
};
function priorityFor(value) {
  return PRIORITIES[value] || PRIORITIES.media;
}

// Los borradores locales son temporales: no activan push y no se sincronizan
// automáticamente. Al habilitar Supabase, conservarlos y migrarlos con revisión.
const LOCAL_REMINDERS_PREFIX = 'playzone_reminders_local_v1_';

function readLocalReminders(userId) {
  if (!userId) return [];
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`${LOCAL_REMINDERS_PREFIX}${userId}`) || '[]',
    );
    return Array.isArray(value)
      ? value
          .filter((item) => item && item.id && item.title)
          .map((item) => ({
            ...item,
            isLocal: true,
            priority: PRIORITIES[item.priority] ? item.priority : 'media',
          }))
      : [];
  } catch (error) {
    console.warn('No se pudieron leer las tareas locales.', error);
    return [];
  }
}

function isMissingRemindersSchema(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code) ||
    (message.includes('reminders') &&
      (message.includes('does not exist') ||
        message.includes('could not find') ||
        message.includes('not found') ||
        message.includes('schema cache'))) ||
    (message.includes('priority') && message.includes('does not exist'))
  );
}

function localDateKey(date = new Date()) {
  // El negocio trabaja en Bolivia; no depender de la zona horaria de los dispositivos.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function deltaCalendarDays(isoDate, todayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
  const target = Date.parse(`${isoDate}T12:00:00Z`);
  const today = Date.parse(`${todayKey}T12:00:00Z`);
  return Number.isNaN(target) ? null : Math.round((target - today) / 86400000);
}

function showDay(key) {
  if (!key) return 'Sin fecha';
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

export default function ReminderCenter({
  userId,
  accounts = [],
  clients = [],
  localDueItems = [],
  quickDraft,
  onQuickDraftConsumed,
}) {
  const [open, setOpen] = useState(false);
  const [popoverTop, setPopoverTop] = useState(70);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [reminders, setReminders] = useState([]);
  const [localReminders, setLocalReminders] = useState(() =>
    readLocalReminders(userId),
  );
  const [backendStatus, setBackendStatus] = useState('checking');
  const [saveFeedback, setSaveFeedback] = useState('');
  const [saveFeedbackType, setSaveFeedbackType] = useState('error');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [pushActive, setPushActive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const today = localDateKey(now);

  const refresh = useCallback(async () => {
    if (!userId) {
      setReminders([]);
      setBackendStatus('no-session');
      return;
    }
    try {
      const { data, error } = await supabase
        .from('reminders')
        .select(
          'id,kind,title,details,due_at,status,source_ref,created_at,priority',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) {
        setBackendStatus(isMissingRemindersSchema(error) ? 'local' : 'error');
        setNotice(
          isMissingRemindersSchema(error)
            ? ''
            : `No se pudo consultar Supabase: ${error.message}`,
        );
        return;
      }
      setBackendStatus('ready');
      setReminders(data || []);
    } catch (error) {
      setBackendStatus('error');
      setNotice(
        `Sin conexión con Supabase: ${error?.message || 'Error de red'}`,
      );
    }
  }, [userId]);

  useEffect(() => {
    setLocalReminders(readLocalReminders(userId));
    setBackendStatus('checking');
  }, [userId]);

  function changeLocalReminders(makeNext) {
    if (!userId)
      throw new Error('Debes iniciar sesión para guardar recordatorios.');
    const next = makeNext(readLocalReminders(userId));
    // Primero se escribe en el navegador; no confirmamos éxito si falla.
    window.localStorage.setItem(
      `${LOCAL_REMINDERS_PREFIX}${userId}`,
      JSON.stringify(next),
    );
    setLocalReminders(next);
  }

  function saveLocally(payload) {
    const stamp = new Date().toISOString();
    const newItem = {
      ...payload,
      id: `local-${crypto.randomUUID()}`,
      status: 'pendiente',
      created_at: stamp,
      updated_at: stamp,
      isLocal: true,
    };
    changeLocalReminders((current) => [newItem, ...current]);
  }

  function downloadLocalBackup() {
    if (!localReminders.length) return;
    const data = new Blob([JSON.stringify(localReminders, null, 2)], {
      type: 'application/json',
    });
    const objectUrl = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `playzone-tareas-locales-${localDateKey()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  useEffect(() => {
    refresh();
    if (!userId) return undefined;
    const timer = window.setInterval(() => {
      setNow(new Date());
      refresh();
    }, 60000);
    const onFocus = () => {
      setNow(new Date());
      refresh();
    };
    window.addEventListener('focus', onFocus);
    const onVisibility = () => {
      if (!document.hidden) onFocus();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, userId]);

  useEffect(() => {
    if (!userId) {
      setPushActive(false);
      return;
    }
    getCurrentPushSubscription()
      .then(async (sub) => {
        if (!sub) {
          setPushActive(false);
          return;
        }
        const { data } = await supabase
          .from('push_subscriptions')
          .select('id')
          .eq('user_id', userId)
          .eq('endpoint', sub.endpoint)
          .maybeSingle();
        setPushActive(Boolean(data));
      })
      .catch(() => setPushActive(false));
  }, [userId]);

  useEffect(() => {
    if (!quickDraft) return;
    setForm({
      kind: quickDraft.kind || 'tarea',
      priority: PRIORITIES[quickDraft.priority] ? quickDraft.priority : 'media',
      title: quickDraft.title || '',
      details: quickDraft.details || '',
      dueAt: '',
      sourceRef: quickDraft.sourceRef || '',
    });
    setSaveFeedback('');
    setShowForm(true);
    setOpen(true);
    onQuickDraftConsumed?.();
  }, [quickDraft]);

  const dueItems = useMemo(() => {
    const results = [];
    accounts.forEach((account) => {
      const date = account.subscriptionEnd;
      const days = deltaCalendarDays(date, today);
      if (days === null || days > 1 || days < -7) return;
      const platform = account.platform || 'Cuenta';
      const type = account.type ? ` ${account.type}` : '';
      results.push({
        id: `account-${account.id}`,
        days,
        date,
        category: 'Cuenta',
        title: `${platform}${type} · ${account.email || account.cardName || 'sin identificación'}`,
      });
    });
    clients.forEach((client) => {
      const date = client.endDate;
      const days = deltaCalendarDays(date, today);
      if (days === null || days > 1 || days < -7) return;
      results.push({
        id: `client-${client.id}`,
        days,
        date,
        category: 'Cliente',
        title: `${client.clientName || 'Cliente'} · ${client.platform || ''}`,
      });
    });
    // Mientras Planillas trabaja en local se muestran avisos identificados como
    // locales. En la etapa Supabase se retirará esta fuente de demostración.
    return [...results, ...localDueItems].sort((a, b) => a.days - b.days);
  }, [accounts, clients, localDueItems, today]);

  const allReminders = [...reminders, ...localReminders];
  const pending = allReminders
    .filter((item) => item.status === 'pendiente')
    .sort(
      (a, b) => priorityFor(b.priority).rank - priorityFor(a.priority).rank,
    );
  const finished = allReminders.filter((item) => item.status !== 'pendiente');
  const urgent = dueItems.length; // Incluye vencimientos atrasados.
  const count = urgent + pending.length;
  const localDueToday = localDueItems.filter((item) => item.days === 0).length;
  const localDueLate = localDueItems.filter((item) => item.days < 0).length;

  async function createReminder(event) {
    event.preventDefault();
    setSaveFeedback('');
    setSaveFeedbackType('error');
    if (!form.title.trim()) {
      setSaveFeedback('Escribe qué necesitas recordar.');
      return;
    }
    if (!userId) {
      setSaveFeedback('Inicia sesión para guardar esta tarea.');
      return;
    }
    if (backendStatus === 'checking') {
      setSaveFeedback(
        'Todavía estamos comprobando la base de datos. Intenta guardar de nuevo en un momento.',
      );
      return;
    }
    if (backendStatus === 'error') {
      setSaveFeedback(
        `No se guardó. ${notice || 'Supabase no responde o rechazó el acceso.'}`,
      );
      return;
    }

    const payload = {
      user_id: userId,
      kind: form.kind,
      priority: form.priority,
      title: form.title.trim(),
      details: form.details.trim(),
      due_at: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      source_ref: form.sourceRef || null,
    };
    setLoading(true);
    setNotice('');
    try {
      let localMode = backendStatus === 'local';
      if (!localMode && backendStatus === 'ready') {
        const { error } = await supabase.from('reminders').insert(payload);
        if (error) {
          if (isMissingRemindersSchema(error)) {
            localMode = true;
            setBackendStatus('local');
          } else {
            throw error;
          }
        }
      }
      if (localMode) {
        saveLocally(payload);
        setSaveFeedbackType('warning');
        setSaveFeedback(
          'Tarea guardada solo en este navegador. Queda pendiente pasarla a Supabase.',
        );
      } else {
        await refresh();
        setSaveFeedbackType('success');
        setSaveFeedback('Tarea guardada en Supabase.');
      }
      setForm(blankForm);
      setShowForm(false);
    } catch (error) {
      setSaveFeedbackType('error');
      setSaveFeedback(
        `No se guardó la tarea: ${error?.message || 'Error desconocido'}`,
      );
    } finally {
      setLoading(false);
    }
  }

  async function setReminderStatus(id, status) {
    setNotice('');
    try {
      if (localReminders.some((item) => item.id === id)) {
        changeLocalReminders((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, status, updated_at: new Date().toISOString() }
              : item,
          ),
        );
        return;
      }
      const { error } = await supabase
        .from('reminders')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
      await refresh();
    } catch (error) {
      setNotice(
        `No se pudo actualizar la tarea: ${error?.message || 'Error desconocido'}`,
      );
    }
  }

  async function togglePush() {
    setLoading(true);
    setNotice('');
    try {
      if (pushActive) {
        await disablePlayZonePush();
        setPushActive(false);
      } else {
        await enablePlayZonePush(userId);
        setPushActive(true);
      }
    } catch (error) {
      setNotice(error.message || 'No se pudo configurar el dispositivo.');
    }
    setLoading(false);
  }

  function resetForm() {
    setShowForm(false);
    setForm(blankForm);
    setSaveFeedback('');
  }
  function openNewForm() {
    resetForm();
    setShowForm(true);
  }

  function togglePanel(event) {
    if (!open) {
      // Fija el desplegable debajo de la campana, esté en Dashboard o Planillas.
      const bottom = event.currentTarget.getBoundingClientRect().bottom;
      setPopoverTop(
        Math.max(8, Math.min(bottom + 9, window.innerHeight - 150)),
      );
    }
    setOpen((value) => !value);
  }

  return (
    <div className="reminder-center">
      <button
        type="button"
        className="reminder-trigger"
        onClick={togglePanel}
        aria-expanded={open}
        aria-label={`Notificaciones: ${count} pendientes`}
      >
        <span aria-hidden="true">🔔</span> Notificaciones
        {count > 0 && (
          <strong className="reminder-count">
            {count > 99 ? '99+' : count}
          </strong>
        )}
      </button>
      {open && (
        <>
          <button
            className="reminder-backdrop"
            onClick={() => setOpen(false)}
            aria-label="Cerrar notificaciones"
          />
          <div
            className="reminder-popover"
            role="region"
            aria-label="Panel de notificaciones"
            style={{
              top: `${popoverTop}px`,
              maxHeight: `calc(100dvh - ${popoverTop + 12}px)`,
            }}
          >
            <div className="reminder-header">
              <strong>🔔 Notificaciones</strong>
              <button
                className="reminder-icon-btn"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            {notice && (
              <p className="reminder-error" role="status">
                {notice}
              </p>
            )}
            {(localDueToday > 0 || localDueLate > 0) && (
              <div className="reminder-due-summary" role="status">
                <span aria-hidden="true">⚠️</span>
                <span>
                  <strong>
                    {localDueToday} vencimiento(s) hoy y {localDueLate}{' '}
                    atrasado(s)
                  </strong>{' '}
                  en tus planillas. Confirma el pago para renovar la fecha desde
                  el vencimiento original.
                </span>
              </div>
            )}
            <div className="reminder-toolbar">
              <button
                type="button"
                className="reminder-add-btn"
                onClick={openNewForm}
              >
                ＋ Nueva tarea
              </button>
              <button
                type="button"
                className="reminder-push-btn"
                onClick={togglePush}
                disabled={loading || !supportsPushNotifications()}
              >
                {pushActive ? '🔕 Desactivar push' : '📣 Activar push'}
              </button>
            </div>
            {!supportsPushNotifications() && (
              <p className="reminder-helper">
                Push requiere HTTPS o localhost y un navegador compatible.
              </p>
            )}
            {backendStatus === 'local' && (
              <p className="reminder-local-warning" role="status">
                🟠 Modo local: aún no se instaló la tabla de recordatorios. Las
                tareas se guardan en este navegador, sin push ni sincronización
                entre dispositivos.
              </p>
            )}
            {localReminders.length > 0 && (
              <div className="reminder-local-tools">
                <span>
                  {localReminders.length} tarea(s) locales pendientes de migrar.
                </span>
                <button type="button" onClick={downloadLocalBackup}>
                  ⬇ Respaldar tareas locales
                </button>
              </div>
            )}
            {!showForm && saveFeedback && (
              <p
                className={`reminder-save-feedback reminder-save-feedback--${saveFeedbackType}`}
                role="status"
              >
                {saveFeedback}
              </p>
            )}
            {showForm && (
              <form className="reminder-form" onSubmit={createReminder}>
                <div className="reminder-form-row">
                  <label>
                    Tipo
                    <select
                      value={form.kind}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, kind: e.target.value }))
                      }
                    >
                      <option value="tarea">Tarea</option>
                      <option value="cobro">Cobro</option>
                      <option value="pago">Pago</option>
                    </select>
                  </label>
                  <label>
                    Fecha y hora (opcional)
                    <input
                      type="datetime-local"
                      value={form.dueAt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, dueAt: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <fieldset className="reminder-priority-fieldset">
                  <legend>Importancia de la tarea</legend>
                  <div
                    className="reminder-priority-options"
                    role="radiogroup"
                    aria-label="Importancia de la tarea"
                  >
                    {Object.entries(PRIORITIES).map(([key, option]) => (
                      <label
                        key={key}
                        className={`reminder-priority-choice reminder-priority-choice--${key} ${form.priority === key ? 'is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="reminder-priority"
                          value={key}
                          checked={form.priority === key}
                          onChange={() =>
                            setForm((f) => ({ ...f, priority: key }))
                          }
                        />
                        <span
                          className="reminder-priority-indicator"
                          aria-hidden="true"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Recordarme
                  <input
                    maxLength={180}
                    required
                    value={form.title}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, title: e.target.value }))
                    }
                    placeholder="Ej. Cobrar Bs 30 a Carlos"
                  />
                </label>
                <label>
                  Observaciones
                  <textarea
                    rows={2}
                    value={form.details}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, details: e.target.value }))
                    }
                    placeholder="Información adicional"
                  />
                </label>
                {saveFeedback && (
                  <p
                    className={`reminder-save-feedback reminder-save-feedback--${saveFeedbackType}`}
                    role="alert"
                  >
                    {saveFeedback}
                  </p>
                )}
                <div className="reminder-form-actions">
                  <button
                    type="button"
                    className="btn btn--tiny btn--ghost"
                    onClick={resetForm}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn--tiny btn--dark"
                    disabled={loading}
                  >
                    {loading ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}
            <div className="reminder-scroll-area">
              <h3>
                Vencimientos <span>{dueItems.length}</span>
              </h3>
              {dueItems.length ? (
                dueItems.map((item) => (
                  <div className="reminder-item" key={item.id}>
                    <div className="reminder-item-top">
                      <strong>{item.category}</strong>
                      <span
                        className={`reminder-due-label ${item.days <= 0 ? 'reminder-due-label--red' : ''}`}
                      >
                        {item.days < 0
                          ? `Venció hace ${-item.days} día(s)`
                          : item.days === 0
                            ? 'Vence hoy'
                            : 'Vence mañana'}
                      </span>
                    </div>
                    <p>{item.title}</p>
                    <small>{showDay(item.date)}</small>
                  </div>
                ))
              ) : (
                <p className="reminder-empty">
                  No hay vencimientos para hoy ni mañana.
                </p>
              )}
              <h3>
                Pendientes <span>{pending.length}</span>
              </h3>
              {pending.length ? (
                pending.map((item) => {
                  const when = item.due_at ? new Date(item.due_at) : null;
                  const late = when && when.getTime() < now.getTime();
                  const priority = priorityFor(item.priority);
                  return (
                    <div
                      className={`reminder-item reminder-item--priority-${priority.className}`}
                      key={item.id}
                    >
                      <div className="reminder-item-top">
                        <strong>
                          {item.kind === 'cobro'
                            ? '💰 Cobro'
                            : item.kind === 'pago'
                              ? '💳 Pago'
                              : '📌 Tarea'}
                        </strong>
                        <span
                          className={`reminder-priority-badge reminder-priority-badge--${priority.className}`}
                        >
                          {priority.label}
                        </span>
                        {when && (
                          <span
                            className={
                              late
                                ? 'reminder-due-label reminder-due-label--red'
                                : 'reminder-due-label'
                            }
                          >
                            {when.toLocaleString('es-BO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        )}
                      </div>
                      <p>{item.title}</p>
                      {item.details && <small>{item.details}</small>}
                      {item.isLocal && (
                        <small className="reminder-local-label">
                          Solo en este navegador · pendiente de migrar
                        </small>
                      )}
                      <div className="reminder-item-actions">
                        <button
                          type="button"
                          onClick={() =>
                            setReminderStatus(item.id, 'completado')
                          }
                        >
                          ✓ Completado
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setReminderStatus(item.id, 'archivado')
                          }
                        >
                          Archivar
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="reminder-empty">
                  No hay tareas, pagos ni cobros pendientes.
                </p>
              )}
              {finished.length > 0 && (
                <details className="reminder-history">
                  <summary>Historial ({finished.length})</summary>
                  {finished.map((item) => (
                    <div className="reminder-history-item" key={item.id}>
                      <span>
                        <span
                          className={`reminder-priority-dot reminder-priority-dot--${priorityFor(item.priority).className}`}
                          aria-hidden="true"
                        />
                        {item.title} · {item.status}
                        {item.isLocal ? ' · local' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReminderStatus(item.id, 'pendiente')}
                      >
                        Reabrir
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </div>
            <p className="reminder-footnote">
              Vencimientos: Supabase y planillas locales de prueba. Las tareas
              guardadas solo en este navegador no enviarán push y deberán
              migrarse a Supabase posteriormente.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

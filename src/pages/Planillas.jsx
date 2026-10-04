import { useEffect, useMemo, useRef, useState } from 'react';
import netflixLogo from '../assets/brands/netflix.jpg';
import primeVideoLogo from '../assets/brands/prime-video.webp';
import hboMaxLogo from '../assets/brands/hbo-max.png';
import chatgptLogo from '../assets/brands/chatgpt-plus.jpg';
import whatsappLogo from '../assets/brands/whatsapp.svg';
import {
  normalizeWhatsAppNumber,
  validateContact,
  validateDateRange,
} from '../lib/planillasValidation';
import {
  businessDateISO,
  confirmPaidRenewal,
  effectiveStatus,
  periodOf,
} from '../lib/planillasRenewal';
import { mapSupabaseToPlanillas } from '../lib/planillasFromSupabase';
import { supabase } from '../lib/supabaseClient';
import {
  createAccount,
  createClient,
  editAccount,
  editClient,
  editProfileGroup,
  deleteClient,
  deleteAccount,
  renewPaid,
} from '../lib/planillasWrite';

const sheets = [
  'Netflix Privado',

  'Netflix Compartido',

  'Prime Video',

  'HBO Max',

  'ChatGPT Plus',
];

const platformLogos = {
  'Netflix Privado': netflixLogo,
  'Netflix Compartido': netflixLogo,
  'Prime Video': primeVideoLogo,
  'HBO Max': hboMaxLogo,
  'ChatGPT Plus': chatgptLogo,
};

function isLinuxDesktop() {
  if (typeof navigator === 'undefined') return false;

  return (
    /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)
  );
}

function getWhatsAppChatUrl(number) {
  // Linux KDE: el lanzador local abre Chrome con el perfil Business.
  // En móviles y otros sistemas conservamos los enlaces web normales.
  if (isLinuxDesktop()) {
    return `playzone-wa-business://chat?phone=${number}`;
  }

  const isMobile =
    typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  return isMobile
    ? `https://wa.me/${number}`
    : `https://web.whatsapp.com/send?phone=${number}`;
}

// Etapa 3: nunca se muestran ni se cargan cuentas/clientes ficticios.
export function getInitialPlanillasDueItems() {
  return []; // ReminderCenter ya calcula los vencimientos desde App / Supabase.
}

export default function Planillas({
  onOpenMenu,
  onCreateReminder,
  onDueItemsChange,
  userId,
  notificationCenter,
  remoteAccounts = [],
  remoteClients = [],
  remoteLoading = false,
  remoteError = '',
  onReload,
}) {
  // No editar si Supabase no cargó los registros o hay una operación pendiente.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const readOnly = remoteLoading || Boolean(remoteError) || busy;
  const remoteView = useMemo(
    () => mapSupabaseToPlanillas(remoteAccounts, remoteClients),
    [remoteAccounts, remoteClients],
  );

  const [activeSheet, setActiveSheet] = useState('Netflix Privado');

  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState(null);

  const groupedData = remoteView.groupedData;
  const [todayISO, setTodayISO] = useState(() => businessDateISO());

  const [pendingDelete, setPendingDelete] = useState(null);

  const [pendingAccountDelete, setPendingAccountDelete] = useState(null);

  const [statusPicker, setStatusPicker] = useState(null);
  const [validationError, setValidationError] = useState(null);

  useEffect(() => {
    // Permite que el estado cambie automáticamente cuando llega medianoche,
    // aun si el usuario deja PlayZone abierto durante horas.
    const refresh = () => setTodayISO(businessDateISO());
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  // Sin avisos locales duplicados: los registros reales los cubre ReminderCenter.
  useEffect(() => {
    onDueItemsChange?.([]);
  }, [onDueItemsChange]);

  async function performWrite(task, nextCell = null) {
    if (busyRef.current || remoteLoading || remoteError) return;
    busyRef.current = true;
    setBusy(true);
    setValidationError(null);
    try {
      const result = await task();
      await onReload(); // Una nueva lectura determina lo que se muestra, nunca una copia local.
      setEditing(nextCell);
      return result;
    } catch (error) {
      setValidationError(`No se guardó el cambio: ${error.message}`);
      // Recargar tras un fallo evita ocultar escrituras parciales en los grupos.
      try {
        await onReload();
      } catch {
        /* El mensaje original se mantiene */
      }
      setEditing(null);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmPaymentAndRenew(account, member = null) {
    if (readOnly) return;
    if (member && String(member.id).startsWith('empty-profile:')) {
      setValidationError(
        'Primero registra el nombre del cliente en ese perfil.',
      );
      return;
    }
    const entity = member || account;
    const kind = member ? 'member' : 'account';
    const result = confirmPaidRenewal(entity, kind, todayISO);
    if (!result.ok) {
      setValidationError(result.message);
      return;
    }
    const title = member ? member.name || 'cliente' : account.email || 'cuenta';
    if (
      !window.confirm(
        `¿Confirmas el pago de ${title}?\nSe renovará un mes desde ${result.previousEndISO}. No se puede repetir el mismo día.`,
      )
    )
      return;
    await performWrite(() =>
      renewPaid(
        supabase,
        member ? 'client' : 'account',
        entity.id,
        result.previousEndISO,
      ),
    );
  }

  function changePaidStatus(account, member, newStatus) {
    if (readOnly) return;
    const entity = member || account;
    if (String(entity.id).startsWith('empty-profile:')) {
      setValidationError('Primero asigna un nombre a este perfil.');
      return;
    }
    if (
      newStatus === 'Habilitado' &&
      periodOf(entity, member ? 'member' : 'account', todayISO)
    ) {
      confirmPaymentAndRenew(account, member);
      return;
    }
    performWrite(() =>
      member
        ? editClient(supabase, userId, member, 'status', newStatus)
        : editAccount(supabase, userId, account, 'status', newStatus),
    );
  }

  function nextEditingCell(account, cell, scope, backwards = false) {
    const order =
      scope === 'account'
        ? getAccountEditingOrder(account)
        : getMemberEditingOrder(account);
    const index = order.findIndex((item) => sameEditingCell(item, cell));
    return index >= 0 ? order[index + (backwards ? -1 : 1)] || null : null;
  }

  function saveCell(account, member, field, raw, cell, nextCell = null) {
    if (readOnly) return;
    const previous = member ? member[field] : account[field];
    // Los valores que muestran las fechas no son la fuente de verdad: se valida el período ISO.
    if (String(previous ?? '') === String(raw ?? '')) {
      setEditing(nextCell);
      return;
    }
    if (member && String(member.id).startsWith('empty-profile:')) {
      if (field !== 'name') {
        setValidationError(
          'Primero registra el nombre del cliente en este espacio disponible.',
        );
        setEditing(null);
        return;
      }
      performWrite(
        () =>
          createClient(
            supabase,
            userId,
            activeSheet,
            account,
            raw,
            member.profile,
          ),
        nextCell,
      );
      return;
    }
    performWrite(
      () =>
        member
          ? editClient(supabase, userId, member, field, raw)
          : editAccount(supabase, userId, account, field, raw),
      nextCell,
    );
  }

  function commitCellOnKey(
    event,
    account,
    member,
    field,
    cell,
    scope,
    group = null,
  ) {
    if (event.key === 'Escape') {
      event.currentTarget.dataset.skipCommit = 'true';
      setEditing(null);
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    event.preventDefault();
    const input = event.currentTarget;
    input.dataset.skipCommit = 'true';
    const next =
      event.key === 'Tab'
        ? nextEditingCell(account, cell, scope, event.shiftKey)
        : null;
    if (group) saveGroup(group, field, input.value, next);
    else saveCell(account, member, field, input.value, cell, next);
  }

  function saveGroup(members, field, value, nextCell = null) {
    const original = members[0]?.[field] || '';
    if (members.every((m) => (m[field] || '') === value)) {
      setEditing(nextCell);
      return;
    }
    performWrite(
      () => editProfileGroup(supabase, userId, members, field, value),
      nextCell,
    );
  }

  async function addAccount() {
    if (readOnly) return;
    const email = window.prompt(
      'Correo de la nueva cuenta (puedes dejarlo vacío; Cancelar no crea nada):',
      '',
    );
    if (email === null) return;
    const created = await performWrite(() =>
      createAccount(supabase, userId, activeSheet, email),
    );
    if (created?.id) {
      setSearch('');
      setEditing({ type: 'account', accountId: created.id, field: 'email' });
    }
  }

  function requestAccountDelete(accountId) {
    setPendingAccountDelete(accountId);
    setPendingDelete(null);
    setStatusPicker(null);
  }

  function cancelAccountDelete() {
    setPendingAccountDelete(null);
  }

  function removeAccount(accountId) {
    if (readOnly) return;
    const account = remoteAccounts.find((a) => a.id === accountId);
    if (!account) return;
    performWrite(() => deleteAccount(supabase, userId, account, remoteClients));
    setPendingAccountDelete(null);
  }

  function AccountActions({ account, allowAddMember = false }) {
    const confirmingDelete = pendingAccountDelete === account.id;

    return (
      <div className="planilla-account-actions planilla-account-actions--account">
        <div className="planilla-account-delete-area">
          {confirmingDelete ? (
            <div className="planilla-account-delete-confirm">
              <span>¿Eliminar esta cuenta?</span>

              <button
                type="button"
                className="planilla-account-delete-confirm-btn planilla-account-delete-confirm-btn--yes"
                onClick={() => removeAccount(account.id)}
              >
                Confirmar
              </button>

              <button
                type="button"
                className="planilla-account-delete-confirm-btn"
                onClick={cancelAccountDelete}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="planilla-delete-account-btn"
              onClick={() => requestAccountDelete(account.id)}
              title="Eliminar esta cuenta completa"
            >
              🗑 Eliminar cuenta
            </button>
          )}
        </div>

        {periodOf(account, 'account', todayISO) &&
          account.status !== 'Deshabilitado' && (
            <button
              type="button"
              className="planilla-confirm-payment-btn"
              onClick={() => confirmPaymentAndRenew(account)}
              title="Confirma el pago y renueva un mes desde el vencimiento anterior"
            >
              ✓ Pago recibido · Renovar cuenta
            </button>
          )}

        {allowAddMember && (
          <button
            type="button"
            className="planilla-add-member-btn"
            onClick={() => addMember(account.id)}
          >
            ＋ Agregar cliente
          </button>
        )}
      </div>
    );
  }

  async function addMember(accountId) {
    if (readOnly) return;
    const account = remoteAccounts.find((item) => item.id === accountId);
    if (!account) return;
    const name = window.prompt(
      'Nombre del nuevo cliente (Cancelar no guarda):',
      '',
    );
    if (name === null) return;
    if (!name.trim()) {
      setValidationError('El nombre del cliente es obligatorio.');
      return;
    }
    let profile = '';
    if (activeSheet !== 'ChatGPT Plus') {
      const entered = window.prompt(
        'Nombre del perfil (puede estar vacío):',
        '',
      );
      if (entered === null) return;
      profile = entered;
    }
    const created = await performWrite(() =>
      createClient(supabase, userId, activeSheet, account, name, profile),
    );
    if (created?.id) {
      setSearch('');
      setEditing({
        type: 'member',
        accountId,
        memberId: created.id,
        field: 'contact',
      });
    }
  }

  function clearFixedProfileMember(accountId, memberId) {
    if (readOnly) return;
    const member = remoteClients.find((item) => item.id === memberId);
    if (!member) {
      setPendingDelete(null);
      return;
    } // Hueco visual, sin fila en Supabase.
    performWrite(() => deleteClient(supabase, userId, member));
    setPendingDelete(null);
  }

  function removeMember(accountId, memberId) {
    if (readOnly) return;
    const member = remoteClients.find((item) => item.id === memberId);
    if (!member) {
      setPendingDelete(null);
      return;
    }
    performWrite(() => deleteClient(supabase, userId, member));
    setPendingDelete(null);
  }

  function requestDelete(accountId, memberId) {
    setPendingDelete({ accountId, memberId });
  }

  function cancelDelete() {
    setPendingDelete(null);
  }

  function isDeletePending(accountId, memberId) {
    return (
      pendingDelete?.accountId === accountId &&
      pendingDelete?.memberId === memberId
    );
  }

  function sameEditingCell(first, second) {
    return (
      first?.type === second?.type &&
      first?.accountId === second?.accountId &&
      first?.memberId === second?.memberId &&
      first?.field === second?.field
    );
  }

  function getMembersForRender(account) {
    const isNetflixShared = activeSheet === 'Netflix Compartido';

    if (!isNetflixShared) {
      return account.members.map((member) => ({
        member,
        profileGroup: [member],
        showProfileCell: true,
        profileRowSpan: 1,
      }));
    }

    const groups = [];
    const groupMap = new Map();

    account.members.forEach((member) => {
      const profile = member.profile?.trim();
      const groupKey = profile || `__empty-profile-${member.id}`;

      if (!groupMap.has(groupKey)) {
        const group = [];
        groupMap.set(groupKey, group);
        groups.push(group);
      }

      groupMap.get(groupKey).push(member);
    });

    return groups.flatMap((group) =>
      group.map((member, index) => ({
        member,
        profileGroup: group,
        showProfileCell: index === 0,
        profileRowSpan: group.length,
      })),
    );
  }

  function getAccountEditingOrder(account) {
    const fields =
      activeSheet === 'ChatGPT Plus'
        ? ['email', 'password', 'subscription', 'cardName', 'status']
        : [
            'email',
            'password',
            'subscription',
            'cardName',
            'status',
            'location',
          ];

    return fields.map((field) => ({
      type: 'account',
      accountId: account.id,
      field,
    }));
  }

  function getMemberEditingOrder(account) {
    const isNetflixShared = activeSheet === 'Netflix Compartido';
    const isChatGPT = activeSheet === 'ChatGPT Plus';
    const order = [];

    if (isChatGPT) {
      account.members.forEach((member) => {
        [
          'name',
          'device',
          'dateRange',
          'contact',
          'loginRecord',
          'payment',
          'note',
        ].forEach((field) => {
          order.push({
            type: 'member',
            accountId: account.id,
            memberId: member.id,
            field,
          });
        });
      });

      return order;
    }

    getMembersForRender(account).forEach(
      ({ member, profileGroup, showProfileCell }) => {
        order.push({
          type: 'member',
          accountId: account.id,
          memberId: member.id,
          field: 'name',
        });

        if (isNetflixShared) {
          if (showProfileCell) {
            const firstMember = profileGroup[0];

            order.push({
              type: 'profile-group',
              accountId: account.id,
              memberId: firstMember.id,
              field: 'profile',
            });

            order.push({
              type: 'pin-group',
              accountId: account.id,
              memberId: firstMember.id,
              field: 'pin',
            });
          }
        } else {
          order.push({
            type: 'member',
            accountId: account.id,
            memberId: member.id,
            field: 'profile',
          });

          order.push({
            type: 'member',
            accountId: account.id,
            memberId: member.id,
            field: 'pin',
          });
        }

        ['device', 'contact', 'dateRange', 'note'].forEach((field) => {
          order.push({
            type: 'member',
            accountId: account.id,
            memberId: member.id,
            field,
          });
        });
      },
    );

    return order;
  }

  // La validación final ocurre en planillasWrite.js antes de enviar cada cambio.
  // Los inputs son no controlados: una tecla nunca dispara una petición a Supabase.

  const accounts = useMemo(() => {
    const current = groupedData[activeSheet] || [];

    const query = search.trim().toLowerCase();

    if (!query) {
      return current;
    }

    return current.filter((account) => {
      const accountText = [
        account.email,

        account.password,

        account.subscription,

        account.status,

        account.cardName,

        account.location,
      ]

        .join(' ')

        .toLowerCase();

      const membersText = account.members

        .map((member) => Object.values(member).join(' ').toLowerCase())

        .join(' ');

      return accountText.includes(query) || membersText.includes(query);
    });
  }, [groupedData, activeSheet, search]);

  function EditableAccountValue({ account, field }) {
    const cell = { type: 'account', accountId: account.id, field };
    if (sameEditingCell(editing, cell))
      return (
        <input
          className="planilla-cell-input"
          autoFocus
          defaultValue={account[field] ?? ''}
          onKeyDown={(e) =>
            commitCellOnKey(e, account, null, field, cell, 'account')
          }
          onBlur={(e) => {
            if (e.currentTarget.dataset.skipCommit !== 'true')
              saveCell(account, null, field, e.currentTarget.value, cell);
          }}
        />
      );
    return (
      <span
        className="planilla-editable-text"
        onClick={() => {
          if (!readOnly) setEditing(cell);
        }}
        title="Clic para editar y guardar al salir"
      >
        {account[field] || '-'}
      </span>
    );
  }

  function EditableMemberValue({ account, member, field }) {
    const cell = {
      type: 'member',
      accountId: account.id,
      memberId: member.id,
      field,
    };
    if (sameEditingCell(editing, cell))
      return (
        <input
          className="planilla-cell-input"
          autoFocus
          defaultValue={member[field] ?? ''}
          onKeyDown={(e) =>
            commitCellOnKey(e, account, member, field, cell, 'member')
          }
          onBlur={(e) => {
            if (e.currentTarget.dataset.skipCommit !== 'true')
              saveCell(account, member, field, e.currentTarget.value, cell);
          }}
        />
      );
    return (
      <span
        className="planilla-editable-text"
        onClick={() => {
          if (!readOnly) setEditing(cell);
        }}
        title="Clic para editar y guardar al salir"
      >
        {member[field] || '-'}
      </span>
    );
  }

  function ContactWithWhatsApp({ account, member }) {
    const number = normalizeWhatsAppNumber(member.contact);

    return (
      <div className="planilla-contact-content">
        <div className="planilla-contact-editor">
          <EditableMemberValue
            account={account}
            member={member}
            field="contact"
          />
        </div>

        {number && (
          <a
            className="planilla-whatsapp-link"
            href={getWhatsAppChatUrl(number)}
            target={isLinuxDesktop() ? undefined : '_blank'}
            rel="noopener noreferrer"
            title={`Abrir chat en WhatsApp Business con ${member.name || number}`}
            aria-label={`Abrir WhatsApp Business con ${member.name || number}`}
          >
            <img src={whatsappLogo} alt="" aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  function EditableProfileGroupValue({ account, members }) {
    const firstMember = members[0];
    const cell = {
      type: 'profile-group',
      accountId: account.id,
      memberId: firstMember.id,
      field: 'profile',
    };
    if (sameEditingCell(editing, cell))
      return (
        <input
          className="planilla-cell-input"
          autoFocus
          defaultValue={firstMember.profile ?? ''}
          onKeyDown={(e) =>
            commitCellOnKey(
              e,
              account,
              firstMember,
              'profile',
              cell,
              'member',
              members,
            )
          }
          onBlur={(e) => {
            if (e.currentTarget.dataset.skipCommit !== 'true')
              saveGroup(members, 'profile', e.currentTarget.value);
          }}
        />
      );
    return (
      <span
        className="planilla-editable-text"
        onClick={() => {
          if (!readOnly) setEditing(cell);
        }}
        title="Editar perfil compartido"
      >
        {firstMember.profile || '-'}
      </span>
    );
  }

  function EditablePinGroupValue({ account, members }) {
    const firstMember = members[0];
    const cell = {
      type: 'pin-group',
      accountId: account.id,
      memberId: firstMember.id,
      field: 'pin',
    };
    if (sameEditingCell(editing, cell))
      return (
        <input
          className="planilla-cell-input"
          autoFocus
          defaultValue={firstMember.pin ?? ''}
          onKeyDown={(e) =>
            commitCellOnKey(
              e,
              account,
              firstMember,
              'pin',
              cell,
              'member',
              members,
            )
          }
          onBlur={(e) => {
            if (e.currentTarget.dataset.skipCommit !== 'true')
              saveGroup(members, 'pin', e.currentTarget.value);
          }}
        />
      );
    return (
      <span
        className="planilla-editable-text"
        onClick={() => {
          if (!readOnly) setEditing(cell);
        }}
        title="Editar PIN compartido"
      >
        {firstMember.pin || '-'}
      </span>
    );
  }

  function StatusValue({ account, member = null }) {
    const value = effectiveStatus(
      member || account,
      member ? 'member' : 'account',
      todayISO,
    );

    const cell = member
      ? {
          type: 'member',
          accountId: account.id,
          memberId: member.id,
          field: 'status',
        }
      : {
          type: 'account',
          accountId: account.id,
          field: 'status',
        };

    const isEditing = sameEditingCell(editing, cell);

    function changeStatus(event) {
      changePaidStatus(account, member, event.target.value);
      setEditing(null);
    }

    if (isEditing) {
      return (
        <select
          className="planilla-status-select"
          autoFocus
          value={value}
          onChange={changeStatus}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(null);
          }}
          onBlur={() =>
            setEditing((current) =>
              sameEditingCell(current, cell) ? null : current,
            )
          }
        >
          <option value="Habilitado">Habilitado</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Deshabilitado">Deshabilitado</option>
        </select>
      );
    }

    const statusClass = value.toLowerCase().replaceAll(' ', '-');

    return (
      <button
        type="button"
        className={`planilla-status planilla-status--${statusClass}`}
        onClick={() => {
          if (!readOnly) setEditing(cell);
        }}
        title="Clic para cambiar estado"
      >
        {value}
      </button>
    );
  }

  function splitStackedValue(value) {
    return String(value ?? '')
      .split(/\s*\|\s*|\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function EditableStackedMemberValue({ account, member, field }) {
    const cell = {
      type: 'member',
      accountId: account.id,
      memberId: member.id,
      field,
    };
    if (sameEditingCell(editing, cell))
      return (
        <input
          className="planilla-cell-input"
          autoFocus
          defaultValue={member[field] ?? ''}
          placeholder="Separa varios datos con |"
          onKeyDown={(e) =>
            commitCellOnKey(e, account, member, field, cell, 'member')
          }
          onBlur={(e) => {
            if (e.currentTarget.dataset.skipCommit !== 'true')
              saveCell(account, member, field, e.currentTarget.value, cell);
          }}
        />
      );
    const items = splitStackedValue(member[field]);
    return (
      <div
        className="chatgpt-stacked-display"
        onClick={() => {
          if (!readOnly) setEditing(cell);
        }}
        title="Clic para editar. Separa varios datos con |"
      >
        {(items.length ? items : ['-']).map((item, index) => (
          <div
            className="chatgpt-stacked-item"
            key={`${member.id}-${field}-${index}`}
          >
            {item}
          </div>
        ))}
      </div>
    );
  }

  function MemberStatusDot({ account, member }) {
    const statuses =
      activeSheet === 'ChatGPT Plus'
        ? ['Habilitado', 'Pendiente', 'Deshabilitado']
        : ['Habilitado', 'Pendiente', 'Deshabilitado', 'Disponible'];

    const calculatedStatus = effectiveStatus(member, 'member', todayISO);
    const currentStatus = statuses.includes(calculatedStatus)
      ? calculatedStatus
      : calculatedStatus === 'Disponible'
        ? 'Disponible'
        : statuses[0];

    const statusClass = currentStatus.toLowerCase().replaceAll(' ', '-');

    const pickerOpen =
      statusPicker?.accountId === account.id &&
      statusPicker?.memberId === member.id;

    function togglePicker(event) {
      event.stopPropagation();

      setStatusPicker((current) =>
        current?.accountId === account.id && current?.memberId === member.id
          ? null
          : {
              accountId: account.id,
              memberId: member.id,
            },
      );
    }

    function chooseStatus(event, newStatus) {
      event.stopPropagation();

      changePaidStatus(account, member, newStatus);
      setStatusPicker(null);
    }

    return (
      <div className="member-status-control">
        <button
          type="button"
          className={`member-status-dot member-status-dot--${statusClass}`}
          disabled={readOnly}
          onClick={readOnly ? undefined : togglePicker}
          aria-label={
            readOnly
              ? `Estado: ${currentStatus}. Solo lectura`
              : `Estado: ${currentStatus}. Clic para elegir otro estado`
          }
          title={
            readOnly
              ? `${currentStatus} · Solo lectura`
              : `${currentStatus} · Clic para elegir estado`
          }
        />

        {pickerOpen && (
          <div
            className="member-status-picker"
            onClick={(event) => event.stopPropagation()}
          >
            {statuses.map((status) => {
              const optionClass = status.toLowerCase().replaceAll(' ', '-');

              return (
                <button
                  type="button"
                  key={status}
                  className={`member-status-option ${
                    status === currentStatus ? 'active' : ''
                  }`}
                  onClick={(event) => chooseStatus(event, status)}
                >
                  <span
                    className={`member-status-option-dot member-status-option-dot--${optionClass}`}
                  />

                  <span>{status}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function NoteReminderButton({ account, member }) {
    if (!onCreateReminder) return null;
    const raw = String(member.note || '').trim();
    const lower = raw.toLocaleLowerCase('es');
    const kind = /cobr|debe|no pag|sin pag|pendiente de pago/.test(lower)
      ? 'cobro'
      : /pagar|factura|renovar cuenta/.test(lower)
        ? 'pago'
        : 'tarea';
    return (
      <button
        type="button"
        className="planilla-note-reminder-btn"
        title="Crear recordatorio desde observaciones"
        aria-label="Crear recordatorio desde observaciones"
        onClick={(event) => {
          event.stopPropagation();
          onCreateReminder({
            kind,
            title: raw.slice(0, 180) || `Revisar ${member.name || 'cliente'}`,
            details: `${activeSheet} · ${member.name || 'Cliente'} · ${account.email || 'Cuenta sin email'}`,
            sourceRef: `${activeSheet}:${account.id}:${member.id}`,
          });
        }}
      >
        🔔
      </button>
    );
  }

  function DeleteMemberControl({ account, member }) {
    if (readOnly) return null;
    const showDelete =
      activeSheet === 'Netflix Privado' ||
      activeSheet === 'Netflix Compartido' ||
      activeSheet === 'Prime Video' ||
      activeSheet === 'HBO Max' ||
      activeSheet === 'ChatGPT Plus';

    if (!showDelete) {
      return null;
    }

    const confirming = isDeletePending(account.id, member.id);

    if (confirming) {
      return (
        <div
          className="member-delete-confirm"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="member-delete-confirm-btn member-delete-confirm-btn--yes"
            onClick={() =>
              activeSheet === 'Netflix Privado' ||
              activeSheet === 'Prime Video' ||
              activeSheet === 'HBO Max'
                ? clearFixedProfileMember(account.id, member.id)
                : removeMember(account.id, member.id)
            }
            title={
              activeSheet === 'Netflix Privado' ||
              activeSheet === 'Prime Video' ||
              activeSheet === 'HBO Max'
                ? 'Vaciar datos del cliente'
                : 'Confirmar eliminación'
            }
          >
            Confirmar
          </button>

          <button
            type="button"
            className="member-delete-confirm-btn"
            onClick={cancelDelete}
            title="Cancelar"
          >
            Cancelar
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        className="planilla-delete-member-btn member-delete-left"
        onClick={(event) => {
          event.stopPropagation();
          requestDelete(account.id, member.id);
        }}
        aria-label={
          activeSheet === 'Netflix Privado' ||
          activeSheet === 'Prime Video' ||
          activeSheet === 'HBO Max'
            ? `Vaciar datos de ${member.name || 'cliente'}`
            : `Eliminar ${member.name || 'cliente'}`
        }
        title={
          activeSheet === 'Netflix Privado' ||
          activeSheet === 'Prime Video' ||
          activeSheet === 'HBO Max'
            ? 'Vaciar datos del cliente'
            : 'Eliminar cliente'
        }
      >
        ×
      </button>
    );
  }

  function countChatGPTDevices(account) {
    return account.members.reduce(
      (total, member) => total + splitStackedValue(member.device).length,
      0,
    );
  }

  function sumChatGPTPayments(account) {
    return account.members.reduce((total, member) => {
      const rawValue = String(member.payment ?? '')
        .replace(',', '.')
        .replace(/[^0-9.-]/g, '');

      const payment = Number.parseFloat(rawValue);

      return total + (Number.isFinite(payment) ? payment : 0);
    }, 0);
  }

  function renderChatGPTAccountBlock(account) {
    const totalDevices = countChatGPTDevices(account);
    const totalPayments = sumChatGPTPayments(account);

    return (
      <div className="planilla-account-block" key={account.id}>
        <table className="planilla-main-table planilla-main-table--chatgpt">
          <colgroup>
            <col className="chatgpt-col-name" />
            <col className="chatgpt-col-device" />
            <col className="chatgpt-col-date" />
            <col className="chatgpt-col-contact" />
            <col className="chatgpt-col-login" />
            <col className="chatgpt-col-payment" />
            <col className="chatgpt-col-note" />
          </colgroup>

          <thead>
            <tr className="planilla-account-grid-row">
              <th colSpan={7} className="planilla-account-grid-wrapper">
                <div className="planilla-account-grid chatgpt-account-grid chatgpt-account-grid--headers">
                  <div className="planilla-account-grid-cell">Cuenta</div>
                  <div className="planilla-account-grid-cell">Email</div>
                  <div className="planilla-account-grid-cell">Contraseña</div>
                  <div className="planilla-account-grid-cell">
                    Fecha Inicio - Fin
                  </div>
                  <div className="planilla-account-grid-cell">Tarjeta</div>
                  <div className="planilla-account-grid-cell">Estado</div>
                  <div className="planilla-account-grid-cell">
                    Total de Dispositivos
                  </div>
                </div>
              </th>
            </tr>

            <tr className="planilla-account-grid-row">
              <td colSpan={7} className="planilla-account-grid-wrapper">
                <div className="planilla-account-grid chatgpt-account-grid chatgpt-account-grid--values">
                  <div className="planilla-account-grid-cell planilla-account-grid-label">
                    Datos
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="email" />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="password" />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue
                      account={account}
                      field="subscription"
                    />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="cardName" />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value planilla-account-status-cell">
                    <StatusValue account={account} />
                  </div>

                  <div
                    className="planilla-account-grid-cell chatgpt-total-devices"
                    title="Se calcula automáticamente desde la columna Dispositivos"
                  >
                    {totalDevices}
                  </div>
                </div>
              </td>
            </tr>

            <tr className="planilla-members-header">
              <th>Nombres y Apellidos</th>
              <th>Dispositivos</th>
              <th>Fecha de Inicio - Fin</th>
              <th>Contacto</th>
              <th>Registro de Ingreso</th>
              <th>Pagos</th>
              <th>Observaciones</th>
            </tr>
          </thead>

          <tbody>
            {account.members.map((member) => {
              const isSearchMatch = memberMatchesSearch(member);

              return (
                <tr
                  key={member.id}
                  className={isSearchMatch ? 'planilla-row-match' : ''}
                >
                  <td className="chatgpt-name-cell planilla-name-cell">
                    <DeleteMemberControl account={account} member={member} />

                    <div className="chatgpt-name-editor">
                      <EditableMemberValue
                        account={account}
                        member={member}
                        field="name"
                      />
                    </div>

                    <MemberStatusDot account={account} member={member} />
                  </td>

                  <td className="chatgpt-stacked-cell">
                    <EditableStackedMemberValue
                      account={account}
                      member={member}
                      field="device"
                    />
                  </td>

                  <td>
                    <EditableMemberValue
                      account={account}
                      member={member}
                      field="dateRange"
                    />
                  </td>

                  <td className="planilla-contact-cell">
                    <ContactWithWhatsApp account={account} member={member} />
                  </td>

                  <td className="chatgpt-stacked-cell">
                    <EditableStackedMemberValue
                      account={account}
                      member={member}
                      field="loginRecord"
                    />
                  </td>

                  <td>
                    <EditableMemberValue
                      account={account}
                      member={member}
                      field="payment"
                    />
                  </td>

                  <td className="chatgpt-note-cell planilla-note-with-reminder">
                    <EditableMemberValue
                      account={account}
                      member={member}
                      field="note"
                    />
                    <NoteReminderButton account={account} member={member} />
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="chatgpt-payment-total-row">
              <td colSpan={4}></td>
              <td className="chatgpt-payment-total-label">Total</td>
              <td className="chatgpt-payment-total-value">
                {Number.isInteger(totalPayments)
                  ? totalPayments
                  : totalPayments.toFixed(2)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <AccountActions account={account} allowAddMember />
      </div>
    );
  }

  function memberMatchesSearch(member) {
    const query = search.trim().toLowerCase();

    if (!query) {
      return false;
    }

    const searchableText = [
      member.name,

      member.profile,

      member.contact,

      member.pin,

      member.device,

      member.dateRange,

      member.loginRecord,

      member.payment,

      member.note,

      member.status,
    ]

      .filter(Boolean)

      .join(' ')

      .toLowerCase();

    return searchableText.includes(query);
  }

  function renderAccountBlock(account) {
    const emptyMemberRows = Math.max(0, 5 - account.members.length);
    const isNetflixShared = activeSheet === 'Netflix Compartido';
    const membersForRender = getMembersForRender(account);

    return (
      <div className="planilla-account-block" key={account.id}>
        <table className="planilla-main-table">
          <colgroup>
            <col className="planilla-col-name" />
            <col className="planilla-col-profile" />
            <col className="planilla-col-pin" />
            <col className="planilla-col-device" />
            <col className="planilla-col-contact" />
            <col className="planilla-col-date" />
            <col className="planilla-col-note" />
          </colgroup>

          <thead>
            <tr className="planilla-account-grid-row">
              <th colSpan={7} className="planilla-account-grid-wrapper">
                <div className="planilla-account-grid planilla-account-grid--headers">
                  <div className="planilla-account-grid-cell">Cuenta</div>
                  <div className="planilla-account-grid-cell">Email</div>
                  <div className="planilla-account-grid-cell">Contraseña</div>
                  <div className="planilla-account-grid-cell">
                    Fecha Inicio - Fin
                  </div>
                  <div className="planilla-account-grid-cell">Tarjeta</div>
                  <div className="planilla-account-grid-cell">Estado</div>
                  <div className="planilla-account-grid-cell">Ubicación</div>
                </div>
              </th>
            </tr>

            <tr className="planilla-account-grid-row">
              <td colSpan={7} className="planilla-account-grid-wrapper">
                <div className="planilla-account-grid planilla-account-grid--values">
                  <div className="planilla-account-grid-cell planilla-account-grid-label">
                    Datos
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="email" />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="password" />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue
                      account={account}
                      field="subscription"
                    />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="cardName" />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value planilla-account-status-cell">
                    <StatusValue account={account} />
                  </div>

                  <div className="planilla-account-grid-cell planilla-account-grid-value">
                    <EditableAccountValue account={account} field="location" />
                  </div>
                </div>
              </td>
            </tr>

            <tr className="planilla-members-header">
              <th>Nombres</th>
              <th>Perfil</th>
              <th>Pin</th>
              <th>Dispositivos</th>
              <th>Contacto</th>
              <th>Fecha Inicio - Fin</th>
              <th>Observaciones</th>
            </tr>
          </thead>

          <tbody>
            {membersForRender.map(
              ({ member, profileGroup, showProfileCell, profileRowSpan }) => {
                const isSearchMatch = memberMatchesSearch(member);

                return (
                  <tr
                    key={member.id}
                    className={isSearchMatch ? 'planilla-row-match' : ''}
                  >
                    <td className="planilla-name-cell">
                      <DeleteMemberControl account={account} member={member} />

                      <div className="planilla-name-editor">
                        <EditableMemberValue
                          account={account}
                          member={member}
                          field="name"
                        />
                      </div>

                      <MemberStatusDot account={account} member={member} />
                    </td>

                    {showProfileCell && (
                      <td
                        className={
                          isNetflixShared ? 'planilla-profile-group-cell' : ''
                        }
                        rowSpan={profileRowSpan}
                      >
                        {isNetflixShared ? (
                          <div className="planilla-group-cell-content">
                            <EditableProfileGroupValue
                              account={account}
                              members={profileGroup}
                            />
                          </div>
                        ) : (
                          <EditableMemberValue
                            account={account}
                            member={member}
                            field="profile"
                          />
                        )}
                      </td>
                    )}

                    {showProfileCell && isNetflixShared ? (
                      <td
                        className="planilla-profile-group-cell"
                        rowSpan={profileRowSpan}
                      >
                        <div className="planilla-group-cell-content">
                          <EditablePinGroupValue
                            account={account}
                            members={profileGroup}
                          />
                        </div>
                      </td>
                    ) : (
                      !isNetflixShared && (
                        <td>
                          <EditableMemberValue
                            account={account}
                            member={member}
                            field="pin"
                          />
                        </td>
                      )
                    )}

                    <td>
                      <EditableMemberValue
                        account={account}
                        member={member}
                        field="device"
                      />
                    </td>

                    <td className="planilla-contact-cell">
                      <ContactWithWhatsApp account={account} member={member} />
                    </td>

                    <td>
                      <EditableMemberValue
                        account={account}
                        member={member}
                        field="dateRange"
                      />
                    </td>

                    <td className="planilla-note-cell planilla-note-with-reminder">
                      <EditableMemberValue
                        account={account}
                        member={member}
                        field="note"
                      />
                      <NoteReminderButton account={account} member={member} />
                    </td>
                  </tr>
                );
              },
            )}

            {Array.from({ length: emptyMemberRows }).map((_, rowIndex) => (
              <tr
                className="planilla-member-empty-row"
                key={`${account.id}-member-empty-${rowIndex}`}
              >
                {Array.from({ length: 7 }).map((__, cellIndex) => (
                  <td
                    aria-hidden="true"
                    key={`${account.id}-member-empty-${rowIndex}-${cellIndex}`}
                  >
                    &nbsp;
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <AccountActions account={account} allowAddMember={isNetflixShared} />
      </div>
    );
  }

  return (
    <main className="page-grid page-grid--stacked planillas-page">
      <section className="panel panel--wide planillas-panel">
        <div className="planillas-topbar">
          <button
            type="button"
            className="planillas-menu-btn"
            onClick={onOpenMenu}
          >
            ☰ Menú
          </button>

          <div>
            <h2>📑 Planillas</h2>
          </div>
          <div className="planillas-notification-slot">
            {notificationCenter}
          </div>
        </div>

        <div className="planillas-tabs">
          {sheets.map((sheet) => (
            <button
              key={sheet}
              type="button"
              data-sheet={sheet}
              className={activeSheet === sheet ? 'active' : ''}
              onClick={() => {
                setActiveSheet(sheet);

                setEditing(null);

                setPendingDelete(null);

                setPendingAccountDelete(null);

                setStatusPicker(null);
                setValidationError(null);

                setSearch('');
              }}
            >
              <img
                className="planillas-tab-logo"
                src={platformLogos[sheet]}
                alt=""
                aria-hidden="true"
              />
              <span>{sheet}</span>
            </button>
          ))}
        </div>

        <div
          role="status"
          style={{
            margin: '10px 0',
            padding: '9px 12px',
            border: '1px solid rgba(154,123,244,.38)',
            borderRadius: 9,
            fontSize: 12,
          }}
        >
          {remoteLoading
            ? '⏳ Leyendo cuentas y clientes desde Supabase…'
            : remoteError
              ? `⚠️ No se pudo consultar Supabase: ${remoteError}`
              : `✅ Supabase · Edición activa · ${remoteAccounts.length} cuentas, ${remoteClients.length} clientes.${busy ? ' Guardando…' : ''}`}
          {!remoteLoading &&
            !remoteError &&
            (remoteView.unsupportedAccounts.length > 0 ||
              remoteView.unlinkedClients.length > 0) && (
              <span style={{ display: 'block', opacity: 0.8, marginTop: 4 }}>
                {remoteView.unsupportedAccounts.length} cuenta(s) de otras
                plataformas y {remoteView.unlinkedClients.length} cliente(s) sin
                cuenta asociada no se muestran en estas cinco planillas; sí
                permanecen en Supabase y en las listas originales.
              </span>
            )}
        </div>
        <div className="planillas-account-tools">
          <div className="filters planillas-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="🔍 Buscar cuenta, cliente, perfil o contacto..."
            />
          </div>

          <button
            type="button"
            className="planilla-add-member-btn planillas-add-account-btn"
            disabled={readOnly}
            title="Crear una cuenta real en Supabase"
            onClick={addAccount}
          >
            ＋ Registrar cuenta
          </button>
        </div>

        {validationError && (
          <div className="planillas-validation-notice" role="alert">
            <span>
              ⚠️ {validationError} Revisa el dato e inténtalo nuevamente.
            </span>
            <button
              type="button"
              onClick={() => setValidationError(null)}
              aria-label="Cerrar aviso"
            >
              ×
            </button>
          </div>
        )}

        <div className="planillas-content">
          {remoteLoading ? (
            <div className="planillas-empty">
              Cargando datos reales desde Supabase…
            </div>
          ) : remoteError ? (
            <div className="planillas-empty" role="alert">
              Error de lectura. No se han cargado datos de prueba.
            </div>
          ) : accounts.length > 0 ? (
            accounts.map((account) =>
              activeSheet === 'ChatGPT Plus'
                ? renderChatGPTAccountBlock(account)
                : renderAccountBlock(account),
            )
          ) : (
            <div className="planillas-empty">
              No hay cuentas registradas en esta plataforma todavía.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

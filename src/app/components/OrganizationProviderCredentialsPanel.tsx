/**
 * Organization AI provider credentials — the CUSTOMER console (AI-01 Batch 4D).
 *
 * Where an administrator of a customer organization brings their own AI
 * provider key, replaces it, and takes it back.
 *
 * ── WHOSE PANEL THIS IS, AND WHOSE IT IS NOT ──────────────────────────────
 *
 * `ProviderAdministrationPanel` is MARQ's: the platform's provider estate, its
 * certification decisions, its model allow lists, its governed spending
 * exposure and the keys the platform executes with. It is the platform
 * operator's screen and a customer never sees it.
 *
 * THIS panel shows ONE organization its OWN credentials. It renders nothing
 * about MARQ's estate, and cannot: the server's customer read model carries no
 * platform credential field, no deployment variable name, no root key identity
 * and no exposure figure. Where the platform arrangement is relevant — "your
 * requests currently use the MARQ platform arrangement" — it is named as
 * exactly that and never described further.
 *
 * ── GENERIC BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * THERE IS NO PROVIDER NAME IN ANY BRANCH IN THIS FILE. Not `openai`, not
 * `anthropic`. Every decision reads provider METADATA the server sends:
 * `available` decides whether a form appears, `credentialPolicy` supplies the
 * form's hint, `credential.status` decides what the card says. A provider added
 * in a later batch renders here with no change to this file.
 *
 * ── THE STORED KEY IS NEVER SHOWN, BECAUSE IT IS NEVER SENT ───────────────
 *
 * No response type this component reads has a field that could hold a secret.
 * The credential card shows a keyed fingerprint, at most four characters, and
 * timestamps. Replacement asks for the NEW key and never for the old one —
 * there is no "confirm your current key" step, because the platform could not
 * check one, and asking for a value it cannot verify would teach administrators
 * to paste live keys into forms for no reason.
 *
 * The entered value lives in one piece of component state and is cleared the
 * moment the request settles, success or failure.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';

import {
  ByokError,
  configureOrganizationCredential,
  fetchOrganizationCredentials,
  fetchOrganizationProviders,
  revokeOrganizationCredential,
  setOrganizationFallbackPolicy,
  type ByokCredentialRecord,
  type ByokProvider,
  type ByokSummary,
} from '@/app/services/aiByokService';

interface Props {
  accessToken?: string;
}

/**
 * What the credential card says, per lifecycle state.
 *
 * A lookup rather than a conditional chain, so a state the server adds renders
 * as plain text instead of silently taking the styling of whichever branch
 * happened to be last.
 */
const STATUS_COPY: Record<string, { label: string; style: string }> = {
  active: { label: 'In force', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inactive: { label: 'Switched off', style: 'bg-amber-50 text-amber-700 border-amber-200' },
  revoked: { label: 'Revoked', style: 'bg-rose-50 text-rose-700 border-rose-200' },
  not_configured: { label: 'Not configured', style: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** What the platform is currently authenticating this organization's calls with. */
const SOURCE_COPY: Record<string, string> = {
  customer_byok: 'Your organization’s own credential',
  platform: 'The MARQ platform arrangement',
  none: 'Nothing — requests to this provider will not run',
};

function Badge({ text, style }: { text: string; style?: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        style ?? 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {text}
    </span>
  );
}

export function OrganizationProviderCredentialsPanel({ accessToken }: Props) {
  const [summary, setSummary] = useState<ByokSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, ByokCredentialRecord[]>>({});

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 4_000);
  }, []);

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    try {
      setSummary(await fetchOrganizationProviders(accessToken));
      setError(null);
    } catch (err) {
      // Reported IN PLACE. "Your role does not permit this" is a normal answer
      // on this surface — most members of an organization are not its
      // administrators — and it must read as an explanation rather than as a
      // broken page.
      setError(
        err instanceof ByokError
          ? err.message
          : 'The provider credential surface is unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = useCallback(
    async (providerId: string) => {
      if (!accessToken || history[providerId]) return;
      try {
        const records = await fetchOrganizationCredentials(accessToken, providerId);
        setHistory((current) => ({ ...current, [providerId]: records }));
      } catch {
        // A missing history is not worth an error banner: the card above it is
        // still accurate, and the administrator asked to expand a detail panel
        // rather than to perform an action.
      }
    },
    [accessToken, history],
  );

  /**
   * One wrapper for every mutation, so no call site can skip the confirmation,
   * the reason, the busy guard, the refresh or the error surface — the same
   * reasoning that puts the server's audited mutations behind one door.
   *
   * THE REASON IS NOT DECORATION. The server refuses a change without one, and
   * it lands on an append-only trail the organization's own administrators and
   * MARQ can both read. Collecting it here rather than sending a placeholder is
   * what makes "why was this key replaced?" answerable.
   */
  const withConfirmation = useCallback(
    async (
      confirmation: string,
      prompt: string,
      run: (reason: string) => Promise<unknown>,
    ) => {
      if (!window.confirm(confirmation)) return;
      const reason = window.prompt(
        `${prompt}\n\nThis is recorded on the credential audit trail. State why:`,
      );
      if (reason === null) return;
      if (reason.trim().length < 4) {
        notify('A reason of at least four characters is required.', 'error');
        return;
      }
      setBusy(true);
      try {
        await run(reason.trim());
        setHistory({});
        await load();
        notify('Change applied and recorded.');
      } catch (err) {
        notify(
          err instanceof ByokError ? err.message : 'The change could not be applied.',
          'error',
        );
      } finally {
        setBusy(false);
      }
    },
    [load, notify],
  );

  if (!accessToken) {
    return (
      <div className="rounded-xl border border-slate-200 p-6 text-center">
        <Lock className="mx-auto h-5 w-5 text-slate-400" />
        <p className="mt-2 text-sm text-slate-600">
          Managing AI provider credentials requires an authenticated session.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your provider credentials…
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {error}
      </div>
    );
  }

  if (!summary || summary.providers.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No AI providers currently accept a customer-supplied credential.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            toast.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* ── What this screen is, said once, at the top ──────────────────────
          An administrator arriving here is about to paste a live vendor API
          key. The two things they most need to know before they do — that it
          is encrypted and that they will never see it again — belong above the
          form and not beside the submit button. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Your organization’s AI provider credentials
        </p>
        <p className="mt-1 text-xs text-slate-600">
          A credential you add here is encrypted before it is stored and is used only for your
          organization’s own AI requests, billed to your own vendor account.{' '}
          <span className="font-semibold text-slate-800">
            It can never be read back — including by you, by your colleagues and by MARQ.
          </span>{' '}
          Keep your own copy; replacing it is how you change it, and revoking it is how you take
          it back.
        </p>
        {!summary.credentialStorage.available && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Credentials cannot be stored right now:{' '}
              {summary.credentialStorage.blocker ?? 'this deployment is not configured for it'}.
              Contact MARQ support.
            </span>
          </p>
        )}
      </div>

      {summary.providers.map((provider) => (
        <ProviderCard
          key={provider.providerId}
          provider={provider}
          busy={busy}
          expanded={expanded === provider.providerId}
          history={history[provider.providerId]}
          notify={notify}
          onExpand={() => {
            const next = expanded === provider.providerId ? null : provider.providerId;
            setExpanded(next);
            if (next) void loadHistory(next);
          }}
          onSubmitCredential={(secret, credentialName) =>
            withConfirmation(
              provider.credential.status === 'active'
                ? `Replace your ${provider.displayName} credential?\n\n` +
                    'The credential currently in force is superseded immediately. Requests ' +
                    'already in flight are unaffected; every request after this uses the new ' +
                    'credential.'
                : `Store a ${provider.displayName} credential for your organization?\n\n` +
                    'It is encrypted before it is stored and can never be read back.',
              provider.credential.status === 'active'
                ? `Replace the ${provider.displayName} credential for your organization.`
                : `Store a ${provider.displayName} credential for your organization.`,
              (reason) =>
                configureOrganizationCredential(
                  accessToken,
                  provider.providerId,
                  { secret, credentialName },
                  reason,
                ),
            )
          }
          onRevokeCredential={(credentialId) =>
            void withConfirmation(
              `Revoke your ${provider.displayName} credential?\n\n` +
                'This cannot be undone. Restoring your own account means entering a new ' +
                'credential.\n\n' +
                (provider.fallback === 'tenant_only'
                  ? 'Your policy is to use your own credential only, so AI requests to this ' +
                    'provider will STOP until you add a new one.'
                  : 'Your requests will fall back to the MARQ platform arrangement.'),
              `Revoke the ${provider.displayName} credential for your organization.`,
              (reason) =>
                revokeOrganizationCredential(
                  accessToken,
                  provider.providerId,
                  credentialId,
                  reason,
                ),
            )
          }
          onSetFallback={(fallback) =>
            void withConfirmation(
              fallback === 'tenant_only'
                ? 'Use your own credential only?\n\n' +
                    'If your credential is missing or revoked, AI requests to this provider ' +
                    'will not run. They will NOT fall back to the MARQ platform arrangement.'
                : 'Allow the MARQ platform arrangement as a fallback?\n\n' +
                    'When your organization has no credential of its own, requests will use ' +
                    'MARQ’s arrangement instead of failing.',
              `Change the credential fallback policy for ${provider.displayName}.`,
              (reason) =>
                setOrganizationFallbackPolicy(
                  accessToken,
                  provider.providerId,
                  fallback,
                  reason,
                ),
            )
          }
        />
      ))}
    </div>
  );
}

interface CardProps {
  provider: ByokProvider;
  busy: boolean;
  expanded: boolean;
  history?: ByokCredentialRecord[];
  notify: (message: string, kind?: 'success' | 'error') => void;
  onExpand: () => void;
  onSubmitCredential: (secret: string, credentialName?: string) => Promise<void>;
  onRevokeCredential: (credentialId: string) => void;
  onSetFallback: (fallback: 'platform' | 'tenant_only') => void;
}

function ProviderCard(props: CardProps) {
  const { provider } = props;
  const status = STATUS_COPY[provider.credential.status] ?? {
    label: provider.credential.status,
    style: undefined as string | undefined,
  };

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {provider.displayName}
            <Badge text={status.label} style={status.style} />
            {provider.billable && (
              <Badge text="billed to you" style="bg-amber-50 text-amber-700 border-amber-200" />
            )}
          </p>

          {/* The server's own message. Derived there from the state beside it,
              so it cannot drift from the badge above. */}
          <p className="mt-1 text-sm text-slate-600">{provider.message}</p>

          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <Info className="h-3 w-3" />
            Currently authenticating with:{' '}
            <span className="font-medium text-slate-700">
              {SOURCE_COPY[provider.effectiveSource] ?? provider.effectiveSource}
            </span>
          </p>

          {provider.credential.configured && (
            <p className="mt-1 text-xs text-slate-500">
              {provider.credential.credentialName ?? 'credential'} · {provider.credential.fingerprint}
              {provider.credential.lastFour ? ` · ends ${provider.credential.lastFour}` : ''}
              {provider.credential.rotatedAt
                ? ` · replaced ${provider.credential.rotatedAt}`
                : provider.credential.createdAt
                  ? ` · added ${provider.credential.createdAt}`
                  : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={props.onExpand}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {props.expanded ? 'Hide detail' : 'Manage'}
          </button>
        </div>
      </div>

      {props.expanded && (
        <div className="space-y-5 border-t border-slate-200 p-4">
          {!provider.available && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                A credential cannot be stored for this provider right now:{' '}
                {provider.unavailableReason}.
              </span>
            </p>
          )}

          {/* STORED IS NOT SERVING.
              A credential can be stored, active, correctly sealed and genuinely
              the key that would authenticate a request, while the platform
              cannot make requests at all. Saying only the first half told
              administrators their key was in service in a deployment where
              every request was refused, so the second half is said here too —
              as a platform STATE, naming nothing about MARQ's own credential. */}
          {provider.serviceable === false && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {provider.credential.status === 'active'
                  ? 'Your credential is stored and would authenticate requests, but no request is reaching this provider: '
                  : 'This provider is not currently serving requests: '}
                {provider.unserviceableReason ??
                  'the MARQ platform cannot currently execute requests for this provider'}
                . Contact MARQ support if this persists.
              </span>
            </p>
          )}

          {/* ── The credential in force ───────────────────────────────────── */}
          {provider.credential.configured && provider.credential.credentialId && (
            <section>
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <KeyRound className="h-3.5 w-3.5" /> Credential in force
              </h4>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {provider.credential.credentialName ?? 'credential'}
                  </span>
                  {' · '}
                  {provider.credential.fingerprint}
                  {provider.credential.lastFour ? ` · ends ${provider.credential.lastFour}` : ''}
                  {provider.credential.secretVersion
                    ? ` · version ${provider.credential.secretVersion}`
                    : ''}
                </div>
                {/* DESTRUCTIVE, AND IT SAYS SO. The confirmation this opens
                    names what revocation does and what happens afterwards,
                    which depends on the organization's own fallback policy. */}
                <button
                  disabled={props.busy}
                  onClick={() => props.onRevokeCredential(provider.credential.credentialId!)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> Revoke
                </button>
              </div>
            </section>
          )}

          {/* ── Add or replace ────────────────────────────────────────────── */}
          {provider.available && (
            <CredentialForm
              provider={provider}
              busy={props.busy}
              notify={props.notify}
              onSubmit={props.onSubmitCredential}
            />
          )}

          {/* ── The fallback policy ───────────────────────────────────────── */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              When you have no credential of your own
            </h4>
            <div className="mt-2 space-y-2">
              {(
                [
                  {
                    value: 'platform' as const,
                    title: 'Use the MARQ platform arrangement',
                    detail:
                      'If your credential is missing or revoked, requests still run, on MARQ’s ' +
                      'arrangement rather than your vendor account.',
                  },
                  {
                    value: 'tenant_only' as const,
                    title: 'Use our own credential only',
                    detail:
                      'Requests reach your vendor account or they do not run. Revoking your ' +
                      'credential stops AI for this provider until you add a new one.',
                  },
                ]
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    provider.fallback === option.value
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    name={`fallback-${provider.providerId}`}
                    checked={provider.fallback === option.value}
                    disabled={props.busy}
                    onChange={() => props.onSetFallback(option.value)}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {option.title}
                      {provider.fallback === option.value && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{option.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* ── History ───────────────────────────────────────────────────── */}
          {props.history && props.history.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Credential history
              </h4>
              <ul className="mt-1 space-y-1">
                {props.history.map((record) => (
                  <li key={record.credentialId} className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{record.credentialName}</span> · v
                    {record.secretVersion} · {record.status} · {record.fingerprint}
                    {record.lastFour ? ` · ends ${record.lastFour}` : ''} · added {record.createdAt}
                    {record.revokedAt ? ` · revoked ${record.revokedAt}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-400">
                Fingerprints identify a credential without revealing it. No stored credential can
                be displayed.
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The credential entry form.
 *
 * WRITE-ONLY BY SHAPE. `type="password"`, `autoComplete="off"`, no default
 * value, and the field is cleared in a `finally` — so the entered key is gone
 * from component state whether the request succeeded or failed. There is
 * nothing here that reads a stored credential, because there is no API that
 * returns one.
 *
 * Adding and replacing are the same form, because they are the same server
 * operation. An administrator replacing a key is never asked for the old one:
 * the platform cannot verify it, and asking would train people to paste live
 * credentials into fields that do nothing with them.
 */
function CredentialForm({
  provider,
  busy,
  notify,
  onSubmit,
}: {
  provider: ByokProvider;
  busy: boolean;
  notify: (message: string, kind?: 'success' | 'error') => void;
  onSubmit: (secret: string, credentialName?: string) => Promise<void>;
}) {
  const [secret, setSecret] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const replacing = provider.credential.status === 'active';

  const submit = async () => {
    if (secret.trim().length < 8) {
      notify('Enter the full credential value.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(secret.trim(), name.trim() === '' ? undefined : name.trim());
    } finally {
      // Cleared unconditionally. A failed submission that left the key in the
      // field would leave it in the DOM, in React state and in any error
      // overlay a browser extension happens to render.
      setSecret('');
      setName('');
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-700">
        {replacing ? 'Replace your credential' : 'Add your credential'}
      </p>
      <p className="text-[11px] text-slate-500">
        {provider.credentialPolicy.credentialFormatHint ??
          'The API credential authorising Cortex to call this provider on your behalf.'}{' '}
        It is encrypted before it is stored and{' '}
        <span className="font-semibold text-slate-700">can never be read back</span> — including
        by you.
        {replacing ? ' The credential currently in force is superseded immediately.' : ''}
      </p>
      <input
        type="password"
        value={secret}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setSecret(event.target.value)}
        placeholder="Paste your credential"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Label (optional) — e.g. primary, rotated-2026-09"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        disabled={busy || submitting}
        onClick={() => void submit()}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {replacing ? 'Replace credential' : 'Add credential'}
      </button>
    </section>
  );
}

/**
 * Provider Administration — MARQ Team Admin console (AI-01 Batch 4C).
 *
 * The operator surface for the platform's AI provider estate: what is
 * configured, what is credentialed and by what, what is certified, what is
 * eligible, and which models may serve.
 *
 * ── GENERIC BY CONSTRUCTION ─────────────────────────────────────────────────
 *
 * THERE IS NO PROVIDER NAME IN ANY BRANCH IN THIS FILE. Not `openai`, not
 * `anthropic`, not `mock`. Every decision the UI makes reads provider METADATA
 * the server sends:
 *
 *   `credentialPolicy.manageable`  decides whether a credential form appears.
 *                                  The mock provider sets it false and gets no
 *                                  form — without this component knowing the
 *                                  mock exists.
 *   `credentialPolicy.required`    decides between "no credential required" and
 *                                  "no credential configured", which are very
 *                                  different states to show an operator.
 *   `credential.management`        decides what the credential card says and
 *                                  which actions it offers.
 *   `models[]`                     rendered from the server's own list.
 *
 * A provider added in Batch 4E renders correctly here with no change to this
 * file. That is the test of whether the Batch 4C contract is real, and it is
 * asserted by `tests/features/providerAdministrationSurface.test.ts`.
 *
 * ── THE STORED KEY IS NEVER SHOWN, BECAUSE IT IS NEVER SENT ────────────────
 *
 * No response type this component reads has a field that could hold a secret.
 * The credential card shows a keyed fingerprint, at most four characters, and
 * timestamps. Rotation asks for the NEW key and never for the old one — there
 * is no "confirm your current key" step, because the platform could not check
 * one, and asking for a value it cannot verify would teach operators to paste
 * live keys into a form for no reason.
 *
 * The entered value lives in one piece of component state and is cleared the
 * moment the request settles, success or failure.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';

import {
  fetchAIProviderAdministration,
  fetchAIProviderCredentials,
  revokeAIProviderCredential,
  setAIProviderCredential,
  setAIProviderEnabled,
  setAIProviderModelEnabled,
  AIAdminError,
  formatMicroUsd,
  hasAICapability,
  type AIAdminCapability,
  type AIProviderAdministration,
  type AIProviderAdministrationSummary,
  type AIProviderCredentialRecord,
} from '@/app/services/aiAdminService';

interface Props {
  accessToken?: string;
  capabilities?: readonly AIAdminCapability[];
  /** Collect an audited reason and run the mutation. Shared with the console. */
  withReason: (prompt: string, run: (reason: string) => Promise<unknown>) => Promise<void>;
  notify: (message: string, kind?: 'success' | 'error') => void;
  busy: boolean;
}

/**
 * Certification badge styling, keyed by the SERVER's vocabulary.
 *
 * A lookup rather than a conditional chain, so a state the server adds renders
 * as plain text instead of silently taking the styling of whichever branch
 * happened to be last.
 */
const CERTIFICATION_STYLE: Record<string, string> = {
  certified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  testing: 'bg-sky-50 text-sky-700 border-sky-200',
  unverified: 'bg-slate-100 text-slate-600 border-slate-200',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  disabled: 'bg-rose-50 text-rose-700 border-rose-200',
};

const STATE_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  unavailable: 'bg-rose-50 text-rose-700 border-rose-200',
  disabled: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** What the credential card says, per management state. Never a key. */
const MANAGEMENT_COPY: Record<string, { label: string; detail: string }> = {
  cortex_managed: {
    label: 'Cortex managed',
    detail: 'Stored encrypted in Cortex. Rotating it does not require a deployment.',
  },
  deployment_managed: {
    label: 'Deployment managed',
    detail:
      'Supplied by a deployment environment variable. Cortex never reads, displays or ' +
      'overwrites its value; changing it requires a deployment.',
  },
  not_required: {
    label: 'Not required',
    detail: 'This provider is synthetic and authenticates against nothing.',
  },
  unconfigured: {
    label: 'Not configured',
    detail: 'No credential is available, so this provider cannot execute.',
  },
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

export function ProviderAdministrationPanel({
  accessToken,
  capabilities,
  withReason,
  notify,
  busy,
}: Props) {
  const [summary, setSummary] = useState<AIProviderAdministrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, AIProviderCredentialRecord[]>>({});

  const canManage = hasAICapability(capabilities, 'ai.providers.manage');
  const canManageCredentials = hasAICapability(capabilities, 'ai.providers.credentials.manage');
  const canManageModels = hasAICapability(capabilities, 'ai.providers.models.manage');

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    try {
      setSummary(await fetchAIProviderAdministration(accessToken));
      setError(null);
    } catch (err) {
      // Reported IN PLACE. Provider administration has its own capabilities, so
      // "your role does not permit this" is a normal answer here and must not
      // blank the rest of the console.
      setError(
        err instanceof AIAdminError
          ? err.message
          : 'The provider administration surface is unavailable.',
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
        const records = await fetchAIProviderCredentials(accessToken, providerId);
        setHistory((current) => ({ ...current, [providerId]: records }));
      } catch {
        // A missing history is not worth an error banner: the provider card
        // above it is still accurate, and the operator asked to expand a
        // detail panel rather than to perform an action.
      }
    },
    [accessToken, history],
  );

  const run = useCallback(
    async (prompt: string, action: (reason: string) => Promise<unknown>) => {
      await withReason(prompt, action);
      setHistory({});
      await load();
    },
    [withReason, load],
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the provider estate…
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
    return <p className="text-sm text-slate-500">No AI providers are registered.</p>;
  }

  return (
    <div className="space-y-4">
      {/* ── Deployment-level facts ──────────────────────────────────────────
          Shown once, above the list, because they explain why a credential
          form further down may be absent or refuse. An operator who cannot
          store a credential should learn the reason here rather than from a
          failed submission. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Managed credential storage
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-900">
            {summary.managedCredentials.available ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Available
              </>
            ) : (
              <>
                <ShieldOff className="h-4 w-4 text-amber-600" /> Unavailable
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {summary.managedCredentials.available
              ? `Encrypted at rest${
                  summary.managedCredentials.keyId
                    ? ` under root key ${summary.managedCredentials.keyId}`
                    : ''
                }. Providers without a managed credential continue to resolve from the deployment environment.`
              : (summary.managedCredentials.blocker ??
                'Managed credentials cannot be stored in this deployment.')}
          </p>
        </div>

        {/* The governed exposure figure. It is on this page because provider
            and model administration is what moves it, and an operator enabling
            a model deserves to see the number their action changes. */}
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Worst-case request reservation
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-900">
            {summary.exposure.withinCeiling ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600" />
            )}
            {summary.exposure.maxReservationMicroUsd.toLocaleString()} µUSD (
            {formatMicroUsd(summary.exposure.maxReservationMicroUsd)})
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Highest single-request hold any governed feature can take
            {summary.exposure.maxFeatureId ? ` (${summary.exposure.maxFeatureId}` : ''}
            {summary.exposure.maxProviderId
              ? ` on ${summary.exposure.maxProviderId}/${summary.exposure.maxModelId ?? 'unknown'})`
              : summary.exposure.maxFeatureId
                ? ')'
                : ''}
            . Governed ceiling {summary.exposure.ceilingMicroUsd.toLocaleString()} µUSD.
          </p>
        </div>
      </div>

      {summary.providers.map((provider) => (
        <ProviderCard
          key={provider.providerId}
          provider={provider}
          expanded={expanded === provider.providerId}
          history={history[provider.providerId]}
          busy={busy}
          canManage={canManage}
          canManageCredentials={canManageCredentials}
          canManageModels={canManageModels}
          notify={notify}
          onExpand={() => {
            const next = expanded === provider.providerId ? null : provider.providerId;
            setExpanded(next);
            if (next) void loadHistory(provider.providerId);
          }}
          onToggleProvider={(enabled) =>
            void run(
              `${enabled ? 'Enable' : 'Disable'} the ${provider.displayName} provider. ` +
                'This changes which vendor can serve AI requests platform-wide.',
              (reason) => setAIProviderEnabled(accessToken!, provider.providerId, enabled, reason),
            )
          }
          onToggleModel={(modelId, enabled) =>
            void run(
              `${enabled ? 'Enable' : 'Disable'} ${modelId} on ${provider.displayName}. ` +
                'This changes which models the platform may select.',
              (reason) =>
                setAIProviderModelEnabled(
                  accessToken!,
                  provider.providerId,
                  modelId,
                  enabled,
                  reason,
                ),
            )
          }
          onSubmitCredential={(secret, credentialName) =>
            run(
              `Store a new credential for ${provider.displayName}. ` +
                'Any credential currently in force is superseded immediately.',
              (reason) =>
                setAIProviderCredential(
                  accessToken!,
                  provider.providerId,
                  { secret, credentialName },
                  reason,
                ),
            )
          }
          onRevokeCredential={(credentialId) =>
            void run(
              `Revoke credential ${credentialId} for ${provider.displayName}. ` +
                'This cannot be undone; restoring service requires entering a new credential.',
              (reason) =>
                revokeAIProviderCredential(accessToken!, provider.providerId, credentialId, reason),
            )
          }
        />
      ))}
    </div>
  );
}

interface CardProps {
  provider: AIProviderAdministration;
  expanded: boolean;
  history?: AIProviderCredentialRecord[];
  busy: boolean;
  canManage: boolean;
  canManageCredentials: boolean;
  canManageModels: boolean;
  notify: (message: string, kind?: 'success' | 'error') => void;
  onExpand: () => void;
  onToggleProvider: (enabled: boolean) => void;
  onToggleModel: (modelId: string, enabled: boolean) => void;
  onSubmitCredential: (secret: string, credentialName?: string) => Promise<void>;
  onRevokeCredential: (credentialId: string) => void;
}

function ProviderCard(props: CardProps) {
  const { provider } = props;
  const management = MANAGEMENT_COPY[provider.credential.management] ?? {
    label: provider.credential.management,
    detail: '',
  };

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {provider.displayName}
            <span className="text-xs font-normal text-slate-400">{provider.providerId}</span>
            <Badge text={provider.health.state} style={STATE_STYLE[provider.health.state]} />
            <Badge
              text={provider.certification}
              style={CERTIFICATION_STYLE[provider.certification]}
            />
            {provider.billable ? (
              <Badge text="billable" style="bg-amber-50 text-amber-700 border-amber-200" />
            ) : (
              <Badge text="no cost" style="bg-slate-100 text-slate-600 border-slate-200" />
            )}
          </p>

          {/* The server's own operational message. Derived there from the state
              beside it, so it cannot drift from the badges above — and never a
              vendor's error text, which can echo request content. */}
          <p className="mt-1 text-sm text-slate-600">{provider.message}</p>

          <p className="mt-1 text-xs text-slate-500">
            credential {management.label}
            {provider.credential.fingerprint ? ` · ${provider.credential.fingerprint}` : ''}
            {provider.credential.lastFour ? ` · ends ${provider.credential.lastFour}` : ''}
            {' · '}
            {provider.modelsEnabled} of {provider.modelsAvailable} models eligible
            {' · circuit '}
            {provider.health.circuit}
          </p>

          {provider.lastConfigurationChangeAt && (
            <p className="mt-1 text-xs text-slate-400">
              last configuration change {provider.lastConfigurationChangeAt}
              {provider.lastConfigurationChangeBy
                ? ` by ${provider.lastConfigurationChangeBy}`
                : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={props.onExpand}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {props.expanded ? 'Hide detail' : 'Detail'}
          </button>
          {props.canManage && (
            <button
              disabled={props.busy}
              onClick={() => props.onToggleProvider(!provider.enabled)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {provider.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
        </div>
      </div>

      {props.expanded && (
        <div className="space-y-5 border-t border-slate-200 p-4">
          {/* ── Credential ────────────────────────────────────────────────── */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <KeyRound className="h-3.5 w-3.5" /> Credential
            </h4>
            <p className="mt-1 text-sm text-slate-600">{management.detail}</p>

            {provider.credential.environmentVariable && (
              <p className="mt-1 text-xs text-slate-500">
                Deployment variable{' '}
                <code className="rounded bg-slate-100 px-1">
                  {provider.credential.environmentVariable}
                </code>
                {provider.credential.environmentCredentialPresent
                  ? ' is set for this deployment. Its value is never read or displayed here.'
                  : ' is not set for this deployment.'}
              </p>
            )}

            {provider.credential.configured && provider.credential.credentialId && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {provider.credential.credentialName ?? 'credential'}
                  </span>
                  {' · '}
                  {provider.credential.fingerprint}
                  {provider.credential.lastFour ? ` · ends ${provider.credential.lastFour}` : ''}
                  {provider.credential.rotatedAt
                    ? ` · rotated ${provider.credential.rotatedAt}`
                    : provider.credential.createdAt
                      ? ` · added ${provider.credential.createdAt}`
                      : ''}
                </div>
                {props.canManageCredentials && (
                  <button
                    disabled={props.busy}
                    onClick={() => props.onRevokeCredential(provider.credential.credentialId!)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Revoke
                  </button>
                )}
              </div>
            )}

            {/* THE FORM IS METADATA-DRIVEN. `manageable` comes from the
                adapter's descriptor, so a synthetic provider gets no form and
                this component never learns which providers are synthetic. */}
            {provider.credentialPolicy.manageable && props.canManageCredentials && (
              <CredentialForm
                provider={provider}
                busy={props.busy}
                notify={props.notify}
                onSubmit={props.onSubmitCredential}
              />
            )}

            {provider.credentialPolicy.manageable &&
              props.canManageCredentials &&
              !provider.credential.managedStorageAvailable && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  {provider.credential.managedStorageBlocker}
                </p>
              )}

            {props.history && props.history.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Credential history
                </p>
                <ul className="mt-1 space-y-1">
                  {props.history.map((record) => (
                    <li key={record.credentialId} className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{record.credentialName}</span>{' '}
                      · v{record.secretVersion} · {record.status} · {record.fingerprint}
                      {record.lastFour ? ` · ends ${record.lastFour}` : ''} · added{' '}
                      {record.createdAt}
                      {record.revokedAt ? ` · revoked ${record.revokedAt}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ── Models ────────────────────────────────────────────────────── */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Models
            </h4>
            {/* No free-text model field, anywhere. Models come from the
                provider's certified catalogue; a console that let an operator
                type a model name would be a console that could make an
                uncertified model production-eligible. */}
            <ul className="mt-2 space-y-2">
              {provider.models.map((model) => (
                <li
                  key={model.modelId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {model.runtimeEligible ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-slate-300" />
                      )}
                      {model.modelId}
                      {model.isPinnedDefault && <Badge text="pinned" />}
                      <Badge
                        text={model.certification}
                        style={CERTIFICATION_STYLE[model.certification]}
                      />
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {model.promptMicroUsdPer1k} µUSD/1k in · {model.completionMicroUsdPer1k}{' '}
                      µUSD/1k out · max {model.capabilities.maxOutputTokens.toLocaleString()} out
                      {model.capabilities.zeroDataRetention ? ' · zero data retention' : ''}
                      {model.runtimeEligible
                        ? ' · eligible'
                        : model.enabled
                          ? ' · enabled, not currently eligible'
                          : ' · disabled'}
                    </p>
                  </div>
                  {props.canManageModels && (
                    <button
                      disabled={props.busy}
                      onClick={() => props.onToggleModel(model.modelId, !model.enabled)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {model.enabled ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* ── Health ────────────────────────────────────────────────────── */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Runtime health
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              state {provider.health.state} · circuit {provider.health.circuit} ·{' '}
              {provider.health.successCount} ok · {provider.health.failureCount} failed
              {provider.health.lastLatencyMs !== undefined
                ? ` · last ${provider.health.lastLatencyMs}ms`
                : ''}
              {provider.health.lastFailureAt
                ? ` · last failure ${provider.health.lastFailureAt}`
                : ''}
              {provider.health.lastRecoveryAt
                ? ` · last recovery ${provider.health.lastRecoveryAt}`
                : ''}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              selection:{' '}
              <span className={provider.eligible ? 'text-emerald-600' : 'text-amber-700'}>
                {provider.selectionReason}
              </span>
            </p>
            {/* A health check here never calls the vendor. Everything above is
                observed from real traffic, so opening this page cannot produce
                a bill. */}
            <p className="mt-1 text-[11px] text-slate-400">
              Health is observed from served traffic. Opening this page makes no provider call.
            </p>
          </section>
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
 * Rotation and first entry are the same form, because they are the same server
 * operation. An operator rotating a key is never asked for the old one: the
 * platform cannot verify it, and asking would train people to paste live
 * credentials into fields that do nothing with them.
 */
function CredentialForm({
  provider,
  busy,
  notify,
  onSubmit,
}: {
  provider: AIProviderAdministration;
  busy: boolean;
  notify: (message: string, kind?: 'success' | 'error') => void;
  onSubmit: (secret: string, credentialName?: string) => Promise<void>;
}) {
  const [secret, setSecret] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const rotating = provider.credential.management === 'cortex_managed';

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
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-700">
        {rotating ? 'Replace the stored credential' : 'Store a managed credential'}
      </p>
      <p className="text-[11px] text-slate-500">
        {provider.credentialPolicy.credentialFormatHint ??
          'The provider credential authorising Cortex to call this vendor.'}{' '}
        It is encrypted before it is stored and can never be read back — including by you.
        {rotating ? ' The credential currently in force is superseded immediately.' : ''}
      </p>
      <input
        type="password"
        value={secret}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setSecret(event.target.value)}
        placeholder="Paste the credential"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Label (optional) — e.g. primary, rotated-2026-08"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        disabled={busy || submitting || !provider.credential.managedStorageAvailable}
        onClick={() => void submit()}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {rotating ? 'Rotate credential' : 'Store credential'}
      </button>
    </div>
  );
}

# BP-001 — Platform Authority & Action Envelope Foundation

> **DERIVED IMPLEMENTATION PACKET — DELETE AFTER VERIFIED IMPLEMENTATION**  
> This packet translates the approved Cortex Target Architecture v2.0 into a bounded coding task. It is not a source of product truth.

**Status:** Ready for Claude/Codex implementation  
**Repository:** existing `marqnetwork/marqcortex-` repository only  
**Infrastructure rule:** reuse the existing Supabase project, existing environments, existing deployment pipeline, existing secrets/configuration, and existing repository. **Do not create a new Git repository, Supabase project, deployment, hosting stack, or parallel backend.**  
**Migration rule:** replace/generalize in place. After a replacement is verified and no longer referenced, remove the superseded path.

---

## 1. Objective

Create one platform-wide authority evaluation contract that can govern consequential actions performed by:

- human users;
- service identities;
- AI executives/managers/workers;
- workflows;
- scheduled/background jobs;
- integrations/webhooks.

Canonical decision chain:

```text
Actor
→ Organization / tenant context
→ Permission
→ Policy
→ Authority envelope
→ Consequence / risk classification
→ ALLOW | DENY | REQUIRE_APPROVAL
→ Execution
→ Evidence / audit / outcome
```

This foundation must **generalize the governance already present in the AI/agent/workflow subsystems**. It must not create a second competing governance engine.

---

## 2. Existing Assets to Reuse

Do not rewrite these mechanisms unless an exact incompatibility is demonstrated:

- Supabase/Postgres tenancy and RLS;
- current authentication and organization membership checks;
- existing AI Control Plane;
- existing agent runtime;
- existing agent approval machinery under `supabase/functions/server/ai/agents/approvals/**`;
- existing AI governance under `supabase/functions/server/ai/governance/**`;
- workflow approval/state machinery;
- current audit/observability mechanisms;
- current AI budget/spend controls;
- provider credential/security mechanisms.

The new platform authority service sits **above/generalizes** these components and provides a common contract they can progressively consume.

---

## 3. Hard Infrastructure Constraints

For BP-001:

1. **No new Git repository.**
2. **No new Supabase project.**
3. **No new production/preview deployment stack.**
4. **No new external infrastructure vendor.**
5. **No replacement authentication system.**
6. **No replacement AI Control Plane.**
7. **No destructive database migration.**
8. Any database change must be an additive migration in the existing Supabase migration chain.
9. Do not change working product behavior except where required to route a deliberately selected pilot action through the new authority evaluator.
10. Do not deploy as part of this packet unless explicitly instructed later.

If implementation appears to require violating any rule above, stop and report the blocker instead of creating new infrastructure.

---

## 4. Required Platform Contracts

Implement a shared platform-level contract equivalent to the following concepts. Names may follow existing repository conventions, but the semantics are mandatory.

### 4.1 Actor Context

```text
actor_id
actor_type: human | service | ai_agent | workflow | job | integration
organization_id
membership / role context
source / session / run identifiers where applicable
```

### 4.2 Action Request

```text
action_id / correlation_id
action_type
resource_type
resource_id (optional)
organization_id
actor
requested_effect
input/data classification metadata
requested tool/capability (optional)
budget/cost metadata (optional)
context / trace identifiers
```

### 4.3 Authority Envelope

An authority envelope defines what an actor may do autonomously within explicit boundaries.

Minimum supported boundary classes:

- action/capability scope;
- resource/entity scope;
- organization/workspace scope;
- tool scope;
- data scope/classification;
- financial/cost limit where applicable;
- consequence/risk ceiling;
- approval threshold;
- time/status validity;
- explicit deny rules.

### 4.4 Consequence Classification

Use a small, deterministic platform classification. Prefer a clear enum such as:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Do not let an LLM decide the final enforcement result. AI may recommend a classification later, but the enforced result must be deterministic from persisted rules/context.

### 4.5 Authority Decision

The evaluator returns exactly one of:

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

Return structured reason codes and evidence, not only human-readable text.

Suggested output semantics:

```text
decision
reason_codes[]
matched_permissions[]
matched_policies[]
matched_authority_envelope
consequence_level
approval_requirement (if any)
trace_id
```

---

## 5. Evaluation Order

Enforce a predictable order:

1. validate organization/tenant context;
2. validate actor identity/context;
3. verify base permission;
4. evaluate explicit deny rules;
5. evaluate policy constraints;
6. evaluate authority envelope;
7. evaluate data/tool/budget restrictions;
8. classify consequence/risk;
9. return `ALLOW`, `DENY`, or `REQUIRE_APPROVAL`;
10. emit audit evidence for the decision.

**Fail closed** if required authorization context is absent or inconsistent.

---

## 6. Persistence

Postgres remains authoritative.

Prefer additive tables only if existing tables cannot represent the required concepts. The implementation should first inspect current policy/RBAC/approval/audit schemas and reuse them where sensible.

If new persistence is required, the minimum likely additions are versioned records for:

- authority envelopes;
- authority-envelope assignments;
- platform policy/action definitions only where no equivalent already exists;
- authority decision audit references where current audit records cannot carry the required structured fields.

Every authoritative row must include or derive `organization_id` and must be protected by RLS/tenant controls consistent with current repository standards.

Do **not** create a second user/role/membership system.

---

## 7. Integration Strategy

BP-001 is a foundation packet, not a big-bang migration.

Implement the shared evaluator, then integrate **one safe pilot path** to prove it works end-to-end. Prefer a low-risk existing agent/workflow action that already has approval/RBAC checks.

For that pilot:

```text
existing caller
→ shared authority evaluator
→ ALLOW / DENY / REQUIRE_APPROVAL
→ reuse existing approval flow when approval is required
→ execute existing behavior
→ existing + structured audit
```

Do not migrate every endpoint in BP-001.

Existing AI-specific checks may remain temporarily behind adapters, but the direction must be toward one shared platform contract.

---

## 8. Suggested Code Shape

Follow current project conventions after inspecting the repository. A reasonable target is a platform-level module outside the AI-only namespace, for example:

```text
supabase/functions/server/platform/authority/
  contracts.ts
  consequence.ts
  evaluator.ts
  policyAdapter.ts
  auditAdapter.ts
  approvalAdapter.ts
  index.ts
  __tests__/
```

This is a **shape, not permission to duplicate existing implementations**. If equivalent platform folders/contracts already exist, extend them instead.

AI/agent code should consume this module through adapters rather than moving all AI code into the new folder.

---

## 9. Security Requirements

Mandatory:

- deny by default;
- organization/tenant isolation;
- server-side enforcement only for authoritative decisions;
- no client-provided role/authority accepted as truth;
- no reusable connector/provider credentials exposed to actors;
- deterministic final enforcement;
- tamper-evident/structured audit trail using existing audit architecture;
- explicit approval requirements for actions outside an envelope;
- existing RLS preserved and extended to new authoritative tables;
- cross-tenant negative tests;
- no privilege broadening during adapter/fallback paths.

---

## 10. Tests Required

At minimum:

1. human actor allowed inside role + authority envelope;
2. human actor denied without organization membership;
3. AI agent allowed inside assigned envelope;
4. AI agent requires approval when consequence exceeds envelope;
5. workflow actor cannot inherit the initiating human's unrestricted privileges automatically;
6. service/integration actor has explicit bounded permissions;
7. explicit deny beats allow;
8. missing authorization context fails closed;
9. cross-tenant resource access denied;
10. budget/tool/data restriction can force deny or approval;
11. approval path reuses current approval machinery;
12. authority decision produces traceable structured audit evidence;
13. current pilot behavior still works when the evaluator returns `ALLOW`;
14. current tests for AI governance/agents/workflows remain passing.

---

## 11. Non-Goals

Do **not** build in BP-001:

- new Cortex UI/navigation;
- self-forming departments;
- dynamic agent spawning;
- Knowledge Graph;
- enterprise memory/dreaming;
- email/social/telephony connectors;
- Tool Gateway;
- durable scheduler/event bus;
- autonomous sales engine;
- billing/entitlements;
- investment execution;
- new AI providers;
- new infrastructure/deployment.

Those depend on this foundation and belong in later packets.

---

## 12. Acceptance Gate

BP-001 is complete only when all are true:

- shared platform authority contracts exist;
- `ALLOW | DENY | REQUIRE_APPROVAL` is deterministic and tested;
- tenant isolation is preserved;
- existing approval machinery is reused, not duplicated;
- structured authority decisions are auditable;
- one existing low-risk action is integrated end-to-end;
- no current behavior regresses outside the selected pilot;
- no new repository/Supabase/deployment was created;
- tests pass;
- implementation notes identify any temporary adapter that should later be removed;
- obsolete code created unnecessary by this packet is deleted after verification.

---

## 13. Required Implementation Report

Claude/Codex must return a short report containing:

```text
A. Files changed
B. Database migrations added (if any)
C. Existing mechanisms reused
D. Pilot action integrated
E. Tests run + results
F. Security/RLS verification
G. Temporary compatibility adapters remaining
H. Obsolete files/code removed
I. Blockers / follow-up work
```

Do not claim completion without actual test evidence.

---

## 14. Cleanup Rule

After BP-001 implementation is verified and its architectural decisions are absorbed into the active system map/architecture documentation:

- delete this build packet;
- delete superseded temporary implementation notes;
- remove compatibility adapters once no callers depend on them;
- regenerate/update only the minimal authoritative current-state documentation.

The repository should become **cleaner after implementation, not larger with permanent process artifacts**.

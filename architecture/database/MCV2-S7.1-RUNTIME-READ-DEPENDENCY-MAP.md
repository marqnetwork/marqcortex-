# MCV2-S7.1 — Runtime Read/Write Dependency Map (Diagnostic Domain)

**Sprint:** `MCV2-S7.1-PLAN-006`
**Status:** Audit only — no runtime code changed. KV remains authoritative.
**Source of truth:** Direct reads of `supabase/functions/server/index.tsx` (3705 lines), `kv_store.tsx`, `repositories/*.ts`, `src/app/services/dataService.ts`.
**Evidence tag:** PROVEN (file reads, no inference) unless marked otherwise.

---

## 1. Storage primitives

| Layer | File | Access | Authority |
|-------|------|--------|-----------|
| KV helper | `supabase/functions/server/kv_store.tsx` | `service_role` only | **Authoritative** |
| KV table | `kv_store_324f4fbe (key TEXT PK, value JSONB)` | via helper | Runtime source of truth |
| SQL repositories | `supabase/functions/server/repositories/*.ts` | `service_role` (`repositoryClient.ts`) | **Exists, NOT wired to any route** |
| Frontend gateway | `src/app/services/dataService.ts` | demo or `api.ts` | Article 3 boundary |

KV helper surface: `get`, `set`, `del`, `mget`, `mset`, `mdel`, `getByPrefix`. All diagnostic runtime reads/writes flow through these seven functions inside `index.tsx` route handlers.

---

## 2. KV key namespace (diagnostic domain, observed)

| KV key pattern | Entity | Written by | Read by | SQL target table |
|----------------|--------|-----------|---------|------------------|
| `lead:{id}` | Lead | `POST /leads/capture`, `POST /leads/exit-intent` | (none at runtime; analytics none) | `leads` |
| `lead_email:{email}` | Lead email index | same | `POST /leads/exit-intent` (dedupe) | `leads.email` (unique/org) |
| `sub:{id}` | Submission (JSON blob) | `POST /submissions`, status/bulk/analyze/outcome/message updates | many (see §3) | `submissions` + `diagnostic_answers` + `diagnostic_scores` |
| `sub_email:{email}` | Submission email index | `POST /submissions` | `POST /auth/client/verify` | `submissions.contact_email` |
| `cortex:{submissionId}` | AI analysis / scores | `POST /submissions/:id/analyze`, `analyze-batch` | report build, outcome, cortex GET, learning-loop | `diagnostic_scores` + `domain_scores` |
| `outcome:{submissionId}` | Outcome | `POST /submissions/:id/outcome` | outcome GET, `cortex/outcomes`, learning-loop | `outcomes` |
| `proposal:{submissionId}` | Proposal | proposal save/send/respond | proposal GET (team + client) | *(Sprint 3 domain — out of S7 scope)* |
| `note:{submissionId}:{noteId}` | Submission note | notes POST/DELETE | notes GET, analytics | *(no table in S5 slice)* |
| `msg:{submissionId}:{msgId}` | Message | messages POST (team/client) | messages GET | *(Sprint 3 domain)* |
| `notif:{ts}-{rand}` | Notification | `storeNotification` | notifications GET | *(no table)* |
| `client_session:{token}` | Client session | `POST /auth/client/verify` | `requireClientAccess` | *(Sprint 3 domain)* |
| `eng_log:{id}` | Engagement log | engagement POST | engagement/summary/analytics | *(no table)* |
| `settings:platform` | Platform settings | settings PATCH | settings GET, email prefs | *(no table)* |

**Report note (critical):** there is **no `report:` KV key**. The client report is **computed on demand** by `buildAIClientReport(sub, ai)` from `sub:{id}` + `cortex:{submissionId}` (`index.tsx:2609–2634`, `2636+`). The `reports` / `report_versions` SQL tables therefore have **no 1:1 KV source** — a dual-read for reports compares a *stored* SQL report against a *derived* value. This is the single highest normalization risk in the domain. Tagged **LIKELY** high-risk.

---

## 3. Access-path table (route → storage)

Legend — **Src**: KV = KV read/write. **RW**: R/W. **Auth**: `team` = `verifyTeamToken`, `client` = `requireClientAccess` (session token OR email match), `public` = none. **SQL repo?**: does a repository method already exist. **S7 treatment**: recommended read mode for S7.2 shadow work.

| Route (`/make-server-324f4fbe/…`) | Caller (dataService) | RW | Entity | Src | Response shape | Fallback today | Auth | SQL repo? | Migration risk | S7 treatment |
|---|---|---|---|---|---|---|---|---|---|---|
| `GET /diagnostic` | (config load) | R | question config | none/KV `settings:platform` | `{questions,…}` | static | public | n/a | none | out of scope |
| `POST /leads/capture` | `saveLead` | W | Lead | KV `lead:`,`lead_email:` | `{success,leadId}` | 500 on err | public | `createLead`,`lookupLeadByEmail` | low (backfilled S6.2) | **write-boundary doc only** |
| `POST /leads/exit-intent` | `saveExitIntentLead` | W+R | Lead | KV `lead_email:` read then `lead:` write | `{success,leadId}` | 500 | public | same | low | write-boundary doc only |
| `POST /submissions` | `createSubmission` | W | Submission | KV `sub:`,`sub_email:` | `{success,submissionId}` | 500 | public | `createSubmission`,`upsertAnswer`,`upsertDiagnosticScore` | **high** (core entity) | write-boundary doc only |
| `GET /submissions` | `getSubmissions` | R | Submission list | KV `getByPrefix('sub:')` | `{success,submissions[]}` | `[]` on empty | team | `listSubmissions` | **high** (list ordering/paging) | **Mode B shadow** (entity #2) |
| `GET /submissions/:id` | `getSubmission` | R | Submission | KV `sub:{id}` | `{success,submission}` | 404 | team | `getSubmissionById` | high | **Mode B shadow** |
| `PATCH /submissions/:id/status` | `updateSubmissionStatus` | RW | Submission | KV `sub:` read+write | `{success,submission}` | 404 | team | `updateSubmission` | high | write-boundary doc only |
| `PATCH /submissions/bulk` | `bulkUpdateSubmissions` | RW | Submission | KV per-id read+write | `{success,updated[]}` | skip missing | team | `updateSubmission` | high | write-boundary doc only |
| `GET /client/submission/:id` | `getClientSubmission` | R | Submission | KV `sub:{id}` | `{success,submission}` | 404 | client | `getSubmissionById` | **high (client isolation)** | **Mode B shadow** (guarded) |
| `POST /client/submission/:id/engagement` | `trackEngagement` | RW | Submission+log | KV `sub:`,`eng_log:` | `{success}` | 404 | client | n/a | med | none |
| `GET /client/submission/:id/engagement/log` | `getEngagementLog` | R | eng log | KV `eng_log:` | `{success,log[]}` | `[]` | client | n/a | low | none |
| `GET /cortex/engagement-summary` | `getEngagementSummary` | R | eng logs | KV `getByPrefix` | `{success,…}` | `[]` | team | n/a | low | none |
| `GET /analytics/overview` | `getAnalytics` | R | subs+proposals | KV `getByPrefix('sub:'),('proposal:')` | `{success,…}` | zeros | team | `listSubmissions` | med (aggregate) | later (aggregate mode) |
| `GET /analytics/engagement` | `getEngagementAnalytics` | R | subs+notes | KV `getByPrefix` | `{success,…}` | zeros | team | n/a | low | later |
| `GET /notifications` | `getNotifications` | R | notif | KV `getByPrefix('notif:')` | `{success,notifications[]}` | `[]` | team | n/a | low | none |
| `POST /notifications/read` | `markNotificationsRead` | W | last-read marker | KV `notifs_last_read_at` | `{success}` | — | team | n/a | low | none |
| `GET /submissions/:id/notes` | `getNotes` | R | notes | KV `getByPrefix('note:{id}:')` | `{success,notes[]}` | `[]` | team | n/a | low | none |
| `POST /submissions/:id/notes` | `addNote` | W | note | KV `note:` | `{success,note}` | — | team | n/a | low | none |
| `DELETE /submissions/:id/notes/:noteId` | `deleteNote` | W | note | KV `del note:` | `{success}` | — | team | n/a | low | none |
| `GET /submissions/:id/messages/team` | `getTeamMessages` | R | msg | KV `getByPrefix('msg:')` | `{success,messages[]}` | `[]` | team | n/a | med (Sprint 3) | none |
| `POST /submissions/:id/messages/team` | `postTeamReply` | W | msg | KV `msg:` | `{success,message}` | — | team | n/a | med | none |
| `GET /submissions/:id/messages` | `getClientMessages` | R | msg | KV `getByPrefix('msg:')` | `{success,messages[]}` | `[]` | client | n/a | med | none |
| `POST /submissions/:id/messages` | `postClientMessage` | W | msg | KV `msg:`,`sub:` | `{success,message}` | 404 | client | n/a | med | none |
| `GET /submissions/:id/proposal` | `getProposal` | R | proposal | KV `proposal:` | `{success,proposal}` | null | team | n/a (Sprint 3) | high | none (Sprint 3) |
| `POST /submissions/:id/proposal` | `saveProposal` | RW | proposal | KV `proposal:` | `{success}` | — | team | n/a | high | none |
| `POST /submissions/:id/proposal/send` | `sendProposal` | RW | proposal+sub | KV `proposal:`,`sub:` | `{success}` | — | team | n/a | high | none |
| `GET /client/submission/:id/proposal` | `getClientProposal` | R | proposal | KV `sub:`,`proposal:` | `{success,proposal}` | 404 | client | n/a | high (isolation) | none |
| `POST /client/submission/:id/proposal/respond` | `respondToProposal` | RW | proposal+sub | KV `proposal:`,`sub:` | `{success}` | 404 | client | n/a | high | none |
| `GET /client/submission/:id/report` | `getClientReport` | R | **derived report** | KV `sub:`+`cortex:` → compute | `{success,report,aiPowered}` | `report:null` | client | `getReportBySubmission` | **high (derived)** | **Mode B shadow** (report normalization pilot) |
| `POST /submissions/analyze-batch` | `analyzeSubmissionsBatch` | RW | cortex+sub | KV `sub:`,`cortex:` | `{success,…}` | per-item | team | `upsert*Score` | high | write-boundary doc only |
| `POST /submissions/:id/analyze` | `analyzeSubmission` | RW | cortex+sub | KV `sub:`,`cortex:` | `{success,analysis}` | 404 | team | `upsert*Score` | high | write-boundary doc only |
| `GET /submissions/:id/cortex` | `getCortexAnalysis` | R | cortex | KV `cortex:` | `{success,analysis}` | null | team | `listDomainScores` | high | **Mode B shadow** |
| `DELETE /submissions/:id/cortex` | (reset) | W | cortex | KV `del cortex:` | `{success}` | — | team | n/a | high | none |
| `POST /submissions/:id/outcome` | (save outcome) | RW | outcome+sub | KV `outcome:`,`sub:` | `{success}` | — | team | `createOutcome`,`updateOutcome` | med | write-boundary doc only |
| `GET /submissions/:id/outcome` | (get outcome) | R | outcome | KV `outcome:` | `{success,outcome}` | null | team | `getOutcomeBySubmission` | med | **Mode B shadow** (low-risk pilot) |
| `GET /cortex/outcomes` | (list) | R | outcome list | KV `getByPrefix('outcome:')` | `{success,outcomes[]}` | `[]` | team | `listOutcomes` | med | later |
| `GET /cortex/learning-loop` | (analytics) | R | outcome+cortex | KV `getByPrefix` | `{success,…}` | `[]` | team | multiple | med | later |
| `GET /cortex/status` | `getCortexStatus` | R | cortex list | KV `getByPrefix('cortex:')` | `{success,…}` | `[]` | team | n/a | med | later |
| `GET /settings`, `PATCH /settings` | `getPlatformSettings`,`save…` | RW | settings | KV `settings:platform` | `{success,settings}` | defaults | team | n/a | low | none |

Auth/pipeline/email/annotation routes (`/cortex/pipeline-positions`, `/cortex/column-capacities`, `/proposal/annotations/*`, `/email-queue/*`, `/email/*`, `/team/*`, AI routes `/ai/chat`, `/cortex/narrative`, `/blocks/*`) are **out of diagnostic S7 scope** — they belong to Sprint 3/5 domains or the already-migrated Intelligence Gateway. Listed here for completeness only; **not** targeted for shadow reads in S7.2.

---

## 4. Diagnostic read entities eligible for S7.2 shadow reads

Ordered by ascending risk (rollout order):

1. **Outcome** (`GET /submissions/:id/outcome`) — 1:1 mapping, `getOutcomeBySubmission` exists, team-only, low blast radius. **First pilot.**
2. **Submission single** (`GET /submissions/:id`, `GET /client/submission/:id`) — core, `getSubmissionById` exists. Client path guarded separately (tenant isolation).
3. **Submission list** (`GET /submissions`) — ordering/pagination normalization risk.
4. **Cortex/scores** (`GET /submissions/:id/cortex`) — score-row reassembly from `diagnostic_scores`+`domain_scores`.
5. **Report** (`GET /client/submission/:id/report`) — derived value; normalization pilot, last.

Everything else = **KV-only (Mode A)** for the entirety of S7.

---

## 5. Auth / tenant context per path

| Path class | Actor | Token check | Org scope today | Org scope required for SQL |
|---|---|---|---|---|
| Public capture/submit | anon | none | implicit default org `marq` | inject `organization_id = <default_org>` server-side |
| Team reads | team user | `verifyTeamToken` (Supabase Auth) | none in KV (single-tenant blob) | resolve org via `organization_memberships` before repo call |
| Client reads | client | `requireClientAccess` (session token OR `?email=` match) | `submissionId`-bound | repo call MUST bind both `submission_id` AND `organization_id`; email-fallback path must not widen scope |

**Finding (SUSPECTED, security):** KV is effectively single-tenant (default `marq` org). Introducing SQL reads adds `organization_id` as a new required filter. Any shadow read that omits org scoping, or derives it from client-supplied input, is a tenant-isolation defect. This is the primary reason the security review (Stage 13) fails-closed on tenant errors rather than falling back.

---

## 6. Dependency map (route → storage), compact graph

```
Frontend component
  └─ dataService.ts (Article 3 boundary — unchanged in S7)
       └─ api.ts (HTTP)  ── OR ──  demoData (isDemo)
            └─ Edge Hono route (index.tsx)
                 └─ [S7.2 target] DiagnosticStorageGateway
                      ├─ KV adapter  → kv_store.tsx → kv_store_324f4fbe   (AUTHORITATIVE)
                      └─ SQL adapter → repositories/*.ts → cortex.* tables (SHADOW ONLY)
```

Today the "DiagnosticStorageGateway" node does **not exist**; routes call `kv.*` directly. S7.2 inserts exactly one node between the route handler and the two adapters. No route signature, response envelope, or `dataService`/`api.ts` surface changes.

---

*End of dependency map. No runtime files were modified producing this document.*

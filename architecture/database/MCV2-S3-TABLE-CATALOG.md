# MCV2-S3 — Table Catalog

**Sprint:** `MCV2-S3-DATABASE-ARCHITECTURE`  
**Total proposed tables:** 88  
**Domains:** 12 (A–L)

Legend: **Org-owned** = requires `organization_id`. **RLS** = `tenant` | `client-scoped` | `admin-only` | `platform` | `public-insert`.

---

## Domain A — Identity and tenancy (9 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `organizations` | Platform tenants | No | Root | Medium | tenant | Low | **1 ✓** |
| `organization_profiles` | Branding, region, billing | Yes | organizations | Medium | tenant | Low | 1 (deferred) |
| `memberships` | User ↔ org ↔ role | Yes | auth.users, roles | High | tenant | Low | **1 ✓** (`organization_memberships`) |
| `roles` | Role definitions | Yes | organizations | High | tenant | Low | **1 ✓** |
| `permissions` | Permission catalog | No | — | Low | platform | Low | **1 ✓** |
| `role_permissions` | Role ↔ permission | Yes | roles, permissions | High | tenant | Low | **1 ✓** |
| `invitations` | Pending invites | Yes | organizations | High | tenant | Low | 1 (deferred) |
| `client_sessions` | Portal session tokens | Yes | submissions | High | client-scoped | Medium | 3 |
| `service_accounts` | Automation identities | Yes | organizations | High | admin-only | Low | 1 |

---

## Domain B — Organizational structure (8 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `executives` | Leadership roster | Yes | organizations | Medium | tenant | Low | 6 |
| `departments` | Org units | Yes | organizations | Medium | tenant | Low | 6 |
| `workers` | AI/human workers | Yes | departments | Medium | tenant | Low | 6 |
| `worker_roles` | Worker role types | Yes | organizations | Low | tenant | Low | 6 |
| `capabilities` | Skill catalog | Yes | organizations | Low | tenant | Low | 6 |
| `department_memberships` | Worker ↔ dept | Yes | workers, departments | Medium | tenant | Low | 6 |
| `reporting_lines` | Hierarchy | Yes | workers | Medium | tenant | Low | 6 |
| `approval_policies` | Approval rules | Yes | organizations | High | admin-only | Low | 6 |

---

## Domain C — Objectives and work (10 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `objectives` | Strategic objectives | Yes | organizations | Medium | tenant | Low | 6 |
| `key_results` | OKR key results | Yes | objectives | Medium | tenant | Low | 6 |
| `projects` | Delivery projects | Yes | objectives, submissions | Medium | tenant | Medium | 6 |
| `workstreams` | Project streams | Yes | projects | Medium | tenant | Medium | 6 |
| `tasks` | Actionable tasks | Yes | workstreams | Medium | tenant | High | 6 |
| `task_dependencies` | Task graph | Yes | tasks | Low | tenant | Medium | 6 |
| `assignments` | Task ↔ worker/user | Yes | tasks, workers | Medium | tenant | High | 6 |
| `execution_runs` | Autonomous runs | Yes | projects | High | admin-only | Medium | 12 |
| `execution_events` | Run event log | Yes | execution_runs | High | admin-only | High | 12 |
| `milestones` | Delivery milestones | Yes | projects | Medium | tenant | Medium | 4 |

---

## Domain D — Cortex diagnostic core (12 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `diagnostic_leads` | Funnel leads | Yes | — | Medium | public-insert + tenant | Medium | **2 ✓** (`leads`) |
| `contacts` | Normalized contacts | Yes | accounts | High | tenant | Medium | **2 ✓** |
| `submissions` | Diagnostic submissions | Yes | diagnostic_leads, contacts | High | tenant + client | High | **2 ✓** |
| `diagnostic_answers` | Per-question answers | Yes | submissions | High | tenant + client | High | **2 ✓** |
| `diagnostic_scores` | Computed scores | Yes | submissions | Medium | tenant | High | **2 ✓** |
| `domain_scores` | Dimension scores | Yes | submissions | Medium | tenant | High | **2 ✓** |
| `recommendations` | Engine recommendations | Yes | submissions | Medium | tenant | Medium | 2 |
| `portfolios` | Solution portfolios | Yes | submissions | Medium | tenant | Medium | 2 |
| `portfolio_versions` | Immutable portfolio | Yes | portfolios | Medium | tenant | Medium | 2 |
| `reports` | Client reports | Yes | submissions | High | client-scoped | Medium | **2 ✓** (S5 foundation) |
| `report_versions` | Report snapshots | Yes | reports | High | client-scoped | Medium | **2 ✓** (S5 foundation) |
| `outcomes` | Post-engagement outcomes | Yes | submissions | Medium | tenant | Low | **2 ✓** (S5 foundation) |

---

## Domain E — Proposal and commercial (8 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `proposals` | Proposal header | Yes | submissions | High | tenant + client | Medium | 3 |
| `proposal_versions` | Immutable versions | Yes | proposals | High | tenant + client | Medium | 3 |
| `proposal_blocks` | Structured blocks | Yes | proposal_versions | Medium | tenant | Medium | 3 |
| `proposal_annotations` | Client annotations | Yes | proposals | Medium | client-scoped | Low | 3 |
| `proposal_gates` | Gate engine state | Yes | proposals | Medium | tenant | Low | 3 |
| `contracts` | Executed contracts | Yes | proposals | High | admin-only | Low | 9 |
| `signatures` | E-sign records | Yes | contracts | High | admin-only | Low | 9 |
| `scope_baselines` | Locked scope | Yes | proposals | Medium | tenant | Low | 3 |

---

## Domain F — ROI and delivery (9 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `roi_models` | ROI model per submission | Yes | submissions | Medium | tenant | Medium | 4 |
| `roi_assumptions` | Editable assumptions | Yes | roi_models | Medium | tenant | Medium | 4 |
| `roi_scenarios` | Scenario runs | Yes | roi_models | Medium | tenant | Medium | 4 |
| `roi_baselines` | Locked baselines | Yes | roi_models | Medium | tenant | Low | 4 |
| `roi_actuals` | Tracked actuals | Yes | roi_models | Medium | tenant | Medium | 4 |
| `roi_variances` | Baseline vs actual | Yes | roi_models | Medium | tenant | Medium | 4 |
| `execution_blueprints` | Delivery blueprint | Yes | submissions | Medium | tenant | Low | 4 |
| `governance_gates` | Gate checkpoints | Yes | execution_blueprints | Medium | tenant | Low | 4 |
| `qbr_reports` | Quarterly reviews | Yes | accounts | Medium | tenant | Low | 4 |

---

## Domain G — Revenue and CRM (8 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `accounts` | CRM accounts | Yes | organizations | High | tenant | Medium | 9 |
| `crm_contacts` | CRM contacts | Yes | accounts | High | tenant | Medium | 9 |
| `opportunities` | Pipeline deals | Yes | accounts, submissions | High | tenant | Medium | 9 |
| `pipeline_stages` | Stage definitions | Yes | organizations | Low | tenant | Low | 9 |
| `activities` | CRM activity log | Yes | opportunities | Medium | tenant | High | 9 |
| `meetings` | Scheduled meetings | Yes | opportunities, submissions | Medium | tenant + client | Medium | 9 |
| `sales_calls` | Call records | Yes | opportunities | High | tenant | Medium | 9 |
| `win_loss_records` | Win/loss analysis | Yes | opportunities | Medium | tenant | Low | 9 |

---

## Domain H — Marketing and content (6 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `brands` | Brand entities | Yes | organizations | Low | tenant | Low | 10 |
| `campaigns` | Marketing campaigns | Yes | brands | Medium | tenant | Low | 10 |
| `content_items` | Content assets | Yes | campaigns | Medium | tenant | Medium | 10 |
| `content_performance` | Metrics | Yes | content_items | Low | tenant | Medium | 10 |
| `publishing_jobs` | Publish queue | Yes | content_items | Low | tenant | Low | 10 |
| `content_approvals` | Approval workflow | Yes | content_items | Medium | tenant | Low | 10 |

---

## Domain I — Outreach (6 tables) — design only

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `prospects` | Outreach targets | Yes | accounts | High | admin-only | High | 10 |
| `outreach_sequences` | Sequence definitions | Yes | organizations | Medium | admin-only | Low | 10 |
| `outreach_steps` | Sequence steps | Yes | outreach_sequences | Medium | admin-only | Low | 10 |
| `outreach_messages` | Sent messages | Yes | prospects | High | admin-only | High | 10 |
| `consent_records` | GDPR/consent | Yes | prospects | High | admin-only | Medium | 10 |
| `suppression_lists` | Opt-out list | Yes | organizations | High | admin-only | Medium | 10 |

---

## Domain J — Knowledge and memory (10 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `knowledge_spaces` | Knowledge containers | Yes | organizations | High | tenant | Low | 7 |
| `knowledge_sources` | Source registry | Yes | knowledge_spaces | Medium | tenant | Low | 7 |
| `documents` | Document metadata | Yes | knowledge_spaces | High | tenant | Medium | 7 |
| `document_versions` | Version history | Yes | documents | High | tenant | Medium | 7 |
| `document_chunks` | Parsed chunks | Yes | document_versions | Medium | tenant | High | 8 |
| `embeddings` | Vector embeddings | Yes | document_chunks | Medium | tenant | High | 8 |
| `retrieval_indexes` | Index metadata | Yes | knowledge_spaces | Low | tenant | Low | 8 |
| `sops` | Standard procedures | Yes | knowledge_spaces | Medium | tenant | Low | 7 |
| `decision_records` | Org decisions | Yes | deliberation_sessions | Medium | tenant | Low | 7 |
| `knowledge_permissions` | Space ACLs | Yes | knowledge_spaces | High | tenant | Low | 7 |

---

## Domain K — AI platform (9 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `ai_providers` | Provider registry | No | — | Low | platform | Low | 5 |
| `ai_models` | Model registry | No | ai_providers | Low | platform | Low | 5 |
| `intelligence_requests` | Request log | Yes | organizations | High | admin-only | High | 5 |
| `model_attempts` | Per-attempt detail | Yes | intelligence_requests | High | admin-only | High | 5 |
| `intelligence_responses` | Response metadata | Yes | intelligence_requests | High | admin-only | Medium | 5 |
| `usage_records` | Usage rollup | Yes | organizations | Medium | tenant | High | 5 |
| `cost_records` | Cost rollup | Yes | usage_records | Medium | admin-only | High | 5 |
| `deliberation_sessions` | Multi-model sessions | Yes | organizations | High | tenant | Low | 11 |
| `deliberation_candidates` | Anonymous candidates | Yes | deliberation_sessions | Medium | tenant | Low | 11 |

---

## Domain L — Communication and audit (13 tables)

| Table | Purpose | Org-owned | Key relationships | Sensitivity | RLS | Volume | Sprint |
|-------|---------|-----------|-------------------|-------------|-----|--------|--------|
| `notifications` | Team notifications | Yes | submissions | Low | tenant | High | 2 |
| `notification_read_states` | Read watermarks | Yes | memberships | Low | tenant | Low | 2 |
| `conversations` | Message threads | Yes | submissions | Medium | tenant + client | Medium | 3 |
| `conversation_participants` | Participants | Yes | conversations | Medium | tenant + client | Medium | 3 |
| `messages` | Messages | Yes | conversations, submissions | Medium | tenant + client | High | 3 |
| `message_attachments` | Attachments | Yes | messages | Medium | tenant | Low | 3 |
| `engagement_events` | Client engagement | Yes | submissions | Low | tenant + client | High | 3 |
| `submission_notes` | Team notes | Yes | submissions | Medium | tenant | Medium | 2 |
| `email_queue_items` | Email queue | Yes | submissions | Medium | admin-only | Medium | 3 |
| `pipeline_positions` | Kanban positions | Yes | submissions | Low | tenant | Medium | 2 |
| `pipeline_column_settings` | WIP limits | Yes | organizations | Low | tenant | Low | 2 |
| `organization_settings` | Platform settings | Yes | organizations | High | admin-only | Low | **1 ✓** |
| `audit_events` | Append-only audit | Yes | — | High | admin-only | Very High | 11 |

### Supporting infrastructure tables (included in L count above)

Also planned: `idempotency_keys`, `scheduled_jobs`, `job_attempts`, `webhooks`, `integration_events`, `dead_letter_events` — ship with Sprint 11 audit hardening.

---

## KV entities without dedicated table (resolved)

| KV entity | Resolution |
|-----------|------------|
| `sub_email:*` | Unique index on `submissions.contact_email` |
| `lead_email:*` | Unique index on `diagnostic_leads.email` |
| `msg_read:*` | `conversation_participants.last_read_at` |
| `notifs_last_read_at` | `notification_read_states` |
| `team:member:*` | Deprecated — `memberships` + Auth |
| `eng:` (unused) | Use `engagement_events` only |
| `notification:` prefix | Normalize to `notifications` on migration |

---

## Audit requirements (high-risk tables)

Requires `audit_events` on INSERT/UPDATE/DELETE:

`submissions`, `proposals`, `proposal_versions`, `contracts`, `memberships`, `organization_settings`, `client_sessions`, `intelligence_requests`, `knowledge_permissions`, `roi_baselines`, `outreach_messages`, `consent_records`

---

*End of Table Catalog — 88 tables*

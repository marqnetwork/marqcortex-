# MCV2-S3 — Entity Relationship Diagrams

**Sprint:** `MCV2-S3-DATABASE-ARCHITECTURE`  
**Format:** Mermaid ER diagrams split by bounded domain  
**Note:** Diagrams show logical model; not all tables ship in Sprint 1.

---

## Diagram 1 — Identity, tenancy, and auth

```mermaid
erDiagram
    organizations ||--o{ organization_profiles : has
    organizations ||--o{ memberships : has
    organizations ||--o{ organization_settings : has
    organizations ||--o{ invitations : sends
    auth_users ||--o{ memberships : belongs
    memberships }o--|| roles : has
    roles ||--o{ role_permissions : grants
    permissions ||--o{ role_permissions : in
    organizations ||--o{ client_sessions : scopes
    client_sessions }o--|| submissions : grants_access
    organizations ||--o{ service_accounts : owns

    organizations {
        uuid id PK
        text slug UK
        text name
        timestamptz created_at
    }
    memberships {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        uuid role_id FK
        text status
    }
    client_sessions {
        uuid id PK
        uuid organization_id FK
        uuid submission_id FK
        text token_hash UK
        timestamptz expires_at
    }
```

---

## Diagram 2 — Diagnostic core (KV migration priority)

```mermaid
erDiagram
    organizations ||--o{ diagnostic_leads : owns
    organizations ||--o{ submissions : owns
    diagnostic_leads ||--o| submissions : converts_to
    submissions ||--o{ diagnostic_answers : contains
    submissions ||--o{ submission_notes : has
    submissions ||--o| cortex_analyses : analyzed_by
    submissions ||--o| outcomes : tracks
    submissions ||--o{ engagement_events : logs
    submissions ||--o{ reports : generates
    submissions ||--o| proposals : has
    submissions ||--o{ messages : threads
    accounts ||--o{ submissions : links
    submissions ||--o{ pipeline_positions : on_board

    diagnostic_leads {
        uuid id PK
        uuid organization_id FK
        text email
        text capture_source
        jsonb utm_data
    }
    submissions {
        uuid id PK
        uuid organization_id FK
        varchar legacy_id UK
        text contact_email
        text status
        int ai_score
        jsonb answers_json
    }
    cortex_analyses {
        uuid id PK
        uuid submission_id FK
        text status
        jsonb results
    }
```

---

## Diagram 3 — Proposal, commercial, ROI

```mermaid
erDiagram
    submissions ||--o{ proposals : has
    proposals ||--o{ proposal_versions : versions
    proposals ||--o{ proposal_annotations : annotated
    proposal_versions ||--o{ proposal_blocks : contains
    portfolios ||--o{ portfolio_versions : versions
    submissions ||--o| portfolios : recommends
    submissions ||--o{ roi_models : models
    roi_models ||--o{ roi_scenarios : scenarios
    roi_models ||--o{ roi_actuals : actuals
    submissions ||--o{ execution_blueprints : plans

    proposals {
        uuid id PK
        uuid submission_id FK
        text status
        uuid current_version_id FK
    }
    proposal_versions {
        uuid id PK
        uuid proposal_id FK
        int version_number
        jsonb payload
        timestamptz immutable_at
    }
    roi_models {
        uuid id PK
        uuid submission_id FK
        jsonb assumptions
    }
```

---

## Diagram 4 — CRM and revenue (future)

```mermaid
erDiagram
    organizations ||--o{ accounts : owns
    accounts ||--o{ crm_contacts : has
    accounts ||--o{ opportunities : pipelines
    opportunities }o--|| submissions : sourced_from
    opportunities ||--o{ pipeline_stages : at
    opportunities ||--o{ activities : logs
    opportunities ||--o{ meetings : schedules
    opportunities ||--o{ sales_calls : records

    accounts {
        uuid id PK
        uuid organization_id FK
        text name
    }
    opportunities {
        uuid id PK
        uuid account_id FK
        uuid submission_id FK
        text stage
        numeric value_estimate
    }
```

**Canonical rule:** `diagnostic_leads` (funnel) → `submissions` → `accounts`/`opportunities` (CRM). No duplicate lead authority.

---

## Diagram 5 — AI platform and deliberation

```mermaid
erDiagram
    organizations ||--o{ intelligence_requests : makes
    intelligence_requests ||--o{ model_attempts : attempts
    intelligence_requests ||--o| intelligence_responses : produces
    model_attempts }o--|| ai_providers : uses
    model_attempts }o--|| ai_models : uses
    intelligence_requests ||--o{ usage_records : rolls_up
    usage_records ||--o{ cost_records : costs
    deliberation_sessions ||--o{ deliberation_candidates : has
    deliberation_candidates ||--o{ deliberation_critiques : receives
    deliberation_sessions ||--o| consensus_results : concludes

    intelligence_requests {
        uuid id PK
        uuid organization_id FK
        text feature
        text correlation_id
        boolean store_content
    }
    deliberation_candidates {
        uuid id PK
        uuid session_id FK
        text candidate_label
        text response_redacted
    }
    model_attempts {
        uuid id PK
        uuid request_id FK
        uuid provider_id FK
        int latency_ms
        int total_tokens
    }
```

**Privacy:** `deliberation_candidates` never stores `provider_id`. Provider identity lives in `model_attempts` (admin-only RLS).

---

## Diagram 6 — Knowledge, RAG, audit

```mermaid
erDiagram
    organizations ||--o{ knowledge_spaces : owns
    knowledge_spaces ||--o{ documents : contains
    documents ||--o{ document_versions : versions
    document_versions ||--o{ document_chunks : chunks
    document_chunks ||--o{ embeddings : embedded
    knowledge_spaces ||--o{ knowledge_permissions : grants
    organizations ||--o{ audit_events : audited

    documents {
        uuid id PK
        uuid knowledge_space_id FK
        text title
        text parsing_status
    }
    document_chunks {
        uuid id PK
        uuid document_version_id FK
        int chunk_index
        text content
    }
    embeddings {
        uuid id PK
        uuid chunk_id FK
        text model_id
        vector embedding
    }
    audit_events {
        uuid id PK
        uuid organization_id FK
        text actor_type
        text action
        text entity_type
        jsonb metadata
    }
```

---

## Diagram 7 — Communication

```mermaid
erDiagram
    submissions ||--o{ conversations : has
    conversations ||--o{ conversation_participants : includes
    conversations ||--o{ messages : contains
    messages ||--o{ message_attachments : has
    organizations ||--o{ notifications : receives
    organizations ||--o{ email_queue_items : queues

    messages {
        uuid id PK
        uuid submission_id FK
        uuid conversation_id FK
        text sender_type
        text body
    }
    notifications {
        uuid id PK
        uuid organization_id FK
        uuid submission_id FK
        text type
        timestamptz read_at
    }
```

---

## KV → relational quick reference

| KV key | Primary table(s) |
|--------|------------------|
| `sub:*` | `submissions`, `diagnostic_answers` |
| `lead:*` | `diagnostic_leads` |
| `client_session:*` | `client_sessions` |
| `proposal:*` | `proposals`, `proposal_versions` |
| `cortex:*` | `cortex_analyses` |
| `msg:*` | `messages` |
| `note:*` | `submission_notes` |
| `eng_log:*` | `engagement_events` |
| `outcome:*` | `outcomes` |
| `notif:*` | `notifications` |
| `emailq:*` | `email_queue_items` |
| `settings:platform` | `organization_settings` |
| `cortex:pipeline:positions` | `pipeline_positions` |

---

*End of ERD document*

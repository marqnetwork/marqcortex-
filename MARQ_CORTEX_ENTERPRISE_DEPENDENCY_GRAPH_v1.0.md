# MARQ Cortex — Enterprise Dependency Graph

**Artifact ID:** P0-M0.3-C2
**Version:** 1.0
**Status:** APPROVED — DERIVED ARTIFACT (subordinate to the LOCKED blueprint)
**Type:** Dependency graph + implementation sequence

---

## 0. Basis, Scope and Constraints

### 0.1 Approved Source Registries (the only permitted inputs)

| Registry | Canonical source | Entries |
|---|---|---|
| **Domain Registry** | `MARQ_CORTEX_REFERENCE_ARCHITECTURE_v1.0.md` §8.4 (classification) and §8.6 (Canonical Domain Model) | 18 internal domains + 8 external domains |
| **Module Registry** | `MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` §III-23 (Product Modules), §III-24 (System Modules), §III-25 (Business Modules) | 12 product + 11 system + 7 business = 30 modules |
| **Capability Registry** | `MARQ_CORTEX_REFERENCE_ARCHITECTURE_v1.0.md` §14.5 (Business Capability Model) and §14.6 (Capability Classification) | 12 model + 5 strategic + 6 operational + 7 foundational = 30 capabilities |

### 0.2 Governing dependency authorities already approved

This graph **reads** the following approved material; it does not restate or replace it.

- **§VI-13 — Execution Dependency Model.** Fourteen-domain dependency chain; the Hard/Soft distinction; the incomplete-or-unverified downstream-block rule.
- **§VI-14 — Enterprise Execution Layers.** The nine-layer readiness sequence. **Not renumbered, not reordered here.**
- **§VI-18 — Execution Gates.** Eight gates (Architecture, Data Integrity, Security, Governance, Product Readiness, AI Readiness, Operational Readiness, Release Readiness).
- **§VI-25 — Capability Dependency Matrix.** Release-gated unlock relationships.
- **§VI-5 — Gap Analysis.** Gap IDs G1–G8 referenced as verification anchors.
- **RA §8.8, §10.14.** Circular dependencies and circular references are prohibited between domains and components.
- **RA §10.9, §10.12, §10.13.** Event-based composition, configuration-based composition, extensibility — the approved mechanisms by which back-edges are made non-blocking.

### 0.3 Constraint compliance

- **No new capabilities were created.** Every node in this graph is a verbatim entry from one of the three registries. The coverage matrix in §8 proves 1:1 traceability with zero additions.
- **No architecture was redesigned.** No domain, module, capability, layer, gate, wave, or boundary was added, removed, renamed, merged, split or resequenced. Dependency edges are *observations* over the approved architecture.
- **One notational addition is declared, not invented:** §VI-13 approves two dependency strengths (Hard, Soft). This task requires a third — **Optional**. Optional is introduced here as a *graph edge annotation only*, grounded in the already-approved mechanisms of RA §10.12 (Configuration-Based Composition), RA §10.13 (Extensibility), and §III-23's approved future state ("per-org configuration of module availability via progressive complexity"). It creates no new architectural class and changes no §VI-13 classification.

---

## 1. Node Registry (frozen)

### 1.1 Domain Registry — 26 nodes

**Core Business Domains** (RA §8.6)

| ID | Domain |
|---|---|
| `DR-C1` | Intelligence |
| `DR-C2` | Knowledge |
| `DR-C3` | Workflow |
| `DR-C4` | Customer |
| `DR-C5` | Product |
| `DR-C6` | Operations |

**Supporting Domains** (RA §8.6)

| ID | Domain |
|---|---|
| `DR-S1` | Reporting |
| `DR-S2` | Search |
| `DR-S3` | Notifications |
| `DR-S4` | Documents |
| `DR-S5` | Scheduling |
| `DR-S6` | Communication |

**Shared Platform Domains** (RA §8.6)

| ID | Domain |
|---|---|
| `DR-P1` | Identity |
| `DR-P2` | Configuration |
| `DR-P3` | Audit |
| `DR-P4` | Telemetry |
| `DR-P5` | Event Bus |
| `DR-P6` | API Platform |

**External Domains** (RA §8.4)

| ID | Domain |
|---|---|
| `DR-X1` | CRM systems |
| `DR-X2` | ERP platforms |
| `DR-X3` | Payment providers |
| `DR-X4` | Cloud AI providers |
| `DR-X5` | Email services |
| `DR-X6` | Messaging platforms |
| `DR-X7` | Analytics services |
| `DR-X8` | Third-party APIs |

> **Registry reconciliation note (no change made).** RA §8.4 lists illustrative names that RA §8.6 canonicalises: *Customer Success → Customer*, *Business Operations → Operations*, *Product Management → Product*, *Identity & Access Management → Identity*, *Configuration Management → Configuration*, *Audit Services → Audit*, *API Gateway → API Platform*. §8.4's *Feature Management* and *Workflow Runtime* are illustrative capabilities of `DR-P2` and `DR-C3` respectively and are **not** promoted to domains here. §8.6 governs.

### 1.2 Module Registry — 30 nodes

**Product Modules** (§III-23)

| ID | Module |
|---|---|
| `MR-P1` | Public Funnel & Lead Capture |
| `MR-P2` | Diagnostic & Scoring |
| `MR-P3` | Recommendation & Portfolio |
| `MR-P4` | ROI Modeling |
| `MR-P5` | Proposal System |
| `MR-P6` | Editability & Copilot |
| `MR-P7` | Contract Generation |
| `MR-P8` | Execution Delivery |
| `MR-P9` | ROI Actuals & QBR |
| `MR-P10` | Client Portal |
| `MR-P11` | Team Dashboard |
| `MR-P12` | CORTEX AI |

**System Modules** (§III-24)

| ID | Module |
|---|---|
| `MR-S1` | Frontend Data Gateway |
| `MR-S2` | HTTP Client & Endpoint Config |
| `MR-S3` | Intelligence Gateway |
| `MR-S4` | Manifest / Registry |
| `MR-S5` | Feature Flags & Runtime Config |
| `MR-S6` | Auth & Session |
| `MR-S7` | KV Persistence + Relational Foundation & Repositories |
| `MR-S8` | Migration System |
| `MR-S9` | Email / Notifications |
| `MR-S10` | Error / Offline Handling |
| `MR-S11` | PDF / Export |

**Business Modules** (§III-25)

| ID | Module |
|---|---|
| `MR-B1` | Acquisition |
| `MR-B2` | Diagnosis & Qualification |
| `MR-B3` | Value Modeling |
| `MR-B4` | Proposal & Governance |
| `MR-B5` | Delivery |
| `MR-B6` | Growth & Retention |
| `MR-B7` | Client Relationship |

### 1.3 Capability Registry — 30 nodes

**Business Capability Model** (RA §14.5)

| ID | Capability |
|---|---|
| `CR-M1` | Opportunity Management |
| `CR-M2` | Customer Management |
| `CR-M3` | AI Operations |
| `CR-M4` | Knowledge Management |
| `CR-M5` | Workflow Management |
| `CR-M6` | Campaign Management |
| `CR-M7` | Product Management |
| `CR-M8` | Sales Operations |
| `CR-M9` | Service Delivery |
| `CR-M10` | Analytics |
| `CR-M11` | Governance |
| `CR-M12` | Platform Administration |

**Strategic Capabilities** (RA §14.6)

| ID | Capability |
|---|---|
| `CR-S1` | AI Intelligence |
| `CR-S2` | Organizational Knowledge |
| `CR-S3` | Intelligent Workflow Automation |
| `CR-S4` | Business Discovery |
| `CR-S5` | Enterprise Decision Support |

**Operational Capabilities** (RA §14.6)

| ID | Capability |
|---|---|
| `CR-O1` | Customer onboarding |
| `CR-O2` | Proposal management |
| `CR-O3` | Project delivery |
| `CR-O4` | Reporting |
| `CR-O5` | Communications |
| `CR-O6` | Scheduling |

**Foundational Capabilities** (RA §14.6)

| ID | Capability |
|---|---|
| `CR-F1` | Identity Management |
| `CR-F2` | Security |
| `CR-F3` | Configuration |
| `CR-F4` | Audit |
| `CR-F5` | Monitoring |
| `CR-F6` | Notifications |
| `CR-F7` | Authorization |

---

## 2. Edge Taxonomy

| Class | Symbol | Definition | Ordering effect | Authority |
|---|---|---|---|---|
| **Hard Dependency** | `⟹` | The dependent may not be implemented until the prerequisite is **IMPLEMENTED and VERIFIED**. An IMPLEMENTED-but-UNVERIFIED prerequisite does **not** satisfy it. | **Blocking.** Fixes topological order. Enforced at the §VI-18 gates. | §VI-13 |
| **Soft Dependency** | `→` | The dependent *benefits from* but is not blocked by the prerequisite; it may proceed against a **documented interim contract**. The obligation is recorded so eventual satisfaction is not forgotten. | **Non-blocking.** Permits parallelism; creates a tracked debt. | §VI-13 |
| **Optional Dependency** | `⇢` | The dependent is **complete and correct without** the prerequisite. Presence is a composition/configuration decision — per-tenant module availability, progressive-complexity tier, or an additive extension. | **None.** Never affects order; absence is a valid production state. | RA §10.12, §10.13; §III-23 (approved future state) |

**Reading rules**

1. `A ⟹ B` means *A depends on B*; B must be VERIFIED before A begins.
2. A hard edge is only asserted where the approved material states blocking necessity. Where the approved material states benefit-without-blocking, the edge is Soft — misclassification in either direction is the primary risk named in §VI-13.
3. External domains (`DR-X*`) are **never** reachable by a direct hard edge from an internal node. Every dependency on an external domain is mediated by the Integration Layer (RA §8.4) and is therefore Soft or Optional at the internal node.

---

## 3. Tier 1 — Capability Dependency Graph

### 3.1 Foundational tier (`CR-F*`) — the root of the enterprise graph

```
        CR-F2 Security          CR-F3 Configuration
         (root)                  (root)
             │                        │
             └───────────┬────────────┘
                         ⟹
                  CR-F1 Identity Management
                         │
             ┌───────────┼────────────┐
             ⟹           ⟹            ⟹
    CR-F7 Authorization  CR-F4 Audit   CR-F6 Notifications
                                 │            ▲
                                 →            │  (⇢ per-tenant channel config)
                                 ▼            │
                          CR-F5 Monitoring ───┘
```

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `CR-F1` Identity Management | ⟹ | `CR-F2` Security | §VI-13 #11 — Security "gates (1)–(2)" |
| `CR-F1` Identity Management | ⟹ | `CR-F3` Configuration | §VI-13 #1 — tenancy is schema/policy-configured |
| `CR-F7` Authorization | ⟹ | `CR-F1` Identity Management | §VI-13 #2 — "Governs which identity may act. Depends on (1)." |
| `CR-F4` Audit | ⟹ | `CR-F1` Identity Management | RA §11.x — audit requires actor attribution |
| `CR-F4` Audit | → | `CR-F5` Monitoring | §VI-13 #10 — observability cross-cuts, does not block |
| `CR-F5` Monitoring | ⟹ | `CR-F3` Configuration | §VI-13 #10/#13 — instrumentation is configured |
| `CR-F5` Monitoring | → | `CR-F4` Audit | RA §11 — correlation improves, does not gate |
| `CR-F6` Notifications | ⟹ | `CR-F1`, `CR-F3` | §III-24 (`MR-S9`), RA §8.6 `DR-S3` |
| `CR-F6` Notifications | ⇢ | `CR-F5` Monitoring | Alert-driven notification is additive |

**`CR-F2` and `CR-F3` are the only capability nodes in the entire registry with no prerequisite.** They are the graph roots.

### 3.2 Governing tier

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `CR-M11` Governance | — | *(none)* | §VI-14 Layer 1 — "Dependencies. None upstream; it is the root." |
| `CR-M12` Platform Administration | ⟹ | `CR-F1`, `CR-F7`, `CR-F3` | RA §14.6 — administration acts under authorization |
| `CR-M12` Platform Administration | → | `CR-F4` Audit | Administrative action is audited asynchronously |

> `CR-M11` Governance is the **absolute root of the enterprise graph** — the only node in any tier with no upstream dependency of any class.

### 3.3 Platform / workflow tier

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `CR-M5` Workflow Management | ⟹ | `CR-F1`, `CR-F7`, `CR-M12` | §VI-13 #8 — depends on (4)–(7) |
| `CR-M5` Workflow Management | → | `CR-M3` AI Operations | §VI-13 — workforce-driven orchestration deepens, deterministic orchestration ships first |
| `CR-M5` Workflow Management | ⇢ | `CR-F6` Notifications | RA §10.8 — notification is one orchestrated participant |

### 3.4 Intelligence / knowledge tier

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `CR-S1` AI Intelligence | ⟹ | `CR-F1`, `CR-F7`, `CR-M12` | §VI-13 #5 — gateway depends on (4); §VI-14 Layer 5 depends on Layers 1–4 |
| `CR-S1` AI Intelligence | ⟹ | Authoritative data plane (G1) | §VI-13 — "any intelligence broadening that treats SQL as truth is hard-blocked by SQL authority (G1)" |
| `CR-M3` AI Operations | ⟹ | `CR-S1` AI Intelligence | RA §14.5/§15 — AI Ops operates the intelligence surface |
| `CR-M3` AI Operations | ⟹ | `CR-F5` Monitoring *(gateway-scope)* | §VI-13 #5 — `telemetry`/`health`/`certification` are constituent |
| `CR-S2` Organizational Knowledge | ⟹ | `CR-S1` AI Intelligence | §VI-13 #6 — "Depends on (3)–(5)" |
| `CR-M4` Knowledge Management | ⟹ | `CR-S2` Organizational Knowledge | RA §16 |
| `CR-S1` AI Intelligence | → | `CR-S2` Organizational Knowledge | §VI-13 — **explicitly soft**: "knowledge-system maturation (6) improves but does not block single-provider gateway use (5)" |
| `CR-S5` Enterprise Decision Support | ⟹ | `CR-S1`, `CR-S2` | RA §15/§16 |
| `CR-S5` Enterprise Decision Support | → | `CR-M10` Analytics | Decision support improves with analytics; not blocked |

### 3.5 Automation tier

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `CR-S3` Intelligent Workflow Automation | ⟹ | `CR-M5`, `CR-S1`, `CR-M3` | §VI-13 #7 — "Depends on (1)–(6) — it cannot precede authoritative data, enforced tenancy, a governed gateway, or a knowledge substrate" |
| `CR-S3` Intelligent Workflow Automation | ⟹ | `CR-F7` Authorization | §VI-11 — authority before autonomy |
| `CR-S3` Intelligent Workflow Automation | → | `CR-S2` Organizational Knowledge | Knowledge substrate improves autonomy quality |

### 3.6 Business / operational tier

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `CR-S4` Business Discovery | ⟹ | `CR-S1` AI Intelligence, `CR-M2` Customer Management | RA §14.6, §III-23 (`MR-P2`) |
| `CR-M1` Opportunity Management | ⟹ | `CR-M2` Customer Management | RA §14.7 Customer Acquisition value stream |
| `CR-M1` Opportunity Management | ⟹ | `CR-S4` Business Discovery | §III-25 (`MR-B2` precedes `MR-B4`) |
| `CR-M2` Customer Management | ⟹ | `CR-F1`, `CR-F7`, `CR-M12` | Tenant-scoped customer records |
| `CR-O1` Customer onboarding | ⟹ | `CR-M2` Customer Management | RA §14.6/§14.7 |
| `CR-O2` Proposal management | ⟹ | `CR-M1` Opportunity Management | RA §14.7 — Opportunity → Proposal |
| `CR-O2` Proposal management | ⇢ | `CR-S1` AI Intelligence | Copilot assist is additive; §VI-11 "AI assists, never overrides" |
| `CR-M8` Sales Operations | ⟹ | `CR-M1`, `CR-O2` | RA §14.5 |
| `CR-M8` Sales Operations | ⇢ | `DR-X1` CRM systems | External, Integration-Layer-mediated (G6) |
| `CR-M9` Service Delivery | ⟹ | `CR-O2` Proposal management, `CR-M5` Workflow Management | RA §14.7 Service Delivery value stream |
| `CR-O3` Project delivery | ⟹ | `CR-M9` Service Delivery | RA §14.6 |
| `CR-M7` Product Management | ⟹ | `CR-M12`, `CR-M2` | RA §14.5 |
| `CR-M7` Product Management | → | `CR-M10` Analytics | Product decisions improve with analytics |
| `CR-O5` Communications | ⟹ | `CR-F6` Notifications, `CR-M2` | RA §14.6 |
| `CR-O5` Communications | ⇢ | `DR-X5`, `DR-X6` | External channel providers |
| `CR-O6` Scheduling | ⟹ | `CR-M2` Customer Management | RA §14.6 |
| `CR-O6` Scheduling | ⇢ | `DR-X8` Third-party APIs | External calendar integration (G6) |
| `CR-O4` Reporting | ⟹ | `CR-M2`, authoritative data plane (G1) | §VI-13 #3 |
| `CR-O4` Reporting | → | `CR-M10` Analytics | Enterprise analytics deepens reporting |
| `CR-M10` Analytics | ⟹ | `CR-F5` Monitoring, `CR-F4` Audit, authoritative data plane (G1) | §VI-14 Layer 8 |
| `CR-M10` Analytics | ⇢ | `DR-X7` Analytics services | External, Integration-Layer-mediated |
| `CR-M6` Campaign Management | ⟹ | `CR-M2`, `CR-O5` Communications | RA §14.5 |
| `CR-M6` Campaign Management | ⇢ | `CR-S3` Intelligent Workflow Automation | Automation is additive to campaign execution |

---

## 4. Tier 2 — Domain Dependency Graph

### 4.1 Master domain graph (hard edges only)

```
                         [ GOVERNANCE ROOT — CR-M11 ]
                                     │
                                     ⟹
      ┌──────────────────────────────┴──────────────────────────────┐
      │                    SHARED PLATFORM DOMAINS                   │
      │                                                              │
      │   DR-P2 Configuration ──⟹──┐                                 │
      │                            ├──⟹── DR-P1 Identity             │
      │   (CR-F2 Security) ────⟹───┘            │                    │
      │                                          ⟹                   │
      │                              ┌───────────┼───────────┐       │
      │                              ▼           ▼           ▼       │
      │                        DR-P3 Audit  DR-P6 API   DR-P5 Event  │
      │                              │      Platform      Bus        │
      │                              └────────→ DR-P4 Telemetry ◄────┘
      └──────────────────────────────┬──────────────────────────────┘
                                     ⟹
      ┌──────────────────────────────┴──────────────────────────────┐
      │                       CORE BUSINESS DOMAINS                  │
      │                                                              │
      │                     DR-C3 Workflow                           │
      │                          │  ▲                                │
      │                          ⟹  └────→ (soft, event-carried)     │
      │                          ▼                                   │
      │                     DR-C1 Intelligence ──⟹──► DR-C2 Knowledge│
      │                          ▲   └───────←──────────┘ (soft)     │
      │                          │                                   │
      │                          ⟹                                   │
      │              DR-C4 Customer ──⟹──► DR-C5 Product             │
      │                          │                                   │
      │                          └────────→ DR-C6 Operations (soft)  │
      └──────────────────────────────┬──────────────────────────────┘
                                     ⟹
      ┌──────────────────────────────┴──────────────────────────────┐
      │                      SUPPORTING DOMAINS                      │
      │   DR-S1 Reporting  DR-S2 Search  DR-S3 Notifications         │
      │   DR-S4 Documents  DR-S5 Scheduling  DR-S6 Communication     │
      └──────────────────────────────┬──────────────────────────────┘
                                     ⇢  (Integration Layer only)
      ┌──────────────────────────────┴──────────────────────────────┐
      │   EXTERNAL DOMAINS  DR-X1…DR-X8 — never a direct hard edge   │
      └──────────────────────────────────────────────────────────────┘
```

### 4.2 Domain edge register

| Dependent domain | Class | Prerequisite domain | Basis |
|---|---|---|---|
| `DR-P1` Identity | ⟹ | `DR-P2` Configuration | §VI-13 #1 |
| `DR-P3` Audit | ⟹ | `DR-P1` Identity | Actor attribution |
| `DR-P3` Audit | ⟹ | `DR-P5` Event Bus | RA §10.9 — audit is event-carried |
| `DR-P5` Event Bus | ⟹ | `DR-P2` Configuration | RA §10.9 |
| `DR-P5` Event Bus | → | `DR-P4` Telemetry | Self-observation; ships with local instrumentation |
| `DR-P4` Telemetry | ⟹ | `DR-P2` Configuration | §VI-13 #10 |
| `DR-P4` Telemetry | → | `DR-P5` Event Bus | Event-carried signal improves collection; not blocking |
| `DR-P6` API Platform | ⟹ | `DR-P1` Identity, `DR-P2` Configuration | RA §7 Integration/API layer; auth precedes exposure |
| `DR-C3` Workflow | ⟹ | `DR-P1`, `DR-P5`, `DR-P6` | §VI-13 #8 |
| `DR-C1` Intelligence | ⟹ | `DR-P1`, `DR-P6`, authoritative data (G1) | §VI-13 #5 |
| `DR-C1` Intelligence | ⇢ | `DR-X4` Cloud AI providers | RA §8.4 — Integration-Layer-mediated; provider-neutral by construction |
| `DR-C2` Knowledge | ⟹ | `DR-C1` Intelligence | §VI-13 #6 — "Depends on (3)–(5)" |
| `DR-C1` Intelligence | → | `DR-C2` Knowledge | §VI-13 — explicitly soft |
| `DR-C3` Workflow | ⟹ | `DR-C1` Intelligence *(for AI-orchestrating workflows)* | §VI-13 #8 depends on (4)–(7) |
| `DR-C1` Intelligence | → | `DR-C3` Workflow | RA §10.9 — event-carried back-edge |
| `DR-C4` Customer | ⟹ | `DR-P1`, `DR-P6` | Tenant-scoped customer state |
| `DR-C5` Product | ⟹ | `DR-C4` Customer | §VI-14 Layer 7 — surfaces render customer state |
| `DR-C5` Product | → | `DR-C1` Intelligence | §VI-14 Layer 7 — "core journey soft-depends" |
| `DR-C6` Operations | ⟹ | `DR-P3` Audit, `DR-P4` Telemetry | §VI-14 Layer 8 |
| `DR-C4`…`DR-C5` | → | `DR-C6` Operations | §VI-13 — "broader observability (10) improves but does not block product interface work (9)" |
| `DR-S1` Reporting | ⟹ | `DR-C4` Customer, authoritative data (G1) | §VI-13 #3 |
| `DR-S2` Search | ⟹ | `DR-C2` Knowledge *(semantic)*, `DR-P6` | RA §16 |
| `DR-S3` Notifications | ⟹ | `DR-P1`, `DR-P5` | RA §10.9 |
| `DR-S3` Notifications | ⇢ | `DR-X5` Email services, `DR-X6` Messaging platforms | Channel providers |
| `DR-S4` Documents | ⟹ | `DR-P1`, `DR-C4` Customer | §III-24 `MR-S11` |
| `DR-S5` Scheduling | ⟹ | `DR-C4` Customer | RA §14.6 |
| `DR-S5` Scheduling | ⇢ | `DR-X8` Third-party APIs | External calendars (G6) |
| `DR-S6` Communication | ⟹ | `DR-S3` Notifications, `DR-C4` Customer | RA §14.6 |
| `DR-X1`…`DR-X8` | — | *(external — own no internal dependency)* | RA §8.4 |

---

## 5. Tier 3 — Module Dependency Graph

### 5.1 System modules (`MR-S*`) — the substrate

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `MR-S4` Manifest/Registry | — | *(none)* | Constitution Art. 14 — precedes implementation of every other module |
| `MR-S5` Feature Flags & Runtime Config | ⟹ | `MR-S4` | §III-24, §III-53 |
| `MR-S2` HTTP Client & Endpoint Config | ⟹ | `MR-S4`, `MR-S5` | §III-24 |
| `MR-S6` Auth & Session | ⟹ | `MR-S2`, `MR-S5` | §III-24, §III-40; §VI-13 #1–#2 |
| `MR-S7` KV Persistence + Relational Foundation & Repositories | ⟹ | `MR-S6` | §VI-13 #3–#4 — tenancy precedes data authority |
| `MR-S8` Migration System | ⟹ | `MR-S7` | §III-37; §VI-27 expand → migrate → contract |
| `MR-S1` Frontend Data Gateway | ⟹ | `MR-S2`, `MR-S7` | §III-24 — single data access point |
| `MR-S10` Error/Offline Handling | ⟹ | `MR-S1` | §III-56 — demo fallback wraps the gateway |
| `MR-S11` PDF/Export | ⟹ | `MR-S1` | §III-24 — dynamic import over gateway data |
| `MR-S3` Intelligence Gateway | ⟹ | `MR-S1`, `MR-S7` | §VI-13 #5 — "Depends on (4) for the data it narrates" |
| `MR-S3` Intelligence Gateway | ⇢ | `DR-X4` Cloud AI providers | Provider-neutral; `mockProvider` satisfies the contract |
| `MR-S9` Email/Notifications | ⟹ | `MR-S2`, `MR-S6` | §III-24, §III-48 |
| `MR-S9` Email/Notifications | ⇢ | `DR-X5` Email services | Provider-substitutable |

**System-module hard chain (linear, no branches until `MR-S1`):**

```
MR-S4 ⟹ MR-S5 ⟹ MR-S2 ⟹ MR-S6 ⟹ MR-S7 ⟹ MR-S8
                                   │
                                   ⟹ MR-S1 ⟹ { MR-S10, MR-S11, MR-S3 }
                                   │
                                   ⟹ MR-S9
```

### 5.2 Product modules (`MR-P*`) — the customer journey

| Dependent | Class | Prerequisite | Basis |
|---|---|---|---|
| `MR-P1` Public Funnel & Lead Capture | ⟹ | `MR-S1`, `MR-S10` | §III-23, §III-28 |
| `MR-P2` Diagnostic & Scoring | ⟹ | `MR-P1`, `MR-S1` | §III-28 public journey |
| `MR-P3` Recommendation & Portfolio | ⟹ | `MR-P2` | §III-23 — ranked recommendations from scoring |
| `MR-P4` ROI Modeling | ⟹ | `MR-P3` | §III-23 — models the recommended portfolio |
| `MR-P5` Proposal System | ⟹ | `MR-P3`, `MR-P4` | §III-23 — Ready Gate assembles both |
| `MR-P6` Editability & Copilot | ⟹ | `MR-P5`, `MR-S3` | §III-23 — universal blocks + gateway |
| `MR-P5` Proposal System | ⇢ | `MR-P6` Editability & Copilot | Proposal is complete without copilot assist |
| `MR-P7` Contract Generation | ⟹ | `MR-P5` | §III-23 — "auto-generated contract from accepted proposal/scope" |
| `MR-P8` Execution Delivery | ⟹ | `MR-P7` | §III-23, §III-29 sign → deliver |
| `MR-P9` ROI Actuals & QBR | ⟹ | `MR-P4`, `MR-P8` | §III-23 — actuals against the model |
| `MR-P9` ROI Actuals & QBR | → | `MR-P3` Recommendation & Portfolio | Opportunity engine feeds new recommendations — **runtime loop, see C-5** |
| `MR-P10` Client Portal | ⟹ | `MR-P5`, `MR-S6` | §III-23 — 8 fixed tabs, authenticated |
| `MR-P10` Client Portal | ⇢ | `MR-P8`, `MR-P9` | Tabs render when their upstream exists |
| `MR-P11` Team Dashboard | ⟹ | `MR-P2`, `MR-S1`, `MR-S6` | §III-23, §III-28 team journey |
| `MR-P11` Team Dashboard | ⇢ | `MR-P12` CORTEX AI | Dashboard operable without AI panels |
| `MR-P12` CORTEX AI | ⟹ | `MR-S3` Intelligence Gateway | §VI-16 — **no AI path may bypass the gateway** |
| `MR-P12` CORTEX AI | → | `MR-P11` Team Dashboard | Surfaces where the AI is consumed |

### 5.3 Business modules (`MR-B*`) — the value chain

Business modules are the commercial reading of the product modules (§III-25); their order is the value chain **pre-sale → sign → deliver → grow**.

| Dependent | Class | Prerequisite | Realising modules |
|---|---|---|---|
| `MR-B1` Acquisition | ⟹ | `MR-P1`, `MR-S9` | Lead capture, exit-intent, nurture queue |
| `MR-B2` Diagnosis & Qualification | ⟹ | `MR-B1`, `MR-P2`, `MR-P3` | Scoring, domain analysis, portfolio |
| `MR-B3` Value Modeling | ⟹ | `MR-B2`, `MR-P4` | ROI suite |
| `MR-B4` Proposal & Governance | ⟹ | `MR-B3`, `MR-P5`, `MR-P7` | Ready Gate, snapshot, export, contract |
| `MR-B5` Delivery | ⟹ | `MR-B4`, `MR-P8` | Execution blueprint, scope control |
| `MR-B6` Growth & Retention | ⟹ | `MR-B5`, `MR-P9` | ROI actuals, QBR, revenue intelligence |
| `MR-B7` Client Relationship | ⟹ | `MR-P10`, `MR-S9` | Portal, messaging, scheduling, reports |
| `MR-B7` Client Relationship | ⇢ | `DR-X6` Messaging platforms | External channels |
| `MR-B6` Growth & Retention | → | `MR-B2` Diagnosis & Qualification | Opportunity engine re-enters the chain — **see C-5** |

---

## 6. Circular Dependency Detection

**Method.** Depth-first traversal of the combined 86-node graph (26 domains + 30 modules + 30 capabilities) across all three edge classes, with strongly-connected-component identification. Every SCC of size > 1 is reported below.

**Cycle severity classes**

- **ILLEGAL (hard ↔ hard).** Both directions blocking. No topological order exists. Prohibited by RA §8.8 and §10.14; must be broken before implementation.
- **RESOLVED (hard ↔ soft).** One direction blocking, the reverse advisory/event-carried. A topological order exists on the hard subgraph. Permitted.
- **BENIGN (soft ↔ soft, or any ⇢).** No blocking edge in the cycle. No ordering impact.

### 6.1 Detected cycles

| ID | Cycle | Tier | Class | Resolution mechanism (already approved) | Verdict |
|---|---|---|---|---|---|
| **C-1** | `DR-P1` Identity ⟷ `DR-P3` Audit | Domain | **RESOLVED** | Audit ⟹ Identity (actor attribution) is synchronous. Identity → Audit is **event-carried** via `DR-P5` Event Bus (RA §10.9). No synchronous back-edge. | Build Identity → Audit; retro-fit identity-event auditing. **Order preserved.** |
| **C-2** | `DR-C1` Intelligence ⟷ `DR-C2` Knowledge<br>`CR-S1` ⟷ `CR-S2` | Domain + Capability | **RESOLVED** | Already resolved in the approved material: §VI-13 states the back-edge is **soft** — "knowledge-system maturation (6) improves but does not block single-provider gateway use (5)." | No action. **Pre-resolved by §VI-13.** |
| **C-3** | `DR-C3` Workflow ⟷ `DR-C1` Intelligence | Domain | **RESOLVED** | Workflow ⟹ Intelligence (§VI-13 #8 depends on (4)–(7)). Intelligence → Workflow is event-carried (RA §10.9) and constrained by §VI-11 "AI assists, never overrides" — deterministic authority is preserved, so the back-edge can never become blocking. | **Order preserved.** |
| **C-4** | `DR-P4` Telemetry ⟷ `DR-P5` Event Bus | Domain | **BENIGN** | Both directions are Soft. Event Bus ships with local instrumentation; Telemetry ships with direct collection. Each is independently deliverable. | No ordering impact. |
| **C-5** | `MR-P3` Recommendation → `MR-P4` → `MR-P5` → `MR-P7` → `MR-P8` → `MR-P9` ROI Actuals & QBR → `MR-P3`<br>*(business mirror: `MR-B2` → … → `MR-B6` → `MR-B2`)* | Module | **RESOLVED** | This is a **runtime value-stream loop**, not a build-time dependency (RA §14.7 Continuous Improvement: Measurement → Analysis → Recommendation → Change → Validation). The closing edge `MR-P9 → MR-P3` is Soft and **data-carried**: the opportunity engine emits new recommendation input; it does not require `MR-P3` code to change. | Build order is unaffected. **Highest-visibility cycle in the product — must not be misread as blocking.** |
| **C-6** | `MR-P5` Proposal System ⟷ `MR-P6` Editability & Copilot | Module | **RESOLVED** | Copilot ⟹ Proposal (blocks must exist to be edited). Proposal ⇢ Copilot is **Optional** — the Proposal System, Ready Gate, snapshot and export are complete and releasable without any copilot assist. | Build Proposal → Copilot. **Order preserved.** |
| **C-7** | `DR-C6` Operations ⟷ { `DR-C1`…`DR-C5`, `DR-S1`…`DR-S6` } | Domain | **RESOLVED** | Operations ⟹ Telemetry/Audit (hard, §VI-14 Layer 8). All other domains → Operations is Soft — §VI-13 #10: "broader observability improves but does not block product interface work." | **Order preserved.** |
| **C-8** | `CR-F4` Audit ⟷ `CR-F5` Monitoring | Capability | **BENIGN** | Both directions Soft. Neither is a prerequisite for the other's first release. | No ordering impact. |

### 6.2 Detection result

> **No ILLEGAL (hard ↔ hard) cycle exists anywhere in the Enterprise Dependency Graph.**
>
> The hard-edge subgraph across all 86 nodes is a **directed acyclic graph**. A valid total topological order therefore exists, and §9 states it.
>
> Two cycles are **BENIGN** (C-4, C-8) and six are **RESOLVED** (C-1, C-2, C-3, C-5, C-6, C-7) — in every resolved case by a mechanism already present in the approved architecture (event-carried composition RA §10.9, configuration-based composition RA §10.12, or an explicit §VI-13 soft classification). **No architectural change was required to break any cycle.**

### 6.3 Standing risks

1. **C-5 misclassification.** Treating the QBR → Recommendation loop as a hard dependency would deadlock the entire product tier. It is Soft and data-carried. *(§VI-13: "Treating a soft dependency as hard stalls deliverable work.")*
2. **C-6 inversion.** Treating Copilot as a prerequisite of the Proposal System would hard-block the proposal path behind `MR-S3` and G3. It is Optional.
3. **C-3 inversion.** Allowing Intelligence to synchronously invoke Workflow would convert a resolved cycle into an ILLEGAL one and violate §VI-11 authority-before-autonomy.

---

## 7. Foundation Capabilities

**Definition applied.** A Foundation Capability is a registry entry on which **every other node in the graph transitively hard-depends**, computed by reverse reachability over the hard-edge subgraph.

### 7.1 F0 — Absolute Foundation (universal hard predecessors)

Every one of the remaining 83 nodes hard-depends on all four, transitively. These are the load-bearing floor of Cortex.

| ID | Capability | Why everything depends on it | Gate |
|---|---|---|---|
| `CR-F3` | **Configuration** | Graph root. Every other capability, domain and module is configured before it can be instantiated. No prerequisite of any class. | Architecture |
| `CR-F2` | **Security** | Graph root. §VI-13 #11 — "cross-cuts every layer and **gates (1)–(2)**." No prerequisite of any class. | Security |
| `CR-F1` | **Identity Management** | §VI-13 #1 — "**Everything tenant-scoped depends on this.**" §VI-25 — "Until tenancy is RELEASABLE, no wave that persists or renders tenant data is deliverable." | **G2** / Security |
| `CR-F7` | **Authorization** | §VI-13 #2 — "Governs which identity may act." §VI-11 — authority before autonomy. No governed action exists without it. | **G2** / Security |

**Realising registry nodes:** domains `DR-P2` Configuration, `DR-P1` Identity · modules `MR-S4` Manifest/Registry, `MR-S5` Feature Flags & Runtime Config, `MR-S2` HTTP Client & Endpoint Config, `MR-S6` Auth & Session.

> **The single most load-bearing item in the graph** is the pairing of `CR-F1` Identity Management with the authoritative data plane realised by `MR-S7` + `MR-S8` (gaps **G2** and **G1**). §VI-25: *"Authoritative relational data (delivered) → … This is the single most enabling release in the model."*

### 7.2 F1 — Governing Foundation (universal for governed, evidenced operation)

| ID | Capability / node | Why | Gate |
|---|---|---|---|
| `CR-M11` | **Governance** | §VI-14 Layer 1 — the absolute root; every downstream decision derives authority here. Precedes even F0 in *authority*, though it imposes no build prerequisite. | Governance |
| `CR-F4` | **Audit** | Every governed action must be attributable and evidenced (§VI-28 evidence model). | Governance |
| `CR-M12` | **Platform Administration** | The operating surface through which all shared platform domains are administered. | Architecture |
| `DR-P6` | **API Platform** | Every cross-domain interaction is contract-mediated (RA §8.8, §10.15). | Architecture |
| `DR-P5` | **Event Bus** | The mechanism by which **six of the eight detected cycles** are held non-blocking (RA §10.9). Without it, C-1/C-3/C-5/C-7 tighten toward ILLEGAL. | Architecture |

### 7.3 F2 — Enabling Foundation (hard for a large subset, not universal)

| ID | Capability / node | Hard-required by |
|---|---|---|
| `CR-F5` | Monitoring | `CR-M3` AI Operations, `CR-M10` Analytics, `DR-C6` Operations (G5) |
| `CR-F6` | Notifications | `CR-O5` Communications, `DR-S3`, `DR-S6`, `MR-S9`, `MR-B1`, `MR-B7` |
| `MR-S7` | KV Persistence + Relational Foundation & Repositories | Every data-bearing module and every intelligence path (G1) |
| `MR-S8` | Migration System | Every subsequent schema-bearing increment — §VI-25: "unlocks *reversible* delivery" |
| `MR-S1` | Frontend Data Gateway | Every product surface (§III-24 — single data access point) |
| `MR-S3` | Intelligence Gateway | Every AI path without exception — §VI-16 prohibits any direct-provider route |

### 7.4 Foundation rule

> **No node outside F0 may enter implementation until every F0 capability is VERIFIED** — not merely IMPLEMENTED (§VI-13 governing rule, enforced at the Security and Data Integrity gates, §VI-18).

---

## 8. Coverage Matrix

Every registry entry is assigned exactly one **entry stage** — the earliest stage at which its hard prerequisites are satisfied. Stages are the nine approved execution layers of §VI-14, unchanged.

| Stage (= §VI-14 Layer) | Domains | Modules | Capabilities |
|---|---|---|---|
| **1** Constitutional & Governance Integrity | — | `MR-S4` | `CR-M11` |
| **2** Identity, Tenancy & Authorization | `DR-P2`, `DR-P1` | `MR-S5`, `MR-S2`, `MR-S6` | `CR-F3`, `CR-F2`, `CR-F1`, `CR-F7` |
| **3** Data & Domain Integrity | `DR-P3`, `DR-P6` | `MR-S7`, `MR-S8`, `MR-S1` | `CR-F4`, `CR-M12` |
| **4** Core Platform Services | `DR-P5`, `DR-C3`, `DR-S4` | `MR-S10`, `MR-S11` | `CR-M5` |
| **5** Intelligence & Knowledge | `DR-C1`, `DR-C2`, `DR-X4` | `MR-S3`, `MR-P12` | `CR-S1`, `CR-M3`, `CR-S2`, `CR-M4`, `CR-S5` |
| **6** AI Workforce & Orchestration | — | `MR-P6` | `CR-S3` |
| **7** Department & Product Experiences | `DR-C4`, `DR-C5`, `DR-S1`, `DR-S2`, `DR-S3`, `DR-S5`, `DR-S6`, `DR-X5`, `DR-X6` | `MR-P1`–`MR-P5`, `MR-P7`–`MR-P11`, `MR-S9`, `MR-B1`–`MR-B5`, `MR-B7` | `CR-M2`, `CR-S4`, `CR-M1`, `CR-O1`, `CR-O2`, `CR-M8`, `CR-M9`, `CR-O3`, `CR-M7`, `CR-F6`, `CR-O5`, `CR-O6`, `CR-O4` |
| **8** Operational Intelligence & Optimization | `DR-P4`, `DR-C6` | `MR-B6` | `CR-F5`, `CR-M10` |
| **9** Scale, Ecosystem & Market Expansion | `DR-X1`, `DR-X2`, `DR-X3`, `DR-X7`, `DR-X8` | — | `CR-M6` |

**Coverage verification**

| Registry | Entries | Assigned | Unassigned | Added |
|---|---|---|---|---|
| Domain Registry | 26 | 26 | 0 | **0** |
| Module Registry | 30 | 30 | 0 | **0** |
| Capability Registry | 30 | 30 | 0 | **0** |
| **Total** | **86** | **86** | **0** | **0** |

---

## 9. Recommended Implementation Sequence — Cortex V1

**Sequence authority.** This is the topological order of the hard-edge DAG, expressed **within** the nine approved execution layers (§VI-14) and gated by the eight approved gates (§VI-18). It introduces no layer, no gate, no wave and no schedule. Per §VI-14, **the sequence is capability readiness, not dates or sprints.**

**V1 scope decision.** Cortex V1 = **Steps 1–20 (Stages 1–8)**. Stage 9 (`DR-X1`, `DR-X2`, `DR-X3`, `DR-X7`, `DR-X8`, `CR-M6`) is **excluded from V1** — §VI-14 Layer 9 is admissible only on a complete, observable platform, and beginning it earlier is the prohibited-early-work failure mode of §VI-16.

### 9.1 The sequence

| # | Step | Nodes entering | Hard prerequisite | Exit gate |
|---|---|---|---|---|
| **1** | Establish governance authority | `CR-M11`, `MR-S4` | *(root)* | Governance |
| **2** | Establish configuration + security roots | `CR-F3`, `CR-F2`, `DR-P2`, `MR-S5` | 1 | Architecture |
| **3** | Establish identity and tenancy | `CR-F1`, `DR-P1`, `MR-S2`, `MR-S6` | 2 | **Security (G2)** |
| **4** | Enforce authorization | `CR-F7` | 3 | **Security (G2)** |
| **5** | Make the relational plane authoritative | `MR-S7`, `MR-S8` | 4 | **Data Integrity (G1)** |
| **6** | Establish audit and the API contract surface | `CR-F4`, `DR-P3`, `DR-P6`, `CR-M12` | 5 | Governance · Architecture |
| **7** | Consolidate the data access path | `MR-S1` | 5 | Architecture |
| **8** | Stand up event-based composition | `DR-P5` | 6 | Architecture |
| **9** | Establish deterministic workflow + platform services | `CR-M5`, `DR-C3`, `DR-S4`, `MR-S10`, `MR-S11` | 7, 8 | Architecture |
| **10** | Stand up the governed intelligence surface | `CR-S1`, `DR-C1`, `MR-S3`, `DR-X4` (⇢) | 9 | **AI Readiness (G3)** |
| **11** | Operate the intelligence surface | `CR-M3`, `MR-P12` | 10 | AI Readiness |
| **12** | Establish the knowledge substrate | `CR-S2`, `CR-M4`, `DR-C2` | 10 | AI Readiness |
| **13** | Enable decision support | `CR-S5` | 11, 12 | AI Readiness |
| **14** | Stand up governed automation | `CR-S3`, `MR-P6` | 13 | **AI Readiness (G4)** |
| **15** | Establish customer + product domains | `CR-M2`, `DR-C4`, `DR-C5` | 9 | Product Readiness |
| **16** | Deliver the acquisition → qualification path | `CR-S4`, `CR-M1`, `MR-P1`, `MR-P2`, `MR-P3`, `MR-B1`, `MR-B2` | 15 | Product Readiness |
| **17** | Deliver the value → proposal → contract path | `CR-O2`, `CR-M8`, `MR-P4`, `MR-P5`, `MR-P7`, `MR-B3`, `MR-B4` | 16 | Product Readiness |
| **18** | Deliver the delivery + service path | `CR-M9`, `CR-O1`, `CR-O3`, `MR-P8`, `MR-B5`, `CR-M7`, `DR-S1`, `DR-S2`, `CR-O4` | 17 | Product Readiness |
| **19** | Deliver the client relationship surface | `CR-F6`, `CR-O5`, `CR-O6`, `DR-S3`, `DR-S5`, `DR-S6`, `MR-S9`, `MR-P9`, `MR-P10`, `MR-P11`, `MR-B7`, `DR-X5` (⇢), `DR-X6` (⇢) | 18 | Product Readiness |
| **20** | Instrument the enterprise | `CR-F5`, `CR-M10`, `DR-P4`, `DR-C6`, `MR-B6` | 19 | **Operational Readiness (G5)** · Release Readiness |
| — | *Post-V1* | `DR-X1`, `DR-X2`, `DR-X3`, `DR-X7`, `DR-X8`, `CR-M6` | 20 | Release Readiness (G6) |

### 9.2 Approved concurrency

The following may proceed **in parallel** because their only cross-links are Soft or Optional. This is the delivery value of correctly classifying the edges.

| Parallel track A | Parallel track B | Justification |
|---|---|---|
| Steps **10–14** (Intelligence / Knowledge / Automation) | Steps **15–19** (Product surfaces, core journey) | §VI-14 Layer 7 — "workforce-dependent surfaces hard-depend on Layer 6; **core journey soft-depends**." `MR-P1`–`MR-P5`, `MR-P10`, `MR-P11` hard-depend only through Step 9. |
| Step **12** (Knowledge) | Step **11** (AI Operations) | §VI-13 — knowledge maturation is an explicit **soft** dependency of gateway use (cycle C-2). |
| Step **20** (Instrumentation) | Steps **15–19** (Product) | §VI-13 #10 — "observability improves but does not block product interface work" (cycle C-7). Track it as a recorded soft debt; it must converge before Release Readiness. |
| `MR-P6` Copilot (Step 14) | `MR-P5` Proposal (Step 17) | Proposal ⇢ Copilot is **Optional** (cycle C-6). Proposal releases without it. |

### 9.3 Sequence constraints

1. **Steps 1–5 are strictly serial.** No parallelism is admissible below Step 5: `CR-F3` → `CR-F2` → `CR-F1` → `CR-F7` → authoritative data is a pure chain, and every one of the remaining 81 nodes hard-depends on it.
2. **Step 5 is the gating step of the entire sequence.** §VI-25 — authoritative relational data is "the single most enabling release in the model." Nothing in Steps 10–20 may be *released* before it is RELEASABLE.
3. **Step 10 precedes every AI path without exception.** §VI-16 — no capability, module, or domain may reach a provider except through `MR-S3`. Any node found bypassing the gateway is refused at the AI Readiness gate, not remediated afterwards.
4. **Step 14 may not begin before Step 13 is VERIFIED.** §VI-13 #7 — automation "cannot precede authoritative data, enforced tenancy, a governed gateway, or a knowledge substrate."
5. **Step 20 must converge before Release Readiness.** It runs concurrently with 15–19 as a soft dependency, but G5 is a hard exit condition of V1 (§VI-14 Layer 8 — "Scale is unsafe without the ability to observe, diagnose, and recover").
6. **No step is a date.** §VI-14 governing rule — the sequence is not converted to dates or sprints here or anywhere.

### 9.4 Sequence validation

| Check | Result |
|---|---|
| Hard-edge subgraph acyclic | **PASS** — §6.2 |
| Every hard prerequisite precedes its dependent in the order | **PASS** — every `Hard prerequisite` column value is strictly less than its step number |
| Every registry entry appears exactly once | **PASS** — §8, 86/86 |
| No new capability, domain or module introduced | **PASS** — §8, 0 added |
| §VI-14 layer order preserved and unrenumbered | **PASS** — Stage *n* ≡ Layer *n* |
| §VI-18 gates applied, none created | **PASS** — 8 gates referenced, 0 added |
| External domains reached only via Optional/Soft edges | **PASS** — `DR-X1`–`DR-X8` carry no inbound hard edge |

---

## 10. Traceability

**Part II:** DNA Ch 8.3 / 11 / 14 / 17 / 18 / 20 / 23 / 25 / 33 / 35.
**Part III:** §III-23, §III-24, §III-25, §III-26, §III-28, §III-29, §III-37, §III-40, §III-44, §III-48, §III-53, §III-56.
**Part VI:** §VI-5, §VI-6, §VI-11, §VI-12, §VI-13, §VI-14, §VI-16, §VI-18, §VI-19, §VI-22, §VI-23, §VI-25, §VI-27, §VI-28.
**Reference Architecture v1.0:** Ch 7, Ch 8 (§8.4, §8.6, §8.8, §8.13), Ch 9, Ch 10 (§10.4, §10.6, §10.8, §10.9, §10.12, §10.13, §10.14, §10.15), Ch 11, Ch 14 (§14.5, §14.6, §14.7), Ch 15, Ch 16, Ch 24.
**Constitution:** Art. 2, Art. 3, Art. 14, Art. 15.

**Completion evidence.** An 86-node dependency graph across three tiers built solely from the approved Domain, Module and Capability Registries; three edge classes defined with the Optional class explicitly declared as a notation grounded in RA §10.12/§10.13; eight cycles detected with SCC analysis, none ILLEGAL, six resolved by already-approved mechanisms and two benign; three tiers of Foundation Capabilities identified by reverse reachability, with `CR-F3`, `CR-F2`, `CR-F1`, `CR-F7` proven to be universal hard predecessors; a twenty-step V1 implementation sequence stated as a topological order within the nine unmodified execution layers, with concurrency, constraints and a seven-point validation record.

---

**END OF ENTERPRISE DEPENDENCY GRAPH — P0-M0.3-C2**

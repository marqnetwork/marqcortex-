# Enterprise Capability Registry — P0-M0.3-C1.3

**Sources:** PX = Product Experience · ONT = Ontology · MB = Master Blueprint · RA = Reference Architecture · IG = Implementation Guide
**Total:** 561 capabilities (C0001–C0561) across M001–M186

## D01 — Intelligence & AI

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0001 | M001 | Unified AI Request Handling | Single governed entry point for every AI request, whatever the consumer. | RA 15.5 · MB III-17 |
| C0002 | M001 | Model Selection & Routing | Routes each request to the right model by task, cost, and policy. | RA 15.6 · MB III-17 |
| C0003 | M001 | Provider Abstraction & Substitution | Replaces a provider without changing any consumer. | RA 15.7 · MB III-17 |
| C0004 | M001 | AI Request Resilience & Fallback | Degrades gracefully when a provider fails or times out. | RA 15.5, 18.18 · MB III-17 |
| C0005 | M002 | Model Catalogue & Capability Declaration | Records approved models and what each may be used for. | RA 30.10 · MB III-17 |
| C0006 | M002 | Provider Entitlement Control | Governs which providers are authorised for which tenants. | RA 15.7 · MB III-47 |
| C0007 | M002 | Model Version Governance | Tracks model versions and approved substitutions. | RA 15.21, 30.10 |
| C0008 | M003 | Agent Definition & Authority Scoping | Defines an agent's purpose, scope, and permitted authority. | RA 15.8 · ONT Ch15 · PX Ch62 |
| C0009 | M003 | Agent Task Delegation | Assigns work to agents within declared boundaries. | RA 15.8 · PX Ch62 |
| C0010 | M003 | Multi-Agent Coordination | Coordinates several agents toward one objective without conflict. | RA 15.9 · PX Ch63 |
| C0011 | M003 | Agent Supervision & Human Override | Keeps a human able to inspect, pause, and override any agent. | RA 15.8, 15.17 · PX Ch61 |
| C0012 | M004 | Prompt Template Management | Maintains governed, versioned prompt templates. | RA 15.10, 30.10 |
| C0013 | M004 | Context Assembly & Scoping | Assembles only the context a request is entitled to see. | RA 15.15 · ONT Ch28 |
| C0014 | M004 | Prompt Change Control | Governs prompt change so behaviour shifts are deliberate. | RA 15.10, 15.21 |
| C0015 | M005 | Knowledge Grounding | Binds AI output to authoritative organizational knowledge. | RA 15.12 · MB III-19 |
| C0016 | M005 | Retrieval Orchestration | Selects and retrieves the most relevant knowledge per request. | RA 15.13, 30.10 |
| C0017 | M005 | Citation & Source Attribution | Shows which sources informed an AI answer. | RA 15.12, 16.16 · PX Ch35 |
| C0018 | M006 | Tool Registration & Scoping | Declares which tools AI may invoke and under what limits. | RA 15.14, 30.10 |
| C0019 | M006 | Governed Action Invocation | Executes AI-initiated actions only within permitted authority. | RA 15.14 · PX Ch30 |
| C0020 | M006 | Action Confirmation & Reversal | Requires confirmation for consequential actions and supports reversal. | RA 15.14, 15.17 · PX Ch30 |
| C0021 | M007 | Evidence-Based Reasoning | Reasons from stated evidence rather than unsupported assertion. | RA 15.16 · MB III-16 |
| C0022 | M007 | Decision Recommendation | Proposes decisions for human ratification, never final authority. | MB III-16, III-22 · PX Ch64 |
| C0023 | M007 | Deterministic Authority Preservation | Ensures AI never overrides authoritative calculated results. | MB III-16, III-21 · RA 15.3 |
| C0024 | M008 | Output Boundary Enforcement | Prevents AI output exceeding scope or advisory limits. | RA 15.17 · MB III-4 |
| C0025 | M008 | Prohibited Content Prevention | Blocks unsafe or disallowed AI output. | RA 15.17, 21.15 |
| C0026 | M008 | Uncertainty & Confidence Signalling | Constrains unsupported claims and signals uncertainty honestly. | RA 15.17 · PX Ch35 |
| C0027 | M009 | AI Quality Evaluation | Measures AI output quality against defined criteria. | RA 15.20 |
| C0028 | M009 | AI Behaviour Monitoring | Observes live AI behaviour for drift and anomaly. | RA 15.18 |
| C0029 | M009 | AI Responsiveness Insight | Tracks latency and throughput of AI capabilities. | RA 15.18 · MB III-58 |
| C0030 | M010 | AI Consumption Metering | Measures AI usage per tenant, capability, and request. | RA 15.19 |
| C0031 | M010 | Cost Attribution & Budgeting | Attributes AI cost and enforces budget limits. | RA 15.19 |
| C0032 | M010 | Usage Throttling & Quota Control | Limits consumption to protect cost and availability. | RA 15.19 |
| C0033 | M011 | AI Capability Introduction & Approval | Governs how new AI capability enters production. | RA 15.21 · PX Ch38 |
| C0034 | M011 | Model Promotion & Rollback | Promotes or reverts models under explicit control. | RA 15.21 · IG Ch18 |
| C0035 | M011 | AI Capability Retirement | Retires AI capability without breaking consumers. | RA 15.21 |

## D02 — Knowledge Management

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0036 | M012 | Canonical Concept Definition | Defines every concept once, authoritatively. | ONT Ch5–9, Ch19 |
| C0037 | M012 | Entity Modelling Standard | Governs how entities are described and structured. | ONT Ch19 |
| C0038 | M012 | Relationship Modelling Standard | Governs how entities may legitimately relate. | ONT Ch20–21, Ch29 |
| C0039 | M012 | Semantic Consistency Enforcement | Prevents conflicting or duplicate definitions entering the platform. | ONT Ch9, Ch28 |
| C0040 | M013 | Entity & Relationship Graph Representation | Represents the enterprise as a connected, queryable graph. | ONT Ch27 · RA 16.6 |
| C0041 | M013 | Graph Traversal & Inference | Answers questions by traversing relationships. | ONT Ch27 · RA 16.6 |
| C0042 | M013 | Cross-Domain Relationship Linking | Links entities across domains without collapsing boundaries. | ONT Ch22 · RA 16.6 |
| C0043 | M014 | Knowledge Asset Capture | Captures knowledge as a durable managed asset. | RA 16.7 · ONT Ch14 |
| C0044 | M014 | Knowledge Review & Approval | Approves knowledge before it becomes authoritative. | RA 16.14–16.15 |
| C0045 | M014 | Knowledge Currency & Retirement | Keeps knowledge current and retires stale content. | RA 16.14, 16.17 |
| C0046 | M015 | Taxonomy Definition | Defines the categories by which knowledge is organized. | RA 16.9 · ONT Ch14 |
| C0047 | M015 | Content Tagging & Categorization | Classifies knowledge assets consistently. | RA 16.8–16.9 |
| C0048 | M015 | Sensitivity & Confidentiality Labelling | Marks knowledge by sensitivity to drive access decisions. | RA 16.9, 21.16 |
| C0049 | M016 | Decision & Rationale Retention | Retains why decisions were made, not only what. | RA 16.18 · ONT Ch26 |
| C0050 | M016 | Contextual Recall | Resurfaces prior relevant context when it matters. | RA 15.11, 16.18 · MB III-20 |
| C0051 | M016 | Compounding Organizational Learning | Lets insight accumulate across engagements over time. | MB III-20 · PX Ch48 |
| C0052 | M017 | Source Provenance Recording | Records the origin of every knowledge assertion. | RA 16.16 · ONT Ch26 |
| C0053 | M017 | Derivation Lineage Tracking | Traces how derived knowledge was produced. | RA 16.16 · ONT Ch26 |
| C0054 | M017 | Traceability to Authoritative Source | Links any knowledge claim back to its authority. | ONT Ch26 · RA 16.16 |
| C0055 | M018 | Knowledge Ownership Assignment | Assigns an accountable owner to every knowledge area. | RA 16.15 · ONT Ch30 |
| C0056 | M018 | Knowledge Quality Assessment & Remediation | Measures and improves knowledge quality. | RA 16.17 |
| C0057 | M018 | Knowledge Policy Enforcement | Enforces rules on what may be published as knowledge. | RA 11.19, 16.15 |
| C0058 | M019 | Access-Governed Knowledge Distribution | Shares knowledge only with entitled audiences. | RA 16.19 · PX Ch23 |
| C0059 | M019 | Cross-Team Knowledge Reuse | Enables reuse rather than recreation of knowledge. | RA 16.19 · PX Ch23 |
| C0060 | M019 | AI Knowledge Availability | Makes approved knowledge consumable by AI systems. | RA 16.20 · MB III-19 |

## D03 — Work & Workflow Execution

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0061 | M020 | Workflow Type Definition | Declares the categories of work the enterprise executes. | RA 17.5, 30.12 · ONT Ch13 |
| C0062 | M020 | Workflow Stage & Lifecycle Modelling | Defines the stages work passes through to completion. | RA 17.6 · ONT Ch13 |
| C0063 | M020 | Work Item Structure & Hierarchy | Structures work into objectives, milestones, and tasks. | ONT Ch13 · MB III-23 |
| C0064 | M021 | Process Orchestration | Coordinates multi-step processes to a defined outcome. | RA 17.9, Ch26 · IG Ch20 |
| C0065 | M021 | Workflow Execution Control | Starts, pauses, resumes, and cancels running work. | RA 17.7 · PX Ch65 |
| C0066 | M021 | Event-Driven Work Coordination | Progresses work in response to business events. | RA 17.10, Ch25 · MB III-32 |
| C0067 | M022 | Workflow State Persistence | Maintains correct state for work spanning long durations. | RA 17.8, 17.13 · MB III-11 |
| C0068 | M022 | Long-Running Process Continuity | Keeps months-long work reliable across restarts. | RA 17.13 · MB III-11 |
| C0069 | M022 | Compensation & Rollback | Reverses partially completed work coherently. | RA 17.14 |
| C0070 | M023 | Human Task Assignment & Routing | Routes work needing judgement to the right person. | RA 17.11 · ONT Ch13 |
| C0071 | M023 | Approval & Sign-Off Management | Captures formal approval before work advances. | RA 17.11 · MB III-29 · PX Ch28 |
| C0072 | M023 | Work Queue & Triage | Presents pending human work in prioritised order. | MB III-23 · PX Ch16 |
| C0073 | M024 | AI Work Proposal | Lets AI propose next steps and sequencing for human review. | RA 17.12 · PX Ch65 |
| C0074 | M024 | AI-Assisted Progression | Advances routine work steps under human authority. | RA 17.12 · PX Ch30 |
| C0075 | M024 | Autonomy Boundary Control | Limits what work AI may progress unattended. | RA 17.12, 15.17 · PX Ch66 |
| C0076 | M025 | Business Process Definition | Documents the processes that deliver enterprise value. | RA 14.9 · MB III-29 |
| C0077 | M025 | Value Stream Mapping | Maps activity sequences that produce customer value. | RA 14.7 · MB III-29 |
| C0078 | M025 | Process Rule & Policy Application | Applies business rules and policy at each process step. | RA 14.10–14.11 · MB III-54 |
| C0079 | M026 | Delivery Blueprint Definition | Defines the plan by which committed work is delivered. | MB III-23, III-25 |
| C0080 | M026 | Workstream & Milestone Tracking | Tracks delivery progress against planned milestones. | MB III-23 · ONT Ch13 |
| C0081 | M026 | Delivery Gate Enforcement | Blocks delivery progression until gate criteria are met. | MB III-23, III-29 · IG Ch39 |
| C0082 | M027 | Change Request Capture | Records requested changes to committed scope. | MB III-25, III-75 |
| C0083 | M027 | Change Impact Assessment | Assesses cost, schedule, and risk impact before approval. | MB III-21, III-75 |
| C0084 | M027 | Scope Version Control | Versions agreed scope so drift is visible. | MB III-21, III-71 |
| C0085 | M028 | Failure Detection & Classification | Detects and classifies workflow failure accurately. | RA 17.15 · MB III-56 |
| C0086 | M028 | Retry & Backoff Management | Retries transient failures without duplicating effect. | RA 17.16 |
| C0087 | M028 | Exception Escalation | Escalates unrecoverable exceptions to a human owner. | RA 17.15 · MB III-57 |
| C0088 | M029 | Work-in-Flight Visibility | Shows what work is active, blocked, or at risk. | RA 17.17 · MB III-30 |
| C0089 | M029 | Cycle Time & Throughput Analysis | Measures how quickly work completes. | RA 17.18 · MB III-82 |
| C0090 | M029 | Bottleneck Identification | Identifies where work consistently stalls. | RA 17.18 · PX Ch32 |

## D04 — Customer & Client Engagement

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0091 | M030 | Customer Record Management | Maintains the authoritative customer record. | ONT 18.4 · MB III-12 · RA 14.5 |
| C0092 | M030 | Contact & Relationship Management | Maintains people and their relationship to accounts. | MB III-12 · ONT Ch12 |
| C0093 | M030 | Customer Identity Resolution | Resolves duplicate or partial customer identities. | MB III-12 · RA 20.7 |
| C0094 | M031 | Client Status Visibility | Shows a client where their engagement currently stands. | MB III-23 · PX Ch8 |
| C0095 | M031 | Client Deliverable Access | Gives clients access to their reports, solutions, and proposals. | MB III-23 · PX Ch8 |
| C0096 | M031 | Client Self-Service Actions | Lets clients respond, approve, and act without intermediaries. | MB III-23 · PX Ch8 |
| C0097 | M032 | Client Message Exchange | Carries governed two-way messages with the client. | MB III-23, III-25 |
| C0098 | M032 | Conversation History & Continuity | Preserves the full record of client correspondence. | MB III-23 · RA 13.17 |
| C0099 | M032 | Client Communication Governance | Ensures outbound client communication meets standards. | MB III-25 · PX Ch35 |
| C0100 | M033 | Journey Stage Definition | Defines the stages a customer progresses through. | ONT 18.6 · MB III-28 |
| C0101 | M033 | Touchpoint Management | Governs each point of contact across the journey. | ONT 18.8 · PX Ch19 |
| C0102 | M033 | Interaction Capture | Records every meaningful customer interaction. | ONT 18.7 · MB III-28 |
| C0103 | M034 | Feedback Collection | Captures customer feedback at defined moments. | ONT 18.9 · PX Ch32 |
| C0104 | M034 | Sentiment & Satisfaction Assessment | Assesses how customers actually feel about the engagement. | ONT 18.9–18.10 · PX Ch32 |
| C0105 | M034 | Feedback-Driven Improvement Routing | Routes feedback into improvement and product decisions. | PX Ch32 · ONT Ch22 |
| C0106 | M035 | Customer Health Assessment | Assesses the health of each customer relationship. | PX Ch55 · MB III-25 |
| C0107 | M035 | Churn & Risk Signalling | Flags accounts at risk before they are lost. | PX Ch55 · MB III-25 |
| C0108 | M035 | Expansion Opportunity Identification | Identifies where a customer could gain more value. | PX Ch55 · MB III-23 |
| C0109 | M036 | Onboarding Journey Execution | Moves a new customer from agreement to productive use. | RA 14.6 · MB III-10 |
| C0110 | M036 | Customer Enablement & Orientation | Helps customers understand and adopt what they bought. | PX Ch18 · RA 14.6 |
| C0111 | M036 | Onboarding Readiness Verification | Confirms prerequisites are met before delivery begins. | MB III-10, III-29 |

## D05 — Product Management

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0112 | M037 | Product Definition | Defines each product and the value it delivers. | ONT 18.1 · MB III-1 |
| C0113 | M037 | Business Service Definition | Defines the services offered to customers. | ONT 18.2 · RA 14.8 |
| C0114 | M037 | Offering Portfolio Management | Manages the full set of products and services offered. | RA 14.5 · PX Ch57 |
| C0115 | M038 | Feature Definition & Intent | Defines features as units of customer-visible value. | ONT 18.3 · MB III-23 |
| C0116 | M038 | Feature Value Justification | Requires each feature to justify the value it creates. | PX Ch4 · ONT 18.11 |
| C0117 | M038 | Feature Ownership Assignment | Assigns clear ownership for each feature. | RA 14.13 · MB III-85 |
| C0118 | M039 | Product Scope Declaration | States explicitly what the product does. | MB III-2, III-4 |
| C0119 | M039 | Product Boundary Enforcement | States and enforces what the product will not do. | MB III-4 · PX Ch4 |
| C0120 | M039 | Advisory Limit Governance | Prevents the product overstepping advisory boundaries. | MB III-4 · ONT Ch17 |
| C0121 | M040 | Roadmap Definition & Sequencing | Sequences product investment into ordered waves. | PX Ch57 · MB VI-22 |
| C0122 | M040 | Capability Dependency Planning | Plans delivery around real capability dependencies. | MB VI-25 · RA 10.14 |
| C0123 | M040 | Release Wave Planning | Groups capability into coherent releasable waves. | MB VI-22 · IG Ch33 |
| C0124 | M041 | Product Metric Definition | Defines which measures prove product value. | MB III-81 · PX Ch10 |
| C0125 | M041 | Adoption & Usage Measurement | Measures whether capability is actually used. | MB III-50, III-81 |
| C0126 | M041 | Outcome & Success Verification | Verifies the product delivered its intended outcome. | MB III-83 · PX Ch10 · ONT 18.12 |

## D06 — Business Operations

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0127 | M042 | Service Definition & Catalogue | Defines each operational service and its purpose. | RA 19.5, 30.21 · ONT 16.1 |
| C0128 | M042 | Service Level Definition | Sets the levels at which services are committed to run. | RA 19.7 |
| C0129 | M042 | Service Level Tracking & Reporting | Measures and reports performance against commitments. | RA 19.7 · MB III-82 |
| C0130 | M043 | Incident Detection & Triage | Detects disruption and assesses its severity. | RA 19.11 · ONT 16.13 |
| C0131 | M043 | Incident Resolution & Recovery | Restores service and confirms recovery. | RA 19.11 · IG Ch35 |
| C0132 | M043 | Problem Root Cause Elimination | Removes the underlying cause so issues do not recur. | RA 19.12 · PX Ch32 |
| C0133 | M044 | Change Assessment & Authorization | Assesses and authorizes change before production. | RA 19.13 · MB III-75 |
| C0134 | M044 | Change Scheduling & Coordination | Schedules change to minimise operational disruption. | RA 19.13 · IG Ch33 |
| C0135 | M044 | Change Rollback Readiness | Ensures every change can be reversed. | RA 19.13 · IG Ch24 |
| C0136 | M045 | Demand Forecasting | Forecasts demand on platform capacity. | RA 19.14 · MB III-59 |
| C0137 | M045 | Capacity Planning & Scaling | Provides sufficient capacity to meet demand. | RA 19.14 · MB III-59 |
| C0138 | M045 | Resource Allocation & Fair Use | Allocates shared resources fairly across tenants. | ONT 16.8 · RA 19.14 |
| C0139 | M046 | Failure Mode Analysis | Identifies how the platform can fail before it does. | RA 19.15, 11.14 |
| C0140 | M046 | Fault Tolerance & Graceful Degradation | Keeps the platform useful when components fail. | RA 11.14, 11.16 · MB III-60 |
| C0141 | M046 | Availability Assurance | Sustains agreed availability of critical services. | MB III-61 · RA 11.16 |
| C0142 | M047 | Recovery Objective Definition | Defines acceptable recovery time and data loss. | RA 19.16 · MB III-67 |
| C0143 | M047 | Disaster Recovery Execution | Restores operation after major loss. | RA 19.16 · IG Ch31 |
| C0144 | M047 | Continuity Testing & Verification | Proves recovery works before it is needed. | RA 19.16 · IG Ch31 |
| C0145 | M048 | Operational Task Automation | Removes manual operational toil through automation. | RA 19.17 · PX Ch30 |
| C0146 | M048 | Self-Healing Response | Automatically corrects known recoverable conditions. | RA 19.17 · PX Ch66 |
| C0147 | M048 | Runbook & Procedure Automation | Codifies operational procedure as repeatable execution. | RA 19.17 · IG Ch34 |
| C0148 | M049 | Operational State Awareness | Keeps operators continuously aware of real state. | RA 19.20 · PX Ch31 · ONT 16.9 |
| C0149 | M049 | Operational Analytics | Analyses operational behaviour to find improvement. | RA 19.20 · MB III-82 |
| C0150 | M049 | Continuous Improvement Cycle | Turns operational learning into durable change. | RA 19.21 · PX Ch32 |

## D07 — Diagnostic Assessment & Advisory

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0151 | M050 | Diagnostic Question Set Management | Maintains the questions the assessment is built on. | MB III-23 · PX Ch28 |
| C0152 | M050 | Response Capture & Validation | Captures answers and rejects invalid input. | MB III-21, III-55 |
| C0153 | M050 | Input Normalization | Normalizes raw answers into comparable inputs. | MB III-21–III-22 |
| C0154 | M051 | Readiness Score Calculation | Produces the authoritative overall readiness score. | MB III-5, III-21–22 |
| C0155 | M051 | Deterministic Score Reproducibility | Guarantees identical inputs always produce identical scores. | MB III-21–22 · RA 15.3 |
| C0156 | M051 | Instant Score Delivery | Returns a readiness result within minutes of assessment. | MB III-8, III-23 · PX Ch11 |
| C0157 | M052 | Multi-Axis Domain Scoring | Scores each business area on its defined axes. | MB III-5, III-37 |
| C0158 | M052 | Business Area Discovery | Identifies where a business has the greatest exposure. | MB III-5 · RA 14.6 |
| C0159 | M052 | Domain Score Persistence & Comparison | Retains domain scores for tracking and comparison. | MB III-37 |
| C0160 | M053 | Recommendation Qualification | Admits only findings meeting defined value thresholds. | MB III-5, III-22 |
| C0161 | M053 | Deterministic Priority Ranking | Ranks qualified recommendations by defined formula. | MB III-5, III-22 |
| C0162 | M053 | Dependency-Aware Sequencing | Sequences recommendations respecting real dependencies. | MB III-21 · RA 10.14 |
| C0163 | M054 | Portfolio Assembly | Assembles ranked recommendations into one portfolio. | MB III-21, III-23 |
| C0164 | M054 | Portfolio Guardrail Enforcement | Keeps the portfolio bounded to a usable size. | MB III-5, III-22 |
| C0165 | M054 | Dependency Map Presentation | Shows how recommended work interconnects. | MB III-21 · ONT Ch24 |
| C0166 | M055 | Base Return Modelling | Models expected financial return of recommended work. | MB III-21, III-23 |
| C0167 | M055 | Risk & Scenario Modelling | Models outcomes under varying assumptions and risk. | MB III-21, III-23 |
| C0168 | M055 | Payback & Cost Modelling | Models investment cost and time to payback. | MB III-21, III-23 |
| C0169 | M056 | Actuals Capture | Captures realized results after delivery. | MB III-21, III-23 |
| C0170 | M056 | Modelled-versus-Actual Comparison | Compares realized value against what was promised. | MB III-21 · PX Ch54 |
| C0171 | M056 | Benefit Realisation Reporting | Reports whether committed value was actually achieved. | MB III-23 · PX Ch54 |
| C0172 | M057 | Readiness Report Generation | Produces the client-facing readiness report. | MB III-23, III-49 |
| C0173 | M057 | Result Narration | Explains deterministic results in plain business language. | MB III-15, III-23 · PX Ch35 |
| C0174 | M057 | Strategic Advisory Framing | Frames findings as actionable strategic guidance. | MB III-23 · PX Ch28 |
| C0175 | M058 | Cross-Engine Consistency Checking | Verifies calculated outputs remain mutually coherent. | MB III-21, III-55 |
| C0176 | M058 | Assumption Declaration & Traceability | Makes every assumption explicit and traceable. | MB III-55 · ONT Ch26 |
| C0177 | M058 | Recalculation Trigger Enforcement | Forces recalculation when underlying inputs change. | MB III-29, III-55 |

## D08 — Revenue & Commercial Management

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0178 | M059 | Inbound Lead Capture | Captures inbound interest into the pipeline. | MB III-23, III-25 |
| C0179 | M059 | Lead Qualification | Determines which leads warrant commercial effort. | MB III-25 · RA 14.5 |
| C0180 | M059 | Lead Source Attribution | Records where each lead originated. | MB III-12, III-25 |
| C0181 | M060 | Opportunity Lifecycle Tracking | Tracks opportunities through stages to decision. | RA 14.5, 30.7 · MB III-25 |
| C0182 | M060 | Pipeline Visibility & Forecasting | Shows expected commercial outcome across the pipeline. | MB III-23, III-25 |
| C0183 | M060 | Opportunity Prioritization | Focuses effort on the highest-value opportunities. | MB III-25 · RA 14.16 |
| C0184 | M061 | Campaign Definition & Execution | Defines and runs outbound commercial campaigns. | RA 14.5 · MB III-25 |
| C0185 | M061 | Nurture Sequence Management | Progresses unconverted interest over time. | MB III-25, III-48 |
| C0186 | M061 | Campaign Effectiveness Measurement | Measures what campaigns actually produced. | MB III-50 · RA 14.15 |
| C0187 | M062 | Proposal Composition | Assembles a client proposal from approved content. | MB III-23 · RA 14.6 |
| C0188 | M062 | Readiness Gate Enforcement | Blocks a proposal advancing until it passes quality gates. | MB III-21, III-29 |
| C0189 | M062 | Proposal Status Governance | Governs the permitted status transitions of a proposal. | MB III-10, III-29 |
| C0190 | M063 | Scope Definition & Agreement | Defines precisely what is being sold. | MB III-21, III-25 |
| C0191 | M063 | Pricing Determination | Determines price consistently against defined rules. | MB III-25 · RA 14.10 |
| C0192 | M063 | Commercial Terms Definition | Establishes the commercial terms of the engagement. | MB III-21 · ONT Ch17 |
| C0193 | M064 | Contract Generation | Generates the agreement from accepted scope. | MB III-21, III-23 |
| C0194 | M064 | Contract Validity Enforcement | Invalidates contracts whose basis has changed. | MB III-29 · ONT Ch17 |
| C0195 | M064 | Contract Record Custody | Retains the authoritative executed agreement. | MB III-23 · ONT Ch17 |
| C0196 | M065 | Charge Calculation | Calculates what each customer owes. | MB III-46 |
| C0197 | M065 | Invoice Issuance | Issues invoices accurately and on schedule. | MB III-46 · RA 30.7 |
| C0198 | M065 | Payment Reconciliation | Reconciles payments against what was invoiced. | MB III-46 · RA 8.4 |
| C0199 | M066 | Entitlement Definition | Defines what each customer is entitled to use. | MB III-47 · RA 14.5 |
| C0200 | M066 | License Assignment & Enforcement | Assigns and enforces licensed access. | MB III-47 · RA 21.7 |
| C0201 | M066 | Usage-Against-Entitlement Tracking | Tracks consumption against what was licensed. | MB III-47, III-50 |
| C0202 | M067 | Quarterly Business Review Preparation | Prepares evidence-based value reviews with clients. | MB III-21, III-23 |
| C0203 | M067 | Revenue Intelligence Reporting | Reports commercial performance and trend. | MB III-23 · PX Ch59 |
| C0204 | M067 | Account Growth & Renewal Planning | Plans renewal and expansion of existing accounts. | MB III-25 · PX Ch60 |

## D09 — User Experience & Interaction

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0205 | M068 | Channel Definition per Actor | Defines the surface each actor type engages through. | RA 13.4 · MB III-6 |
| C0206 | M068 | Surface Access Boundary | Keeps each actor confined to their intended surface. | MB III-6, III-40 · RA 13.18 |
| C0207 | M068 | Multi-Device Experience Consistency | Delivers a coherent experience across devices. | RA 13.4 · PX Ch25 |
| C0208 | M069 | Information Hierarchy Definition | Orders information by importance and relationship. | PX Ch20 · RA 13.6 |
| C0209 | M069 | Navigation Structure | Lets people move through the platform predictably. | RA 13.7 · PX Ch21 |
| C0210 | M069 | Orientation & Wayfinding | Ensures people always know where they are. | PX Ch21 · RA 13.7 |
| C0211 | M070 | Workspace Composition | Assembles the environment where work happens. | RA 13.8 · PX Ch22 |
| C0212 | M070 | Layout Stability & Predictability | Keeps the working environment calm and stable. | PX Ch22 · RA 13.8 |
| C0213 | M070 | Contextual Panel Assembly | Brings relevant context into the working view. | RA 13.6, 13.8 · PX Ch22 |
| C0214 | M071 | Interaction Pattern Standardization | Standardizes how people interact with the platform. | RA 13.9 · MB III-27 |
| C0215 | M071 | Visual Language & Design System | Provides one consistent visual vocabulary. | MB III-27 · PX Ch9 |
| C0216 | M071 | Feedback & Response Clarity | Makes every action's result immediately clear. | PX Ch9, Ch13 · RA 13.9 |
| C0217 | M072 | Progressive Capability Disclosure | Reveals capability only when it creates value. | PX Ch14, Ch18 · RA 13.11 |
| C0218 | M072 | Personalized Experience Adaptation | Adapts the experience to the individual. | RA 13.11 · PX Ch18 |
| C0219 | M072 | Cognitive Load Management | Keeps demand on attention within human limits. | PX Ch13, Ch16 · RA 13.3 |
| C0220 | M073 | Accessibility Conformance | Meets defined accessibility standards. | MB III-70 · RA 13.12 |
| C0221 | M073 | Assistive Technology Support | Works correctly with assistive technologies. | RA 13.12 · MB III-70 |
| C0222 | M073 | Inclusive Interaction Design | Designs interaction usable by people of all abilities. | PX Ch9 · RA 13.12 |
| C0223 | M074 | Language Localization | Presents the platform in the user's language. | RA 13.13 · PX Ch25 |
| C0224 | M074 | Regional Format Adaptation | Adapts dates, numbers, and currency to locale. | RA 13.13 |
| C0225 | M074 | Multi-Region Content Management | Manages content variants across regions. | RA 13.13 · PX Ch25 |
| C0226 | M075 | Journey Definition per Actor | Defines the end-to-end journey for each actor. | MB III-8, III-28 · ONT 18.6 |
| C0227 | M075 | Journey Progression Tracking | Tracks where each participant is in their journey. | MB III-28 · ONT 18.6 |
| C0228 | M075 | Journey Friction Identification | Finds where journeys break down in practice. | PX Ch19, Ch32 |
| C0229 | M076 | Reasoning Transparency | Shows the basis on which a conclusion was reached. | PX Ch35 · RA 13.10 |
| C0230 | M076 | Source & Evidence Disclosure | Discloses the evidence behind presented results. | PX Ch35 · ONT Ch26 |
| C0231 | M076 | Confidence & Limitation Communication | States honestly what the system does not know. | PX Ch14, Ch35 · RA 15.17 |

## D10 — Analytics & Reporting

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0232 | M077 | Report Definition & Templating | Defines governed report structures. | MB III-49 · RA 14.6 |
| C0233 | M077 | Report Generation & Distribution | Produces and delivers reports to their audience. | MB III-49 |
| C0234 | M077 | Report Versioning & Integrity | Preserves what each issued report contained. | MB III-49 · RA 16.10 |
| C0235 | M078 | Dashboard Composition | Assembles dashboards for each audience. | MB III-51 · RA 13.6 |
| C0236 | M078 | Real-Time State Visualization | Shows current state at a glance. | MB III-51, III-21 |
| C0237 | M078 | Trend & Comparison Visualization | Shows change over time and against benchmark. | MB III-51 · PX Ch49 |
| C0238 | M079 | Metric Definition & Ownership | Defines each metric once with a clear owner. | RA 14.15 · MB III-81 |
| C0239 | M079 | KPI Target Setting | Sets targets against which performance is judged. | MB III-83 · RA 14.15 |
| C0240 | M079 | Metric Calculation Consistency | Guarantees a metric means the same thing everywhere. | RA 14.15 · ONT Ch28 |
| C0241 | M080 | Pattern & Anomaly Detection | Detects meaningful patterns and outliers. | PX Ch49 · ONT Ch14 |
| C0242 | M080 | Predictive Insight Generation | Produces forward-looking insight from history. | PX Ch49 · RA 30.9 |
| C0243 | M080 | Insight Explainability | Explains why an insight was produced. | PX Ch35, Ch49 · RA 11.18 |
| C0244 | M081 | Usage & Behaviour Analytics | Analyses how the platform is actually used. | MB III-50 |
| C0245 | M081 | Funnel & Conversion Analysis | Measures progression and drop-off through journeys. | MB III-50 · PX Ch19 |
| C0246 | M081 | Operational Performance Analytics | Analyses operational efficiency and cost. | RA 19.20 · MB III-82 |

## D11 — Search & Discovery

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0247 | M082 | Content Indexing | Indexes enterprise content so it can be found. | RA 16.11 · PX Ch24 |
| C0248 | M082 | Query Processing | Interprets what a searcher is asking for. | RA 16.11 · PX Ch24 |
| C0249 | M082 | Federated Search Across Sources | Searches across multiple sources as one. | PX Ch24 · RA 16.11 |
| C0250 | M083 | Semantic Meaning Matching | Finds information by meaning, not keyword. | RA 16.12 · IG Ch19 |
| C0251 | M083 | Embedding Generation & Maintenance | Maintains semantic representations of content. | RA 16.12, 20.14 |
| C0252 | M083 | Similarity Retrieval | Retrieves conceptually similar content. | RA 16.12, 20.14 |
| C0253 | M084 | Proactive Content Surfacing | Surfaces relevant content users did not request. | PX Ch24 · RA 13.16 |
| C0254 | M084 | Contextual Recommendation | Recommends content based on current context. | PX Ch24 · RA 13.11 |
| C0255 | M084 | Entity & Concept Discovery | Helps users discover related entities and concepts. | ONT Ch27 · PX Ch24 |
| C0256 | M085 | Relevance Ranking | Orders results by genuine usefulness. | RA 13.16, 16.11 |
| C0257 | M085 | Permission-Filtered Results | Never returns results a user may not see. | RA 13.18, 16.19 · ONT Ch28 |
| C0258 | M085 | Search Quality Measurement | Measures whether searches actually succeed. | RA 16.17 · MB III-50 |

## D12 — Communication & Notifications

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0259 | M086 | Notification Generation | Creates notifications from business events. | MB III-48 · ONT 16.7 |
| C0260 | M086 | Notification Routing & Targeting | Delivers notifications to the right recipients. | MB III-48 · RA 13.15 |
| C0261 | M086 | Notification Prioritization & Noise Control | Prevents notification fatigue. | RA 13.15 · PX Ch16 |
| C0262 | M087 | Email Delivery | Reliably delivers outbound email. | MB III-48, III-24 |
| C0263 | M087 | Delivery Queueing & Retry | Queues and retries failed delivery. | MB III-24, III-48 · RA 18.11 |
| C0264 | M087 | Delivery Status Tracking | Tracks whether messages actually arrived. | MB III-48 · RA 18.19 |
| C0265 | M088 | Template Management | Maintains governed communication templates. | MB III-48 |
| C0266 | M088 | Correspondence Composition | Composes correspondence from approved templates. | MB III-23, III-48 |
| C0267 | M088 | Tone & Brand Consistency | Keeps communication consistent in voice and brand. | PX Ch9 · MB III-48 |
| C0268 | M089 | Shared Object Collaboration | Lets multiple people work on the same object. | PX Ch27 · RA 13.17 |
| C0269 | M089 | Commentary & Annotation | Allows discussion in the context of the work. | PX Ch27 · RA 13.17 |
| C0270 | M089 | Collaborative Decision Capture | Records decisions reached collaboratively. | PX Ch28 · ONT Ch13 |
| C0271 | M090 | Channel Preference Management | Respects how each recipient prefers to be contacted. | MB III-48 · RA 21.16 |
| C0272 | M090 | Consent Capture & Honouring | Captures and honours communication consent. | MB III-69 · RA 21.16 |
| C0273 | M090 | Unsubscribe & Suppression | Stops contacting those who have opted out. | MB III-48, III-69 |

## D13 — Document & Records Management

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0274 | M091 | Block-Based Content Composition | Builds documents from reusable content blocks. | MB III-23, III-21 |
| C0275 | M091 | Section & Structure Management | Organizes documents into governed sections. | MB III-23 · RA 16.10 |
| C0276 | M091 | Assisted Content Authoring | Assists authors without removing their authority. | MB III-23 · PX Ch61 |
| C0277 | M092 | Revision History | Retains every revision of a document. | MB III-21, III-71 |
| C0278 | M092 | Version Comparison | Shows what changed between versions. | MB III-71 · RA 16.10 |
| C0279 | M092 | Version Increment Governance | Governs when a new version is created. | MB III-21, III-71 |
| C0280 | M093 | Record Freezing | Freezes an issued record against later change. | MB III-11, III-29 |
| C0281 | M093 | Integrity Verification | Proves a record has not been altered. | MB III-11, III-21 |
| C0282 | M093 | Append-Only Record Guarantee | Guarantees records are added to, never overwritten. | MB III-11 · ONT Ch17 |
| C0283 | M094 | Document Storage & Organization | Stores documents in a governed structure. | RA 16.10 · MB III-37 |
| C0284 | M094 | Document Access Control | Restricts document access to entitled parties. | RA 16.19, 21.7 |
| C0285 | M094 | Document Metadata Management | Describes each document so it can be governed. | RA 16.8, 16.10 |
| C0286 | M095 | Client-Ready Output Generation | Produces polished output for external audiences. | MB III-21, III-24 |
| C0287 | M095 | Snapshot-Sourced Rendering | Renders only from frozen authoritative records. | MB III-29 · RA 16.10 |
| C0288 | M095 | Multi-Format Export | Exports records into required formats. | MB III-24 · RA 16.10 |
| C0289 | M096 | Deliverable Template Library | Maintains governed templates for recurring deliverables. | MB III-21, III-23 |
| C0290 | M096 | Template Assembly | Assembles deliverables from templates and data. | MB III-21 |
| C0291 | M096 | Template Governance & Approval | Approves templates before operational use. | MB III-21 · RA 12.9 |
| C0292 | M097 | Retention Policy Application | Retains records for their required period. | RA 20.19 · MB III-68 |
| C0293 | M097 | Archival & Cold Storage | Moves inactive records to archival storage. | RA 20.19 · MB III-66 |
| C0294 | M097 | Defensible Disposal | Disposes of records lawfully with evidence. | MB III-68–69 · ONT Ch17 |

## D14 — Scheduling & Coordination

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0295 | M098 | Appointment Booking | Books meetings between clients and the team. | MB III-23 · RA 14.6 |
| C0296 | M098 | Meeting Lifecycle Management | Manages confirmation, change, and cancellation. | RA 14.6 · MB III-23 |
| C0297 | M098 | Scheduling Notification | Notifies participants of scheduled commitments. | MB III-48 · RA 13.15 |
| C0298 | M099 | Availability Definition | Declares when people and resources are available. | RA Ch8, 14.6 · ONT 16.8 |
| C0299 | M099 | Calendar State Management | Maintains authoritative calendar state. | RA Ch8, 14.6 |
| C0300 | M099 | Conflict Detection & Resolution | Prevents double-booking of people or resources. | RA 14.6 · ONT 16.8 |
| C0301 | M100 | Schedule Definition | Defines when recurring processing must run. | MB III-34 · RA 30.18 |
| C0302 | M100 | Reliable Triggered Execution | Triggers scheduled work dependably. | MB III-33–34 · RA 30.18 |
| C0303 | M100 | Missed & Overlapping Run Handling | Handles missed or overlapping executions safely. | MB III-33 · RA 17.16 |

## D15 — Identity & Access Management

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0304 | M101 | Identity Establishment | Establishes a durable identity for every participant. | RA 11.4, 21.5 · ONT Ch12 |
| C0305 | M101 | Identity Lifecycle Management | Manages identity from creation to deactivation. | RA 11.4, 30.13 · ONT Ch12 |
| C0306 | M101 | Machine & Service Identity | Establishes identity for non-human actors. | RA 11.4, 21.5 · ONT Ch12 |
| C0307 | M102 | Credential Verification | Verifies claimed identity before granting access. | RA 21.6 · MB III-40 · IG Ch17 |
| C0308 | M102 | Session Establishment & Expiry | Establishes sessions and expires them predictably. | MB III-11, III-40 · RA 13.14 |
| C0309 | M102 | Multi-Actor Session Separation | Keeps distinct actor sessions strictly separate. | MB III-6, III-40 |
| C0310 | M103 | Access Decision Evaluation | Decides whether a specific request is permitted. | RA 21.7, 11.5 · MB III-41 |
| C0311 | M103 | Policy Enforcement at Every Boundary | Enforces access consistently at every entry point. | RA 11.5, 21.9 · IG Ch17 |
| C0312 | M103 | Least-Privilege Enforcement | Grants only the minimum access required. | RA 21.7–21.8 · PX Ch34 |
| C0313 | M104 | Role Definition | Defines roles as reusable bundles of responsibility. | MB III-42 · ONT Ch12 |
| C0314 | M104 | Role Assignment | Assigns roles to identities within an organization. | MB III-42, III-45 · ONT Ch12 |
| C0315 | M104 | Role Hierarchy & Inheritance | Structures roles so privilege is inherited coherently. | MB III-42 · RA 21.8 |
| C0316 | M105 | Permission Definition | Defines the granular permissions the platform recognises. | MB III-43 · RA 21.8 |
| C0317 | M105 | Permission Grant & Revocation | Grants and withdraws permissions reliably. | MB III-43 · RA 21.7 |
| C0318 | M105 | Attribute-Based Access Conditions | Conditions access on contextual attributes. | RA 21.8 · ONT Ch12 |
| C0319 | M106 | Continuous Request Verification | Treats every request as untrusted until verified. | RA 21.9 · PX Ch34 |
| C0320 | M106 | Trust Boundary Definition | Declares where trust boundaries sit. | RA 21.9, 11.8 |
| C0321 | M106 | Privilege Escalation Prevention | Prevents unauthorized elevation of privilege. | RA 21.9 · MB III-39 |

## D16 — Organization & Tenancy

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0322 | M107 | Organization Creation & Provisioning | Creates and provisions a new organization. | MB III-9, III-45 · ONT Ch11 |
| C0323 | M107 | Organization Configuration | Configures an organization for operation. | MB III-9, III-53 |
| C0324 | M107 | Organization Suspension & Closure | Suspends or closes an organization cleanly. | MB III-9 · ONT Ch11 |
| C0325 | M108 | Membership Management | Manages who belongs to an organization. | MB III-45 · ONT Ch11 |
| C0326 | M108 | Team Composition | Groups members into teams with shared purpose. | ONT Ch11 · RA 14.12 |
| C0327 | M108 | Invitation & Access Onboarding | Brings new members into an organization. | MB III-45 · RA 14.6 |
| C0328 | M109 | Tenant Data Partitioning | Partitions all data by owning organization. | MB III-44 · RA 11.8 |
| C0329 | M109 | Cross-Tenant Access Prevention | Guarantees no organization can reach another's data. | RA 11.8 · MB III-44 |
| C0330 | M109 | Tenant Scope Enforcement on Every Read | Applies tenant scope to every data access. | MB III-44 · RA 11.8, 20.18 |
| C0331 | M110 | Organizational Unit Modelling | Represents departments and business units. | ONT Ch11 · RA 14.12 |
| C0332 | M110 | Reporting Structure Representation | Represents who reports to whom. | ONT Ch11, Ch22 · RA 14.12 |
| C0333 | M110 | Structural Change Management | Handles reorganization without losing history. | ONT Ch11 · RA 14.12 |
| C0334 | M111 | Organization Preference Management | Holds per-organization operating preferences. | MB III-9, III-53 |
| C0335 | M111 | Per-Tenant Capability Configuration | Configures which capabilities each tenant may use. | MB III-53 · RA 10.12 |
| C0336 | M111 | Setting Inheritance & Override | Resolves platform defaults against tenant overrides. | RA 11.9 · MB III-53 |
| C0337 | M112 | Domain & Data Ownership Assignment | Assigns accountable owners to domains and data. | RA 8.9, 14.13 · MB III-85 |
| C0338 | M112 | Accountability Declaration | States who answers for each outcome. | MB III-85 · RA 12.18 |
| C0339 | M112 | Stewardship Responsibility Tracking | Tracks stewardship duties and their fulfilment. | RA 20.17 · ONT Ch17 |

## D17 — Data & Information Management

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0340 | M113 | Canonical Entity Definition | Defines the authoritative structure of each data entity. | RA 20.5 · MB III-12 · ONT Ch10 |
| C0341 | M113 | Relationship & Integrity Rules | Defines how entities relate and must stay consistent. | MB III-38 · ONT Ch20 |
| C0342 | M113 | Schema Evolution Governance | Evolves data structure without breaking consumers. | RA 20.5 · IG Ch16 |
| C0343 | M114 | Golden Record Maintenance | Maintains one authoritative version of core entities. | RA 20.7, 30.9 |
| C0344 | M114 | Duplicate Detection & Merge | Detects and reconciles duplicate master records. | RA 20.7 · MB III-12 |
| C0345 | M114 | Master Data Stewardship | Assigns stewardship over shared core entities. | RA 20.7, 20.17 |
| C0346 | M115 | Reference Code Set Management | Governs shared code sets and lookup values. | RA 20.8, 30.9 |
| C0347 | M115 | Classification Value Governance | Controls permitted classification values. | RA 20.8 · ONT Ch14 |
| C0348 | M115 | Reference Data Distribution | Distributes reference data consistently platform-wide. | RA 20.8 · ONT Ch28 |
| C0349 | M116 | Business Record of Truth | Holds the authoritative live business data. | MB III-11, III-37 · RA 20.6 |
| C0350 | M116 | Runtime Authority Declaration | States unambiguously which store is authoritative. | MB III-11, III-37 |
| C0351 | M116 | Transactional Consistency | Keeps related changes consistent together. | RA 20.9 · IG Ch16 |
| C0352 | M117 | Durable Event Recording | Records what happened, in order, durably. | RA 20.10, 30.17 · MB III-32 |
| C0353 | M117 | Event Replay & Reconstruction | Reconstructs state by replaying recorded events. | RA 20.10, Ch25 |
| C0354 | M117 | Event Retention Governance | Governs how long events are retained. | RA 20.10, 20.19 |
| C0355 | M118 | Analytical Data Organization | Organizes data for analysis and history. | RA 20.11–20.13, 30.9 |
| C0356 | M118 | Historical Data Preservation | Preserves history for trend and comparison. | RA 20.11 · MB III-50 |
| C0357 | M118 | Analytical Data Provisioning | Provides governed analytical data to consumers. | RA 20.12–20.13 |
| C0358 | M119 | Vector Representation Storage | Stores semantic representations of content. | RA 20.14 · IG Ch19 |
| C0359 | M119 | Vector Index Maintenance | Keeps semantic indexes current with source content. | RA 20.14, 16.12 |
| C0360 | M119 | Semantic Retrieval Serving | Serves meaning-based retrieval requests. | RA 20.14 · RA 15.13 |
| C0361 | M120 | Data Catalogue | Records what data exists and where. | RA 20.15, 30.9 |
| C0362 | M120 | Business Glossary Alignment | Aligns data definitions to canonical business meaning. | RA 20.15 · ONT Ch12, Ch19 |
| C0363 | M120 | Data Ownership Registration | Records who owns each data asset. | RA 20.15, 20.17 |
| C0364 | M121 | Data Quality Measurement | Measures accuracy, completeness, and validity. | RA 20.16 |
| C0365 | M121 | Data Validation Rules | Enforces validity at the point of entry. | MB III-55 · RA 20.16 |
| C0366 | M121 | Quality Remediation & Reconciliation | Corrects and reconciles defective data. | RA 20.16 · MB III-37 |
| C0367 | M122 | Data Policy Definition | Defines how data may be used and shared. | RA 20.17, 11.22 · ONT Ch17 |
| C0368 | M122 | Data Classification & Sensitivity | Classifies data by sensitivity to drive controls. | RA 20.17–20.18 · MB III-69 |
| C0369 | M122 | Data Usage Oversight | Verifies data is used only as permitted. | RA 11.22 · ONT Ch17 |
| C0370 | M123 | Data Lifecycle Definition | Defines each stage of a data asset's life. | RA 20.19 · ONT Ch10 |
| C0371 | M123 | Retention Rule Enforcement | Retains data only as long as permitted or required. | RA 20.19 · MB III-68 |
| C0372 | M123 | Data Purge & Right to Erasure | Removes data when obligation or request requires. | MB III-69 · RA 21.16 |
| C0373 | M124 | Backup Execution | Captures recoverable copies on schedule. | RA 20.20 · MB III-66 · IG Ch31 |
| C0374 | M124 | Restore Verification | Proves backups can actually be restored. | RA 20.20 · IG Ch31 |
| C0375 | M124 | Point-in-Time Recovery | Recovers data to a chosen prior moment. | RA 20.20 · MB III-66 |
| C0376 | M125 | Source Inventory & Assessment | Inventories what must be migrated before moving it. | MB III-37 · IG Ch37 |
| C0377 | M125 | Migration Execution & Backfill | Moves data into the new authoritative store. | MB III-37 · IG Ch37 |
| C0378 | M125 | Reconciliation & Cutover Gating | Proves parity before authority transfers. | MB III-37 · IG Ch37, Ch39 |
| C0379 | M126 | AI Training & Grounding Data Governance | Governs which data may inform AI. | RA 20.21, 30.10 · PX Ch38 |
| C0380 | M126 | AI Data Provenance | Records the origin of data used by AI. | RA 20.21, 16.16 |
| C0381 | M126 | Sensitive Data Exclusion from AI | Keeps prohibited data out of AI processing. | RA 20.21, 21.15–21.16 |

## D18 — Integration & Interoperability

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0382 | M127 | API Contract Definition | Defines the contract each interface guarantees. | RA 18.6, 30.16 · MB III-35 |
| C0383 | M127 | API Versioning & Compatibility | Evolves interfaces without breaking consumers. | RA 18.21, 30.16 · IG Ch15 |
| C0384 | M127 | API Documentation & Discoverability | Makes interfaces understandable to consumers. | RA 30.16 · PX Ch42 · IG Ch10 |
| C0385 | M128 | Traffic Ingress Control | Controls all external traffic through one entry point. | RA 18.7, Ch8 |
| C0386 | M128 | Rate Limiting & Throttling | Protects the platform from excessive load. | RA 18.7, 18.18 |
| C0387 | M128 | Gateway Authentication & Routing | Authenticates and routes inbound requests. | RA 18.7, 21.12 |
| C0388 | M129 | Service-to-Service Contracts | Governs how internal services call each other. | RA 18.5 · ONT 16.5 |
| C0389 | M129 | Service Discovery | Lets services locate one another reliably. | RA 18.8, 30.8 |
| C0390 | M129 | Internal Traffic Governance | Governs and secures service-to-service traffic. | RA 18.8, 18.17 |
| C0391 | M130 | Business Event Definition | Defines the events domains publish. | RA 18.9, 30.17 · MB III-32 |
| C0392 | M130 | Event Publication & Subscription | Lets domains publish and subscribe without coupling. | RA 18.9, Ch25 · IG Ch21 |
| C0393 | M130 | Event Contract Governance | Governs event schema and its evolution. | RA 11.21, 18.20 |
| C0394 | M131 | Asynchronous Message Delivery | Moves messages reliably between components. | RA 18.10–18.11 · IG Ch21 |
| C0395 | M131 | Ordering & Delivery Guarantees | Provides the ordering and delivery semantics promised. | RA 18.10 · IG Ch21 |
| C0396 | M131 | Dead Letter & Poison Message Handling | Isolates messages that cannot be processed. | RA 18.11, 18.18 |
| C0397 | M132 | Webhook Registration | Lets external systems subscribe to events. | RA 18.12 · MB III-36 |
| C0398 | M132 | Outbound Event Notification | Notifies external subscribers of events. | RA 18.12 · MB III-36 |
| C0399 | M132 | Webhook Delivery Assurance | Retries and verifies outbound webhook delivery. | RA 18.12, 18.18 |
| C0400 | M133 | Reusable Connector Provision | Provides governed connectors for common system types. | RA 18.13 · IG Ch22 |
| C0401 | M133 | Connector Configuration | Configures connectors per tenant and system. | RA 18.13 · MB III-53 |
| C0402 | M133 | Connector Lifecycle Management | Manages connector versions and retirement. | RA 18.13, 18.21 |
| C0403 | M134 | External System Onboarding | Brings an external system into governed integration. | RA 18.14, 8.4 · MB III-36 |
| C0404 | M134 | Model Translation at the Boundary | Prevents external models leaking into the core. | RA 18.15 |
| C0405 | M134 | External Dependency Isolation | Isolates the platform from external instability. | RA 18.15, 18.18 |
| C0406 | M135 | Field & Schema Mapping | Maps external structures to canonical ones. | RA 18.16 · MB III-21 |
| C0407 | M135 | Format Conversion | Converts between data representations. | RA 18.16 |
| C0408 | M135 | Transformation Rule Governance | Governs and versions transformation logic. | RA 18.16, 18.20 |
| C0409 | M136 | Integration Contract Registry | Records every integration contract in force. | RA 18.20 · MB III-36 |
| C0410 | M136 | Backward Compatibility Assurance | Ensures changes do not break existing consumers. | RA 18.21, 11.20 |
| C0411 | M136 | Integration Approval & Retirement | Approves new integrations and retires old ones. | RA 18.20–18.21 |
| C0412 | M137 | Developer Onboarding | Helps developers start consuming the platform. | PX Ch42 · RA 30.16 |
| C0413 | M137 | Interface Discovery & Reference | Lets developers find and understand interfaces. | PX Ch42 · RA 30.16 |
| C0414 | M137 | Developer Credential & Access Provisioning | Issues governed developer access. | PX Ch42 · RA 21.12 |
| C0415 | M138 | Integration Fault Tolerance | Keeps integrations working through partial failure. | RA 18.18 |
| C0416 | M138 | Circuit Breaking & Timeout Control | Prevents a failing dependency cascading. | RA 18.18, 11.14 |
| C0417 | M138 | Integration Behaviour Visibility | Makes integration health and traffic visible. | RA 18.19 · MB III-62 |

## D19 — Observability & Telemetry

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0418 | M139 | Signal Instrumentation | Emits the signals needed to understand behaviour. | RA 11.10 · MB III-62 · IG Ch27 |
| C0419 | M139 | Metric Aggregation | Aggregates raw signals into usable measures. | RA 11.10 · ONT 16.10 |
| C0420 | M139 | Telemetry Retention & Access | Retains telemetry and makes it queryable. | RA 11.10 · MB III-62 |
| C0421 | M140 | Health Check Evaluation | Continuously evaluates whether services are healthy. | RA 19.9 · ONT 16.11 |
| C0422 | M140 | Threshold & Condition Monitoring | Detects when conditions breach defined thresholds. | RA 19.9 · MB III-63 |
| C0423 | M140 | Synthetic & End-to-End Monitoring | Verifies critical journeys work from outside in. | RA 19.9 · IG Ch27 |
| C0424 | M141 | Structured Log Emission | Emits logs in a consistent, queryable structure. | RA 11.12 · IG Ch28 |
| C0425 | M141 | Log Correlation | Correlates log entries to a single request or actor. | RA 11.12 · MB III-64 |
| C0426 | M141 | Sensitive Data Redaction in Logs | Keeps personal and secret data out of logs. | RA 11.12, 21.16 · MB III-69 |
| C0427 | M142 | Request Trace Propagation | Carries trace context across service boundaries. | RA 11.10 · IG Ch27 |
| C0428 | M142 | End-to-End Latency Attribution | Attributes latency to its actual source. | RA 11.10, 11.15 · IG Ch29 |
| C0429 | M142 | Causal Failure Localization | Locates the true origin of a failure. | RA 11.13 · IG Ch27 |
| C0430 | M143 | Alert Definition & Thresholds | Defines what conditions warrant an alert. | RA 19.10 · ONT 16.12 |
| C0431 | M143 | Alert Routing & On-Call Escalation | Routes alerts to the responder who can act. | RA 19.10 · IG Ch35 |
| C0432 | M143 | Alert Suppression & Deduplication | Prevents alert storms and fatigue. | RA 19.10 · PX Ch16 |
| C0433 | M144 | Actor Action Recording | Records who did what and when. | RA 11.11 · MB III-65 |
| C0434 | M144 | Immutable Audit Evidence | Keeps audit records tamper-evident and durable. | RA 11.11 · ONT Ch17 · MB III-65 |
| C0435 | M144 | Audit Query & Evidence Production | Produces audit evidence on demand. | MB III-65 · ONT Ch17 |
| C0436 | M145 | Performance Baseline Definition | Defines expected responsiveness and throughput. | RA 11.15 · MB III-58 |
| C0437 | M145 | Performance Regression Detection | Detects when performance degrades. | RA 11.15 · IG Ch29 |
| C0438 | M145 | Resource Utilisation Insight | Shows how resources are actually consumed. | RA 11.15, 19.14 · MB III-82 |
| C0439 | M146 | Error Capture & Classification | Captures and classifies errors affecting users. | RA 11.13 · MB III-56 |
| C0440 | M146 | User-Facing Failure Handling | Fails gracefully and honestly for the user. | MB III-56 · PX Ch14 |
| C0441 | M146 | Edge Case & Anomaly Diagnosis | Diagnoses rare and unexpected conditions. | MB III-57 · RA 11.13 |

## D20 — Platform Configuration & Administration

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0442 | M147 | Configuration Definition & Schema | Defines what may be configured and within what bounds. | RA 11.9 · MB III-53 · IG Ch26 |
| C0443 | M147 | Environment-Scoped Configuration | Varies configuration safely per environment. | RA 11.9, 19.18 · MB III-73 |
| C0444 | M147 | Configuration Change Governance | Governs and records configuration change. | RA 11.9, 19.18 · IG Ch26 |
| C0445 | M148 | Feature Toggle Control | Turns capability on or off without redeployment. | RA Ch8 · MB III-53 |
| C0446 | M148 | Progressive & Targeted Rollout | Exposes capability to a controlled audience first. | MB III-53 · IG Ch24 |
| C0447 | M148 | Emergency Kill Switch | Disables capability instantly when necessary. | MB III-53 · RA 10.12 |
| C0448 | M149 | Component Registration | Records every component the system contains. | MB III-26 · RA 12.16 |
| C0449 | M149 | Registry Validation & Drift Detection | Detects when reality diverges from the registry. | MB III-26 · RA 12.8 |
| C0450 | M149 | Single Source of Inventory Truth | Keeps exactly one authoritative system inventory. | MB III-26 · ONT Ch26 |
| C0451 | M150 | Administrative Control Surface | Gives administrators governed platform-wide control. | MB III-52 · RA 14.5 |
| C0452 | M150 | Tenant Administration | Lets administrators manage tenants and their state. | MB III-45, III-52 |
| C0453 | M150 | Privileged Action Accountability | Records and constrains privileged administrative action. | MB III-52, III-65 · RA 21.9 |
| C0454 | M151 | Environment Definition & Isolation | Defines environments and keeps them isolated. | MB III-73 · IG Ch23 |
| C0455 | M151 | Environment Parity Management | Keeps environments comparable enough to trust. | IG Ch23–24 · MB III-73 |
| C0456 | M151 | Environment Provisioning & Teardown | Creates and removes environments reliably. | IG Ch23 · RA 30.19 |
| C0457 | M152 | Runtime Behaviour Adjustment | Adjusts runtime behaviour without redeployment. | MB III-53 · RA 10.12 |
| C0458 | M152 | Safe Default Resolution | Falls back to a safe default when configuration is absent or invalid. | MB III-53 · RA 11.9 |
| C0459 | M152 | Operational Override Governance | Governs who may override runtime behaviour. | MB III-53, III-86 · RA 12.10 |

## D21 — Security & Privacy

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0460 | M153 | Security Control Definition | Defines the controls protecting the platform. | RA 21.4 · MB III-39 · IG Ch30 |
| C0461 | M153 | Defence-in-Depth Layering | Layers controls so no single failure is fatal. | RA 21.4, 11.6 · MB III-39 |
| C0462 | M153 | Security Posture Assessment | Assesses how secure the platform actually is. | RA 21.4, 21.21 · IG Ch30 |
| C0463 | M154 | Secret Storage & Isolation | Stores secrets outside code and configuration. | RA 21.10 · IG Ch26 |
| C0464 | M154 | Secret Rotation | Rotates credentials and keys on schedule. | RA 21.10 · IG Ch26 |
| C0465 | M154 | Secret Access Restriction | Limits which identities may read which secrets. | RA 21.10, 21.7 |
| C0466 | M155 | Encryption in Transit | Protects data moving between components. | RA 21.11 · MB III-39 |
| C0467 | M155 | Encryption at Rest | Protects stored data from unauthorized reading. | RA 21.11, 20.18 |
| C0468 | M155 | Key Management & Custody | Manages cryptographic keys through their lifecycle. | RA 21.11, 21.10 |
| C0469 | M156 | Input Validation & Injection Prevention | Rejects hostile input before it reaches logic. | RA 21.14 · MB III-55 · IG Ch30 |
| C0470 | M156 | API Abuse Protection | Protects interfaces from misuse and enumeration. | RA 21.12 · RA 18.7 |
| C0471 | M156 | Dependency Vulnerability Management | Keeps third-party components free of known flaws. | RA 21.14 · IG Ch30 |
| C0472 | M157 | Network Boundary Protection | Controls what may reach the platform's substrate. | RA 21.13 · IG Ch23 |
| C0473 | M157 | Runtime Hardening | Reduces the attack surface of running components. | RA 21.13 · IG Ch30 |
| C0474 | M157 | Infrastructure Access Control | Restricts administrative access to infrastructure. | RA 21.13, 21.9 |
| C0475 | M158 | Prompt Injection Defence | Prevents hostile input subverting AI behaviour. | RA 21.15, 15.17 |
| C0476 | M158 | AI Output Leakage Prevention | Stops AI disclosing data the requester may not see. | RA 21.15–21.16 · ONT Ch28 |
| C0477 | M158 | AI Access Boundary Enforcement | Confines AI to data and tools it is entitled to. | RA 21.15, 15.14 |
| C0478 | M159 | Personal Data Identification | Identifies where personal data exists. | RA 21.16 · MB III-69 |
| C0479 | M159 | Purpose Limitation & Minimisation | Collects and uses only what is necessary. | RA 21.16 · MB III-69 · PX Ch36 |
| C0480 | M159 | Data Subject Rights Fulfilment | Honours access, correction, and erasure rights. | MB III-69 · RA 21.16 |
| C0481 | M160 | Threat Detection | Detects hostile activity against the platform. | RA 21.17 |
| C0482 | M160 | Security Event Monitoring | Monitors and correlates security-relevant events. | RA 21.18, 21.21 |
| C0483 | M160 | Anomalous Behaviour Identification | Identifies behaviour inconsistent with normal use. | RA 21.17–21.18 |
| C0484 | M161 | Security Incident Triage | Assesses severity and scope of a security incident. | RA 21.19 · IG Ch35 |
| C0485 | M161 | Containment & Eradication | Contains and removes the cause of a breach. | RA 21.19 · IG Ch35 |
| C0486 | M161 | Breach Notification & Post-Incident Review | Notifies as required and learns from the incident. | RA 21.19 · MB III-68 · IG Ch35 |

## D22 — Governance, Risk & Compliance

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0487 | M162 | Policy Authoring & Publication | Defines and publishes enterprise policy. | ONT Ch17 · RA 14.10 · PX Ch37 |
| C0488 | M162 | Policy Enforcement Verification | Verifies policy is actually being enforced. | RA 11.23, 14.10 · ONT Ch17 |
| C0489 | M162 | Policy Exception Detection | Detects where policy is not being followed. | ONT Ch17 · RA 12.8 |
| C0490 | M163 | Architecture Decision Recording | Records each significant decision and its reasoning. | RA 12.6, Ch31 · MB III-86 |
| C0491 | M163 | Architecture Review & Approval | Reviews and approves architectural change. | RA 12.7 · MB III-86 |
| C0492 | M163 | Architectural Constraint Enforcement | Enforces the constraints the architecture depends on. | RA 12.8, 10.15 · ONT Ch28 |
| C0493 | M164 | Standards Definition | Defines the standards work must meet. | RA 12.9 · IG Ch5, Ch38 |
| C0494 | M164 | Conformance Assessment | Assesses whether work conforms to standard. | RA 12.8 · IG Ch38–39 |
| C0495 | M164 | Non-Conformance Remediation | Corrects work that fails to meet standard. | RA 12.8, 12.10 · IG Ch38 |
| C0496 | M165 | Risk Identification | Identifies risks to the enterprise and platform. | RA 12.11 · ONT Ch17 |
| C0497 | M165 | Risk Assessment & Prioritization | Assesses likelihood and impact to prioritise treatment. | RA 12.11 · ONT Ch17 · PX Ch37 |
| C0498 | M165 | Risk Treatment & Acceptance | Treats, transfers, or formally accepts each risk. | ONT Ch17 · RA 12.11 |
| C0499 | M166 | Regulatory Obligation Mapping | Maps which obligations apply to the platform. | MB III-68 · PX Ch37 · ONT Ch17 |
| C0500 | M166 | Control Evidence Collection | Collects evidence that controls operate. | MB III-68 · RA 11.17 |
| C0501 | M166 | Compliance Reporting & Attestation | Reports and attests to compliance status. | MB III-68 · RA 11.17 · ONT Ch17 |
| C0502 | M167 | Permitted AI Use Definition | Defines where and how AI may be used. | RA 11.18 · PX Ch38 · ONT Ch15 |
| C0503 | M167 | AI Decision Explainability | Ensures AI-influenced decisions can be explained. | RA 11.18 · PX Ch35, Ch38 |
| C0504 | M167 | AI Accountability Assignment | Assigns human accountability for AI outcomes. | PX Ch38 · ONT Ch17 · MB IV-8 |
| C0505 | M168 | Audit Planning & Scoping | Plans what will be independently examined. | ONT Ch17 · MB III-84 |
| C0506 | M168 | Independent Control Testing | Tests whether controls operate as claimed. | ONT Ch17 · RA 11.11 |
| C0507 | M168 | Audit Finding Resolution | Resolves and closes audit findings. | ONT Ch17 · MB III-84 |
| C0508 | M169 | Decision Right Definition | Defines who may decide what. | MB III-86 · RA 12.18 |
| C0509 | M169 | Escalation Path Definition | Defines how decisions escalate when contested. | MB III-86 · RA 12.18 |
| C0510 | M169 | Accountability Traceability | Traces every outcome to an accountable owner. | MB III-85, III-87 · ONT Ch26 |
| C0511 | M170 | Exception Request & Justification | Captures why a departure from standard is sought. | RA 12.10 · IG Ch38 |
| C0512 | M170 | Time-Bounded Waiver Approval | Approves exceptions with a defined expiry. | RA 12.10 · IG Ch38 |
| C0513 | M170 | Exception Register & Expiry Enforcement | Tracks open exceptions and closes them on expiry. | RA 12.10 · MB III-78 |
| C0514 | M171 | Gate Criteria Definition | Defines what must be true before work proceeds. | IG Ch39 · MB III-77 |
| C0515 | M171 | Gate Evaluation & Enforcement | Blocks progression until criteria are demonstrably met. | IG Ch39 · MB III-29, III-77 |
| C0516 | M171 | Acceptance Evidence Retention | Retains proof that acceptance criteria were met. | MB III-77 · IG Ch39 |
| C0517 | M172 | Ethical Principle Definition | States the ethical commitments the platform upholds. | PX Ch39 · ONT Ch17 · MB IV-9 |
| C0518 | M172 | Trust Commitment Verification | Verifies the platform honours its trust commitments. | PX Ch35, Ch39 · ONT Ch17 |
| C0519 | M172 | Ethical Concern Escalation | Provides a route to raise and resolve ethical concern. | PX Ch39 · MB III-86 |

## D23 — Engineering & Delivery Lifecycle

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0520 | M173 | Engineering Principle Definition | States the principles all engineering must follow. | IG Ch5 · MB IV-10 |
| C0521 | M173 | Coding Standard Enforcement | Holds code to defined, consistent standards. | IG Ch8 |
| C0522 | M173 | Naming & Documentation Convention | Standardizes naming and required documentation. | IG Ch9–Ch10 |
| C0523 | M174 | Repository Structure Standard | Standardizes how repositories are organized. | IG Ch6 |
| C0524 | M174 | Module Boundary Definition | Defines module boundaries that match business capability. | IG Ch7 · RA 8.5 |
| C0525 | M174 | Dependency Direction Enforcement | Keeps dependencies pointing the permitted way. | IG Ch7 · RA 7.14 |
| C0526 | M175 | Branching Model | Defines how work is branched and integrated. | IG Ch11 |
| C0527 | M175 | Change History Integrity | Keeps an accurate, attributable change history. | IG Ch11 · RA 11.11 |
| C0528 | M175 | Merge Governance | Governs what may be merged and by whom. | IG Ch11–Ch12 |
| C0529 | M176 | Peer Review Requirement | Requires independent review of every change. | IG Ch12 |
| C0530 | M176 | Review Criteria & Checklist | Defines what reviewers must verify. | IG Ch12, Ch39 |
| C0531 | M176 | Review Outcome Accountability | Holds reviewers accountable for what they approve. | IG Ch12 · MB III-86 |
| C0532 | M177 | Test Strategy Definition | Defines what must be tested and at what level. | IG Ch32 · MB III-76 |
| C0533 | M177 | Automated Regression Protection | Prevents previously fixed defects returning. | IG Ch32 · MB III-76 |
| C0534 | M177 | Coverage & Test Adequacy Assessment | Assesses whether testing is genuinely sufficient. | IG Ch32, Ch39 |
| C0535 | M178 | Automated Build & Verification | Builds and verifies every change automatically. | IG Ch25 |
| C0536 | M178 | Pipeline Gate Integration | Blocks the pipeline when quality gates fail. | IG Ch25, Ch39 |
| C0537 | M178 | Build Reproducibility | Produces identical artefacts from identical sources. | IG Ch25 · RA 30.20 |
| C0538 | M179 | Deployment Strategy Selection | Chooses how change reaches production safely. | IG Ch24 · RA Ch22, 30.20 |
| C0539 | M179 | Progressive & Reversible Rollout | Rolls change out gradually and reversibly. | IG Ch24 · MB III-72 |
| C0540 | M179 | Deployment Verification | Confirms a deployment actually succeeded. | IG Ch24 · MB III-72 |
| C0541 | M180 | Release Scope Definition | Declares exactly what a release contains. | IG Ch33 · MB III-74 |
| C0542 | M180 | Version Scheme & Tagging | Versions releases consistently and traceably. | MB III-71 · IG Ch33 |
| C0543 | M180 | Release Approval & Readiness | Approves release only when demonstrably ready. | IG Ch33, Ch39 · MB III-74 |
| C0544 | M181 | Infrastructure Definition as Code | Defines infrastructure declaratively and reviewably. | IG Ch23 · RA 30.19 |
| C0545 | M181 | Runtime Environment Provisioning | Provisions the runtime the platform needs. | IG Ch23 · RA 30.18–30.19 |
| C0546 | M181 | Infrastructure Cost Management | Manages what the infrastructure costs to run. | IG Ch23 · RA 19.14 |
| C0547 | M182 | Additive Evolution Discipline | Evolves through bounded additive change, not rebuild. | RA Ch32 · MB IV-10 · PX Ch45 |
| C0548 | M182 | Modernization Sequencing | Sequences modernization to protect working behaviour. | RA Ch32 · IG Ch40 |
| C0549 | M182 | Deprecation & Sunset Management | Retires capability without stranding consumers. | RA Ch32, 18.21 · IG Ch40 |
| C0550 | M183 | Technical Debt Registration | Records known debt explicitly rather than hiding it. | IG Ch36 · MB III-78 |
| C0551 | M183 | Debt Impact Assessment | Assesses what each debt item actually costs. | IG Ch36 · MB III-78–79 |
| C0552 | M183 | Planned Debt Repayment | Repays debt deliberately rather than opportunistically. | IG Ch36 · MB III-80 |

## D24 — External Ecosystem & Extensibility

| ID | Module | Capability Name | Description | Source(s) |
|---|---|---|---|---|
| C0553 | M184 | Provider Selection & Approval | Approves which external providers may be used. | RA 8.4, 10.14 · MB III-36 |
| C0554 | M184 | Provider Dependency Isolation | Keeps external providers replaceable, never load-bearing. | RA 8.4, 18.15 · MB IV-10 |
| C0555 | M184 | Provider Performance & Obligation Oversight | Holds providers to their commitments. | RA 10.14, 19.7 |
| C0556 | M185 | Extension Point Definition | Defines where the platform may be extended. | RA 10.13 · PX Ch44 |
| C0557 | M185 | Extension Sandboxing & Limits | Confines extensions so they cannot destabilise the core. | RA 10.13, 10.15 · PX Ch44 |
| C0558 | M185 | Extension Lifecycle & Certification | Certifies, versions, and retires extensions. | RA 10.13 · PX Ch44 |
| C0559 | M186 | Partner Onboarding & Enablement | Brings partners into the ecosystem capably. | PX Ch46, Ch68 · ONT 18.15 |
| C0560 | M186 | Marketplace Listing & Distribution | Lets approved offerings be discovered and adopted. | PX Ch46, Ch68 |
| C0561 | M186 | Ecosystem Trust & Governance | Governs conduct and trust across the ecosystem. | PX Ch68, Ch72 · ONT 18.15 |

---

**Merge decisions applied (duplicates collapsed to a single capability):**
- Context assembly appears in RA 15.15 and 16.13 → **C0013** only; knowledge-side retrieval is **C0016**.
- Audit appears as mechanism (RA 11.11) and programme (ONT Ch17) → mechanism **C0433–C0435** (M144), assurance programme **C0505–C0507** (M168); no overlap.
- Secrets management appears in RA 21.10 and IG Ch26 → **C0463–C0465** (D21) only; D20 configuration excludes secrets.
- Encryption-at-rest appears in RA 21.11 and 20.18 → **C0467** only.
- Data classification appears in RA 16.9, 20.17 and 21.16 → knowledge labelling **C0048**, data classification **C0368**; privacy consumes both.
- Rate limiting appears in RA 18.7 and 21.12 → **C0386** only; **C0470** covers abuse patterns beyond rate.
- Deprecation appears in RA 18.21 and Ch32 → integration compatibility **C0410**, platform sunset **C0549**.
- Quality gates appear in IG Ch39, MB III-29 and III-77 → governance definition **C0514–C0516** (M171); domain-specific gate enforcement remains **C0081** (delivery) and **C0188** (proposal) as distinct business gates.
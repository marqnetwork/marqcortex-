Enterprise Module Registry — P0-M0.3-C1.2
Sources: PX = Product Experience · ONT = Ontology · MB = Master Blueprint · RA = Reference Architecture · IG = Implementation Guide
Total: 186 modules (M001–M186) across D01–D24

D01 — Intelligence & AI
ID	Domain	Module Name	Description	Source(s)
M001	D01	Intelligence Gateway & Model Routing	Single provider-independent entry point for all AI execution, routing requests to models without embedding any vendor.	RA 15.5–15.7, 30.10 · MB III-17 · IG Ch18
M002	D01	AI Provider & Model Registry	Registers approved models and providers with their capabilities, versions, and substitution rules.	RA 15.7, 30.10 · MB III-17
M003	D01	Agent & Multi-Agent Orchestration	Defines autonomous agents and coordinates multiple agents working toward a shared objective.	RA 15.8–15.9 · PX Ch62–63 · MB III-18
M004	D01	Prompt & Context Assembly	Governs how prompts are composed and what context is assembled before any model invocation.	RA 15.10, 15.15, 30.10 · MB III-18
M005	D01	Retrieval-Augmented Intelligence	Grounds AI responses in authoritative organizational knowledge rather than model recall.	RA 15.12–15.13, 30.10 · MB III-19
M006	D01	AI Tool & Action Execution	Allows AI to invoke governed tools and take permitted actions within defined boundaries.	RA 15.14, 30.10 · PX Ch30
M007	D01	AI Reasoning & Decision Support	Structures how AI reasons over evidence to support — never replace — authoritative decisions.	RA 15.16 · MB III-16 · PX Ch64
M008	D01	AI Safety & Guardrails	Constrains AI behaviour to prevent harmful, out-of-scope, or authority-violating output.	RA 15.17, 21.15 · PX Ch38
M009	D01	AI Evaluation, Observability & Quality	Measures AI quality, monitors behaviour in production, and evidences fitness for purpose.	RA 15.18, 15.20 · IG Ch18
M010	D01	AI Cost & Consumption Governance	Controls and attributes AI spend and consumption across tenants and capabilities.	RA 15.19 · MB III-17
M011	D01	AI Lifecycle Management	Manages introduction, versioning, promotion, and retirement of AI capabilities and models.	RA 15.21 · IG Ch18
D02 — Knowledge Management
ID	Domain	Module Name	Description	Source(s)
M012	D02	Enterprise Ontology & Semantic Model	Maintains the canonical meaning of every concept, entity, and relationship in the enterprise.	ONT (whole) · RA 16.5
M013	D02	Knowledge Graph	Represents entities and their relationships as a connected, queryable enterprise model.	RA 16.6 · ONT Ch27
M014	D02	Knowledge Asset & Lifecycle Management	Creates, curates, publishes, and retires organizational knowledge assets.	RA 16.7, 16.14 · ONT Ch14
M015	D02	Knowledge Classification & Taxonomy	Organizes knowledge through consistent categorization so it can be found and trusted.	RA 16.8–16.9 · ONT Ch14
M016	D02	Organizational Memory & Recall	Retains and surfaces prior context, decisions, and learning so the organization compounds knowledge.	RA 15.11, 16.18 · MB III-20 · ONT Ch14
M017	D02	Knowledge Provenance & Lineage	Records where knowledge came from and how it was derived, so any assertion can be traced.	RA 16.16 · ONT Ch26
M018	D02	Knowledge Quality & Governance	Governs accuracy, currency, ownership, and approval of knowledge before it is relied upon.	RA 16.15, 16.17, 11.19 · ONT Ch30
M019	D02	Knowledge Sharing & Distribution	Makes approved knowledge available to the right people, teams, and AI systems.	RA 16.19 · PX Ch23
D03 — Work & Workflow Execution
ID	Domain	Module Name	Description	Source(s)
M020	D03	Workflow Definition & Modelling	Defines the types, stages, and lifecycle of work the enterprise executes.	RA 17.5–17.6, 30.12 · ONT Ch13
M021	D03	Workflow Orchestration Engine	Executes and coordinates multi-step business processes to completion.	RA 17.7, 17.9, Ch26 · PX Ch65 · IG Ch20
M022	D03	Workflow State & Long-Running Execution	Maintains correct state for work that spans hours, days, or months, including compensation.	RA 17.8, 17.13–17.14 · MB III-11
M023	D03	Human Task & Approval Management	Routes work requiring human judgement, decision, or approval to the right person.	RA 17.11 · ONT Ch13 · PX Ch28
M024	D03	AI-Orchestrated Workflow	Allows AI to propose, sequence, and progress work under human authority.	RA 17.12 · PX Ch30, Ch65
M025	D03	Business Process & Value Stream Management	Maps and governs the end-to-end processes that deliver value to customers.	RA 14.7, 14.9 · MB III-29
M026	D03	Execution Delivery & Blueprint Management	Plans and tracks client delivery through workstreams, milestones, tasks, and gates.	MB III-23, III-25 · ONT Ch13
M027	D03	Scope & Change Control	Governs changes to committed scope, assessing impact before work is altered.	MB III-23, III-25, III-75 · RA 17.19
M028	D03	Workflow Exception & Retry Management	Handles failure, exception, and retry so work neither stalls silently nor corrupts state.	RA 17.15–17.16 · MB III-56
M029	D03	Workflow Monitoring & Analytics	Provides visibility into work in flight, bottlenecks, throughput, and cycle time.	RA 17.17–17.18 · MB III-30
D04 — Customer & Client Engagement
ID	Domain	Module Name	Description	Source(s)
M030	D04	Customer & Contact Management	Maintains the authoritative record of customers, contacts, and their relationships.	RA 14.5 · ONT 18.4 · MB III-12
M031	D04	Client Portal Experience	Gives signed clients a calm, fixed, trustworthy view of their engagement.	MB III-23 · PX Ch8
M032	D04	Client Messaging & Correspondence	Carries governed two-way communication between the client and the delivery team.	MB III-23, III-25 · RA 13.17
M033	D04	Customer Journey & Touchpoint Management	Defines and governs the stages and touchpoints a customer moves through.	ONT 18.6–18.8 · PX Ch19 · MB III-28
M034	D04	Feedback & Voice of Customer	Captures customer feedback and feeds it back into improvement.	ONT 18.9 · PX Ch32
M035	D04	Customer Intelligence & Health	Assesses customer health, risk, and opportunity to guide relationship decisions.	PX Ch55 · MB III-25 · RA 14.5
M036	D04	Customer Onboarding	Brings a new customer from agreement to productive use of the platform.	RA 14.6 · MB III-10 · PX Ch18
D05 — Product Management
ID	Domain	Module Name	Description	Source(s)
M037	D05	Product & Service Catalogue	Defines the products and business services the enterprise offers.	ONT 18.1–18.2 · MB III-1, III-2 · RA 14.5
M038	D05	Feature & Offering Definition	Defines features as units of customer-visible value with clear intent and ownership.	ONT 18.3 · MB III-23
M039	D05	Product Scope & Boundary Governance	Declares what the product does and explicitly does not do, protecting advisory boundaries.	MB III-4 · PX Ch4
M040	D05	Product Roadmap & Portfolio Planning	Sequences product investment into waves and releases aligned to strategy.	PX Ch57 · MB VI-22, VI-25
M041	D05	Product Metrics & Success Measurement	Defines and tracks the measures that prove the product is delivering value.	MB III-81, III-83 · PX Ch10
D06 — Business Operations
ID	Domain	Module Name	Description	Source(s)
M042	D06	Service Management & Service Levels	Defines operational services and the levels at which they are committed to run.	RA 19.5, 19.7, 30.21 · ONT 16.1
M043	D06	Incident & Problem Management	Detects, resolves, and learns from operational disruption and its root causes.	RA 19.11–19.12 · ONT 16.13 · IG Ch35
M044	D06	Operational Change Management	Governs how change reaches production without destabilizing service.	RA 19.13 · MB III-75 · IG Ch33
M045	D06	Capacity & Resource Management	Ensures sufficient capacity and fair allocation of resources to sustain demand.	RA 19.14 · ONT 16.8 · MB III-59
M046	D06	Resilience & Reliability Engineering	Designs the platform to withstand, absorb, and recover from failure.	RA 19.15, 11.14, 11.16 · MB III-60–61 · PX Ch51
M047	D06	Disaster Recovery & Business Continuity	Restores business operation after major loss or outage within agreed objectives.	RA 19.16 · MB III-67 · IG Ch31
M048	D06	Operational Automation	Removes manual operational toil through governed automation.	RA 19.17 · PX Ch30, Ch66
M049	D06	Operational Awareness & Continuous Improvement	Keeps operators continuously aware of state and drives measurable improvement.	RA 19.20–19.21 · PX Ch31–32 · MB III-30
D07 — Diagnostic Assessment & Advisory
ID	Domain	Module Name	Description	Source(s)
M050	D07	Diagnostic Intake & Questionnaire	Collects and normalizes the business inputs the assessment reasons over.	MB III-23, III-21 · PX Ch28
M051	D07	Readiness Scoring	Produces the authoritative, deterministic readiness score for an assessed business.	MB III-5, III-21, III-22
M052	D07	Domain Scoring & Business Discovery	Scores each business area on problem density, impact, feasibility, and risk.	MB III-5, III-37 · RA 14.6
M053	D07	Recommendation Qualification & Sequencing	Qualifies which findings become recommendations and in what order they should be acted on.	MB III-5, III-21, III-22
M054	D07	Recommendation Portfolio Management	Assembles qualified recommendations into a ranked, bounded portfolio with dependencies.	MB III-23, III-21
M055	D07	ROI & Value Modelling	Models the financial value, payback, and risk of the recommended work.	MB III-23, III-21 · PX Ch54
M056	D07	ROI Actuals & Benefit Realisation	Tracks realized value against modelled value after delivery.	MB III-23, III-21 · PX Ch54
M057	D07	Assessment Reporting & Narrative	Turns deterministic results into a clear readiness report and explanation.	MB III-23, III-49 · PX Ch35
M058	D07	Consistency & Assumption Validation	Verifies that assessment inputs, assumptions, and engine outputs remain coherent.	MB III-21, III-55 · RA 12.8
D08 — Revenue & Commercial Management
ID	Domain	Module Name	Description	Source(s)
M059	D08	Lead Capture & Acquisition	Captures and qualifies inbound interest into the commercial pipeline.	MB III-23, III-25 · RA 14.5
M060	D08	Opportunity & Pipeline Management	Tracks commercial opportunities through stages to a decision.	RA 14.5, 30.7 · MB III-25
M061	D08	Campaign & Nurture Management	Runs outbound campaigns and nurture sequences to progress unconverted interest.	RA 14.5 · MB III-25, III-48
M062	D08	Proposal Authoring & Governance	Produces client proposals and gates them for quality before they may be sent.	MB III-23, III-21, III-29
M063	D08	Pricing & Scope Definition	Defines what is being sold, at what price, under what scope.	MB III-21, III-25 · RA 14.10
M064	D08	Contract Generation & Management	Generates and governs the binding agreement derived from accepted scope.	MB III-23, III-21 · ONT Ch17
M065	D08	Billing & Invoicing	Charges customers accurately for what they have agreed and consumed.	MB III-46 · RA 30.7
M066	D08	Licensing & Entitlements	Determines what each customer is entitled to access and use.	MB III-47 · RA 14.5
M067	D08	Revenue Intelligence, QBR & Account Growth	Reviews delivered value with the client and identifies expansion opportunity.	MB III-23, III-25, III-21 · PX Ch59–60
D09 — User Experience & Interaction
ID	Domain	Module Name	Description	Source(s)
M068	D09	Experience Channels & Surfaces	Defines the distinct surfaces through which each actor engages the platform.	RA 13.4 · MB III-6, III-27
M069	D09	Navigation & Information Architecture	Organizes information and navigation so people always know where they are.	RA 13.7 · PX Ch20–21
M070	D09	Workspace Composition	Assembles the working environment in which people do their work.	RA 13.8 · PX Ch22
M071	D09	Interaction & Design System	Provides consistent interaction patterns and a shared visual language.	RA 13.9 · MB III-27 · PX Ch9
M072	D09	Personalization & Progressive Complexity	Reveals capability as it becomes valuable, adapting to the individual.	RA 13.11 · PX Ch14, Ch18
M073	D09	Accessibility	Ensures the platform is usable by people of all abilities.	RA 13.12 · MB III-70 · PX Ch9
M074	D09	Internationalization & Localization	Adapts the experience to language, region, and local convention.	RA 13.13 · PX Ch25
M075	D09	User Journey Management	Defines and governs the end-to-end journeys each actor travels.	MB III-8, III-28 · ONT 18.6 · PX Ch19
M076	D09	Trust, Transparency & Explainability Experience	Shows people why the system concluded what it did, earning warranted trust.	PX Ch14, Ch35 · RA 13.10 · ONT Ch17
D10 — Analytics & Reporting
ID	Domain	Module Name	Description	Source(s)
M077	D10	Reporting & Report Generation	Produces governed reports for internal and client audiences.	MB III-49 · RA 14.6
M078	D10	Dashboards & Visualization	Presents current state and trend to decision-makers at a glance.	MB III-51, III-21 · RA 13.6
M079	D10	Business Metrics & KPI Management	Defines, calculates, and governs the enterprise's measures of performance.	RA 14.15 · MB III-81–83
M080	D10	Insight & Prediction	Turns data into forward-looking insight and prediction.	PX Ch49 · ONT Ch14 · RA 30.9
M081	D10	Operational & Product Analytics	Analyses how the platform and product are actually used and performing.	MB III-50 · RA 19.20
D11 — Search & Discovery
ID	Domain	Module Name	Description	Source(s)
M082	D11	Search Services & Indexing	Makes enterprise content findable through governed indexing and query.	RA 16.11, Ch8 · PX Ch24
M083	D11	Semantic & Vector Search	Finds information by meaning rather than keyword match.	RA 16.12, 20.14 · IG Ch19
M084	D11	Discovery & Recommendation Surfaces	Proactively surfaces relevant information people did not think to ask for.	PX Ch24 · RA 13.16
M085	D11	Search Relevance & Result Governance	Governs relevance, ranking, and permitted visibility of search results.	RA 13.16, 16.11 · ONT Ch28
D12 — Communication & Notifications
ID	Domain	Module Name	Description	Source(s)
M086	D12	Notification Management	Tells the right participant the right thing at the right moment, without noise.	MB III-48 · ONT 16.7 · RA 13.15
M087	D12	Email & Message Delivery	Reliably delivers outbound email and messages, with queueing and retry.	MB III-48, III-24 · RA 18.11
M088	D12	Communication Templates & Correspondence	Standardizes recurring communication so tone and content stay consistent.	MB III-23, III-48
M089	D12	Collaboration & Co-working	Enables people to work together on shared objects and decisions.	PX Ch27 · RA 13.17 · ONT Ch13
M090	D12	Communication Preferences & Consent	Respects each recipient's channel preferences and consent.	MB III-48, III-69 · RA 21.16
D13 — Document & Records Management
ID	Domain	Module Name	Description	Source(s)
M091	D13	Document Authoring & Block Composition	Builds documents from reusable, individually editable content blocks.	MB III-23, III-21 · RA 16.10
M092	D13	Document Versioning & Revision Control	Tracks every revision of a document so history is never lost.	MB III-21, III-71 · RA 16.10
M093	D13	Immutable Snapshot & Records Integrity	Freezes issued records so what was sent can never be silently altered.	MB III-11, III-21, III-29 · ONT Ch17
M094	D13	Document Storage & Repository	Stores and organizes documents with controlled access and structure.	RA 16.10, 20.19 · MB III-37
M095	D13	Export & Rendering	Produces client-ready output from authoritative records only.	MB III-21, III-24 · RA 16.10
M096	D13	Template & Deliverable Management	Provides governed templates for recurring deliverables.	MB III-21, III-23
M097	D13	Records Retention & Archival	Retains, archives, and disposes of records per policy and obligation.	RA 20.19 · MB III-66, III-68 · ONT Ch17
D14 — Scheduling & Coordination
ID	Domain	Module Name	Description	Source(s)
M098	D14	Appointment & Meeting Scheduling	Books and manages meetings between clients and the team.	MB III-23 · RA Ch8, 14.6
M099	D14	Availability & Calendar Management	Maintains availability and calendar state for people and resources.	RA Ch8, 14.6 · ONT 16.8
M100	D14	Scheduled & Recurring Execution	Triggers recurring and time-based processing on a governed schedule.	MB III-33, III-34 · RA 30.18
D15 — Identity & Access Management
ID	Domain	Module Name	Description	Source(s)
M101	D15	Identity Lifecycle & Directory	Establishes and maintains the identity of every participant, human or system.	RA 11.4, 21.5, 30.13 · ONT Ch12
M102	D15	Authentication & Session Management	Verifies who a participant is and maintains their authenticated session.	RA 21.6 · MB III-40, III-11 · IG Ch17
M103	D15	Authorization & Policy Enforcement	Decides and enforces what an authenticated participant may do.	RA 21.7, 11.5 · MB III-41 · IG Ch17
M104	D15	Role Management	Defines roles as reusable bundles of responsibility and access.	MB III-42, III-21 · ONT Ch12
M105	D15	Permission Management	Defines the granular permissions that roles and policies grant.	MB III-43 · RA 21.8
M106	D15	Zero Trust & Access Boundaries	Treats every request as untrusted until explicitly verified.	RA 21.9 · PX Ch34
D16 — Organization & Tenancy
ID	Domain	Module Name	Description	Source(s)
M107	D16	Organization Lifecycle & Provisioning	Creates, configures, and retires organizations as tenants of the platform.	MB III-9, III-45 · ONT Ch11
M108	D16	Membership & Team Management	Manages who belongs to an organization and to which teams.	ONT Ch11 · MB III-45 · RA 14.12
M109	D16	Tenant Isolation & Data Scoping	Guarantees that one organization can never reach another's data.	RA 11.8 · MB III-44 · ONT Ch11
M110	D16	Organizational Structure & Hierarchy	Represents departments, business units, and reporting structure.	RA 14.12 · ONT Ch11 · PX Ch19
M111	D16	Organization Settings & Preferences	Holds per-organization configuration and operating preferences.	MB III-9, III-53 · RA 11.9
M112	D16	Ownership & Accountability Assignment	Assigns clear ownership and accountability for domains, data, and decisions.	RA 14.13, 8.9 · MB III-85
D17 — Data & Information Management
ID	Domain	Module Name	Description	Source(s)
M113	D17	Enterprise Data Model & Entity Relationships	Defines the authoritative structure and relationships of enterprise data.	RA 20.5 · MB III-12, III-38 · ONT Ch10
M114	D17	Master Data Management	Maintains single authoritative versions of core shared entities.	RA 20.7, 30.9
M115	D17	Reference Data Management	Governs shared code sets, lookups, and classification values.	RA 20.8, 30.9
M116	D17	Transactional & Operational Data Management	Owns the live business data of record and its runtime authority.	RA 20.6, 20.9 · MB III-11, III-37
M117	D17	Event Store	Retains the durable record of what happened, in order.	RA 20.10, 30.17 · MB III-32
M118	D17	Analytical Data Platform	Organizes data for analysis, reporting, and historical insight.	RA 20.11–20.13, 30.9
M119	D17	Vector Data Store	Stores semantic representations enabling meaning-based retrieval.	RA 20.14 · IG Ch19
M120	D17	Metadata & Data Catalog	Describes what data exists, what it means, and who owns it.	RA 20.15, 16.8, 30.9
M121	D17	Data Quality Management	Measures and improves the accuracy and completeness of enterprise data.	RA 20.16 · ONT Ch30
M122	D17	Data Governance & Stewardship	Assigns ownership and enforces policy over how data may be used.	RA 20.17, 11.22 · ONT Ch17
M123	D17	Data Lifecycle & Retention	Governs data from creation through archival and deletion.	RA 20.19 · MB III-68–69
M124	D17	Backup & Restore	Protects data against loss and proves it can be recovered.	RA 20.20 · MB III-66 · IG Ch31
M125	D17	Data Migration & Cutover	Moves data to new authoritative stores safely, with reconciliation before cutover.	MB III-37 · IG Ch37
M126	D17	AI Data Management	Governs the data used to ground, train, and evaluate AI.	RA 20.21, 30.10 · ONT Ch15
D18 — Integration & Interoperability
ID	Domain	Module Name	Description	Source(s)
M127	D18	API Management & Design	Defines and governs the contracts through which capability is exposed.	RA 18.6, 30.16 · MB III-35 · IG Ch15
M128	D18	API Gateway	Provides the single controlled entry point for external API traffic.	RA 18.7, Ch8 · MB III-35
M129	D18	Internal Service Integration	Connects internal services through stable, governed interfaces.	RA 18.5, 18.8 · ONT 16.5
M130	D18	Event Architecture & Event Bus	Distributes business events so domains stay decoupled yet coordinated.	RA 18.9, Ch25, 30.17 · MB III-32 · IG Ch21
M131	D18	Event Streaming & Messaging	Moves high-volume and asynchronous messages reliably between components.	RA 18.10–18.11 · IG Ch21
M132	D18	Webhook Management	Notifies external systems of events they have subscribed to.	RA 18.12 · MB III-36
M133	D18	Connector Framework	Provides reusable, governed connectors to recurring external system types.	RA 18.13 · IG Ch22
M134	D18	External System Integration & Anti-Corruption	Integrates outside systems without letting their models leak inward.	RA 18.14–18.15, 8.4 · MB III-36
M135	D18	Data Transformation & Mapping	Translates data between external and canonical representations.	RA 18.16 · MB III-21, III-23
M136	D18	Integration Contracts & Governance	Governs integration versioning, compatibility, and lifecycle.	RA 18.20–18.21, 11.20–11.21 · MB III-36
M137	D18	Developer Experience & API Portal	Enables developers to discover, understand, and adopt Cortex interfaces.	PX Ch42 · RA 30.16
M138	D18	Integration Reliability & Observability	Keeps integrations resilient and makes their behaviour visible.	RA 18.18–18.19 · MB III-60
D19 — Observability & Telemetry
ID	Domain	Module Name	Description	Source(s)
M139	D19	Telemetry & Metrics Collection	Gathers signals describing what the platform and business are doing.	RA 11.10, Ch8 · MB III-62 · ONT 16.10
M140	D19	Monitoring & Health	Continuously assesses whether services are healthy and behaving as expected.	RA 19.9 · MB III-63 · ONT 16.11 · IG Ch27
M141	D19	Logging	Records what happened in a consistent, queryable, privacy-safe form.	RA 11.12 · MB III-64 · IG Ch28
M142	D19	Distributed Tracing	Follows a single request across services to locate cause.	RA 11.10 · IG Ch27
M143	D19	Alert & Escalation Management	Raises and routes alerts to the right responder without fatigue.	RA 19.10 · ONT 16.12
M144	D19	Audit Trail & Evidence Capture	Records who did what, when, producing durable non-repudiable evidence.	RA 11.11, Ch8 · MB III-65 · ONT Ch17
M145	D19	Performance Monitoring	Measures responsiveness and throughput against expectation.	RA 11.15 · MB III-58 · IG Ch29
M146	D19	Error Tracking & Diagnostics	Detects, classifies, and diagnoses failures affecting users.	RA 11.13 · MB III-56–57
D20 — Platform Configuration & Administration
ID	Domain	Module Name	Description	Source(s)
M147	D20	Configuration Management	Governs platform configuration as controlled, environment-aware settings.	RA 11.9, 19.18, Ch8 · MB III-53 · IG Ch26
M148	D20	Feature Flag & Rollout Control	Turns capability on or off safely, including instant kill switches.	RA Ch8 · MB III-53 · IG Ch26
M149	D20	Component Registry & System Manifest	Maintains the single authoritative inventory of what the system contains.	MB III-26 · RA 12.16 · ONT Ch26
M150	D20	Platform Administration	Gives administrators governed control over platform-wide operation.	MB III-52 · RA 14.5
M151	D20	Environment Management	Defines and isolates the environments the platform runs in.	MB III-73 · IG Ch23–24
M152	D20	Runtime Configuration & Operational Switches	Adjusts runtime behaviour without redeployment, under governance.	MB III-53 · RA 10.12
D21 — Security & Privacy
ID	Domain	Module Name	Description	Source(s)
M153	D21	Security Architecture & Controls	Establishes the security model and controls protecting the platform.	RA 21.4, 11.6 · MB III-39 · IG Ch30
M154	D21	Secrets & Key Management	Protects credentials and keys and keeps them out of code and logs.	RA 21.10 · IG Ch26
M155	D21	Cryptography & Data Protection	Protects data in transit and at rest through approved cryptography.	RA 21.11 · MB III-39
M156	D21	API & Application Security	Defends application and API entry points against abuse.	RA 21.12, 21.14 · IG Ch30
M157	D21	Infrastructure Security	Secures the underlying compute, network, and platform substrate.	RA 21.13 · IG Ch23, Ch30
M158	D21	AI Security	Protects AI surfaces against prompt abuse, leakage, and misuse.	RA 21.15, 15.17 · PX Ch38
M159	D21	Data Privacy & Protection	Honours privacy commitments and protects personal information.	RA 21.16, 11.7 · MB III-69 · PX Ch36
M160	D21	Threat Detection & Security Monitoring	Detects hostile activity and surfaces it for response.	RA 21.17–21.18, 21.21
M161	D21	Security Incident Response	Contains, resolves, and learns from security incidents.	RA 21.19 · IG Ch35
D22 — Governance, Risk & Compliance
ID	Domain	Module Name	Description	Source(s)
M162	D22	Policy Management & Enforcement	Defines enterprise policy and ensures it is actually enforced.	ONT Ch17 · RA 14.10, 11.23 · PX Ch37
M163	D22	Architecture Governance & Decision Records	Governs architectural decisions and preserves the reasoning behind them.	RA Ch12, 12.6, Ch31 · MB III-86
M164	D22	Standards Management & Conformance	Maintains enterprise standards and verifies conformance to them.	RA 12.8–12.9 · IG Ch38
M165	D22	Risk Management	Identifies, assesses, and treats risk across the enterprise.	RA 12.11 · ONT Ch17 · PX Ch37
M166	D22	Regulatory Compliance & Evidence	Demonstrates compliance with legal and regulatory obligation.	MB III-68 · RA 11.17 · PX Ch37 · ONT Ch17
M167	D22	AI Governance & Explainability	Governs how AI may be used and ensures its outputs can be explained.	RA 11.18 · PX Ch38 · ONT Ch15, Ch17
M168	D22	Audit & Assurance Programme	Independently verifies that controls operate as claimed.	ONT Ch17 · RA 11.11 · MB III-84
M169	D22	Decision Authority & Accountability	Establishes who may decide what, and who answers for the outcome.	MB III-84–86 · RA 12.18 · PX Ch33
M170	D22	Exception & Waiver Management	Governs deliberate, time-bounded departures from standard.	RA 12.10 · IG Ch38
M171	D22	Quality Gates & Acceptance Governance	Blocks progression until defined quality criteria are demonstrably met.	IG Ch39 · MB III-77 · RA 12.8
M172	D22	Ethical & Organizational Trust Governance	Holds the platform to its ethical commitments and sustains earned trust.	PX Ch35, Ch39 · ONT Ch17 · MB IV-9
D23 — Engineering & Delivery Lifecycle
ID	Domain	Module Name	Description	Source(s)
M173	D23	Engineering Principles & Coding Standards	Defines how code must be written to be maintainable and safe.	IG Ch5, Ch8–Ch9 · MB IV-10
M174	D23	Repository & Project Structure Standards	Standardizes how work is organized in repositories and modules.	IG Ch6–Ch7
M175	D23	Version Control & Branching	Governs how change is tracked, branched, and integrated.	IG Ch11
M176	D23	Code Review & Engineering Quality	Ensures every change is independently reviewed before it lands.	IG Ch12, Ch39
M177	D23	Testing Strategy & Automation	Proves behaviour is correct and stays correct as the system evolves.	IG Ch32 · MB III-76
M178	D23	CI/CD & Build Automation	Automates build, verification, and promotion of every change.	IG Ch25
M179	D23	Deployment Management	Delivers change into environments predictably and reversibly.	IG Ch24 · RA Ch22, 30.20 · MB III-72
M180	D23	Release Management & Versioning	Governs what is released, when, and under which version.	IG Ch33 · MB III-71, III-74
M181	D23	Cloud Infrastructure & Provisioning	Provisions and manages the infrastructure the platform runs on.	IG Ch23 · RA 30.19 · MB III-13
M182	D23	Architecture Evolution & Modernization	Evolves the platform through bounded additive change rather than rebuild.	RA Ch32 · IG Ch40 · PX Ch45 · MB IV-10
M183	D23	Technical Debt & Maintenance Management	Tracks and deliberately repays technical debt.	IG Ch36 · MB III-78–79
D24 — External Ecosystem & Extensibility
ID	Domain	Module Name	Description	Source(s)
M184	D24	External Service Provider Management	Governs relationships with third-party providers reached only through the Integration Layer.	RA 8.4, 10.14 · MB III-36
M185	D24	Extension & Plugin Framework	Lets the platform be extended without modifying its core.	RA 10.13 · PX Ch44
M186	D24	Partner & Marketplace Ecosystem	Enables partners to build on and distribute through Cortex.	PX Ch46, Ch68 · ONT 18.15
Merge decisions applied (duplicates collapsed, not dropped):

AI memory (RA 15.11) + organizational memory (RA 16.18) → M016 (D02); D01 consumes it via M005.
Semantic/vector search (RA 16.11–16.12) placed once in D11; vector storage separately in M119 (D17).
Immutable snapshots appear in both proposal governance (MB III-29) and records (MB III-11) → single M093 (D13); D08's M062 governs the proposal gate only.
"Feature Management" split by intent: product offering definition M038 (D05) vs. release toggles M148 (D20).
Metadata appears in RA 16.8 and 20.15 → single M120 (D17); D02 retains taxonomy as M015.
Migration appears in MB III-37 and IG Ch37 → single M125 (D17).
Alerting split: operator alerts M143 (D19) vs. participant notifications M086 (D12).
Backup/restore M124 (D17, data) kept distinct from DR/continuity M047 (D06, service) per RA 20.20 vs 19.16.
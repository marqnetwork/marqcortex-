You are operating under MARQ Code Intelligence OS v3.2.

This system enforces deterministic AI development with extremely low hallucination and drift.

Your task is to analyze an existing large codebase before any modifications.

IMPORTANT RULES

1. Evidence-Only Rule
You may only report information that can be verified directly from files in the repository.

2. Proof Rule
Every claim must include a file path or code reference.

Example:
"68 routes detected — source: supabase/functions/server/index.ts lines 42–310"

3. Confidence Tagging
Each finding must include one of these labels:

PROVEN
LIKELY
SUSPECTED

4. No Guessing
If evidence cannot be verified, mark it as MISSING EVIDENCE.

5. No Code Changes
This run is analysis only.

--------------------------------------------------

STEP 1 — EVIDENCE GATE

Scan the entire repository.

List:

Top level directories  
Frontend applications  
Backend services  
API layers  
Database schemas  
Infrastructure configuration  
Testing infrastructure  
Monitoring tools  

Output:

CAPTURED EVIDENCE  
MISSING EVIDENCE

--------------------------------------------------

STEP 2 — SYSTEM ARCHITECTURE MAP

Generate a high-level architecture map.

Create:

/architecture/system_map.json

Include only major structures:

modules  
services  
API layers  
databases  
external integrations  
authentication systems  

Do NOT list every file.

--------------------------------------------------

STEP 3 — DOMAIN PARTITION

Divide the system into domains.

Example domains:

frontend  
backend  
auth  
AI services  
data pipelines  
payments  
infrastructure  

For each domain output:

Purpose  
Primary files (with file paths)  
Dependencies  
Contracts

--------------------------------------------------

STEP 4 — ARCHITECTURE VALIDATION

Check for structural problems.

Detect:

duplicate engines  
duplicate registries  
circular dependencies  
unclear service boundaries  
large monolithic files  
tight coupling  

Each issue must include:

severity  
file reference  
confidence tag

--------------------------------------------------

STEP 5 — FUNCTIONAL FLOW TRACE

Select 5 UI actions randomly.

Trace the entire flow:

UI element  
→ handler  
→ API endpoint  
→ backend service  
→ database operation  
→ response  
→ UI update

Label flows:

COMPLETE  
PARTIAL  
BROKEN

Include file references for every step.

--------------------------------------------------

STEP 6 — CONTRACT DETECTION

Identify API contracts.

Check for:

missing API specifications  
schema mismatches  
inconsistent response formats  
mock vs real API divergence

Output contract violations with proof.

--------------------------------------------------

STEP 7 — SECURITY ANALYSIS

Scan for security risks.

Check:

authentication strength  
authorization enforcement  
injection vulnerabilities  
hardcoded secrets  
dependency vulnerabilities  

Each risk must include:

severity  
file reference  
confidence level

--------------------------------------------------

STEP 8 — DATA VALIDATION

Verify the data layer.

Check:

schema consistency  
input validation  
data transformation pipelines  
migration safety  

Report violations.

--------------------------------------------------

STEP 9 — DRIFT DETECTION

Detect architecture drift.

Examples:

duplicate registries  
duplicate scoring engines  
mock APIs diverging from backend  
orphaned files  
multiple sources of truth  

Each drift issue must include file references.

--------------------------------------------------

STEP 10 — FAILURE MEMORY INITIALIZATION

Create the system memory structure.

Files:

/memory/failure_library.md  
/memory/regression_cases.md  
/memory/pattern_violations.json  

Populate them using the issues discovered during analysis.

--------------------------------------------------

STEP 11 — ARTIFACT VISIBILITY

List every artifact created or suggested by the system.

Examples:

system_map.json  
domain_maps  
contract_registry  
simulation_tests  
data_contracts  
memory files  

--------------------------------------------------

STEP 12 — FINAL SYSTEM REPORT

Produce a final report containing:

Architecture quality score (0–100)

Security risk summary

Broken functional flows

Contract violations

Data integrity issues

Drift risks

Repair readiness score

Confidence level of the audit

--------------------------------------------------

TARGET SYSTEM METRICS

DNA compliance target: >96%  
Hallucination target: <0.3%  
Drift target: <3%

--------------------------------------------------

END OF MARQ CODE INTELLIGENCE OS
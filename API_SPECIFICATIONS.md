# MARQ Cortex — API Specifications

**Server:** Supabase Edge Function (`make-server-324f4fbe`)  
**Base URL:** `https://{projectId}.supabase.co/functions/v1/make-server-324f4fbe`  
**Auth schemes:**
- `TEAM_TOKEN` — Supabase JWT issued at `/auth/team/login`. Pass as `Authorization: Bearer {token}`.
- `CLIENT_TOKEN` — Session token issued at `/auth/client/verify`. Pass as `Authorization: Bearer client_{uuid}`.
- `ANON` — No auth. Use public anon key as `Authorization: Bearer {publicAnonKey}`.

**Rate limit:** 120 req/min per IP. Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Group 1 — Health & Test

### 1. `GET /ping`
**Auth:** ANON  
**Returns:** `{ success, message: "pong", timestamp, server }`  
**Notes:** No KV access. Fastest liveness check.

---

### 2. `GET /test-auth`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, message, userId, timestamp }`  
**Errors:** `401` — invalid or expired token.

---

### 3. `GET /health`
**Auth:** ANON  
**Returns:** `{ status: "ok"|"error", timestamp, kvStore: "connected"|"error" }`  
**Notes:** Performs a read/write/delete cycle on the KV store to confirm connectivity.

---

### 4. `GET /diagnostic`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, timestamp, counts: { submissions, notifications, notes, proposals }, types, samples }`  
**Notes:** Database stats only — no submission data returned.

---

## Group 2 — Lead Capture

### 5. `POST /leads/capture`
**Auth:** ANON  
**Body:** `{ name?, email, phone?, website? }`  
**Returns:** `{ success, leadId }`  
**Errors:** `400` — email missing.  
**Side effects:** Stores `lead:{leadId}` and `lead_email:{email}` in KV. Fires team notification email (gated by `newSubmission` pref).

---

### 6. `POST /leads/exit-intent`
**Auth:** ANON  
**Body:** `{ email }`  
**Returns:** `{ success, leadId, alreadyExists? }`  
**Notes:** Idempotent — returns existing leadId if email already captured.

---

## Group 3 — Auth

### 7. `POST /auth/team/login`
**Auth:** ANON  
**Body:** `{ email, password }`  
**Returns:** `{ success, accessToken, user: { id, email, name } }`  
**Errors:** `400` — missing fields. `401` — invalid credentials.  
**Notes:** Proxies to Supabase Auth `signInWithPassword`. Token is a Supabase JWT.

---

### 8. `POST /auth/client/verify`
**Auth:** ANON  
**Body:** `{ email }`  
**Returns:** `{ exists: false }` | `{ exists: true, submissionId, companyName, sessionToken }`  
**Notes (F-003):** Issues a `client_{uuid}` session token stored in KV with 8-hour TTL. Required for protected client routes. Token is prefixed `client_` to distinguish from team JWTs.

---

## Group 4 — Submissions (Team)

### 9. `POST /submissions`
**Auth:** ANON  
**Body:** `{ contactName?, email, phone?, website?, industry, answers, readinessScore? }`  
**Returns:** `{ success, submissionId }`  
**Notes (F-001):** If `readinessScore` is provided (computed client-side by `computeInstantScore`), it is stored as `aiScore` — eliminating dual-scoring drift. Falls back to `round((completionScore + qualityScore) / 2)` for direct API calls.  
**Side effects:** Stores `sub:{id}` and `sub_email:{email}` in KV. Creates notification. Fires `newSubmission` email.

---

### 10. `GET /submissions`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, submissions: Submission[], total }`  
**Notes:** Fetches all `sub:` prefix keys. Returns submissions sorted newest-first. Filters out malformed entries.

---

### 11. `GET /submissions/:id`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, submission: Submission }`  
**Errors:** `404` — not found.

---

### 12. `PATCH /submissions/:id/status`
**Auth:** TEAM_TOKEN  
**Body:** `{ status?, priority? }`  
**Returns:** `{ success, submission: Submission }`  
**Valid statuses:** `new` | `in-review` | `completed` | `approved`  
**Side effects:** On `in-review` → sends client "under review" email. On `completed` → fires `reportReady` email (gated). Stores status-change notification.

---

### 13. `PATCH /submissions/bulk`
**Auth:** TEAM_TOKEN  
**Body:** `{ ids: string[], status?, priority?, assignedTo? }`  
**Returns:** `{ success, updated: number, results: Array<{ id, success, error? }> }`  
**Notes:** Max 100 ids. Processes in parallel. Each failure is logged but doesn't abort others.

---

## Group 5 — Client Portal

### 14. `GET /client/submission/:id`
**Auth:** CLIENT_TOKEN (preferred) or `?email=` query param (fallback)  
**Returns:** `{ success, submission: Submission }`  
**Notes (F-003):** Token path validates `client_session:{token}` in KV and confirms `submissionId` matches. Email path is backward-compatible but weaker. Both paths reject on mismatch with `404` (not `403`, to avoid enumeration).

---

### 15. `POST /client/submission/:id/engagement`
**Auth:** ANON  
**Body:** `{ type, meta? }`  
**Valid types:** `report_viewed` | `cta_clicked` | `pdf_printed` | `portal_opened` | `proposal_viewed` | `meeting_scheduled` | `message_sent`  
**Returns:** `{ success, engagement, event }`  
**Notes:** Updates aggregate engagement fields on submission AND appends to discrete event log `eng_log:{id}` (max 50 events, newest-first).

---

### 16. `GET /client/submission/:id/engagement/log`
**Auth:** ANON  
**Returns:** `{ success, events: Array<{ id, type, at, meta? }> }`

---

### 17. `GET /cortex/engagement-summary`
**Auth:** TEAM_TOKEN  
**Query:** `?ids=id1,id2,...` (comma-separated, max 100)  
**Returns:** `{ success, summary: Record<submissionId, LatestEvent | null> }`  
**Notes:** Returns only the most recent event per submission.

---

## Group 6 — Analytics

### 18. `GET /analytics/overview`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, analytics: { total, byStatus, byPriority, avgQuality, avgCompletion, avgAiScore, conversionRate, avgTimeToReviewHours, weeklyTrend, proposalStats, highPriorityThisWeek, dailyTrend, industryBreakdown, generatedAt } }`  
**Notes:** Computes live from all `sub:` and `proposal:` prefix keys. `dailyTrend` covers last 14 days.

---

### 19. `GET /analytics/engagement`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, engagement: { reportDelivery, notes, topEngagedLeads, recentActivity } }`  
**Notes:** `reportDelivery` includes `viewRate`, `ctaRate`, `pdfRate`. `topEngagedLeads` capped at 10. `recentActivity` capped at 25.

---

## Group 7 — Notifications

### 20. `GET /notifications`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, notifications: AppNotification[], unreadCount }`  
**Notes:** Computes `read` state against `notifs_last_read_at` timestamp in KV. Capped at 50 most recent.

---

### 21. `POST /notifications/read`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success }`  
**Notes:** Stores current timestamp as `notifs_last_read_at`. All prior notifications become `read: true` on next `GET /notifications`.

---

## Group 8 — Notes

### 22. `GET /submissions/:id/notes`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, notes: Note[] }`  
**Notes:** Fetches all `note:{submissionId}:` prefix keys. Returns sorted oldest-first.

---

### 23. `POST /submissions/:id/notes`
**Auth:** TEAM_TOKEN  
**Body:** `{ content, type?: "note"|"action"|"flag"|"insight" }`  
**Returns:** `{ success, note: Note }`  
**Notes:** Author name and email are derived from the team JWT — no need to pass them in body.

---

### 24. `DELETE /submissions/:id/notes/:noteId`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success }`  
**Notes:** Hard delete from KV. No recovery.

---

## Group 9 — Messaging

### 25. `GET /submissions/:id/messages/team`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, messages: Message[], unreadFromClient }`  
**Notes:** Marks thread as read (updates `msg_read:{submissionId}` in KV). `unreadFromClient` is the count of client messages since last team read.

---

### 26. `POST /submissions/:id/messages/team`
**Auth:** TEAM_TOKEN  
**Body:** `{ content, authorName? }`  
**Returns:** `{ success, message: Message }`  
**Side effects:** Sends client a "team reply" email (always transactional — not gated).

---

### 27. `GET /submissions/:id/messages`
**Auth:** ANON (submissionId is the implicit credential)  
**Returns:** `{ success, messages: Message[] }`

---

### 28. `POST /submissions/:id/messages`
**Auth:** ANON  
**Body:** `{ content, clientName? }`  
**Returns:** `{ success, message: Message }`  
**Side effects:** Stores notification. Fires `messageReceived` team email (gated).

---

## Group 10 — Proposals (Team)

### 29. `GET /submissions/:id/proposal`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, proposal: Proposal | null }`

---

### 30. `POST /submissions/:id/proposal`
**Auth:** TEAM_TOKEN  
**Body:** Proposal object (must include `proposal_id`)  
**Returns:** `{ success, proposal: Proposal }`  
**Notes:** Preserves sent/viewed/accepted/rejected status — you can only save as `draft`. Once sent, status is immutable via this endpoint.

---

### 31. `POST /submissions/:id/proposal/send`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, proposal: Proposal }`  
**Errors:** `404` — no draft saved. `400` — already responded.  
**Side effects:** Sets status `sent`. Fires proposal-sent email to client. Stores `Proposal Sent` notification.

---

## Group 11 — Proposals (Client)

### 32. `GET /client/submission/:id/proposal`
**Auth:** ANON  
**Returns:** `{ success, proposal: Proposal | null }`  
**Notes:** Returns `null` if status is `draft`. Auto-advances `sent` → `viewed` on first client open. Fires `proposalViewed` team notification and email (gated).

---

### 33. `POST /client/submission/:id/proposal/respond`
**Auth:** ANON  
**Body:** `{ response: "accepted"|"rejected", clientName? }`  
**Returns:** `{ success, proposal: Proposal }`  
**Notes:** Idempotent — calling again returns same proposal. If accepted, submission status advances to `approved`. Fires `proposalAccepted` team email (gated).

---

## Group 12 — Team Management

### 34. `GET /team/members`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, members: TeamMemberRecord[] }`  
**Notes:** Reads from Supabase Auth — all users with `user_metadata.role === 'team'`.

---

### 35. `POST /team/invite`
**Auth:** TEAM_TOKEN  
**Body:** `{ name, email, teamRole?: "admin"|"reviewer"|"viewer", tempPassword? }`  
**Returns:** `{ success, member: TeamMemberRecord, tempPassword }`  
**Errors:** `409` — email already exists.  
**Notes:** Creates Supabase Auth user with `email_confirm: true`. Auto-generates password if not provided. Returns `tempPassword` in response (one-time — not stored).

---

### 36. `PATCH /team/members/:id`
**Auth:** TEAM_TOKEN  
**Body:** `{ name?, teamRole? }`  
**Returns:** `{ success, member: { id, email, name, teamRole } }`

---

### 37. `DELETE /team/members/:id`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success }`  
**Errors:** `400` — cannot remove yourself.  
**Notes:** Hard-deletes from Supabase Auth. Cleans up `team:member:{id}` from KV.

---

## Group 13 — Settings

### 38. `GET /settings`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, currentUser, platformSettings, health: { submissionCounts, serverTime, recentActivity } }`

---

### 39. `PATCH /settings`
**Auth:** TEAM_TOKEN  
**Body:** `{ platformSettings?: PlatformSettings, profileName?: string }`  
**Returns:** `{ success }`  
**Notes:** `platformSettings` is stored as `settings:platform` in KV. `profileName` updates Supabase Auth user metadata.

---

## Group 14 — Email

### 40. `POST /test-email`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, sent, resendKeyConfigured, to }`  
**Notes:** Sends to the authenticated team member's email. Logs if `RESEND_API_KEY` not configured.

---

### 41. `POST /email/weekly-digest`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, to? }` | `{ success: false, reason }`  
**Notes:** Gated by `weeklyDigest` notification preference. Aggregates live stats from all `sub:` and `proposal:` keys.

---

### 42. `GET /email/status`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, resendConfigured, fromAddress, note }`

---

### 43. `POST /email/send`
**Auth:** TEAM_TOKEN  
**Body:** `{ to, subject, html?, text? }`  
**Returns:** `{ success, sent, resendKeyConfigured, messageId }`  
**Notes:** Direct send via Resend API. If `RESEND_API_KEY` not set, logs and returns `sent: false` (no error thrown).

---

### 44. `POST /email-queue`
**Auth:** ANON  
**Body:** `{ submissionId, contactName, contactEmail, companyName, industry, readinessScore, bottleneckTheme, emails: QueuedEmailPayload[] }`  
**Returns:** `{ success, queued }`  
**Notes:** Stores each email as `emailq:{submissionId}:{emailId}` in KV. Fires diagnostic-received email (gated).

---

### 45. `GET /email-queue`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, emails: QueuedEmailPayload[], total }`

---

### 46. `PATCH /email-queue/:emailId`
**Auth:** TEAM_TOKEN  
**Body:** `{ status: "sent"|"skipped"|"failed" }`  
**Returns:** `{ success, email }`  
**Notes:** When status is `sent`, fires the actual nurture email via Resend (gated per-template by notification prefs).

---

## Group 15 — Client Report

### 47. `GET /client/submission/:id/report`
**Auth:** ANON  
**Returns:** `{ success, report: ClientReport | null, aiPowered: boolean }`  
**Notes:** Returns `null` if no CORTEX analysis exists yet (`cortex:{id}` key absent or status !== `complete`). When AI analysis exists, builds a full ClientReport shape from it.

---

## Group 16 — CORTEX AI Analysis

### 48. `POST /submissions/:id/analyze`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, analysis: CortexAnalysisResult }`  
**Errors:** `503` — `OPENAI_API_KEY` not configured. `404` — submission not found.  
**Notes:** Runs OpenAI analysis via `runCortexAnalysis()`. Persists to `cortex:{id}` in KV. Back-fills `aiScore`, `qualityScore`, `priority` on the submission record.

---

### 49. `GET /submissions/:id/cortex`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, analysis: CortexAnalysisResult | null }`

---

### 50. `DELETE /submissions/:id/cortex`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success }`  
**Notes:** Clears `cortex:{id}` from KV. Next analysis run will recompute from scratch.

---

### 51. `GET /cortex/status`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, analyzed: Record<submissionId, { analyzedAt, aiScore, model, priority }>, count }`  
**Notes:** Scans all `cortex:` prefix keys. Only includes entries with `status === 'complete'`.

---

### 52. `POST /submissions/analyze-batch`
**Auth:** TEAM_TOKEN  
**Body:** `{ ids: string[] }` (max 10)  
**Returns:** `{ success, results: Array<{ id, success, aiScore?, error? }>, analyzed, total }`  
**Errors:** `503` — `OPENAI_API_KEY` not configured.  
**Notes:** Sequential processing (no parallel AI calls). Partial failures do not abort the batch.

---

## Group 17 — CORTEX Outcomes & Learning Loop

### 53. `POST /submissions/:id/outcome`
**Auth:** TEAM_TOKEN  
**Body:** `{ didConvert: boolean, conversionValue?, lostReason?, recommendationWorked?, whatWeLearned?, improvementAreas? }`  
**Returns:** `{ success, outcome: OutcomeRecord }`  
**Notes:** If `didConvert === true` and submission is not yet `approved`, auto-advances status.

---

### 54. `GET /submissions/:id/outcome`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, outcome: OutcomeRecord | null }`

---

### 55. `GET /cortex/outcomes`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, outcomes: Record<submissionId, { didConvert, conversionValue, loggedAt }>, count }`  
**Notes:** Summary map — used to decorate Kanban lead cards with conversion status.

---

### 56. `GET /cortex/learning-loop`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, isEmpty, data: LearningLoopData | null }`  
**Notes:** Aggregates all `outcome:` prefix keys into: `conversionRate`, `avgDealSize`, `recommendationAccuracy`, `byIndustry`, `scoreCorrelation`, `topLostReasons`, `recentOutcomes`, `avgDaysToClose`.

---

## Group 18 — CORTEX Pipeline (Kanban)

### 57. `GET /cortex/pipeline-positions`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, positions: Record<submissionId, columnId>, count }`  
**Notes:** Stored as single KV key `cortex:pipeline:positions`.

---

### 58. `POST /cortex/pipeline-positions`
**Auth:** TEAM_TOKEN  
**Body:** `{ submissionId, columnId }` (single) | `{ positions: Record<submissionId, columnId> }` (bulk merge)  
**Returns:** `{ success, positions, count }`  
**Notes:** Single-card update called on every drag-drop. Bulk merge called on board initial load.

---

### 59. `DELETE /cortex/pipeline-positions`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success }`  
**Notes:** Full reset — clears all saved positions.

---

### 60. `GET /cortex/column-capacities`
**Auth:** TEAM_TOKEN  
**Returns:** `{ success, capacities: Record<columnId, number> }`

---

### 61. `PUT /cortex/column-capacities`
**Auth:** TEAM_TOKEN  
**Body:** `{ capacities: Record<columnId, number> }`  
**Returns:** `{ success, capacities }`

---

## Group 19 — Proposal Annotations

### 62. `GET /proposal/annotations/:submissionId`
**Auth:** ANON  
**Returns:** `{ success, annotations: ProposalAnnotation[] }`  
**Notes:** Sorted newest-first.

---

### 63. `POST /proposal/annotations/:submissionId`
**Auth:** ANON  
**Body:** `{ selectedText, comment?, author, color?, sectionKey }`  
**Returns:** `{ success, annotation: ProposalAnnotation }`  
**Notes:** Both team and client can annotate. `color` defaults to `#FBBF24`.

---

### 64. `DELETE /proposal/annotations/:submissionId/:annotationId`
**Auth:** ANON  
**Returns:** `{ success }`

---

## Group 20 — AI Services

### 65. `POST /cortex/narrative`
**Auth:** TEAM_TOKEN  
**Body:** `{ type: "why_now"|"confidence_reasoning"|"strategic_decision", context: NarrativeContext }`  
**Returns:** `{ success, type, narrative, model, generated_at }`  
**Errors:** `503` — `OPENAI_API_KEY` not configured.  
**Notes:** Uses `generateNarrative()` (GPT-4o-mini). Narrative explains a math decision — never overrides it.

---

### 66. `POST /blocks/ai-assist`
**Auth:** ANON (anonKey sufficient — no PII in block content)  
**Body:** `{ block_id, block_type, title, current_content, action, context }`  
**Valid actions:** `ai_improve` | `ai_expand` | `ai_simplify` | `fix_issues`  
**Returns:** `{ success, improved_content, diff_summary, confidence, model }`  
**Errors:** `422` — `roi_financial_snapshot` blocks cannot be AI-edited (reference block). `503` — key missing.

---

### 67. `POST /blocks/copilot-interpret`
**Auth:** ANON  
**Body:** `{ user_input, block_summaries: BlockSummary[], scope? }`  
**Returns:** `{ success, intent, targets: BlockTarget[], skipped: string[], confidence }`  
**Notes:** Interprets a natural language instruction and maps it to specific blocks. Does not execute changes — returns a patch plan.

---

### 68. `POST /ai/chat`
**Auth:** TEAM_TOKEN  
**Body:** `{ message, section?, history?: AIChatMessage[], lead?: AIChatLeadContext }`  
**Returns:** `{ success, reply, applyContent?, model, generated_at }`  
**Notes:** Platform-wide conversational AI. `applyContent` is populated when the AI generates content that can be pushed into a section via `GlobalAIChatContext.applyToSection()`. Requires `OPENAI_API_KEY`.

---

## KV Store — Key Namespace Reference

| Prefix | Content | Cardinality |
|---|---|---|
| `sub:{id}` | Full Submission object | 1 per submission |
| `sub_email:{email}` | submissionId string | 1 per email |
| `lead:{id}` | Lead object | 1 per lead |
| `lead_email:{email}` | leadId string | 1 per email |
| `client_session:{token}` | `{ submissionId, email, issuedAt, expiresAt }` | 1 per client session (8h TTL) |
| `notif:{id}` | AppNotification object | Many — capped at 50 on read |
| `notifs_last_read_at` | ISO timestamp string | 1 global |
| `note:{submissionId}:{noteId}` | Note object | Many per submission |
| `msg:{submissionId}:{msgId}` | Message object | Many per submission |
| `msg_read:{submissionId}` | ISO timestamp (team last-read) | 1 per submission |
| `proposal:{submissionId}` | Proposal object | 1 per submission |
| `annotation:{submissionId}:{id}` | ProposalAnnotation | Many per submission |
| `cortex:{submissionId}` | CortexAnalysisResult | 1 per submission |
| `cortex:pipeline:positions` | `Record<submissionId, columnId>` | 1 global |
| `cortex:column:capacities` | `Record<columnId, number>` | 1 global |
| `outcome:{submissionId}` | OutcomeRecord | 1 per submission |
| `eng_log:{submissionId}` | `EngagementEvent[]` (max 50) | 1 per submission |
| `emailq:{submissionId}:{emailId}` | QueuedEmailPayload | Many per submission |
| `settings:platform` | PlatformSettings | 1 global |
| `team:member:{userId}` | TeamMemberRecord | 1 per member |

---

## Environment Variables Required

| Key | Used by | Required |
|---|---|---|
| `SUPABASE_URL` | All routes | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Auth, team management | Yes |
| `SUPABASE_ANON_KEY` | Team login proxy | Yes |
| `OPENAI_API_KEY` | Routes 48, 52, 65, 66, 67, 68 | For AI features |
| `RESEND_API_KEY` | Routes 40, 41, 43, 46 + all side-effect emails | For email delivery |
| `TEAM_ADMIN_EMAIL` | Startup seed | Optional (defaults to `admin@marqcortex.com`) |
| `TEAM_ADMIN_PASSWORD` | Startup seed | Optional (defaults to `CortexAdmin2026!`) |

---

## Go-Live Checklist

1. `supabase functions deploy make-server-324f4fbe`
2. Set `FEATURES.BACKEND_INTEGRATION = true` in `/src/config/features.ts`
3. Set `OPENAI_API_KEY` and `RESEND_API_KEY` in Supabase Edge Function secrets
4. Hit `GET /health` — confirm `kvStore: "connected"`
5. Hit `POST /auth/team/login` with admin credentials — confirm JWT returned
6. Hit `GET /submissions` with JWT — confirm `200 { success: true }`
7. Done. Zero component changes needed.

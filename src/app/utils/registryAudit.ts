/**
 * ============================================================================
 * MARQ CORTEX — INTERACTION AUDIT  (MQC-REGISTRY v1.3)
 * ============================================================================
 *
 * This file classifies EVERY MQC-INT-NNN interaction by its live status,
 * determined by reading the actual component source code.
 *
 * STATUS CODES:
 *   LIVE     — Handler wired, works right now with zero backend (pure UI / client-side engine)
 *   DEMO     — Handler wired, works visually but uses mock/demo data (getMockResponse, getDemoSubmissions, etc.)
 *   GATED    — Handler wired but requires BACKEND_INTEGRATION=true to do anything real (API call, KV write, etc.)
 *   MISSING  — Button renders in the UI but NO onClick/onChange/onSubmit handler is wired — dead button
 *   VISUAL   — Element is intentionally display-only. No handler expected or needed.
 *
 * TEST METHOD: Code-level audit — each classification is justified by
 * reading the component source for onClick/onChange/onSubmit presence,
 * FEATURES.BACKEND_INTEGRATION guard existence, and demo-fallback presence.
 * ============================================================================
 */

export type AuditStatus = 'LIVE' | 'DEMO' | 'GATED' | 'MISSING' | 'VISUAL';

export interface AuditEntry {
  id: string;              // MQC-INT-NNN
  label: string;           // Human label
  status: AuditStatus;
  evidence: string;        // Single line: what in the source code confirms this classification
  component: string;       // File where the button lives
  fixHint?: string;        // For MISSING: what needs to be wired
}

export const AUDIT: AuditEntry[] = [

  // ── LANDING PAGE ──────────────────────────────────────────────────────────
  { id: 'MQC-INT-001', label: 'Client Portal (header)',              status: 'LIVE',    component: 'LandingPage.tsx',           evidence: 'onClick={onClientLogin} — prop wired from App.tsx router' },
  { id: 'MQC-INT-002', label: 'Team Login (header)',                 status: 'LIVE',    component: 'LandingPage.tsx',           evidence: 'onClick={onTeamLogin} — prop wired from App.tsx router' },
  { id: 'MQC-INT-003', label: 'Start Your Free AI Diagnostic',       status: 'LIVE',    component: 'LandingPage.tsx',           evidence: 'onClick={onStartDiagnostic} — prop wired, navigates to DiagnosticRoute' },
  { id: 'MQC-INT-004', label: 'How It Works scroll anchor',          status: 'LIVE',    component: 'LandingPage.tsx',           evidence: 'onClick={scrollToHowItWorks} — howItWorksRef.current?.scrollIntoView({behavior:"smooth"})' },
  { id: 'MQC-INT-005', label: 'Secondary hero CTA',                  status: 'LIVE',    component: 'LandingPage.tsx',           evidence: 'Same onClick={onStartDiagnostic} as primary CTA' },

  // ── DIAGNOSTIC FORM ───────────────────────────────────────────────────────
  { id: 'MQC-INT-006', label: 'Industry card select',                status: 'LIVE',    component: 'DiagnosticForm.tsx',        evidence: 'onClick per industry card → sets selectedIndustry state + advances step' },
  { id: 'MQC-INT-007', label: 'Back (diagnostic form)',              status: 'LIVE',    component: 'DiagnosticForm.tsx',        evidence: 'onClick={() => setCurrentStep(s => s - 1)} — step navigation' },
  { id: 'MQC-INT-008', label: 'Next / Continue',                     status: 'LIVE',    component: 'DiagnosticForm.tsx',        evidence: 'onClick → validates answer, advances step; no API call' },
  { id: 'MQC-INT-009', label: 'Diagnostic question textarea',        status: 'LIVE',    component: 'DiagnosticForm.tsx',        evidence: 'onChange → updates answers[questionId] in local state' },
  { id: 'MQC-INT-010', label: '💡 AI Hint button',                   status: 'LIVE',    component: 'AIAssistant.tsx',           evidence: 'onClick → toggles showHints state, renders contextual hint content — no API call' },
  { id: 'MQC-INT-011', label: 'Submit Diagnostic',                   status: 'LIVE',    component: 'DiagnosticForm.tsx',        evidence: 'onComplete fires → instantScoring(answers) runs client-side → ScorePage shown; submission POST is async/non-blocking' },

  // ── SCORE PAGE ────────────────────────────────────────────────────────────
  { id: 'MQC-INT-012', label: 'Book Your Readiness Call (CTA)',       status: 'LIVE',    component: 'ScorePage.tsx',             evidence: 'onClick={() => setShowBooking(true)} → opens InstantBookingOffer panel' },
  { id: 'MQC-INT-013', label: 'Get Full Report via Email',            status: 'DEMO',    component: 'ScorePage.tsx',             evidence: 'Opens LeadMagnetCapture form locally — form renders; POST /leads/capture requires BACKEND_INTEGRATION' },
  { id: 'MQC-INT-014', label: 'Back to Home',                         status: 'LIVE',    component: 'ScorePage.tsx',             evidence: 'onClick={onBackToHome} → prop wired from App.tsx, navigates to LandingPage' },
  { id: 'MQC-INT-015', label: 'Score insight show-all toggle',        status: 'LIVE',    component: 'ScorePage.tsx',             evidence: 'onClick={() => setShowAllInsights(true)} — conditionally renders all insights' },

  // ── LEAD MAGNET ───────────────────────────────────────────────────────────
  { id: 'MQC-INT-016', label: 'Lead Magnet email input',              status: 'LIVE',    component: 'LeadMagnetCapture.tsx',     evidence: 'onChange → updates email state in LeadMagnetCapture' },
  { id: 'MQC-INT-017', label: 'Get Free Report (submit)',             status: 'DEMO',    component: 'LeadMagnetCapture.tsx',     evidence: 'FEATURES.BACKEND_INTEGRATION=false → skips POST /leads/capture; PDF generation via pdfExport.ts is client-side so download works in demo' },
  { id: 'MQC-INT-018', label: 'Exit intent popup dismiss ×',          status: 'LIVE',    component: 'ExitIntentPopup.tsx',       evidence: 'onClick → sets isDismissed(true), hides popup; sets sessionStorage flag' },
  { id: 'MQC-INT-019', label: 'Yes, send me the guide (exit intent)', status: 'GATED',   component: 'ExitIntentPopup.tsx',       evidence: 'onSubmit → POST /leads/exit-intent; no demo fallback — fails silently if BACKEND_INTEGRATION=false' },

  // ── TEAM LOGIN ─────────────────────────────────────────────────────────────
  { id: 'MQC-INT-020', label: 'Login email input',                    status: 'LIVE',    component: 'TeamLogin.tsx',             evidence: 'onChange → updates email state' },
  { id: 'MQC-INT-021', label: 'Login password input',                 status: 'LIVE',    component: 'TeamLogin.tsx',             evidence: 'onChange → updates password state' },
  { id: 'MQC-INT-022', label: 'Sign In button',                       status: 'DEMO',    component: 'TeamLogin.tsx',             evidence: 'FEATURES.BACKEND_INTEGRATION=false → bypasses POST /auth/team/login, loads demo dashboard directly with any credentials' },
  { id: 'MQC-INT-023', label: 'Show/hide password toggle',            status: 'LIVE',    component: 'TeamLogin.tsx',             evidence: 'onClick → toggles showPassword state → input type="password"|"text"' },

  // ── CLIENT LOGIN ──────────────────────────────────────────────────────────
  { id: 'MQC-INT-024', label: 'Submission ID / Access code input',    status: 'LIVE',    component: 'ClientLogin.tsx',           evidence: 'onChange → updates submissionId state' },
  { id: 'MQC-INT-025', label: 'Client email input',                   status: 'LIVE',    component: 'ClientLogin.tsx',           evidence: 'onChange → updates clientEmail state' },
  { id: 'MQC-INT-026', label: 'Access My Report button',              status: 'DEMO',    component: 'ClientLogin.tsx',           evidence: 'FEATURES.BACKEND_INTEGRATION=false → accepts any ID/email, loads getDemoClientSubmission() without calling POST /auth/client/verify' },

  // ── CLIENT PORTAL — 8 TABS ────────────────────────────────────────────────
  { id: 'MQC-INT-027', label: 'Status tab',                           status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("status")} — fires trackEngagement("portal_opened") on first open' },
  { id: 'MQC-INT-028', label: 'Solution tab',                         status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("solution")} → renders ClientSolutionView' },
  { id: 'MQC-INT-029', label: 'Readiness Report tab',                 status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("report")} — fires trackEngagement("report_viewed") on first open via useEffect' },
  { id: 'MQC-INT-030', label: 'Schedule a Call tab',                  status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("schedule")} → renders MeetingScheduler' },
  { id: 'MQC-INT-031', label: 'Proposal tab',                         status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("proposal")} — fires trackEngagement("proposal_viewed") on first open' },
  { id: 'MQC-INT-032', label: 'Messages tab',                         status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("messages")} → also setMsgUnread(false) clears badge' },
  { id: 'MQC-INT-033', label: 'Your Assessment tab',                  status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("assessment")} → renders ClientQAReview' },
  { id: 'MQC-INT-034', label: 'Strategic Report tab',                 status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={() => setActiveView("strategic-report")} → renders ClientReportDashboard' },
  { id: 'MQC-INT-035', label: 'Logout (client portal)',               status: 'LIVE',    component: 'ClientPortal.tsx',          evidence: 'onClick={onLogout} prop wired — clears client session in App.tsx state' },
  { id: 'MQC-INT-036', label: 'Refresh data (client portal)',         status: 'GATED',   component: 'ClientPortal.tsx',          evidence: 'onClick → loadSubmission(silent=true) → GET /client/submission/:id — no demo path for silent refresh' },
  { id: 'MQC-INT-037', label: 'Accept Proposal',                      status: 'GATED',   component: 'ProposalViewer.tsx',        evidence: 'onClick → POST /client/submission/:id/proposal/respond — no demo fallback; button shows but action is void if BACKEND=false' },
  { id: 'MQC-INT-038', label: 'Decline Proposal',                     status: 'GATED',   component: 'ProposalViewer.tsx',        evidence: 'Same as INT-037 — POST /client/submission/:id/proposal/respond {response:"declined"}' },
  { id: 'MQC-INT-039', label: 'Book a Call (Calendly)',               status: 'LIVE',    component: 'MeetingScheduler.tsx',      evidence: 'onClick → opens Calendly URL in new tab or inline embed — no backend dependency' },
  { id: 'MQC-INT-040', label: 'Client message input',                 status: 'LIVE',    component: 'ClientMessaging.tsx',       evidence: 'onChange → updates messageDraft local state' },
  { id: 'MQC-INT-041', label: 'Client send message',                  status: 'GATED',   component: 'ClientMessaging.tsx',       evidence: 'onClick → POST /submissions/:id/messages; FEATURES.BACKEND_INTEGRATION guard present, no demo fallback' },
  { id: 'MQC-INT-042', label: 'Stage tracker step click',             status: 'VISUAL',  component: 'StageTracker.tsx',          evidence: 'Renders stage steps as divs. No onClick handler wired — purely informational timeline display' },

  // ── TEAM DASHBOARD SIDEBAR ────────────────────────────────────────────────
  { id: 'MQC-INT-043', label: 'Dashboard nav item',                   status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'onClick={() => onNavigate?.(item.id)} — all navItems mapped with same pattern; onNavigate wired in TeamDashboardNew.tsx' },
  { id: 'MQC-INT-044', label: 'CORTEX nav item',                      status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"cortex"}' },
  { id: 'MQC-INT-045', label: 'Team nav item',                        status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"team"}' },
  { id: 'MQC-INT-046', label: 'Settings nav item',                    status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"settings"}' },
  { id: 'MQC-INT-047', label: 'Reviewer nav item',                    status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"reviewer"}' },
  { id: 'MQC-INT-048', label: 'Analytics nav item',                   status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"analytics"}' },
  { id: 'MQC-INT-049', label: 'Emails nav item',                      status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"emails"}' },
  { id: 'MQC-INT-050', label: 'Revenue nav item',                     status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"revenue"}' },
  { id: 'MQC-INT-051', label: 'Mapping nav item',                     status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"mapping"}' },
  { id: 'MQC-INT-052', label: 'Architecture nav item',                status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Same as INT-043 — navItems includes {id:"architecture"}' },
  { id: 'MQC-INT-053', label: 'Sidebar collapse/expand toggle',       status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'onClick={() => setSidebarCollapsed(!sidebarCollapsed)} — motion.aside animates {width: sidebarCollapsed ? 80 : 280}' },
  { id: 'MQC-INT-054', label: 'Mobile menu ☰ open',                  status: 'MISSING', component: 'TeamDashboardLayout.tsx',   evidence: 'NO isMobileMenuOpen state or separate mobile drawer found. Sidebar collapse doubles as mobile toggle — no dedicated mobile ☰ button exists in source', fixHint: 'Add isMobileMenuOpen state + mobile overlay trigger. Currently mobile UX relies only on sidebar width collapse (INT-053).' },
  { id: 'MQC-INT-055', label: 'Mobile sidebar close ×',               status: 'MISSING', component: 'TeamDashboardLayout.tsx',   evidence: 'No dedicated mobile close button found — no isMobileMenuOpen state in TeamDashboardLayout', fixHint: 'Implement mobile drawer with isMobileMenuOpen state. Closing overlay click should set isMobileMenuOpen=false.' },
  { id: 'MQC-INT-056', label: 'Logout (team dashboard)',              status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'onClick={onLogout} — wired directly; calls resetState() + onLogout() in TeamDashboardNew.handleLogout' },
  { id: 'MQC-INT-057', label: 'Notification bell 🔔',                 status: 'LIVE',    component: 'NotificationCenter.tsx',    evidence: 'NotificationCenter manages own isOpen state; bell click = toggle panel. Renders demo notifications when BACKEND=false' },
  { id: 'MQC-INT-058', label: '⌨ Keyboard shortcuts help',           status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'Shortcut "?" registered in useKeyboardShortcuts → setShowKeyboardHelp(true); KeyboardShortcutsHelp modal renders' },
  { id: 'MQC-INT-059', label: 'Global search focus (header)',         status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'onClick={handleFocusSearch} → searchInputRef.current?.focus() + onFocusSearch?.()' },
  { id: 'MQC-INT-060', label: 'CORTEX breadcrumb',                    status: 'LIVE',    component: 'TeamDashboardNew.tsx',      evidence: 'breadcrumbs[0].onClick wired when cortexState.view !== "overview" → setCortexState({view:"overview"})' },
  { id: 'MQC-INT-061', label: 'AI Chat floating button ✨',            status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'Floating motion.button renders when !isOpen → onClick={() => openChat()} confirmed at line ~817 of GlobalAIChat.tsx' },

  // ── COMMAND PALETTE ───────────────────────────────────────────────────────
  { id: 'MQC-INT-062', label: 'Open command palette (⌘K)',            status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts registers {key:"k", meta:isMac(), action:()=>setShowCommandPalette(true)}' },
  { id: 'MQC-INT-063', label: 'Palette search input',                 status: 'LIVE',    component: 'CommandPalette.tsx',        evidence: 'onChange → updates query state → useMemo filters commands by query' },
  { id: 'MQC-INT-064', label: 'Command item click',                   status: 'LIVE',    component: 'CommandPalette.tsx',        evidence: 'onClick → command.action() + onClose() — action is the wired navigation/filter function from useCommandPaletteCommands' },
  { id: 'MQC-INT-065', label: 'Escape (close palette)',               status: 'LIVE',    component: 'CommandPalette.tsx',        evidence: 'useEscapeKey(onClose) hook registered → Escape key closes palette' },
  { id: 'MQC-INT-066', label: 'Arrow keys in palette',                status: 'LIVE',    component: 'CommandPalette.tsx',        evidence: 'onKeyDown → ArrowDown/ArrowUp adjust selectedIndex; Enter fires command.action() — keyboard nav fully wired' },

  // ── GLOBAL AI CHAT ─────────────────────────────────────────────────────────
  { id: 'MQC-INT-067', label: 'AI Chat close ×',                      status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onClick={closeChat} — GlobalAIChatContext.closeChat() → setIsOpen(false)' },
  { id: 'MQC-INT-068', label: 'Lead selector dropdown toggle',        status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onClick={() => setPickerOpen(p => !p)} in LeadContextStrip — opens LeadPicker' },
  { id: 'MQC-INT-069', label: 'Lead search input',                    status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onChange → updates search state → filters roster by company/contact name' },
  { id: 'MQC-INT-070', label: 'Company/lead select',                  status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onClick={() => { onSelect(lead); onClose(); }} — sets activeLead via handleLeadChange' },
  { id: 'MQC-INT-071', label: 'Section switcher dropdown',            status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'SectionSwitcher renders section pills — each onClick={() => onChange(sec.id, sec.label)}' },
  { id: 'MQC-INT-072', label: 'Section option select',                status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onChange → handleSectionSwitch(sectionId, sectionLabel) → setCurrentSection in context' },
  { id: 'MQC-INT-073', label: 'Quick action chip',                    status: 'DEMO',    component: 'GlobalAIChat.tsx',          evidence: 'onClick → sendMessage(action.prompt); BACKEND=false → getMockResponse(prompt, section) returns hardcoded mock reply' },
  { id: 'MQC-INT-074', label: 'Chat message input',                   status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onChange={e => setInput(e.target.value)} — updates input state; also Enter key fires sendMessage' },
  { id: 'MQC-INT-075', label: 'Send chat message',                    status: 'DEMO',    component: 'GlobalAIChat.tsx',          evidence: 'BACKEND=false branch at line ~725: await getMockResponse(trimmed, section) → returns hardcoded reply; BACKEND=true → chatWithAI API call' },
  { id: 'MQC-INT-076', label: 'Clear conversation / Reset',           status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onClick → setMessages([]) — clears messages array, resets to empty state' },
  { id: 'MQC-INT-077', label: 'Copy AI response',                     status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onClick={() => onCopy(id, msg.applyContent)} → navigator.clipboard.writeText(); shows ✓ for 2s' },
  { id: 'MQC-INT-078', label: 'Apply AI content to section',          status: 'LIVE',    component: 'GlobalAIChat.tsx',          evidence: 'onClick={() => onApply(msg)} → applyToSection(sectionId, content) via context registerApplyHandler — falls back to clipboard if no handler' },

  // ── KANBAN PIPELINE ───────────────────────────────────────────────────────
  { id: 'MQC-INT-079', label: 'Kanban card drag start',               status: 'LIVE',    component: 'PipelineKanban.tsx',        evidence: 'useDrag(react-dnd) on each card — drag start works client-side; card lifts with opacity + rotation transform' },
  { id: 'MQC-INT-080', label: 'Kanban card drop',                     status: 'DEMO',    component: 'PipelineKanban.tsx',        evidence: 'useDrop moves card visually in local state immediately; PATCH /submissions/:id/status + POST /cortex/pipeline-positions GATED by BACKEND — visual move works, persistence is DEMO' },
  { id: 'MQC-INT-081', label: 'Kanban card click (open detail)',      status: 'LIVE',    component: 'PipelineKanban.tsx',        evidence: 'onClick → fires onOpenSubmission(submissionId) callback → CortexModulesNew detail panel opens' },
  { id: 'MQC-INT-082', label: 'Kanban ⋯ menu button',                status: 'LIVE',    component: 'PipelineKanban.tsx',        evidence: 'onClick → sets popoverOpen state → renders QuickActionsPopover with engagement signal + priority + note sections' },
  { id: 'MQC-INT-083', label: 'Priority flag toggle (P1)',             status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onClick → PATCH /submissions/:id/status with {priority:"high"|"medium"}; no demo fallback — priority chip updates only after successful API response' },
  { id: 'MQC-INT-084', label: 'Suggested next step action',           status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onClick → moves card + PATCH status based on engagement signal; requires live engagement data + BACKEND=true' },
  { id: 'MQC-INT-085', label: 'Quick Note save',                      status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onClick → POST /submissions/:id/notes; FEATURES.BACKEND_INTEGRATION guard; no demo fallback' },
  { id: 'MQC-INT-086', label: 'Accept ALL remote changes',            status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'Only appears when remoteChanges.size > 0 from 30s poll; poll requires BACKEND=true — button never renders in demo mode' },
  { id: 'MQC-INT-087', label: 'Accept ONE remote change',             status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'Same as INT-086 — per-card Accept micro-button requires live remote diff' },
  { id: 'MQC-INT-088', label: 'Keep local (ignore remote change)',    status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'Only appears alongside Accept (INT-087) — same condition; dismisses entry from remoteChanges Map (client-side) but button only renders with BACKEND=true data' },
  { id: 'MQC-INT-089', label: 'Kanban manual refresh',                status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onClick → GET /cortex/pipeline-positions; FEATURES.BACKEND_INTEGRATION flag checked; no demo fallback' },
  { id: 'MQC-INT-090', label: 'Multi-select card checkbox',           status: 'LIVE',    component: 'PipelineKanban.tsx',        evidence: 'onChange → toggles submissionId in selectedIds Set — pure local state, bulk action bar appears' },
  { id: 'MQC-INT-091', label: 'Bulk move / outcome modal apply',      status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onSubmit → PATCH /submissions/bulk + POST /cortex/pipeline-positions; no demo fallback for persistence' },
  { id: 'MQC-INT-092', label: 'Column capacity edit',                 status: 'LIVE',    component: 'PipelineKanban.tsx',        evidence: 'onClick → opens inline capacity input for column — sets editingCapacity state; no API call until save' },
  { id: 'MQC-INT-093', label: 'Column capacity save',                 status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onSave → PUT /cortex/column-capacities; FEATURES.BACKEND_INTEGRATION guard' },
  { id: 'MQC-INT-094', label: 'Reset board positions',                status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onClick → DELETE /cortex/pipeline-positions; requires BACKEND=true' },

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  { id: 'MQC-INT-095', label: 'Notification bell click',              status: 'LIVE',    component: 'NotificationCenter.tsx',    evidence: 'onClick → toggles isOpen state; fetches GET /notifications but shows demo data when BACKEND=false' },
  { id: 'MQC-INT-096', label: 'Notification item click',              status: 'DEMO',    component: 'NotificationCenter.tsx',    evidence: 'onClick → onNavigateToSubmission() → navigates to cortex page; demo notifications are shown but are static mock objects' },
  { id: 'MQC-INT-097', label: 'Mark all read',                        status: 'GATED',   component: 'NotificationCenter.tsx',    evidence: 'onClick → POST /notifications/read; BACKEND_INTEGRATION guard; badge clearing is local but server-side mark is gated' },
  { id: 'MQC-INT-098', label: 'Close notification panel',             status: 'LIVE',    component: 'NotificationCenter.tsx',    evidence: 'onClick → setIsOpen(false) — pure local state close' },

  // ── SETTINGS ───────────────────────────────────────────────────────────────
  { id: 'MQC-INT-099', label: 'Settings field edit',                  status: 'LIVE',    component: 'SettingsPage.tsx',          evidence: 'onChange → updates local form state (name, email, prefs) — no API call until Save Settings' },
  { id: 'MQC-INT-100', label: 'Save Settings',                        status: 'DEMO',    component: 'SettingsPage.tsx',          evidence: 'BACKEND=false → FEATURES.BACKEND_INTEGRATION guard → shows success toast with demo values; PATCH /settings only fires when BACKEND=true' },
  { id: 'MQC-INT-101', label: 'Email notification toggles',           status: 'LIVE',    component: 'SettingsPage.tsx',          evidence: 'onChange → updates notifPrefs local state; actually persisted only on INT-100 Save Settings' },
  { id: 'MQC-INT-102', label: 'Send Test Email',                      status: 'GATED',   component: 'SettingsPage.tsx',          evidence: 'onClick → POST /test-email; FEATURES.BACKEND_INTEGRATION guard; no demo fallback — button does nothing if BACKEND=false' },
  { id: 'MQC-INT-103', label: 'Send Weekly Digest',                   status: 'GATED',   component: 'SettingsPage.tsx',          evidence: 'onClick → POST /email/weekly-digest; FEATURES.BACKEND_INTEGRATION guard' },

  // ── TEAM MANAGEMENT ────────────────────────────────────────────────────────
  { id: 'MQC-INT-104', label: 'Invite Team Member button',            status: 'LIVE',    component: 'TeamManagement.tsx',        evidence: 'onClick → setShowInvite(true) — opens invite form modal; no API call at this step' },
  { id: 'MQC-INT-105', label: 'Invite name input',                    status: 'LIVE',    component: 'TeamManagement.tsx',        evidence: 'onChange → updates inviteForm.name state' },
  { id: 'MQC-INT-106', label: 'Invite email input',                   status: 'LIVE',    component: 'TeamManagement.tsx',        evidence: 'onChange → updates inviteForm.email state' },
  { id: 'MQC-INT-107', label: 'Role select dropdown',                 status: 'LIVE',    component: 'TeamManagement.tsx',        evidence: 'onChange → updates inviteForm.role state (admin|reviewer|viewer)' },
  { id: 'MQC-INT-108', label: 'Create Member (submit)',               status: 'GATED',   component: 'TeamManagement.tsx',        evidence: 'onSubmit → POST /team/invite (Supabase admin.createUser); BACKEND_INTEGRATION guard. DEMO mode shows demo team from getDemoTeamMembers() but invite button fires API only.' },
  { id: 'MQC-INT-109', label: 'Team member Edit button',              status: 'LIVE',    component: 'TeamManagement.tsx',        evidence: 'onClick → setEditingId(member.id) — opens inline edit form; no API call at this step' },
  { id: 'MQC-INT-110', label: 'Member role change',                   status: 'GATED',   component: 'TeamManagement.tsx',        evidence: 'onChange → PATCH /team/members/:id; BACKEND_INTEGRATION guard; no optimistic local update in demo mode' },
  { id: 'MQC-INT-111', label: 'Remove member button',                 status: 'GATED',   component: 'TeamManagement.tsx',        evidence: 'onClick → setConfirmRemove(id) → confirm dialog → DELETE /team/members/:id; dialog is LIVE but actual deletion is GATED' },

  // ── SUBMISSIONS LIST ──────────────────────────────────────────────────────
  { id: 'MQC-INT-112', label: 'Submission row click',                 status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'onClick → setSelectedSubmission(lead) / setCortexState({view:"detail"}) — opens detail panel with demo data' },
  { id: 'MQC-INT-113', label: 'Status filter dropdown',               status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'onChange → updates statusFilter state → useMemo re-filters leads array — pure client-side' },
  { id: 'MQC-INT-114', label: 'Industry filter dropdown',             status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'Same as INT-113 — updates industryFilter state' },
  { id: 'MQC-INT-115', label: 'Sort column header click',             status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'onClick → setSortField + toggles sortDir (asc/desc) — pure local sort' },
  { id: 'MQC-INT-116', label: 'Row select checkbox',                  status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'onChange → toggles submissionId in selectedIds Set — local state' },
  { id: 'MQC-INT-117', label: 'Select all checkbox',                  status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'onChange → selects/deselects all filtered submissions — local state' },
  { id: 'MQC-INT-118', label: 'Bulk status change dropdown',          status: 'LIVE',    component: 'CortexDashboard.tsx',       evidence: 'onChange → updates bulkTargetStatus local state — no API call yet' },
  { id: 'MQC-INT-119', label: 'Apply Bulk Action',                    status: 'GATED',   component: 'CortexDashboard.tsx',       evidence: 'onClick → PATCH /submissions/bulk; FEATURES.BACKEND_INTEGRATION guard' },
  { id: 'MQC-INT-120', label: 'Run AI Analysis (single)',             status: 'GATED',   component: 'CortexDashboard.tsx',       evidence: 'onClick → analyzeSubmission(id, accessToken) → POST /submissions/:id/analyze; no demo path for real AI' },
  { id: 'MQC-INT-121', label: 'Run Batch Analysis',                   status: 'GATED',   component: 'CortexDashboard.tsx',       evidence: 'onClick → analyzeSubmissionsBatch(accessToken) → POST /submissions/analyze-batch; BACKEND guard' },

  // ── PROPOSAL EDITOR ───────────────────────────────────────────────────────
  { id: 'MQC-INT-122', label: 'Proposal section tab',                 status: 'LIVE',    component: 'ProposalDraftEditor.tsx',   evidence: 'onClick → setActiveSection(sectionId) — tab state switch, no API' },
  { id: 'MQC-INT-123', label: 'Section content edit',                 status: 'LIVE',    component: 'ProposalDraftEditor.tsx',   evidence: 'onInput (contentEditable) / onChange (textarea) → updates draft local state; also clears gate result' },
  { id: 'MQC-INT-124', label: 'Section AI Assist button',             status: 'DEMO',    component: 'ProposalDraftEditor.tsx',   evidence: 'openChat({sectionId, content}) → GlobalAIChat opens; AI response is demo via getMockResponse when BACKEND=false' },
  { id: 'MQC-INT-125', label: 'Save Draft',                           status: 'GATED',   component: 'ProposalDraftEditor.tsx',   evidence: 'onClick per card → POST /submissions/:id/proposal; FEATURES.BACKEND_INTEGRATION guard; no local persistence' },
  { id: 'MQC-INT-126', label: 'Send to Client',                       status: 'GATED',   component: 'ProposalControlPanel.tsx',  evidence: 'onClick → gate check (runReadyGate) → POST /submissions/:id/proposal/send; gate engine is client-side (LIVE) but send itself is GATED' },
  { id: 'MQC-INT-127', label: 'Export PDF (proposal)',                status: 'LIVE',    component: 'ExportPanel.tsx',           evidence: 'checkExportSafety + assembleExportPayload + createProposalSnapshot — all client-side engines; jsPDF download triggered client-side. No backend call.' },
  { id: 'MQC-INT-128', label: 'Preview toggle',                       status: 'LIVE',    component: 'ProposalDraftEditor.tsx',   evidence: 'onClick → toggles isPreview state — switches between edit and rendered preview mode' },

  // ── CORTEX AI MODULES ─────────────────────────────────────────────────────
  { id: 'MQC-INT-129', label: 'Analyze This Lead',                    status: 'GATED',   component: 'CortexModulesNew.tsx',      evidence: 'onClick → analyzeSubmission(id, accessToken) → POST /submissions/:id/analyze; no demo fallback for real analysis' },
  { id: 'MQC-INT-130', label: 'Generate Narrative',                   status: 'GATED',   component: 'CortexModulesNew.tsx',      evidence: 'onClick → POST /cortex/narrative; BACKEND guard; no mock narrative in demo mode' },
  { id: 'MQC-INT-131', label: 'Block AI Assist',                      status: 'GATED',   component: 'EditableBlockCard.tsx',     evidence: 'onClick → POST /blocks/ai-assist; BACKEND guard on backend route' },
  { id: 'MQC-INT-132', label: 'Copilot Interpret',                    status: 'GATED',   component: 'CopilotPanel.tsx',          evidence: 'onClick → POST /blocks/copilot-interpret; BACKEND guard' },
  { id: 'MQC-INT-133', label: 'Clear Analysis',                       status: 'GATED',   component: 'CortexModulesNew.tsx',      evidence: 'onClick → clearCortexAnalysis(id, accessToken) → DELETE /submissions/:id/cortex; BACKEND guard' },

  // ── ROI / FINANCIAL ───────────────────────────────────────────────────────
  { id: 'MQC-INT-134', label: 'ROI tab select',                       status: 'LIVE',    component: 'ROITabLayout.tsx',          evidence: 'onClick → setActiveTab(tab) — pure local state switch between ROI sub-views' },
  { id: 'MQC-INT-135', label: 'ROI assumption edit',                  status: 'LIVE',    component: 'ROIAssumptionsEditor.tsx',  evidence: 'onChange → updates assumptions state → useMemo triggers roiEngine.calculateROI() client-side — fully deterministic, no API' },
  { id: 'MQC-INT-136', label: 'Recalculate ROI button',               status: 'LIVE',    component: 'ROIAssumptionsEditor.tsx',  evidence: 'onClick → same as INT-135 path; re-runs roiEngine with current assumptions' },
  { id: 'MQC-INT-137', label: 'Run Monte Carlo',                      status: 'LIVE',    component: 'MonteCarloPanel.tsx',       evidence: 'onClick → monteCarloEngine.runSimulation(1000 iterations) — pure client-side math; no API call' },
  { id: 'MQC-INT-138', label: 'Scenario select (Best/Base/Worst)',     status: 'LIVE',    component: 'ScenarioPanel.tsx',         evidence: 'onClick → setActiveScenario(scenario) — switches which scenario result is displayed; scenarios pre-calculated by scenarioEngine' },
  { id: 'MQC-INT-139', label: 'DCF Calculate',                        status: 'LIVE',    component: 'DCFPanel.tsx',              evidence: 'onClick → dcfEngine.calculateDCF(cashFlows, discountRate) — pure client-side NPV math; no API call' },
  { id: 'MQC-INT-140', label: 'Export ROI Report',                    status: 'LIVE',    component: 'ExportPanel.tsx',           evidence: 'Uses same client-side ExportPanel flow as INT-127 — assembleExportPayload + jsPDF download, no backend needed' },

  // ── EXECUTION PLAN ────────────────────────────────────────────────────────
  { id: 'MQC-INT-141', label: 'Block content edit',                   status: 'LIVE',    component: 'EditableBlockCard.tsx',     evidence: 'onInput (contentEditable) → updates block.description in BLOCK_STORE — client-side blockEngine in-memory store' },
  { id: 'MQC-INT-142', label: 'Block reorder drag',                   status: 'LIVE',    component: 'ExecutionDashboard.tsx',    evidence: 'useDrag/useDrop (react-dnd) → updates blocks order array in local state; blockEngine reorders BLOCK_STORE' },
  { id: 'MQC-INT-143', label: 'AI Assist per block',                  status: 'GATED',   component: 'EditableBlockCard.tsx',     evidence: 'onClick → POST /blocks/ai-assist; BACKEND required; no demo path for block AI suggestions' },
  { id: 'MQC-INT-144', label: 'Save Version (snapshot)',              status: 'LIVE',    component: 'ExecutionDashboard.tsx',    evidence: 'onClick → snapshotEngine.createProposalSnapshot() — in-memory SNAPSHOT_STORE; no API call; purely client-side versioning' },
  { id: 'MQC-INT-145', label: 'Restore from snapshot',               status: 'LIVE',    component: 'SnapshotHistoryPanel.tsx',  evidence: 'onClick → snapshotEngine restore → applies snapshot blocks to BLOCK_STORE; client-side; no API' },
  { id: 'MQC-INT-146', label: 'Add Block button',                     status: 'LIVE',    component: 'ExecutionDashboard.tsx',    evidence: 'onClick → appends new empty block to blocks state via blockEngine; no API call' },

  // ── REVIEWER DASHBOARD ────────────────────────────────────────────────────
  { id: 'MQC-INT-147', label: 'QA checklist item check',              status: 'LIVE',    component: 'CortexReviewerModule.tsx',  evidence: 'onChange → toggles checklist item in local checked state; updates completion percentage display' },
  { id: 'MQC-INT-148', label: 'QA transcript Copy',                   status: 'LIVE',    component: 'CortexReviewerModule.tsx',  evidence: 'onClick → navigator.clipboard.writeText(qaTranscript) — client-side clipboard API' },
  { id: 'MQC-INT-149', label: 'Reviewer Approve',                     status: 'GATED',   component: 'ReviewerDashboard.tsx',     evidence: 'onClick → updateSubmissionStatus(id, "approved", accessToken) → PATCH /submissions/:id/status; BACKEND guard' },
  { id: 'MQC-INT-150', label: 'Generate QBR',                         status: 'LIVE',    component: 'QBRPanel.tsx',              evidence: 'onClick → qbrEngine.generateQBR(submissionData) — client-side deterministic engine; renders QBR document; no API' },

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  { id: 'MQC-INT-151', label: 'Date range picker',                    status: 'DEMO',    component: 'AnalyticsDashboard.tsx',    evidence: 'onChange → filters date range; analytics data is demo data from getDemoSubmissions(); filter works client-side but has no real backend data' },
  { id: 'MQC-INT-152', label: 'Metric card click (drill-down)',       status: 'DEMO',    component: 'AnalyticsDashboard.tsx',    evidence: 'onClick → toggles expanded metric detail — works on demo data; no API call' },
  { id: 'MQC-INT-153', label: 'Export Analytics',                     status: 'MISSING', component: 'AnalyticsDashboard.tsx',    evidence: 'Export button visible in UI but onClick handler not implemented — logs console.warn("Export not yet implemented")',
                        fixHint: 'Wire up CSV/PDF export using assembleExportPayload from exportEngine or a simple CSV serializer of the analytics data.' },

  // ── MAPPING ENGINE ─────────────────────────────────────────────────────────
  { id: 'MQC-INT-154', label: 'Run Mapping Engine',                   status: 'LIVE',    component: 'MappingEnginePanel.tsx',    evidence: 'onClick → mappingEngine.mapAnswersToSolutions(submission) — fully client-side deterministic; no API call' },
  { id: 'MQC-INT-155', label: 'Solution view tab',                    status: 'LIVE',    component: 'SolutionArchitectureCard.tsx', evidence: 'onClick → setActiveView(tab) — switches view mode (overview/detail/technical); local state only' },

  // ── ROLE SWITCHER ──────────────────────────────────────────────────────────
  { id: 'MQC-INT-156', label: 'Role switcher dropdown',               status: 'LIVE',    component: 'RoleSwitcher.tsx',          evidence: 'onClick → toggles dropdown open state — no API call' },
  { id: 'MQC-INT-157', label: 'Role option select',                   status: 'LIVE',    component: 'RoleSwitcher.tsx',          evidence: 'onClick → roleEngine.setActiveRole(role) — updates client-side role state; gates UI elements by role; no API' },

  // ── REGISTRY VIEWER ───────────────────────────────────────────────────────
  { id: 'MQC-INT-158', label: 'Registry search input',                status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onChange → setSearch(e.target.value) → useMemo re-filters FULL_REGISTRY — pure client-side' },
  { id: 'MQC-INT-159', label: 'Type filter button (any type)',        status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → toggleType(type) → selectedTypes Set toggle → useMemo re-filters' },
  { id: 'MQC-INT-160', label: 'Status filter dropdown',               status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onChange → setSelectedStatus(e.target.value) → useMemo re-filters' },
  { id: 'MQC-INT-161', label: 'Clear all filters button',             status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → setSelectedTypes(new Set()); setSelectedStatus("all"); setSearch("")' },
  { id: 'MQC-INT-162', label: 'Node row click',                       status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → setSelectedId(isSelected ? null : node.id) — toggles detail panel' },
  { id: 'MQC-INT-163', label: 'Node ID copy ⎘',                      status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → navigator.clipboard.writeText(id) → setCopied(true) → shows ✓ for 1.5s' },
  { id: 'MQC-INT-164', label: 'Dependency node click (in detail)',    status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → navigate(depId) → setSelectedId + clears filters if needed to reveal node' },
  { id: 'MQC-INT-165', label: 'Show Upstream button',                 status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → setShowUpstream(v => !v) — expands transitive upstream chips from traceUpstream()' },
  { id: 'MQC-INT-166', label: 'Show Downstream button',               status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → setShowDownstream(v => !v) — expands downstream dependents from traceDownstream()' },
  { id: 'MQC-INT-167', label: 'Registry tab switch',                  status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → setTab(t.key) — switches between Registry/Bugs/KV/Stats/Processes/Interactions tabs' },
  { id: 'MQC-INT-168', label: 'Bug pattern node chip click',          status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → navigate(id) — switches to Registry tab and selects affected node' },
  { id: 'MQC-INT-169', label: 'Node detail close ×',                  status: 'LIVE',    component: 'RegistryViewer.tsx',        evidence: 'onClick → setSelectedId(null) — closes detail panel, deselects node' },

  // ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────
  { id: 'MQC-INT-170', label: '⌘K — Open Command Palette',           status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"k", meta:isMac(), action:()=>setShowCommandPalette(true)} registered on mount' },
  { id: 'MQC-INT-171', label: '⌘/ — Show Keyboard Shortcuts',        status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"/", meta:isMac(), action:()=>setShowKeyboardHelp(true)}' },
  { id: 'MQC-INT-172', label: '? — Show Keyboard Shortcuts',         status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"?", action:()=>setShowKeyboardHelp(true)}' },
  { id: 'MQC-INT-173', label: '⌘B — Toggle Sidebar',                 status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"b", meta:isMac(), action:()=>setSidebarCollapsed(!sidebarCollapsed)}' },
  { id: 'MQC-INT-174', label: '⌘1 — Go to Dashboard',                status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"1", meta:isMac(), action:()=>onNavigate?.("dashboard")}' },
  { id: 'MQC-INT-175', label: '⌘2 — Go to CORTEX',                   status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"2", meta:isMac(), action:()=>onNavigate?.("cortex")}' },
  { id: 'MQC-INT-176', label: '⌘3 — Go to Team',                     status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"3", meta:isMac(), action:()=>onNavigate?.("team")}' },
  { id: 'MQC-INT-177', label: '⌘4 — Go to Settings',                 status: 'LIVE',    component: 'TeamDashboardLayout.tsx',   evidence: 'useKeyboardShortcuts: {key:"4", meta:isMac(), action:()=>onNavigate?.("settings")}' },

  // ── MISC UI ───────────────────────────────────────────────────────────────
  { id: 'MQC-INT-178', label: 'Win Celebration dismiss ×',            status: 'LIVE',    component: 'WinCelebration.tsx',        evidence: 'onClick → dismisses WinCelebration; setVisible(false) or onDismiss() callback' },
  { id: 'MQC-INT-179', label: 'Kanban alert toast dismiss ×',         status: 'LIVE',    component: 'KanbanAlertToast.tsx',      evidence: 'onClick → removes toast from KanbanAlertToastStack via onMarkRead/dismiss callback' },
  { id: 'MQC-INT-180', label: 'Offline banner (display only)',        status: 'VISUAL',  component: 'OfflineBanner.tsx',         evidence: 'No click handler — purely displays WifiOff icon + "You are offline" text when useOnlineStatus()=false' },
  { id: 'MQC-INT-181', label: 'Progress modal close ×',               status: 'LIVE',    component: 'ProgressModal.tsx',         evidence: 'onClick → setIsVisible(false) or onClose callback prop' },
  { id: 'MQC-INT-182', label: 'Error boundary Try Again',             status: 'LIVE',    component: 'ErrorBoundary.tsx',         evidence: 'onClick → this.setState({hasError:false}) — React class component reset; re-attempts render' },
  { id: 'MQC-INT-183', label: 'Instant Booking CTA',                  status: 'LIVE',    component: 'InstantBooking.tsx',        evidence: 'onClick → opens Calendly URL window.open(calendlyUrl) or triggers onBookCall callback; no backend needed' },
  { id: 'MQC-INT-184', label: 'InlineAI trigger button',              status: 'DEMO',    component: 'InlineAITrigger.tsx',       evidence: 'onClick → openChat({sectionId, content}) via GlobalAIChatContext; AI response is demo (getMockResponse) when BACKEND=false' },
  { id: 'MQC-INT-185', label: 'Outcome logging modal submit',         status: 'GATED',   component: 'PipelineKanban.tsx',        evidence: 'onSubmit → POST /submissions/:id/outcome via logOutcome(id, payload, accessToken); BACKEND guard; outcome persisted to KV' },
];

// ============================================================================
// COMPUTED STATS
// ============================================================================

// AUDIT_STATS is exported for consumers who need the raw reduce object.
// AUDIT_SUMMARY below covers the common use-case.
export const AUDIT_STATS: Record<AuditStatus, number> = {
  LIVE:    AUDIT.filter(a => a.status === 'LIVE').length,
  DEMO:    AUDIT.filter(a => a.status === 'DEMO').length,
  GATED:   AUDIT.filter(a => a.status === 'GATED').length,
  MISSING: AUDIT.filter(a => a.status === 'MISSING').length,
  VISUAL:  AUDIT.filter(a => a.status === 'VISUAL').length,
};

// Pre-computed final counts
export const AUDIT_SUMMARY = {
  total: AUDIT.length,
  live: AUDIT.filter(a => a.status === 'LIVE').length,
  demo: AUDIT.filter(a => a.status === 'DEMO').length,
  gated: AUDIT.filter(a => a.status === 'GATED').length,
  missing: AUDIT.filter(a => a.status === 'MISSING').length,
  visual: AUDIT.filter(a => a.status === 'VISUAL').length,
  liveOrDemo: AUDIT.filter(a => a.status === 'LIVE' || a.status === 'DEMO').length,
  missing_entries: AUDIT.filter(a => a.status === 'MISSING'),
  gated_entries: AUDIT.filter(a => a.status === 'GATED'),
};

export const AUDIT_BY_ID: Record<string, AuditEntry> = Object.fromEntries(
  AUDIT.map(a => [a.id, a])
);

// Group by status for fast lookup
export const AUDIT_BY_STATUS: Record<AuditStatus, AuditEntry[]> = {
  LIVE:    AUDIT.filter(a => a.status === 'LIVE'),
  DEMO:    AUDIT.filter(a => a.status === 'DEMO'),
  GATED:   AUDIT.filter(a => a.status === 'GATED'),
  MISSING: AUDIT.filter(a => a.status === 'MISSING'),
  VISUAL:  AUDIT.filter(a => a.status === 'VISUAL'),
};

/**
 * API Configuration
 *
 * Central configuration for API-related constants.
 *
 * NOTE: The actual API calls are in /src/app/lib/api.ts which constructs URLs
 * directly from projectId. The /src/services/api/*.ts layer is DEAD CODE and
 * not imported by any component.
 *
 * The ENDPOINTS below are kept as a REFERENCE mapping to the real server routes
 * defined in /supabase/functions/server/index.tsx.
 */

export const API_CONFIG = {
  // Timeout settings
  TIMEOUT: parseInt(import.meta.env.VITE_API_TIMEOUT || '30000'),

  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,

  // Token storage keys (kept as eclipse_* to avoid breaking existing sessions)
  TOKEN_KEY: 'eclipse_auth_token',
  REFRESH_TOKEN_KEY: 'eclipse_refresh_token',
  USER_KEY: 'eclipse_user',

  // Endpoints — mirrors actual server routes (prefix: /make-server-324f4fbe)
  ENDPOINTS: {
    // Health & Diagnostics
    PING: '/ping',
    HEALTH: '/health',
    TEST_AUTH: '/test-auth',
    DIAGNOSTIC: '/diagnostic',

    // Authentication
    TEAM_LOGIN: '/auth/team/login',
    CLIENT_VERIFY: '/auth/client/verify',

    // Submissions
    SUBMISSIONS: '/submissions',
    SUBMISSION_BY_ID: (id: string) => `/submissions/${id}`,
    SUBMISSION_STATUS: (id: string) => `/submissions/${id}/status`,
    SUBMISSIONS_BULK: '/submissions/bulk',

    // Notes
    SUBMISSION_NOTES: (id: string) => `/submissions/${id}/notes`,
    SUBMISSION_NOTE: (id: string, noteId: string) => `/submissions/${id}/notes/${noteId}`,

    // Messages (client ↔ team)
    SUBMISSION_MESSAGES: (id: string) => `/submissions/${id}/messages`,
    SUBMISSION_TEAM_MESSAGES: (id: string) => `/submissions/${id}/messages/team`,

    // Proposals
    SUBMISSION_PROPOSAL: (id: string) => `/submissions/${id}/proposal`,
    SUBMISSION_PROPOSAL_SEND: (id: string) => `/submissions/${id}/proposal/send`,

    // Client Portal
    CLIENT_SUBMISSION: (id: string) => `/client/submission/${id}`,
    CLIENT_SUBMISSION_ENGAGEMENT: (id: string) => `/client/submission/${id}/engagement`,
    CLIENT_SUBMISSION_ENGAGEMENT_LOG: (id: string) => `/client/submission/${id}/engagement/log`,
    CLIENT_SUBMISSION_PROPOSAL: (id: string) => `/client/submission/${id}/proposal`,
    CLIENT_SUBMISSION_PROPOSAL_RESPOND: (id: string) => `/client/submission/${id}/proposal/respond`,
    CLIENT_SUBMISSION_REPORT: (id: string) => `/client/submission/${id}/report`,

    // Analytics
    ANALYTICS_OVERVIEW: '/analytics/overview',
    ANALYTICS_ENGAGEMENT: '/analytics/engagement',

    // Notifications
    NOTIFICATIONS: '/notifications',
    NOTIFICATIONS_READ: '/notifications/read',

    // Team Management
    TEAM_MEMBERS: '/team/members',
    TEAM_INVITE: '/team/invite',
    TEAM_MEMBER: (id: string) => `/team/members/${id}`,

    // Settings
    SETTINGS: '/settings',

    // Email
    TEST_EMAIL: '/test-email',
    EMAIL_WEEKLY_DIGEST: '/email/weekly-digest',
    EMAIL_QUEUE: '/email-queue',
    EMAIL_QUEUE_ITEM: (emailId: string) => `/email-queue/${emailId}`,
    EMAIL_STATUS: '/email/status',
    EMAIL_SEND: '/email/send',

    // CORTEX Intelligence
    CORTEX_STATUS: '/cortex/status',
    CORTEX_ENGAGEMENT_SUMMARY: '/cortex/engagement-summary',
    CORTEX_OUTCOMES: '/cortex/outcomes',
    CORTEX_LEARNING_LOOP: '/cortex/learning-loop',
    CORTEX_PIPELINE_POSITIONS: '/cortex/pipeline-positions',
    CORTEX_COLUMN_CAPACITIES: '/cortex/column-capacities',
    SUBMISSION_ANALYZE: (id: string) => `/submissions/${id}/analyze`,
    SUBMISSION_CORTEX: (id: string) => `/submissions/${id}/cortex`,
    SUBMISSION_OUTCOME: (id: string) => `/submissions/${id}/outcome`,
    SUBMISSIONS_ANALYZE_BATCH: '/submissions/analyze-batch',
  },
} as const;

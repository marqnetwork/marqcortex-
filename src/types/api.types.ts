/**
 * API Type Definitions
 * TypeScript interfaces for all API requests and responses
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  requestId?: string;
  timestamp?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
}

export interface PaginationResponse {
  page: number;
  limit: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface TeamLoginRequest {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface TeamLoginResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: TeamUser;
}

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'reviewer' | 'viewer';
  permissions: string[];
  avatar?: string;
}

export interface ClientAccessRequest {
  email: string;
  submissionId?: string;
}

export interface ClientVerifyRequest {
  token: string;
}

export interface ClientVerifyResponse {
  token: string;
  expiresIn: number;
  client: ClientInfo;
}

export interface ClientInfo {
  id: string;
  email: string;
  companyName: string;
  submissions: string[];
}

// ============================================================================
// INDUSTRIES & QUESTIONS
// ============================================================================

export interface Industry {
  id: string;
  name: string;
  icon: string;
  color: string;
  questionCount: number;
  averageCompletionTime: number;
}

export interface IndustriesResponse {
  industries: Industry[];
}

export interface Question {
  id: number;
  category: string;
  question: string;
  type: 'textarea' | 'text' | 'number' | 'scale' | 'multiple_choice';
  placeholder?: string;
  required: boolean;
  order: number;
  motivationalQuote?: string;
  exampleAnswers?: string[];
}

export interface QuestionCategory {
  id: string;
  name: string;
  questionCount: number;
}

export interface IndustryQuestionsResponse {
  industryId: string;
  industryName: string;
  totalQuestions: number;
  categories: QuestionCategory[];
  questions: Question[];
}

// ============================================================================
// LEADS
// ============================================================================

export interface LeadCaptureRequest {
  source: 'landing_page' | 'exit_intent' | 'referral';
  email: string;
  name?: string;
  phone?: string;
  website?: string;
  companyName?: string;
  industry?: string;
  metadata?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    landingPage?: string;
    device?: string;
    browser?: string;
  };
}

export interface LeadCaptureResponse {
  leadId: string;
  email: string;
  status: string;
  createdAt: string;
  nextSteps: {
    action: string;
    url: string;
  };
  emailTriggered?: {
    templateId: string;
    status: string;
  };
}

export interface LeadActivityRequest {
  eventType: 'page_view' | 'button_click' | 'video_watch' | 'exit_intent';
  eventData: Record<string, any>;
  timestamp: string;
}

// ============================================================================
// SUBMISSIONS
// ============================================================================

export interface SubmissionStartRequest {
  leadId?: string;
  contactInfo: {
    name: string;
    email: string;
    phone?: string;
    website?: string;
  };
  companyInfo: {
    name: string;
    industry: string;
    employees?: string;
    revenue?: string;
  };
}

export interface SubmissionStartResponse {
  submissionId: string;
  status: string;
  completionPercentage: number;
  questions: Question[];
  createdAt: string;
  expiresAt: string;
}

export interface SubmissionAnswersRequest {
  answers: Record<number, string | number>;
  lastQuestionViewed?: number;
  timeSpent?: number;
}

export interface SubmissionAnswersResponse {
  submissionId: string;
  answersReceived: number;
  completionPercentage: number;
  savedAt: string;
  aiInsights?: {
    detectedPatterns: string[];
    suggestedSolutions: string[];
  };
}

export interface SubmissionCompleteRequest {
  answers: Record<number, string | number>;
  totalTimeSpent: number;
  bookingRequested?: boolean;
  priorityReview?: boolean;
}

export interface SubmissionCompleteResponse {
  submissionId: string;
  status: string;
  completionScore: number;
  qualityScore: number;
  submittedAt: string;
  estimatedReviewTime: string;
  cortexAnalysis: {
    status: string;
    analysisId: string;
    estimatedCompletionTime: string;
  };
  clientPortalAccess: {
    url: string;
    accessToken: string;
  };
  emailTriggered?: {
    templateId: string;
    status: string;
  };
}

export interface Submission {
  id: string;
  status: 'in_progress' | 'submitted' | 'under_review' | 'completed';
  priority: 'low' | 'medium' | 'high';
  completionScore?: number;
  qualityScore?: number;
  contactInfo: {
    name: string;
    email: string;
    phone?: string;
    website?: string;
  };
  companyInfo: {
    name: string;
    industry: string;
    employees?: string;
    revenue?: string;
  };
  answers: SubmissionAnswer[];
  timeline: {
    started: string;
    completed?: string;
    timeSpent: number;
    averageTimePerQuestion: number;
  };
  cortexAnalysis?: {
    analysisId: string;
    status: string;
    insights?: any;
  };
  assignedTo?: {
    userId: string;
    name: string;
    assignedAt: string;
  };
  meeting?: {
    scheduled: boolean;
    scheduledAt?: string;
    duration?: number;
    meetingLink?: string;
  };
}

export interface SubmissionAnswer {
  questionId: number;
  question: string;
  answer: string;
  category: string;
  wordCount: number;
  qualityMetrics?: {
    specificity: number;
    clarity: number;
    actionability: number;
  };
}

// ============================================================================
// TEAM DASHBOARD
// ============================================================================

export interface TeamSubmissionsRequest extends PaginationParams {
  status?: string;
  priority?: string;
  industry?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface TeamSubmission {
  id: string;
  companyName: string;
  contactEmail: string;
  industry: string;
  status: string;
  priority: string;
  completionScore: number;
  qualityScore: number;
  submittedAt: string;
  estimatedValue?: string;
  quickActions?: {
    autoSendEligible: boolean;
    quickApproveEligible: boolean;
    requiresReview: boolean;
  };
}

export interface TeamSubmissionsResponse {
  submissions: TeamSubmission[];
  pagination: PaginationResponse;
  summary: {
    totalSubmissions: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    averageQualityScore: number;
    autoSendEligible: number;
  };
}

export interface ApproveSubmissionRequest {
  notes?: string;
  estimatedValue?: string;
  assignedTo?: string;
}

export interface SendReportRequest {
  reportContent: any;
  emailTemplate?: string;
  includeBookingLink?: boolean;
  customMessage?: string;
}

export interface BulkActionRequest {
  action: 'approve' | 'send_report' | 'assign' | 'archive';
  submissionIds: string[];
  metadata?: Record<string, any>;
}

// ============================================================================
// CLIENT PORTAL
// ============================================================================

export interface ClientSubmissionsResponse {
  client: ClientInfo;
  submissions: Array<{
    id: string;
    status: string;
    submittedAt: string;
    reportAvailable: boolean;
    reportUrl?: string;
    meetingScheduled: boolean;
  }>;
}

export interface DiagnosticReport {
  submissionId: string;
  companyName: string;
  generatedAt: string;
  report: {
    executiveSummary: string;
    keyFindings: Array<{
      title: string;
      description: string;
      impact: string;
      estimatedCost?: string;
    }>;
    recommendations: Array<{
      title: string;
      description: string;
      priority: string;
      estimatedROI?: string;
      implementationTime?: string;
      estimatedCost?: string;
    }>;
    nextSteps: string[];
  };
  callToAction: {
    title: string;
    description: string;
    buttonText: string;
    bookingUrl: string;
  };
}

// ============================================================================
// CORTEX INTELLIGENCE
// ============================================================================

export interface CortexAnalyzeRequest {
  submissionId: string;
  analysisDepth?: 'quick' | 'standard' | 'full';
  modules?: string[];
}

export interface CortexAnalyzeResponse {
  analysisId: string;
  submissionId: string;
  status: 'processing' | 'completed' | 'failed';
  estimatedCompletionTime: number;
  modules: Array<{
    name: string;
    status: string;
  }>;
}

export interface CortexAnalysis {
  analysisId: string;
  submissionId: string;
  status: string;
  completedAt: string;
  modules: {
    leadOverview: CortexLeadOverview;
    diagnosticSummary: CortexDiagnosticSummary;
    aiRecommendations: CortexRecommendations;
    roiEstimates: CortexROI;
    proposalBuilder: CortexProposal;
    callPrep: CortexCallPrep;
    qualityControl: CortexQuality;
  };
}

export interface CortexLeadOverview {
  companyProfile: {
    name: string;
    industry: string;
    size: string;
    revenue: string;
    maturityLevel: string;
  };
  keyMetrics: {
    urgencyScore: number;
    budgetLikelihood: string;
    decisionTimeframe: string;
    dealSize: string;
  };
  signalStrength: {
    painIntensity: number;
    willingnessToChange: number;
    resourceCapability: number;
  };
}

export interface CortexDiagnosticSummary {
  topPainPoints: Array<{
    issue: string;
    severity: string;
    frequency: string;
    impactedTeams: string[];
    estimatedCost: string;
    quotes: string[];
  }>;
  currentState: {
    systemsUsed: string[];
    integrationLevel: string;
    automationScore: number;
    efficiencyRating: string;
  };
  patterns: string[];
}

export interface CortexRecommendations {
  primaryRecommendation: {
    title: string;
    description: string;
    confidence: number;
    estimatedROI: string;
    implementationComplexity: string;
    timeToValue: string;
    tools: string[];
    estimatedCost: string;
  };
  quickWins: Array<{
    title: string;
    impact: string;
    effort: string;
    timeToValue: string;
    estimatedCost: string;
  }>;
  longTermInitiatives: any[];
}

export interface CortexROI {
  yearOne: {
    timeSaved: string;
    costSavings: string;
    efficiencyGains: string;
    errorReduction: string;
    implementation: string;
    netBenefit: string;
  };
  threeYearProjection: {
    totalSavings: string;
    totalInvestment: string;
    roi: string;
    paybackPeriod: string;
  };
}

export interface CortexProposal {
  executiveSummary: string;
  scopeOfWork: Array<{
    phase: string;
    duration: string;
    deliverables: string[];
    cost: string;
  }>;
  pricingOptions: Array<{
    tier: string;
    price: string;
    description: string;
    included: string[];
    recommended?: boolean;
  }>;
}

export interface CortexCallPrep {
  talkingPoints: string[];
  questionsToAsk: string[];
  objectionHandling: Record<string, string>;
  keyInsights: string[];
}

export interface CortexQuality {
  overallScore: number;
  completeness: number;
  clarity: number;
  actionability: number;
  specificityScore: number;
  flags: string[];
  reviewRecommendation: string;
  confidence: number;
}

// ============================================================================
// MEETINGS
// ============================================================================

export interface MeetingBookRequest {
  submissionId: string;
  contactInfo: {
    name: string;
    email: string;
    phone?: string;
    timezone: string;
  };
  preferredSlot: {
    startTime: string;
    duration: number;
  };
  priority?: boolean;
  notes?: string;
}

export interface MeetingBookResponse {
  meetingId: string;
  submissionId: string;
  status: string;
  scheduledAt: string;
  duration: number;
  meetingLink: string;
  calendarInvite: {
    icsUrl: string;
    sentTo: string[];
  };
  priority: boolean;
  priorityBenefits?: {
    reportDelivery: string;
    fastTrackReview: boolean;
    dedicatedSupport: boolean;
  };
}

export interface MeetingAvailabilityRequest {
  timezone: string;
  dateFrom: string;
  dateTo: string;
  duration?: number;
}

export interface MeetingAvailabilityResponse {
  availability: Array<{
    date: string;
    slots: Array<{
      startTime: string;
      endTime: string;
      available: boolean;
    }>;
  }>;
}

// ============================================================================
// ANALYTICS
// ============================================================================

export interface AnalyticsOverviewRequest {
  dateFrom?: string;
  dateTo?: string;
}

export interface AnalyticsOverviewResponse {
  period: {
    from: string;
    to: string;
  };
  metrics: {
    leads: {
      total: number;
      change: string;
      bySource: Record<string, number>;
    };
    submissions: {
      started: number;
      completed: number;
      completionRate: string;
      averageTime: number;
      byIndustry: Record<string, number>;
    };
    conversion: {
      leadToSubmission: string;
      submissionToMeeting: string;
      meetingToClose: string;
      overallConversion: string;
    };
    teamEfficiency: {
      averageReviewTime: string;
      autoSendRate: string;
      submissionsPerReviewer: number;
      capacityUtilization: string;
    };
    clientEngagement: {
      reportOpenRate: string;
      averageTimeToOpen: string;
      meetingBookingRate: string;
      portalActiveUsers: number;
    };
  };
  trends: Array<{
    metric: string;
    current: number;
    previous: number;
    change: string;
    trend: 'up' | 'down' | 'stable';
  }>;
}

export interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
  dropOff: number;
  conversionFromPrevious?: string;
}

export interface AnalyticsFunnelResponse {
  funnel: FunnelStage[];
  insights: string[];
}

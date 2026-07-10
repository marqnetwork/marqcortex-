# 🗄️ ECLIPSE DIAGNOSTIC PLATFORM - DATABASE SCHEMA

**Version:** 1.0  
**Last Updated:** February 2, 2026  
**Database:** PostgreSQL 15+  
**Total Tables:** 18

---

## 📋 **TABLE OF CONTENTS**

1. [Schema Overview](#schema-overview)
2. [Core Tables](#core-tables)
3. [Relationships Diagram](#relationships-diagram)
4. [Indexes & Performance](#indexes--performance)
5. [Data Types & Constraints](#data-types--constraints)
6. [Migrations](#migrations)
7. [Backup & Recovery](#backup--recovery)

---

## 🏗️ **SCHEMA OVERVIEW**

### **Database Structure:**

```
eclipse_platform/
├── users (team members)
├── clients
├── leads
├── lead_activities
├── industries
├── questions
├── submissions
├── submission_answers
├── cortex_analyses
├── cortex_insights
├── meetings
├── emails
├── email_events
├── reports
├── report_views
├── team_actions
├── analytics_events
└── webhooks
```

---

## 📊 **CORE TABLES**

### **1. users** (Team Members)

Team member accounts with role-based access

```sql
CREATE TABLE users (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'user_' || gen_random_uuid(),
  
  -- Authentication
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  mfa_secret VARCHAR(100),
  
  -- Profile
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  full_name VARCHAR(255) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  avatar_url TEXT,
  phone VARCHAR(20),
  
  -- Role & Permissions
  role VARCHAR(20) NOT NULL DEFAULT 'reviewer', -- admin, manager, reviewer, viewer
  permissions JSONB DEFAULT '[]'::jsonb,
  -- Example: ["view_submissions", "edit_submissions", "approve_submissions", "manage_users"]
  
  -- Status
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, suspended
  last_login_at TIMESTAMP WITH TIME ZONE,
  login_count INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT valid_role CHECK (role IN ('admin', 'manager', 'reviewer', 'viewer')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', 'suspended')),
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_last_login ON users(last_login_at DESC);

-- Comments
COMMENT ON TABLE users IS 'Team members who review and manage diagnostic submissions';
COMMENT ON COLUMN users.permissions IS 'JSONB array of permission strings for granular access control';
```

---

### **2. clients**

Client contacts and companies

```sql
CREATE TABLE clients (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'client_' || gen_random_uuid(),
  
  -- Contact Information
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  full_name VARCHAR(255),
  phone VARCHAR(20),
  
  -- Company Information
  company_name VARCHAR(255) NOT NULL,
  company_website TEXT,
  industry VARCHAR(50),
  company_size VARCHAR(50), -- 1-10, 11-50, 51-200, 201-500, 500+
  annual_revenue VARCHAR(50), -- <$100K, $100K-$500K, $500K-$1M, $1M-$5M, $5M-$10M, $10M+
  
  -- Authentication (for client portal)
  magic_link_token VARCHAR(255),
  magic_link_expires_at TIMESTAMP WITH TIME ZONE,
  last_portal_access_at TIMESTAMP WITH TIME ZONE,
  portal_access_count INTEGER DEFAULT 0,
  
  -- Lead Source
  source VARCHAR(50), -- landing_page, exit_intent, referral, manual
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  utm_content VARCHAR(100),
  utm_term VARCHAR(100),
  referrer TEXT,
  
  -- Scoring & Qualification
  lead_score INTEGER DEFAULT 0, -- 0-100
  qualification_status VARCHAR(20) DEFAULT 'new', -- new, qualified, disqualified
  urgency_score INTEGER, -- 0-100
  budget_likelihood VARCHAR(20), -- low, medium, high
  
  -- Relationship
  assigned_to VARCHAR(50) REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, churned
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
  CONSTRAINT valid_lead_score CHECK (lead_score >= 0 AND lead_score <= 100),
  CONSTRAINT valid_urgency CHECK (urgency_score IS NULL OR (urgency_score >= 0 AND urgency_score <= 100))
);

-- Indexes
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_company ON clients(company_name);
CREATE INDEX idx_clients_industry ON clients(industry);
CREATE INDEX idx_clients_lead_score ON clients(lead_score DESC);
CREATE INDEX idx_clients_assigned_to ON clients(assigned_to);
CREATE INDEX idx_clients_created ON clients(created_at DESC);
CREATE INDEX idx_clients_status ON clients(status) WHERE deleted_at IS NULL;

-- Full-text search
CREATE INDEX idx_clients_fulltext ON clients USING gin(
  to_tsvector('english', 
    coalesce(company_name, '') || ' ' || 
    coalesce(full_name, '') || ' ' || 
    coalesce(email, '')
  )
);
```

---

### **3. leads**

Lead capture tracking (pre-submission)

```sql
CREATE TABLE leads (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'lead_' || gen_random_uuid(),
  
  -- Client Reference
  client_id VARCHAR(50) REFERENCES clients(id),
  
  -- Lead Information
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  phone VARCHAR(20),
  company_name VARCHAR(255),
  website TEXT,
  
  -- Capture Details
  capture_source VARCHAR(50) NOT NULL, -- landing_page, exit_intent, referral, manual
  capture_page TEXT,
  
  -- UTM Tracking
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  utm_content VARCHAR(100),
  utm_term VARCHAR(100),
  referrer TEXT,
  
  -- Device & Browser
  device_type VARCHAR(20), -- desktop, mobile, tablet
  browser VARCHAR(50),
  os VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  
  -- Status
  status VARCHAR(20) DEFAULT 'new', -- new, contacted, qualified, converted, lost
  converted_to_submission_id VARCHAR(50),
  
  -- Metadata
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_capture_source CHECK (capture_source IN (
    'landing_page', 'exit_intent', 'referral', 'manual', 'social', 'paid_ad'
  ))
);

-- Indexes
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_client ON leads(client_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_source ON leads(capture_source);
CREATE INDEX idx_leads_captured ON leads(captured_at DESC);
CREATE INDEX idx_leads_utm_campaign ON leads(utm_campaign);
```

---

### **4. lead_activities**

Track lead behavior and engagement

```sql
CREATE TABLE lead_activities (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'activity_' || gen_random_uuid(),
  
  -- References
  lead_id VARCHAR(50) NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id VARCHAR(50) REFERENCES clients(id),
  
  -- Activity Details
  event_type VARCHAR(50) NOT NULL, -- page_view, button_click, video_watch, form_submit, exit_intent
  event_data JSONB DEFAULT '{}'::jsonb,
  -- Example: {"page": "/diagnostic", "duration": 45, "scroll_depth": 75}
  
  -- Context
  page_url TEXT,
  referrer TEXT,
  session_id VARCHAR(100),
  
  -- Metadata
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_event_type CHECK (event_type IN (
    'page_view', 'button_click', 'video_watch', 'form_submit', 
    'exit_intent', 'download', 'scroll', 'time_on_page'
  ))
);

-- Indexes
CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX idx_lead_activities_event ON lead_activities(event_type);
CREATE INDEX idx_lead_activities_occurred ON lead_activities(occurred_at DESC);
CREATE INDEX idx_lead_activities_session ON lead_activities(session_id);

-- JSONB indexes for event_data
CREATE INDEX idx_lead_activities_event_data ON lead_activities USING gin(event_data);
```

---

### **5. industries**

Industry definitions and question sets

```sql
CREATE TABLE industries (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY,
  
  -- Display Information
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(10), -- Emoji
  color VARCHAR(7), -- Hex color
  description TEXT,
  
  -- Metrics
  question_count INTEGER DEFAULT 14,
  average_completion_time INTEGER, -- minutes
  total_submissions INTEGER DEFAULT 0,
  
  -- Status
  active BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_industries_active ON industries(active, display_order);

-- Insert default industries
INSERT INTO industries (id, name, icon, color, question_count, average_completion_time) VALUES
  ('ecommerce', 'E-commerce / DTC', '🛒', '#8B5CF6', 14, 12),
  ('saas', 'SaaS / Software', '💻', '#3B82F6', 14, 11),
  ('agency', 'Agency / Services', '🎨', '#06D7F6', 14, 10),
  ('healthcare', 'Healthcare / Medical', '⚕️', '#FB923C', 14, 13),
  ('nonprofit', 'Non-Profit / Education', '🎓', '#FD4438', 14, 11),
  ('creator', 'Creators / Training / Courses', '📚', '#10B981', 14, 10),
  ('government', 'Government / Public Sector', '🏛️', '#6B7280', 14, 15),
  ('manufacturing', 'Manufacturing / Supply Chain', '🏭', '#F59E0B', 14, 14),
  ('generic', 'Other Business / General', '🏢', '#9333EA', 14, 12);
```

---

### **6. questions**

Diagnostic questions by industry

```sql
CREATE TABLE questions (
  -- Primary Key
  id SERIAL PRIMARY KEY,
  
  -- Industry Reference
  industry_id VARCHAR(50) NOT NULL REFERENCES industries(id),
  
  -- Question Details
  category VARCHAR(100) NOT NULL,
  question TEXT NOT NULL,
  type VARCHAR(20) NOT NULL, -- textarea, text, number, scale, multiple_choice
  placeholder TEXT,
  required BOOLEAN DEFAULT TRUE,
  
  -- Display
  order_position INTEGER NOT NULL,
  motivational_quote TEXT,
  background_theme VARCHAR(50), -- industry, pain, systems, goals
  
  -- Example Answers
  example_answers JSONB DEFAULT '[]'::jsonb,
  -- Example: ["Answer 1", "Answer 2", "Answer 3", "Answer 4"]
  
  -- Validation
  min_length INTEGER,
  max_length INTEGER,
  validation_rules JSONB,
  
  -- Status
  active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_question_type CHECK (type IN (
    'textarea', 'text', 'number', 'scale', 'multiple_choice', 'checkbox', 'rating'
  )),
  CONSTRAINT unique_industry_order UNIQUE (industry_id, order_position)
);

-- Indexes
CREATE INDEX idx_questions_industry ON questions(industry_id, order_position);
CREATE INDEX idx_questions_category ON questions(category);
CREATE INDEX idx_questions_active ON questions(active);
```

---

### **7. submissions**

Main diagnostic submissions

```sql
CREATE TABLE submissions (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'sub_' || gen_random_uuid(),
  
  -- References
  client_id VARCHAR(50) NOT NULL REFERENCES clients(id),
  lead_id VARCHAR(50) REFERENCES leads(id),
  industry_id VARCHAR(50) NOT NULL REFERENCES industries(id),
  
  -- Contact Information (denormalized for historical accuracy)
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20),
  company_name VARCHAR(255) NOT NULL,
  company_website TEXT,
  
  -- Company Details
  company_size VARCHAR(50),
  annual_revenue VARCHAR(50),
  
  -- Submission Status
  status VARCHAR(20) DEFAULT 'in_progress', 
  -- in_progress, submitted, under_review, approved, report_sent, completed, archived
  
  -- Priority & Assignment
  priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
  assigned_to VARCHAR(50) REFERENCES users(id),
  assigned_at TIMESTAMP WITH TIME ZONE,
  
  -- Completion Metrics
  completion_percentage INTEGER DEFAULT 0,
  questions_answered INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 14,
  
  -- Quality Scoring
  quality_score INTEGER, -- 0-100, AI-calculated
  completeness_score INTEGER, -- 0-100
  clarity_score INTEGER, -- 0-100
  specificity_score INTEGER, -- 0-100
  actionability_score INTEGER, -- 0-100
  
  -- Time Tracking
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  total_time_spent INTEGER, -- seconds
  average_time_per_question INTEGER, -- seconds
  
  -- Last Activity
  last_question_viewed INTEGER,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Flags
  is_priority_review BOOLEAN DEFAULT FALSE,
  auto_send_eligible BOOLEAN DEFAULT FALSE,
  requires_manual_review BOOLEAN DEFAULT FALSE,
  has_quality_issues BOOLEAN DEFAULT FALSE,
  
  -- Business Value
  estimated_deal_value VARCHAR(50), -- $5K-$10K, $10K-$25K, $25K-$50K, $50K+
  urgency_level INTEGER, -- 0-100
  decision_timeframe VARCHAR(50), -- 0-30 days, 30-60 days, 60-90 days, 90+ days
  
  -- Metadata
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN (
    'in_progress', 'submitted', 'under_review', 'approved', 
    'report_sent', 'completed', 'archived'
  )),
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT valid_completion CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
  CONSTRAINT valid_quality_score CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100))
);

-- Indexes
CREATE INDEX idx_submissions_client ON submissions(client_id);
CREATE INDEX idx_submissions_industry ON submissions(industry_id);
CREATE INDEX idx_submissions_status ON submissions(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_submissions_priority ON submissions(priority);
CREATE INDEX idx_submissions_assigned ON submissions(assigned_to);
CREATE INDEX idx_submissions_quality ON submissions(quality_score DESC NULLS LAST);
CREATE INDEX idx_submissions_submitted ON submissions(submitted_at DESC NULLS LAST);
CREATE INDEX idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX idx_submissions_auto_send ON submissions(auto_send_eligible) WHERE auto_send_eligible = TRUE;

-- Composite indexes for common queries
CREATE INDEX idx_submissions_status_priority ON submissions(status, priority);
CREATE INDEX idx_submissions_status_quality ON submissions(status, quality_score DESC NULLS LAST);

-- Full-text search
CREATE INDEX idx_submissions_fulltext ON submissions USING gin(
  to_tsvector('english', 
    coalesce(company_name, '') || ' ' || 
    coalesce(contact_name, '') || ' ' || 
    coalesce(contact_email, '')
  )
);
```

---

### **8. submission_answers**

Individual answers to diagnostic questions

```sql
CREATE TABLE submission_answers (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'answer_' || gen_random_uuid(),
  
  -- References
  submission_id VARCHAR(50) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  
  -- Answer Content
  answer_text TEXT,
  answer_number NUMERIC,
  answer_json JSONB, -- For complex answers (multiple choice, etc.)
  
  -- Quality Metrics (AI-calculated)
  word_count INTEGER,
  character_count INTEGER,
  specificity_score NUMERIC(3, 2), -- 0.00 to 1.00
  clarity_score NUMERIC(3, 2),
  actionability_score NUMERIC(3, 2),
  
  -- Time Tracking
  time_spent INTEGER, -- seconds spent on this question
  edit_count INTEGER DEFAULT 0,
  
  -- AI Analysis
  detected_patterns JSONB DEFAULT '[]'::jsonb,
  -- Example: ["manual_process", "time_intensive", "high_cost"]
  
  extracted_entities JSONB DEFAULT '{}'::jsonb,
  -- Example: {"tools": ["Shopify", "Google Sheets"], "roles": ["Manager"], "frequency": "daily"}
  
  sentiment_score NUMERIC(3, 2), -- -1.00 to 1.00
  pain_intensity_score NUMERIC(3, 2), -- 0.00 to 1.00
  
  -- Metadata
  answered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_submission_question UNIQUE (submission_id, question_id),
  CONSTRAINT valid_scores CHECK (
    (specificity_score IS NULL OR (specificity_score >= 0 AND specificity_score <= 1)) AND
    (clarity_score IS NULL OR (clarity_score >= 0 AND clarity_score <= 1)) AND
    (actionability_score IS NULL OR (actionability_score >= 0 AND actionability_score <= 1))
  )
);

-- Indexes
CREATE INDEX idx_answers_submission ON submission_answers(submission_id);
CREATE INDEX idx_answers_question ON submission_answers(question_id);
CREATE INDEX idx_answers_quality ON submission_answers(specificity_score DESC NULLS LAST);

-- JSONB indexes
CREATE INDEX idx_answers_patterns ON submission_answers USING gin(detected_patterns);
CREATE INDEX idx_answers_entities ON submission_answers USING gin(extracted_entities);

-- Full-text search on answers
CREATE INDEX idx_answers_fulltext ON submission_answers USING gin(to_tsvector('english', answer_text));
```

---

### **9. cortex_analyses**

CORTEX intelligence analysis results

```sql
CREATE TABLE cortex_analyses (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'cortex_' || gen_random_uuid(),
  
  -- References
  submission_id VARCHAR(50) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  
  -- Analysis Configuration
  analysis_depth VARCHAR(20) DEFAULT 'standard', -- quick, standard, full
  modules_requested JSONB DEFAULT '[]'::jsonb,
  -- Example: ["lead_overview", "diagnostic_summary", "ai_recommendations", "roi_estimates"]
  
  -- Status
  status VARCHAR(20) DEFAULT 'processing', -- queued, processing, completed, failed
  progress_percentage INTEGER DEFAULT 0,
  
  -- Results (Main Analysis)
  lead_overview JSONB,
  diagnostic_summary JSONB,
  ai_recommendations JSONB,
  roi_estimates JSONB,
  proposal_builder JSONB,
  call_prep JSONB,
  quality_control JSONB,
  
  -- Overall Scores
  overall_quality_score INTEGER, -- 0-100
  confidence_score NUMERIC(3, 2), -- 0.00 to 1.00
  review_recommendation VARCHAR(20), -- auto_approve, quick_review, full_review, reject
  
  -- Processing Details
  processing_started_at TIMESTAMP WITH TIME ZONE,
  processing_completed_at TIMESTAMP WITH TIME ZONE,
  processing_duration INTEGER, -- seconds
  ai_model_version VARCHAR(50),
  
  -- Flags
  has_quality_issues BOOLEAN DEFAULT FALSE,
  requires_human_review BOOLEAN DEFAULT FALSE,
  flagged_concerns JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_analysis_status CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  CONSTRAINT valid_progress CHECK (progress_percentage >= 0 AND progress_percentage <= 100)
);

-- Indexes
CREATE INDEX idx_cortex_submission ON cortex_analyses(submission_id);
CREATE INDEX idx_cortex_status ON cortex_analyses(status);
CREATE INDEX idx_cortex_quality ON cortex_analyses(overall_quality_score DESC NULLS LAST);
CREATE INDEX idx_cortex_created ON cortex_analyses(created_at DESC);

-- JSONB indexes
CREATE INDEX idx_cortex_recommendations ON cortex_analyses USING gin(ai_recommendations);
CREATE INDEX idx_cortex_concerns ON cortex_analyses USING gin(flagged_concerns);
```

---

### **10. cortex_insights**

Extracted insights and patterns

```sql
CREATE TABLE cortex_insights (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'insight_' || gen_random_uuid(),
  
  -- References
  analysis_id VARCHAR(50) NOT NULL REFERENCES cortex_analyses(id) ON DELETE CASCADE,
  submission_id VARCHAR(50) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  
  -- Insight Details
  insight_type VARCHAR(50) NOT NULL, -- pain_point, opportunity, risk, pattern, recommendation
  category VARCHAR(50), -- operations, technology, people, process, finance
  
  -- Content
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB, -- References to specific answers
  
  -- Scoring
  severity VARCHAR(20), -- critical, high, medium, low
  confidence NUMERIC(3, 2), -- 0.00 to 1.00
  impact_score INTEGER, -- 0-100
  
  -- Business Impact
  estimated_cost VARCHAR(50), -- Annual cost of the problem
  estimated_savings VARCHAR(50), -- Potential savings
  implementation_effort VARCHAR(20), -- low, medium, high
  time_to_value VARCHAR(50), -- 1-2 weeks, 1-3 months, etc.
  
  -- Recommendation
  suggested_solution TEXT,
  priority_rank INTEGER,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_insight_type CHECK (insight_type IN (
    'pain_point', 'opportunity', 'risk', 'pattern', 'recommendation', 'quick_win'
  )),
  CONSTRAINT valid_severity CHECK (severity IN ('critical', 'high', 'medium', 'low'))
);

-- Indexes
CREATE INDEX idx_insights_analysis ON cortex_insights(analysis_id);
CREATE INDEX idx_insights_submission ON cortex_insights(submission_id);
CREATE INDEX idx_insights_type ON cortex_insights(insight_type);
CREATE INDEX idx_insights_severity ON cortex_insights(severity);
CREATE INDEX idx_insights_confidence ON cortex_insights(confidence DESC);
```

---

### **11. meetings**

Scheduled meetings and bookings

```sql
CREATE TABLE meetings (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'meeting_' || gen_random_uuid(),
  
  -- References
  submission_id VARCHAR(50) NOT NULL REFERENCES submissions(id),
  client_id VARCHAR(50) NOT NULL REFERENCES clients(id),
  assigned_to VARCHAR(50) REFERENCES users(id),
  
  -- Meeting Details
  title VARCHAR(255) DEFAULT 'Diagnostic Strategy Call',
  description TEXT,
  
  -- Scheduling
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration INTEGER DEFAULT 60, -- minutes
  timezone VARCHAR(50) DEFAULT 'UTC',
  
  -- Meeting Link
  meeting_link TEXT,
  calendar_event_id VARCHAR(255), -- Google Calendar, Outlook, etc.
  
  -- Priority & Type
  is_priority BOOLEAN DEFAULT FALSE,
  meeting_type VARCHAR(50) DEFAULT 'discovery', -- discovery, follow_up, demo, closing
  
  -- Status
  status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, confirmed, rescheduled, completed, cancelled, no_show
  confirmed_by_client BOOLEAN DEFAULT FALSE,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  
  -- Reminders
  reminder_24h_sent BOOLEAN DEFAULT FALSE,
  reminder_1h_sent BOOLEAN DEFAULT FALSE,
  
  -- Outcome
  attended BOOLEAN,
  outcome_notes TEXT,
  next_steps JSONB,
  follow_up_date DATE,
  
  -- Priority Benefits (if priority booking)
  priority_report_delivery_hours INTEGER DEFAULT 24, -- Guaranteed report delivery
  fast_track_review BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  booked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancellation_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN (
    'scheduled', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show'
  ))
);

-- Indexes
CREATE INDEX idx_meetings_submission ON meetings(submission_id);
CREATE INDEX idx_meetings_client ON meetings(client_id);
CREATE INDEX idx_meetings_assigned ON meetings(assigned_to);
CREATE INDEX idx_meetings_scheduled ON meetings(scheduled_at);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_priority ON meetings(is_priority) WHERE is_priority = TRUE;
CREATE INDEX idx_meetings_upcoming ON meetings(scheduled_at) 
  WHERE status IN ('scheduled', 'confirmed') AND scheduled_at > NOW();
```

---

### **12. emails**

Email communications log

```sql
CREATE TABLE emails (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'email_' || gen_random_uuid(),
  
  -- References
  client_id VARCHAR(50) REFERENCES clients(id),
  submission_id VARCHAR(50) REFERENCES submissions(id),
  meeting_id VARCHAR(50) REFERENCES meetings(id),
  sent_by VARCHAR(50) REFERENCES users(id),
  
  -- Email Details
  template_id VARCHAR(100) NOT NULL,
  -- Examples: lead_magnet_download, submission_confirmation, diagnostic_report, meeting_reminder
  
  subject VARCHAR(500) NOT NULL,
  to_email VARCHAR(255) NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  reply_to VARCHAR(255),
  cc_emails TEXT[], -- Array of CC emails
  bcc_emails TEXT[], -- Array of BCC emails
  
  -- Content
  html_content TEXT,
  text_content TEXT,
  template_variables JSONB, -- Variables used in template
  
  -- Delivery
  status VARCHAR(20) DEFAULT 'queued', 
  -- queued, sent, delivered, opened, clicked, bounced, failed, spam_complaint
  
  scheduled_send_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  
  -- Tracking
  tracking_enabled BOOLEAN DEFAULT TRUE,
  open_tracking BOOLEAN DEFAULT TRUE,
  click_tracking BOOLEAN DEFAULT TRUE,
  
  -- External Provider
  provider VARCHAR(50) DEFAULT 'sendgrid', -- sendgrid, ses, postmark, mailgun
  provider_message_id VARCHAR(255),
  
  -- Engagement Metrics
  opens_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  first_opened_at TIMESTAMP WITH TIME ZONE,
  first_clicked_at TIMESTAMP WITH TIME ZONE,
  last_opened_at TIMESTAMP WITH TIME ZONE,
  last_clicked_at TIMESTAMP WITH TIME ZONE,
  
  -- Error Handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN (
    'queued', 'sent', 'delivered', 'opened', 'clicked', 
    'bounced', 'failed', 'spam_complaint', 'unsubscribed'
  ))
);

-- Indexes
CREATE INDEX idx_emails_client ON emails(client_id);
CREATE INDEX idx_emails_submission ON emails(submission_id);
CREATE INDEX idx_emails_template ON emails(template_id);
CREATE INDEX idx_emails_status ON emails(status);
CREATE INDEX idx_emails_sent ON emails(sent_at DESC NULLS LAST);
CREATE INDEX idx_emails_scheduled ON emails(scheduled_send_at) 
  WHERE status = 'queued' AND scheduled_send_at IS NOT NULL;
CREATE INDEX idx_emails_to ON emails(to_email);
```

---

### **13. email_events**

Detailed email tracking events

```sql
CREATE TABLE email_events (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'event_' || gen_random_uuid(),
  
  -- Reference
  email_id VARCHAR(50) NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  
  -- Event Details
  event_type VARCHAR(50) NOT NULL, -- opened, clicked, bounced, spam_complaint, unsubscribed
  event_data JSONB, -- Additional data like clicked link, bounce reason, etc.
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  device_type VARCHAR(20), -- desktop, mobile, tablet
  location JSONB, -- {"city": "San Francisco", "country": "US", "region": "CA"}
  
  -- Clicked Link (if click event)
  clicked_url TEXT,
  link_index INTEGER,
  
  -- Provider Data
  provider_event_id VARCHAR(255),
  provider_timestamp TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_event_type CHECK (event_type IN (
    'sent', 'delivered', 'opened', 'clicked', 'bounced', 
    'deferred', 'dropped', 'spam_complaint', 'unsubscribed'
  ))
);

-- Indexes
CREATE INDEX idx_email_events_email ON email_events(email_id);
CREATE INDEX idx_email_events_type ON email_events(event_type);
CREATE INDEX idx_email_events_occurred ON email_events(occurred_at DESC);

-- JSONB indexes
CREATE INDEX idx_email_events_data ON email_events USING gin(event_data);
CREATE INDEX idx_email_events_location ON email_events USING gin(location);
```

---

### **14. reports**

Generated diagnostic reports

```sql
CREATE TABLE reports (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'report_' || gen_random_uuid(),
  
  -- References
  submission_id VARCHAR(50) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  client_id VARCHAR(50) NOT NULL REFERENCES clients(id),
  cortex_analysis_id VARCHAR(50) REFERENCES cortex_analyses(id),
  generated_by VARCHAR(50) REFERENCES users(id),
  
  -- Report Content
  report_version VARCHAR(20) DEFAULT 'v1.0',
  template_used VARCHAR(100),
  
  -- Sections (stored as JSONB for flexibility)
  executive_summary TEXT,
  key_findings JSONB, -- Array of finding objects
  recommendations JSONB, -- Array of recommendation objects
  roi_analysis JSONB,
  implementation_roadmap JSONB,
  next_steps JSONB,
  
  -- Full Report
  full_report_html TEXT,
  full_report_json JSONB,
  
  -- Files
  pdf_url TEXT,
  pdf_generated_at TIMESTAMP WITH TIME ZONE,
  
  -- Status
  status VARCHAR(20) DEFAULT 'draft', -- draft, finalized, sent, viewed
  
  -- Delivery
  sent_to_client BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP WITH TIME ZONE,
  email_id VARCHAR(50) REFERENCES emails(id),
  
  -- Access
  public_url TEXT, -- Shareable link
  access_token VARCHAR(255) UNIQUE,
  access_expires_at TIMESTAMP WITH TIME ZONE,
  
  -- Engagement
  view_count INTEGER DEFAULT 0,
  first_viewed_at TIMESTAMP WITH TIME ZONE,
  last_viewed_at TIMESTAMP WITH TIME ZONE,
  average_time_viewed INTEGER, -- seconds
  
  -- Metadata
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('draft', 'finalized', 'sent', 'viewed', 'archived'))
);

-- Indexes
CREATE INDEX idx_reports_submission ON reports(submission_id);
CREATE INDEX idx_reports_client ON reports(client_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_generated ON reports(generated_at DESC);
CREATE INDEX idx_reports_access_token ON reports(access_token) WHERE access_token IS NOT NULL;
```

---

### **15. report_views**

Track report viewing activity

```sql
CREATE TABLE report_views (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'view_' || gen_random_uuid(),
  
  -- References
  report_id VARCHAR(50) NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  client_id VARCHAR(50) REFERENCES clients(id),
  
  -- View Details
  session_id VARCHAR(100),
  duration INTEGER, -- seconds spent viewing
  scroll_percentage INTEGER, -- How far they scrolled
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  device_type VARCHAR(20),
  browser VARCHAR(50),
  location JSONB,
  
  -- Interactions
  sections_viewed JSONB DEFAULT '[]'::jsonb,
  -- Example: ["executive_summary", "key_findings", "recommendations"]
  
  buttons_clicked JSONB DEFAULT '[]'::jsonb,
  -- Example: ["book_meeting", "download_pdf", "contact_us"]
  
  -- Metadata
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_scroll CHECK (scroll_percentage >= 0 AND scroll_percentage <= 100)
);

-- Indexes
CREATE INDEX idx_report_views_report ON report_views(report_id);
CREATE INDEX idx_report_views_client ON report_views(client_id);
CREATE INDEX idx_report_views_session ON report_views(session_id);
CREATE INDEX idx_report_views_viewed ON report_views(viewed_at DESC);
```

---

### **16. team_actions**

Audit log of team member actions

```sql
CREATE TABLE team_actions (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'action_' || gen_random_uuid(),
  
  -- References
  user_id VARCHAR(50) NOT NULL REFERENCES users(id),
  submission_id VARCHAR(50) REFERENCES submissions(id),
  
  -- Action Details
  action_type VARCHAR(50) NOT NULL,
  -- Examples: view_submission, edit_submission, approve_submission, send_report,
  -- assign_submission, change_priority, add_note, bulk_approve
  
  action_data JSONB,
  -- Example: {"field_changed": "status", "old_value": "submitted", "new_value": "approved"}
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  -- Metadata
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_action_type CHECK (action_type IN (
    'view_submission', 'edit_submission', 'approve_submission', 'reject_submission',
    'send_report', 'assign_submission', 'change_priority', 'change_status',
    'add_note', 'bulk_approve', 'bulk_send', 'export_data', 'run_cortex_analysis'
  ))
);

-- Indexes
CREATE INDEX idx_team_actions_user ON team_actions(user_id);
CREATE INDEX idx_team_actions_submission ON team_actions(submission_id);
CREATE INDEX idx_team_actions_type ON team_actions(action_type);
CREATE INDEX idx_team_actions_performed ON team_actions(performed_at DESC);

-- JSONB index
CREATE INDEX idx_team_actions_data ON team_actions USING gin(action_data);
```

---

### **17. analytics_events**

Platform analytics and metrics

```sql
CREATE TABLE analytics_events (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'analytics_' || gen_random_uuid(),
  
  -- Event Classification
  category VARCHAR(50) NOT NULL, -- conversion, engagement, performance, user_behavior
  event_name VARCHAR(100) NOT NULL,
  -- Examples: submission_started, submission_completed, exit_intent_shown, ai_assistant_used
  
  -- Event Data
  event_properties JSONB DEFAULT '{}'::jsonb,
  -- Example: {"industry": "ecommerce", "question_number": 7, "time_spent": 45}
  
  -- User Context
  user_id VARCHAR(50), -- Team user (if authenticated)
  client_id VARCHAR(50), -- Client (if identified)
  session_id VARCHAR(100),
  anonymous_id VARCHAR(100), -- For non-authenticated users
  
  -- Technical Context
  page_url TEXT,
  referrer TEXT,
  ip_address INET,
  user_agent TEXT,
  device_type VARCHAR(20),
  browser VARCHAR(50),
  os VARCHAR(50),
  
  -- Metadata
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_category CHECK (category IN (
    'conversion', 'engagement', 'performance', 'user_behavior', 'error', 'feature_usage'
  ))
);

-- Indexes
CREATE INDEX idx_analytics_category ON analytics_events(category);
CREATE INDEX idx_analytics_event_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_user ON analytics_events(user_id);
CREATE INDEX idx_analytics_client ON analytics_events(client_id);
CREATE INDEX idx_analytics_session ON analytics_events(session_id);
CREATE INDEX idx_analytics_occurred ON analytics_events(occurred_at DESC);

-- JSONB index for querying properties
CREATE INDEX idx_analytics_properties ON analytics_events USING gin(event_properties);

-- Time-series partitioning (optional, for high volume)
-- CREATE TABLE analytics_events_2026_02 PARTITION OF analytics_events
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

---

### **18. webhooks**

Webhook configurations and logs

```sql
CREATE TABLE webhooks (
  -- Primary Key
  id VARCHAR(50) PRIMARY KEY DEFAULT 'webhook_' || gen_random_uuid(),
  
  -- Configuration
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  secret VARCHAR(255), -- For signing payloads
  
  -- Events to Subscribe
  events JSONB DEFAULT '[]'::jsonb,
  -- Example: ["lead.captured", "submission.completed", "meeting.booked"]
  
  -- Status
  active BOOLEAN DEFAULT TRUE,
  
  -- Retry Configuration
  retry_enabled BOOLEAN DEFAULT TRUE,
  max_retries INTEGER DEFAULT 3,
  retry_delay INTEGER DEFAULT 60, -- seconds
  
  -- Stats
  total_deliveries INTEGER DEFAULT 0,
  successful_deliveries INTEGER DEFAULT 0,
  failed_deliveries INTEGER DEFAULT 0,
  last_delivery_at TIMESTAMP WITH TIME ZONE,
  last_delivery_status VARCHAR(20),
  
  -- Metadata
  created_by VARCHAR(50) REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_webhooks_active ON webhooks(active);
CREATE INDEX idx_webhooks_events ON webhooks USING gin(events);

-- Webhook Delivery Logs
CREATE TABLE webhook_deliveries (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'delivery_' || gen_random_uuid(),
  webhook_id VARCHAR(50) NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  
  -- Event Details
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  
  -- Delivery
  status VARCHAR(20) NOT NULL, -- pending, success, failed
  http_status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  
  -- Retry
  attempt_number INTEGER DEFAULT 1,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  
  -- Timing
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  duration_ms INTEGER, -- Request duration
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at DESC);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) 
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;
```

---

## 🔗 **RELATIONSHIPS DIAGRAM**

```
┌─────────┐       ┌──────────┐       ┌─────────────┐
│  users  │──────▶│submissions│◀──────│   clients   │
└─────────┘       └─────────┬─┘       └──────┬──────┘
                            │                │
                            │                │
                   ┌────────▼─────┐    ┌─────▼─────┐
                   │submission_   │    │   leads   │
                   │  answers     │    └───────────┘
                   └──────────────┘
                            │
                   ┌────────▼──────────┐
                   │cortex_analyses    │
                   └────────┬──────────┘
                            │
                   ┌────────▼──────────┐
                   │cortex_insights    │
                   └───────────────────┘

┌─────────────┐       ┌──────────┐       ┌──────────┐
│ submissions │──────▶│ meetings │◀──────│ clients  │
└─────────────┘       └──────────┘       └──────────┘

┌─────────────┐       ┌──────────┐       ┌──────────────┐
│ submissions │──────▶│  reports │──────▶│ report_views │
└─────────────┘       └──────────┘       └──────────────┘

┌─────────────┐       ┌──────────┐       ┌──────────────┐
│   clients   │──────▶│  emails  │──────▶│email_events  │
└─────────────┘       └──────────┘       └──────────────┘
```

---

## ⚡ **INDEXES & PERFORMANCE**

### **Critical Indexes for Performance:**

1. **Submissions List Page** (Team Dashboard)
   ```sql
   CREATE INDEX idx_submissions_dashboard ON submissions(status, priority, submitted_at DESC)
     WHERE deleted_at IS NULL;
   ```

2. **Quality Score Filtering**
   ```sql
   CREATE INDEX idx_submissions_quality_review ON submissions(quality_score DESC, status)
     WHERE quality_score >= 90 AND status = 'submitted';
   ```

3. **Client Portal Access**
   ```sql
   CREATE INDEX idx_clients_portal_lookup ON clients(email, magic_link_token)
     WHERE magic_link_expires_at > NOW();
   ```

4. **Email Engagement**
   ```sql
   CREATE INDEX idx_emails_engagement ON emails(client_id, status, sent_at DESC)
     WHERE status IN ('delivered', 'opened', 'clicked');
   ```

### **Partitioning Strategy (High Volume):**

For tables that grow rapidly:

```sql
-- Partition analytics_events by month
CREATE TABLE analytics_events (
  /* columns */
) PARTITION BY RANGE (occurred_at);

CREATE TABLE analytics_events_2026_01 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
  
CREATE TABLE analytics_events_2026_02 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

---

## 📏 **DATA TYPES & CONSTRAINTS**

### **Enums vs Check Constraints:**

Using CHECK constraints for flexibility:

```sql
-- Good: Easy to update
CONSTRAINT valid_status CHECK (status IN ('new', 'approved', 'rejected'))

-- Alternative: PostgreSQL enum (more rigid)
CREATE TYPE submission_status AS ENUM ('new', 'approved', 'rejected');
```

### **JSON vs JSONB:**

Always use **JSONB** for:
- Better performance
- Indexing support
- Query capabilities

```sql
-- Correct
recommendations JSONB DEFAULT '{}'::jsonb

-- Incorrect (avoid plain JSON)
recommendations JSON
```

---

## 🔄 **MIGRATIONS**

### **Migration Template:**

```sql
-- Migration: 001_initial_schema.sql
-- Created: 2026-02-02
-- Description: Initial database schema

BEGIN;

-- Create tables in dependency order
CREATE TABLE users ( /* ... */ );
CREATE TABLE clients ( /* ... */ );
CREATE TABLE submissions ( /* ... */ );
-- ... more tables

-- Create indexes
CREATE INDEX /* ... */;

-- Insert seed data
INSERT INTO industries /* ... */;

COMMIT;
```

### **Rollback Template:**

```sql
-- Rollback: 001_initial_schema.sql

BEGIN;

-- Drop in reverse order
DROP TABLE IF EXISTS webhook_deliveries CASCADE;
DROP TABLE IF EXISTS webhooks CASCADE;
-- ... more drops

COMMIT;
```

---

## 💾 **BACKUP & RECOVERY**

### **Backup Strategy:**

```bash
# Full database backup
pg_dump -h localhost -U postgres -d eclipse_platform > backup_$(date +%Y%m%d).sql

# Compressed backup
pg_dump -h localhost -U postgres -d eclipse_platform | gzip > backup_$(date +%Y%m%d).sql.gz

# Schema only
pg_dump -h localhost -U postgres -d eclipse_platform --schema-only > schema.sql

# Data only
pg_dump -h localhost -U postgres -d eclipse_platform --data-only > data.sql
```

### **Restore:**

```bash
# Restore full backup
psql -h localhost -U postgres -d eclipse_platform < backup_20260202.sql

# Restore compressed
gunzip -c backup_20260202.sql.gz | psql -h localhost -U postgres -d eclipse_platform
```

---

## 📊 **STORAGE ESTIMATES**

### **Projected Storage (1 year, 10,000 submissions):**

| Table | Rows | Avg Size/Row | Total Size |
|-------|------|--------------|------------|
| submissions | 10,000 | 2 KB | 20 MB |
| submission_answers | 140,000 | 1 KB | 140 MB |
| cortex_analyses | 10,000 | 50 KB | 500 MB |
| analytics_events | 1,000,000 | 0.5 KB | 500 MB |
| emails | 50,000 | 5 KB | 250 MB |
| **Total** | | | **~1.5 GB** |

---

## 🔒 **SECURITY**

### **Row-Level Security (RLS):**

```sql
-- Enable RLS
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- Team members can only see assigned submissions
CREATE POLICY team_submissions ON submissions
  FOR SELECT
  TO team_role
  USING (assigned_to = current_user_id() OR role = 'admin');

-- Clients can only see their own submissions
CREATE POLICY client_submissions ON submissions
  FOR SELECT
  TO client_role
  USING (client_id = current_client_id());
```

### **Encryption:**

- Use `pgcrypto` extension for sensitive data
- Encrypt at application layer for PII
- Use environment variables for keys

---

**End of Database Schema**

For questions: db-support@yourdomain.com

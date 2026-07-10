/**
 * MOCK AI ANALYSIS DATA
 * 
 * This file provides dummy/mock AI analysis data for front-end development.
 * 
 * PRODUCTION IMPLEMENTATION:
 * Replace this with actual API calls to your backend, which will:
 * 1. Call GPT/Claude API with the submission data
 * 2. Process the AI response
 * 3. Return data matching the AIAnalysis interface
 * 
 * Example production code:
 * 
 * export const analyzeSubmission = async (submissionId: string): Promise<AIAnalysis> => {
 *   const response = await fetch('/api/analyze', {
 *     method: 'POST',
 *     body: JSON.stringify({ submissionId })
 *   });
 *   return response.json();
 * };
 */

import type { AIAnalysis } from '@/app/types/ai-scoring';

// Mock function to simulate AI analysis
// In production, this would call your backend API
export const getMockAIAnalysis = (submissionId: string): AIAnalysis => {
  return {
    submissionId,
    industry: 'E-commerce / DTC',
    companyName: 'Acme Fashion Co.',
    analyzedAt: new Date().toISOString(),
    
    questionAnalyses: [
      {
        questionId: 1,
        category: 'Business Model & Economics',
        question: 'Describe your business model, who you serve, and how money comes in today.',
        answer: 'We sell sustainable fashion directly to consumers via our website. Revenue from product sales, average order $85, mostly acquired through Instagram and Facebook ads. 60% new customers, 40% repeat.',
        keyInsights: [
          'DTC model with strong digital presence',
          'Healthy repeat purchase rate (40%)',
          'Dependency on paid advertising for acquisition'
        ],
        painPoints: [
          'High customer acquisition costs eating into margins',
          'Limited organic/non-paid traffic channels'
        ],
        opportunityAreas: [
          'Marketing automation and segmentation',
          'Retention and lifecycle campaigns',
          'Customer LTV optimization'
        ],
        maturityScore: 6,
        urgencyScore: 7,
        aiReadinessScore: 7
      },
      {
        questionId: 2,
        category: 'Business Model & Economics',
        question: 'What happens when orders increase by 20-30%? What part of the operation breaks first?',
        answer: 'Customer service would collapse. Already overwhelmed with order inquiries, return questions, shipping updates. Response time would go from 24 hours to 3-4 days. Also fulfillment partner might struggle with spike.',
        keyInsights: [
          'Customer service is the primary bottleneck',
          'Reactive support model (high inquiry volume)',
          'Dependency on fulfillment partner capacity'
        ],
        painPoints: [
          'Customer service team underwater with current volume',
          'Response times already at acceptable limits',
          'Lack of proactive communication reducing inquiries'
        ],
        opportunityAreas: [
          'Self-service customer portal with order tracking',
          'AI chatbot for common inquiries',
          'Automated order status notifications',
          'Proactive communication reducing inquiry volume'
        ],
        maturityScore: 4,
        urgencyScore: 8,
        aiReadinessScore: 8
      },
      {
        questionId: 5,
        category: 'Operations & Fulfillment',
        question: 'Which tasks are still handled manually that shouldn\'t be?',
        answer: 'Manually updating inventory across website, Amazon, and social commerce. Copy-pasting order details into fulfillment partner portal. Creating shipping labels one by one. Answering same questions repeatedly via email.',
        keyInsights: [
          'Multi-channel inventory management is manual',
          'Order processing has significant manual handoffs',
          'High volume of repetitive customer inquiries'
        ],
        painPoints: [
          'Inventory sync errors causing oversells and stockouts',
          'Order processing takes 2-3 hours daily',
          'Customer service time spent on repetitive questions'
        ],
        opportunityAreas: [
          'Centralized inventory management system',
          'Direct integration with fulfillment partner API',
          'Automated FAQ and self-service knowledge base',
          'AI-powered email response suggestions'
        ],
        maturityScore: 3,
        urgencyScore: 7,
        aiReadinessScore: 9
      }
      // ... more question analyses would be here
    ],
    
    overallScores: {
      maturityScore: 48,      // Out of 100
      urgencyScore: 72,       // Out of 100
      aiReadinessScore: 78,   // Out of 100
      impactPotential: 85     // Out of 100
    },
    
    categoryInsights: [
      {
        categoryName: 'Business Model & Economics',
        averageMaturityScore: 5.5,
        keyFindings: [
          'Solid DTC foundation with healthy repeat rate',
          'Over-reliance on paid advertising for growth',
          'Customer service bottleneck limiting scale'
        ],
        topOpportunities: [
          'Marketing automation and segmentation',
          'Customer retention and LTV optimization',
          'Self-service customer support'
        ]
      },
      {
        categoryName: 'Operations & Fulfillment',
        averageMaturityScore: 4.2,
        keyFindings: [
          'Manual processes throughout order-to-cash cycle',
          'Multi-channel inventory management is fragile',
          'High risk of errors with current manual approach'
        ],
        topOpportunities: [
          'Unified inventory management system',
          'Fulfillment partner API integration',
          'Automated order processing workflows'
        ]
      },
      {
        categoryName: 'Customer Experience & Support',
        averageMaturityScore: 3.8,
        keyFindings: [
          'Customer service is reactive and overwhelmed',
          'No self-service options for customers',
          'Limited proactive communication'
        ],
        topOpportunities: [
          'AI chatbot for tier-1 support',
          'Self-service order tracking portal',
          'Automated proactive notifications'
        ]
      },
      {
        categoryName: 'AI Readiness & Future State',
        averageMaturityScore: 7.0,
        keyFindings: [
          'Open to automation and technology',
          'Strong tech infrastructure foundation',
          'Previous successful tool implementations'
        ],
        topOpportunities: [
          'AI-powered customer service',
          'Predictive inventory management',
          'Personalization and recommendation engine'
        ]
      }
    ],
    
    executiveSummary: {
      currentState: 'Acme Fashion Co. is a growing DTC e-commerce brand with solid fundamentals (healthy repeat rate, strong digital presence) but operationally held together with manual processes and duct tape. Customer service and fulfillment operations are at breaking point and will not scale to support growth ambitions.',
      biggestPainPoints: [
        'Customer service team overwhelmed - response times at limit, will collapse with growth',
        'Manual inventory management across multiple channels causing errors and oversells',
        'High customer acquisition costs with over-reliance on paid advertising',
        'Order processing requires 2-3 hours of manual work daily',
        'No proactive customer communication leading to high inquiry volume'
      ],
      quickWins: [
        'Implement AI chatbot for common FAQs (30-40% inquiry reduction expected)',
        'Automated order status emails (reduce "where is my order" inquiries by 50%)',
        'Self-service order tracking portal',
        'Fulfillment partner API integration (eliminate manual order entry)',
        'Centralized inventory management (prevent oversells, reduce manual work)'
      ],
      strategicOpportunities: [
        'AI-powered customer service platform (chatbot + agent assist + email automation)',
        'Full multi-channel inventory and order management system',
        'Marketing automation and customer segmentation for retention',
        'Predictive analytics for inventory planning and demand forecasting',
        'Personalization engine for product recommendations and upsells'
      ],
      estimatedImpact: 'Conservative estimates: 40% reduction in customer service workload, 50% reduction in order processing time, 20-30% reduction in oversell/stockout incidents, 15-25% improvement in repeat purchase rate through better retention marketing. Could support 2-3x current order volume with same team size.'
    },
    
    readinessAssessment: {
      readinessLevel: 'High',
      readinessFactors: [
        {
          factor: 'Technical Infrastructure',
          status: 'Ready',
          description: 'Using Shopify with modern tech stack. APIs available for integrations. Team comfortable with SaaS tools.'
        },
        {
          factor: 'Process Documentation',
          status: 'Challenge',
          description: 'Processes exist but live in team members\' heads. Need to document before automating.'
        },
        {
          factor: 'Team Buy-In',
          status: 'Advantage',
          description: 'Founder and team eager for automation. Previous positive experience with tools. Strong change readiness.'
        },
        {
          factor: 'Data Quality',
          status: 'Ready',
          description: 'Customer and order data in good shape. Historical data available for AI training.'
        },
        {
          factor: 'Budget & Resources',
          status: 'Challenge',
          description: 'Limited budget for large investments. Need to show ROI quickly. Prefer phased approach.'
        }
      ],
      recommendedApproach: 'Quick Wins First: Implement high-impact, low-effort solutions in first 30-60 days to demonstrate value and build momentum. Then tackle strategic platform implementations. Phased rollout reduces risk and proves ROI incrementally.',
      estimatedTimeframe: '3-6 months for full transformation. Quick wins deliverable in 30-60 days. Strategic initiatives 3-6 months.'
    },
    
    recommendedPriorities: [
      {
        priority: 1,
        area: 'AI Chatbot for Customer Support',
        rationale: 'Highest pain point with immediate ROI. Can reduce inquiry volume 30-40% in weeks. Low technical complexity.',
        estimatedImpact: 'Very High',
        estimatedEffort: 'Low',
        quickWin: true
      },
      {
        priority: 2,
        area: 'Automated Order Status Communications',
        rationale: '"Where is my order" is 40% of support tickets. Automated notifications solve this proactively.',
        estimatedImpact: 'High',
        estimatedEffort: 'Low',
        quickWin: true
      },
      {
        priority: 3,
        area: 'Fulfillment Partner API Integration',
        rationale: 'Eliminates 2-3 hours daily manual work. Reduces errors. Foundation for scaling.',
        estimatedImpact: 'High',
        estimatedEffort: 'Medium',
        quickWin: true
      },
      {
        priority: 4,
        area: 'Multi-Channel Inventory Management',
        rationale: 'Prevents oversells and stockouts. Critical for multi-channel expansion. Complex integration.',
        estimatedImpact: 'Very High',
        estimatedEffort: 'High',
        quickWin: false
      },
      {
        priority: 5,
        area: 'Customer Segmentation & Retention Marketing',
        rationale: 'Improve LTV and reduce CAC dependency. Marketing automation platform required.',
        estimatedImpact: 'High',
        estimatedEffort: 'Medium',
        quickWin: false
      }
    ],
    
    riskFlags: [
      {
        riskType: 'Critical',
        area: 'Customer Service Capacity',
        description: 'Team already at breaking point. Growth will cause service quality collapse and customer satisfaction issues.',
        mitigation: 'Implement chatbot and self-service ASAP. Hire additional support rep as bridge solution.'
      },
      {
        riskType: 'High',
        area: 'Inventory Management',
        description: 'Manual multi-channel inventory sync causing oversells. Damages brand reputation and causes refund costs.',
        mitigation: 'Implement inventory management system urgently. Short-term: reduce available inventory buffer to prevent oversells.'
      },
      {
        riskType: 'Medium',
        area: 'Fulfillment Partner Dependency',
        description: 'Single fulfillment partner creates capacity and continuity risk.',
        mitigation: 'Long-term: Diversify fulfillment partners. Ensure API integrations support multi-partner strategy.'
      }
    ]
  };
};

// Mock list of all submissions for the dashboard
export const getMockSubmissionsList = () => {
  return [
    {
      id: 'sub_001',
      companyName: 'Acme Fashion Co.',
      industry: 'E-commerce / DTC',
      submittedAt: '2026-01-27T14:30:00Z',
      submittedBy: 'sarah@acmefashion.com',
      status: 'analyzed' as const,
      overallReadiness: 78,
      readinessLevel: 'High' as const,
      urgencyScore: 72,
      impactPotential: 85
    },
    {
      id: 'sub_002',
      companyName: 'TechFlow SaaS',
      industry: 'SaaS / Software',
      submittedAt: '2026-01-26T09:15:00Z',
      submittedBy: 'john@techflow.io',
      status: 'analyzed' as const,
      overallReadiness: 62,
      readinessLevel: 'High' as const,
      urgencyScore: 68,
      impactPotential: 72
    },
    {
      id: 'sub_003',
      companyName: 'Creative Agency Pro',
      industry: 'Agency / Services',
      submittedAt: '2026-01-25T16:45:00Z',
      submittedBy: 'mike@creativeagency.com',
      status: 'pending' as const,
      overallReadiness: 0,
      readinessLevel: 'Medium' as const,
      urgencyScore: 0,
      impactPotential: 0
    },
    {
      id: 'sub_004',
      companyName: 'HealthCare Plus',
      industry: 'Healthcare / Medical',
      submittedAt: '2026-01-24T11:20:00Z',
      submittedBy: 'dr.smith@healthcareplus.com',
      status: 'analyzed' as const,
      overallReadiness: 45,
      readinessLevel: 'Medium' as const,
      urgencyScore: 82,
      impactPotential: 90
    },
    {
      id: 'sub_005',
      companyName: 'Manufacturing Co',
      industry: 'Manufacturing / Supply Chain',
      submittedAt: '2026-01-23T13:00:00Z',
      submittedBy: 'ops@manufacturing.com',
      status: 'analyzed' as const,
      overallReadiness: 38,
      readinessLevel: 'Medium' as const,
      urgencyScore: 88,
      impactPotential: 95
    }
  ];
};

/**
 * PRODUCTION API INTEGRATION EXAMPLE
 * 
 * Replace the mock functions above with real API calls:
 * 
 * export const analyzeSubmission = async (submissionId: string): Promise<AIAnalysis> => {
 *   const response = await fetch(`/api/submissions/${submissionId}/analyze`, {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${getAuthToken()}`
 *     }
 *   });
 *   
 *   if (!response.ok) {
 *     throw new Error('Failed to analyze submission');
 *   }
 *   
 *   return response.json();
 * };
 * 
 * export const getSubmissionsList = async (): Promise<SubmissionSummary[]> => {
 *   const response = await fetch('/api/submissions', {
 *     headers: {
 *       'Authorization': `Bearer ${getAuthToken()}`
 *     }
 *   });
 *   
 *   if (!response.ok) {
 *     throw new Error('Failed to fetch submissions');
 *   }
 *   
 *   return response.json();
 * };
 * 
 * export const getAIAnalysis = async (submissionId: string): Promise<AIAnalysis> => {
 *   const response = await fetch(`/api/submissions/${submissionId}/analysis`, {
 *     headers: {
 *       'Authorization': `Bearer ${getAuthToken()}`
 *     }
 *   });
 *   
 *   if (!response.ok) {
 *     throw new Error('Failed to fetch analysis');
 *   }
 *   
 *   return response.json();
 * };
 */

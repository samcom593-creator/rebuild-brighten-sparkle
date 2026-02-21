import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CoachingRequest {
  type: 'coaching';
  agentStats: {
    totalLeads: number;
    contacted: number;
    qualified: number;
    closed: number;
    closeRate: number;
    avgWaitTime: number;
    staleLeads: number;
    teamAvgCloseRate: number;
  };
}

interface SummaryRequest {
  type: 'summary';
  applicant: {
    fullName: string;
    email: string;
    phone: string;
    city: string;
    state: string;
    instagramHandle: string;
    hasLicense: boolean;
    yearsExperience: string;
    currentOccupation: string;
    whyJoin: string;
    status: string;
    createdAt: string;
  };
}

interface PerformanceBreakdownRequest {
  type: 'performance_breakdown';
  agentStats: {
    alp: number;
    presentations: number;
    deals: number;
    closingRate: number;
  };
  teamAverages: {
    alp: number;
    presentations: number;
    deals: number;
    closingRate: number;
  };
  rank: number;
  totalAgents: number;
}

interface ChatRequest {
  type: 'chat';
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  applicantContext?: {
    fullName: string;
    hasLicense: boolean;
    yearsExperience: string;
    currentOccupation: string;
    whyJoin: string;
    status: string;
  };
}

interface RecruiterInsightsRequest {
  type: 'recruiter_insights';
  stats: {
    totalLeads: number;
    needsContact: number;
    inProgress: number;
    hotLeads: number;
    atRisk: number;
    overdueFollowups: number;
    newThisWeek: number;
    contactRate: number;
    licenseRate: number;
    pipelineBreakdown: Record<string, number>;
  };
}

interface WeeklyDigestRequest {
  type: 'weekly_digest';
  stats: {
    activeAgents: number;
    weekAlp: number;
    weekDeals: number;
    weekPresentations: number;
    producersCount: number;
    closingRate: number;
    totalApps: number;
    newThisWeek: number;
    licensedCount: number;
    inCourse: number;
    testPhase: number;
    overdueCount: number;
  };
}

type AIRequest = CoachingRequest | SummaryRequest | ChatRequest | PerformanceBreakdownRequest | RecruiterInsightsRequest | WeeklyDigestRequest;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('Missing or invalid authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error('Invalid token:', claimsError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;
    console.log('AI Assistant request from user:', userId);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const body: AIRequest = await req.json();
    console.log('AI Assistant request type:', body.type);

    let systemPrompt = '';
    let userPrompt = '';

    switch (body.type) {
      case 'coaching': {
        const stats = body.agentStats;
        systemPrompt = `You are an expert sales coach for insurance agents. Analyze performance metrics and provide actionable, encouraging coaching advice. Be specific, data-driven, and motivational. Keep responses concise but impactful.`;
        
        userPrompt = `Analyze this agent's performance and provide 3-4 specific coaching tips:

Performance Metrics:
- Total Leads: ${stats.totalLeads}
- Contacted: ${stats.contacted} (${stats.totalLeads > 0 ? ((stats.contacted / stats.totalLeads) * 100).toFixed(1) : 0}%)
- Qualified: ${stats.qualified}
- Closed: ${stats.closed}
- Close Rate: ${stats.closeRate.toFixed(1)}% (Team Average: ${stats.teamAvgCloseRate.toFixed(1)}%)
- Average Response Time: ${stats.avgWaitTime.toFixed(1)} hours
- Stale Leads (48+ hours): ${stats.staleLeads}

Provide personalized coaching tips to improve their performance. Focus on their weakest areas first.`;
        break;
      }

      case 'summary': {
        const app = body.applicant;
        systemPrompt = `You are a recruiter assistant helping agents quickly assess candidates. Provide a brief, insightful summary highlighting key strengths, potential concerns, and recommended next steps. Be objective and professional.`;
        
        userPrompt = `Summarize this applicant profile for quick assessment:

Name: ${app.fullName}
Location: ${app.city}, ${app.state}
Contact: ${app.email} | ${app.phone}
Instagram: @${app.instagramHandle || 'N/A'}
Licensed: ${app.hasLicense ? 'Yes' : 'No'}
Experience: ${app.yearsExperience || 'Not specified'}
Current Occupation: ${app.currentOccupation || 'Not specified'}
Application Status: ${app.status}
Applied: ${new Date(app.createdAt).toLocaleDateString()}

Why they want to join:
"${app.whyJoin || 'Not provided'}"

Provide a 2-3 sentence summary highlighting: key strengths, potential concerns, and a recommended next action.`;
        break;
      }

      case 'chat': {
        const context = body.applicantContext;
        systemPrompt = `You are an AI assistant helping insurance agents qualify leads and handle objections. You have deep knowledge of the insurance industry, sales techniques, and lead qualification.

${context ? `Current Lead Context:
- Name: ${context.fullName}
- Licensed: ${context.hasLicense ? 'Yes' : 'No'}
- Experience: ${context.yearsExperience || 'Unknown'}
- Occupation: ${context.currentOccupation || 'Unknown'}
- Motivation: ${context.whyJoin || 'Not provided'}
- Status: ${context.status}` : 'No specific lead context provided.'}

Provide helpful, actionable advice for qualifying leads, handling objections, and closing deals. Be conversational but professional.`;

        const messages = body.messages;
        userPrompt = messages[messages.length - 1]?.content || '';
        break;
      }

      case 'performance_breakdown': {
        const { agentStats, teamAverages, rank, totalAgents } = body as PerformanceBreakdownRequest;
        systemPrompt = `You are an expert sales performance analyst and motivational coach. Provide a brief, encouraging analysis of an insurance agent's performance compared to their team. Be specific, data-driven, and actionable. Keep it to 3-4 sentences max.`;
        
        userPrompt = `Analyze this agent's performance and provide quick coaching:

Rank: #${rank} out of ${totalAgents} agents

Agent Stats:
- ALP (Annual Life Premium): $${agentStats.alp?.toFixed(0) || 0}
- Presentations: ${agentStats.presentations || 0}
- Deals Closed: ${agentStats.deals || 0}
- Closing Rate: ${agentStats.closingRate?.toFixed(1) || 0}%

Team Averages:
- ALP: $${teamAverages.alp?.toFixed(0) || 0}
- Presentations: ${teamAverages.presentations?.toFixed(1) || 0}
- Deals: ${teamAverages.deals?.toFixed(1) || 0}
- Closing Rate: ${teamAverages.closingRate?.toFixed(1) || 0}%

Provide a 3-4 sentence analysis: highlight their strongest metric vs team, identify the one area to improve, and give ONE specific tip to climb the rankings.`;
        break;
      }

      case 'recruiter_insights': {
        const s = (body as RecruiterInsightsRequest).stats;
        systemPrompt = `You are a recruiting operations analyst for an insurance agency. You help recruiters prioritize their day by analyzing pipeline data and suggesting specific actions. Be direct, actionable, and motivational. Use bullet points and emojis.`;
        
        const breakdownStr = Object.entries(s.pipelineBreakdown).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
        userPrompt = `Generate a daily recruiter brief based on this data:

Total Active Leads: ${s.totalLeads}
Needs Contact (48h+): ${s.needsContact}
Overdue Follow-ups: ${s.overdueFollowups}
Hot Leads (score 70+): ${s.hotLeads}
At-Risk Leads (score <40): ${s.atRisk}
In Progress (licensing): ${s.inProgress}
New This Week: ${s.newThisWeek}
Contact Rate: ${s.contactRate}%
License Conversion Rate: ${s.licenseRate}%

Pipeline Breakdown:
${breakdownStr}

Provide:
1. A 2-3 sentence executive summary of pipeline health
2. Top 3 priorities for today (numbered, specific actions)
3. One motivational insight based on the data`;
        break;
      }

      case 'weekly_digest': {
        const wd = (body as WeeklyDigestRequest).stats;
        systemPrompt = `You are a senior business analyst for an insurance agency. Generate a comprehensive weekly executive summary that an agency owner would review. Be data-driven, highlight wins, flag concerns, and provide strategic recommendations. Use emojis for visual appeal. Format with clear sections.`;

        userPrompt = `Generate a weekly executive summary report for this insurance agency:

PRODUCTION METRICS (This Week):
- Total ALP: $${wd.weekAlp.toLocaleString()}
- Total Deals Closed: ${wd.weekDeals}
- Total Presentations: ${wd.weekPresentations}
- Closing Rate: ${wd.closingRate}%
- Active Producers: ${wd.producersCount}

TEAM METRICS:
- Active Agents: ${wd.activeAgents}

RECRUITMENT PIPELINE:
- Total Active Applications: ${wd.totalApps}
- New This Week: ${wd.newThisWeek}
- Currently In Course: ${wd.inCourse}
- In Test Phase: ${wd.testPhase}
- Licensed: ${wd.licensedCount}
- Overdue Follow-Ups (48h+): ${wd.overdueCount}

Provide:
1. 📊 Executive Summary (3-4 sentences on overall agency health)
2. 🏆 Wins This Week (what went well)
3. ⚠️ Areas of Concern (flagged issues)
4. 📋 Top 3 Strategic Recommendations for next week
5. 📈 Key Ratios (conversion rate, production per agent, etc.)`;
        break;
      }

      default:
        throw new Error('Invalid request type');
    }

    const messages = body.type === 'chat' 
      ? [
          { role: 'system', content: systemPrompt },
          ...body.messages.map(m => ({ role: m.role, content: m.content }))
        ]
      : [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ];

    console.log('Calling Lovable AI Gateway...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add more credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || 'No response generated.';

    console.log('AI response received successfully');

    return new Response(
      JSON.stringify({ content }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('AI Assistant error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

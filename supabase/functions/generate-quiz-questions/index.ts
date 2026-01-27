import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

interface GenerateRequest {
  moduleId: string;
  moduleTitle: string;
  moduleDescription?: string;
  topicKeywords?: string[];
}

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
    console.log('Generate quiz questions request from user:', userId);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const body: GenerateRequest = await req.json();
    const { moduleId, moduleTitle, moduleDescription, topicKeywords } = body;
    
    if (!moduleId || !moduleTitle) {
      return new Response(
        JSON.stringify({ error: 'moduleId and moduleTitle are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating quiz questions for module:', moduleTitle);

    const systemPrompt = `You are an expert training content creator for insurance sales agents. 
Your task is to generate quiz questions that test understanding of training video content.
Create questions that are:
- Practical and relevant to day-to-day sales activities
- Clear and unambiguous with one definitively correct answer
- Progressively challenging (start easier, end harder)
- Testing comprehension, not just memorization`;

    const userPrompt = `Generate exactly 5 multiple-choice quiz questions for the training module titled "${moduleTitle}".

Module Description: ${moduleDescription || 'No description provided'}
Topic Keywords: ${topicKeywords?.join(', ') || 'sales, insurance, training'}

Requirements:
- Each question should have exactly 4 answer options
- One option must be clearly correct
- Include a brief explanation for why the correct answer is right
- Questions should test practical understanding, not trivia
- Make questions challenging but fair

Return the questions in valid JSON format.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'return_quiz_questions',
              description: 'Return the generated quiz questions',
              parameters: {
                type: 'object',
                properties: {
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        question: { type: 'string', description: 'The quiz question' },
                        options: { 
                          type: 'array', 
                          items: { type: 'string' },
                          description: 'Exactly 4 answer options'
                        },
                        correct_answer: { 
                          type: 'number', 
                          description: 'Index of correct answer (0-3)' 
                        },
                        explanation: { 
                          type: 'string', 
                          description: 'Brief explanation of why the answer is correct' 
                        }
                      },
                      required: ['question', 'options', 'correct_answer', 'explanation']
                    }
                  }
                },
                required: ['questions']
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'return_quiz_questions' } }
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
    console.log('AI response received');

    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'return_quiz_questions') {
      throw new Error('Invalid AI response format');
    }

    const questionsData = JSON.parse(toolCall.function.arguments);
    const questions: QuizQuestion[] = questionsData.questions;

    if (!questions || questions.length === 0) {
      throw new Error('No questions generated');
    }

    console.log(`Generated ${questions.length} questions for module ${moduleTitle}`);

    return new Response(
      JSON.stringify({ 
        moduleId,
        moduleTitle,
        questions 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Generate quiz questions error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { GoogleGenAI, Type } from "@google/genai";

const apiKey = (import.meta.env?.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string) || "";

if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing. AI features will not work until you set VITE_GEMINI_API_KEY in your environment.");
}

const ai = new GoogleGenAI({ apiKey });
const MODEL_NAME = "gemini-3-flash-preview";

export interface Skill {
  name: string;
  proficiency: number; // 0-100
  gapDescription: string;
  resumeNotes: string;
  industryBenchmark: number; // 0-100 (Average for this role/level)
  isVerified?: boolean;
}

export interface LearningStep {
  topic: string;
  resource: string;
  url: string;
  estimate: string;
  cost: string;
  prerequisites: string;
  rating?: 'helpful' | 'unhelpful';
}

export async function analyzeCareer(jd: string, resume: string): Promise<{ skills: Skill[], plan: LearningStep[] }> {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Act as an expert technical recruiter and career coach. 
    Analyze this Job Description and the candidate's Resume to provide a comprehensive proficiency gap analysis and learning roadmap.

    STEP 1: Identify 6-10 core technical competencies or tools required by the Job Description. Group related technologies if necessary (e.g., "Fullstack Development" or "Cloud Infrastructure").
    STEP 2: For each identified skill, analyze the candidate's Resume. Look for direct mentions, synonyms, or related experience (e.g., if JD asks for 'Tailwind', but resume has 'Advanced CSS' and 'Bootstrap', they have foundational proficiency).
    STEP 3: Score the candidate (0-100) based on the "Practical Probability" that they could perform the task.
    - 0-10: Truly no related background.
    - 11-40: Indirect experience or foundational knowledge in related tools.
    - 41-70: Direct entry-level or mid-level professional experience.
    - 71-100: Demonstrated mastery or repeated complex applications.
    STEP 4: Generate a personalized learning plan for gaps < 80.

    JD: ${jd}
    RESUME: ${resume}

    IMPORTANT: Do not be overly pedantic with keywords. If a candidate knows "React", they likely understand "Virtual DOM" and "JSX". If they know "PostgreSQL", they have "SQL" and "RDBMS" proficiency. Give credit for related experience.
    Return a JSON object with "skills" and "plan". Be fair and look for implicit evidence.`,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          skills: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                proficiency: { type: Type.NUMBER },
                gapDescription: { type: Type.STRING },
                resumeNotes: { type: Type.STRING },
                industryBenchmark: { type: Type.NUMBER }
              },
              required: ["name", "proficiency", "gapDescription", "resumeNotes", "industryBenchmark"]
            }
          },
          plan: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                resource: { type: Type.STRING },
                url: { type: Type.STRING },
                estimate: { type: Type.STRING },
                cost: { type: Type.STRING },
                prerequisites: { type: Type.STRING }
              },
              required: ["topic", "resource", "url", "estimate", "cost", "prerequisites"]
            }
          }
        },
        required: ["skills", "plan"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return {
      skills: data.skills || [],
      plan: data.plan || []
    };
  } catch (e) {
    console.error("Failed to parse full assessment", e);
    return { skills: [], plan: [] };
  }
}

export async function chatWithAgent(messages: {role: 'user' | 'assistant', content: string}[], skills: Skill[], plan: LearningStep[], currentScore: number, questionCount: number) {
  const isAtLimit = questionCount >= 5;
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `You are Talent Hack, a friendly and expert career growth co-pilot and mentor. Your goal is to help the candidate prepare for their dream role through a collaborative and engaging technical conversation.
    
    CONTEXTUAL DATA:
    1. Proficiency Map: ${JSON.stringify(skills)}
    2. Recommended Learning Path: ${JSON.stringify(plan)}
    3. Current Assessment Score: ${currentScore}%
    4. Questions Answered So Far: ${questionCount}/5
    
    GUIDELINES:
    - BE CONVERSATIONAL: While you are evaluating skills, don't just be an automated test. Act like a mentor having a coffee-shop technical discussion. 
    - PERSONALIZED FEEDBACK: First, provide EXTREMELY BRIEF (1 sentence), ENCOURAGING feedback on the user's previous answer. Mention specific technical strengths or areas for nuance.
    - DUAL ROLE: Balance your mission as a "Neural Interviewer" with a helpful chatbot persona. If the user asks general questions, seeks career advice, or wants clarification, answer them warmly and helpfully.
    - PROACTIVE INTERVIEWER: Gently steer the conversation back to verifying proficiency in the Skill Mesh when appropriate.
    
    TASK EXECUTION:
    - Respond to the user's last message concisely, warmly, and technically.
    ${isAtLimit ? `
    - 5-QUESTION LIMIT REACHED: You have asked 5 probe questions. 
    - DO NOT ask another technical interview question.
    - Instead, summarize their primary strengths demonstrated, state their current score (${currentScore}%), and ask: "Would you like to keep chatting to improve your score further, or shall we move on to exploring your personalized learning roadmap?"
    ` : `
    - INTERVIEW MODE: Aim to probe the candidate's deep technical knowledge.
    - At the end of your response, ask ONE high-signal technical question about a specific skill (prioritize lower-scored ones). Use conversational transitions (e.g., "Thinking about that architecture, how would you handle...").
    `}
    - DYNAMIC EVALUATION: Look for signs of mastery (edge cases, trade-offs). Update skills in the "updates" field accordingly.
    - BE FAIR & GENEROUS: Give 10-30 point boosts for excellent responses. If they admit a gap, acknowledge it as a growth opportunity and offer to explain.
    
    RESPONSE FORMAT:
    Your response must be a valid JSON object with two fields:
    1. "message": Your text response to the user.
    2. "updates": (Optional) An array of objects: { "skillName": string, "proficiency": number (0-100), "reason": string }
    
    Example:
    {
      "message": "That's a great point about React hooks. Based on our discussion, I've updated your proficiency.",
      "updates": [{ "skillName": "React.js", "proficiency": 95, "reason": "Demonstrated advanced knowledge of custom hooks and memoization." }]
    }

    Conversation History:
    ${messages.map(m => `${m.role}: ${m.content}`).join('\n')}
    
    Assistant, focus your "message" on the last user input.`,
    config: {
      temperature: 0.7,
      responseMimeType: "application/json"
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return data;
  } catch (e) {
    return { message: response.text || "I'm having trouble processing that request.", updates: [] };
  }
}

export interface RoadmapItem {
  period: string;
  tasks: {
    title: string;
    description: string;
    duration: string;
  }[];
}

export async function generateRoadmap(skills: Skill[], plan: LearningStep[], duration: string): Promise<RoadmapItem[]> {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Act as a career mentor. Create a detailed, personalized learning roadmap based on the candidate's skill gaps and recommended learning steps.
    
    SKILL GAPS: ${JSON.stringify(skills.filter(s => s.proficiency < 80))}
    LEARNING STEPS: ${JSON.stringify(plan)}
    REQUESTED DURATION: ${duration}
    
    TASK:
    - Breakdown the learning plan into a structured timeline.
    - If duration is <= 2 weeks, provide a DAILY breakdown.
    - If duration is > 2 weeks, provide a WEEKLY breakdown.
    - Each period (Day X or Week X) should have specific tasks with titles, descriptions, and estimated durations.
    - Focus on bridging the most critical gaps first.
    
    Return a JSON array of objects: { "period": string, "tasks": [ { "title": string, "description": string, "duration": string } ] }`,
    config: {
      temperature: 0.5,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            period: { type: Type.STRING },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  duration: { type: Type.STRING }
                },
                required: ["title", "description", "duration"]
              }
            }
          },
          required: ["period", "tasks"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse roadmap", e);
    return [];
  }
}

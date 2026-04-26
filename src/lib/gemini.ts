import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
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

export async function chatWithAgent(messages: {role: 'user' | 'assistant', content: string}[], skills: Skill[], plan: LearningStep[]) {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `You are Catalyst AI, a career growth agent. Help the candidate prepare for their role. 
    
    CONTEXTUAL DATA:
    1. Proficiency Map: ${JSON.stringify(skills)}
    2. Recommended Learning Path: ${JSON.stringify(plan)}
    
    TASK:
    - Respond to the user's last message concisely and technically.
    - PROACTIVE INTERVIEWER: Your primary goal is to verify the candidate's proficiency in the skills listed in the Proficiency Map. 
    - You are a "Neural Interviewer". Your mission is to probe the candidate's deep technical knowledge through a structured, conversational interview.
    - At the end of your response, ask ONE high-signal technical question about a specific skill (prioritize lower-scored ones).
    - DYNAMIC EVALUATION: As the user responds, look for signs of true domain expertise (e.g., mentioning edge cases, architectural trade-offs, specific performance optimizations).
    - REFINED ASSESSMENT: If the user demonstrates proficiency during this conversation, you MUST provide an update to their skills map in the "updates" field.
    - FINAL SCORE IMPACT: Your updates will directly influence the candidate's "Verified Neural Score".
    - BE FAIR: If they explain a complex concept correctly, give them a score boost (20-40 points). If they admit ignorance, keep the score as is but offer a learning path.
    
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

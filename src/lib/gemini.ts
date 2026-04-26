import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const MODEL_NAME = "gemini-3-flash-preview";

export interface Skill {
  name: string;
  proficiency: number; // 0-100
  gapDescription: string;
  resumeNotes: string;
  industryBenchmark: number; // 0-100 (Average for this role/level)
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

export async function extractSkillsFromJD(jd: string) {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Extract a list of required technical skills from this Job Description. Return ONLY a JSON array of strings.
    JD: ${jd}`,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });
  
  try {
    return JSON.parse(response.text || "[]") as string[];
  } catch (e) {
    console.error("Failed to parse skills from JD", e);
    return [];
  }
}

export async function assessSkillProficiency(resume: string, jdSkills: string[]) {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Act as a precise, deterministic Skill Assessment Agent. 
    Analyze this candidate's resume against these required skills: ${jdSkills.join(", ")}.
    
    SCORING RUBRIC:
    - 0-20: No mention or evidence of the skill.
    - 21-50: Mentioned once but no context or shallow project use.
    - 51-75: Clear evidence of professional use or solid project implementation.
    - 76-90: Deep technical knowledge, multiple projects, or advanced certifications.
    - 91-100: Expert/Architect level with significant leadership or complex optimization evidence.

    Provide proficiency levels (0-100), gaps, and specific evidence found in the resume.
    Provide an 'industryBenchmark' (0-100) for each skill.
    
    IMPORTANT: You must be extremely consistent. Identify exactly the same scores for the same resume and skills every single time.`,
    config: {
      systemInstruction: "You are a specialized scoring engine for technical recruiters. Your evaluations are objective, data-driven, and perfectly reproducible.",
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
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
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]") as Skill[];
  } catch (e) {
    console.error("Failed to assess proficiency", e);
    return [];
  }
}

export async function generateLearningPlan(gaps: Skill[]) {
  if (gaps.length === 0) return [];
  
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Find high-quality, free or paid learning resources for these skill gaps: ${gaps.map(g => g.name).join(", ")}.
    
    For each gap, provide:
    - topic: A concrete, actionable learning objective.
    - resource: The specific name of a reputable course or documentation.
    - url: A direct, functional URL. USE THE SEARCH TOOL to find real, current documentation or course pages.
    - estimate: Realistic time commitment.
    - cost: Estimated price (e.g., "Free", "$29/mo", "$49 once").
    - prerequisites: Brief mention of what knowledge is needed before starting (e.g., "Basic JavaScript").`,
    config: {
      temperature: 0,
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
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
    }
  });

  try {
    return JSON.parse(response.text || "[]") as LearningStep[];
  } catch (e) {
    console.error("Failed to generate learning plan", e);
    return [];
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
    - REFINED ASSESSMENT: If the user demonstrates proficiency or clarifies a gap during this conversation, you MUST provide an update to their skills map.
    
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

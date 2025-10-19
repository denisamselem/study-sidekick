import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY; // backwards-compat
if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not found in environment variables");
}

export const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

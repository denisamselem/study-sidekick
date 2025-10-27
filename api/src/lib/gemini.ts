import { GoogleGenAI } from '@google/genai';

if (!process.env.API_KEY) {
    throw new Error("API_KEY not found in environment variables");
}

export const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

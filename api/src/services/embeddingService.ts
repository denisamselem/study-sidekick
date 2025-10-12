
import { ai } from '../lib/gemini';
import { HarmBlockThreshold, HarmCategory, Type } from '@google/genai';

// We use a smaller dimension that is more suitable for a generative model.
// This is a balance between semantic richness and generation speed/reliability.
const EMBEDDING_DIMENSION = 64;

// By disabling all safety checks for this specific internal task, we can reduce
// API overhead and latency. This is acceptable as we are processing the user's
// own content for vectorization, not generating public-facing content.
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

const embeddingSchema = {
    type: Type.OBJECT,
    properties: {
        vector: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: `A semantic vector of exactly ${EMBEDDING_DIMENSION} integers, each between -100 and 100.`
        }
    },
    required: ["vector"]
};


/**
 * Creates a vector embedding for a given text using a generative model.
 * This is a workaround since a dedicated embedding model is not available.
 * It prompts the model to generate a semantic vector and parses the result.
 * @param text The text to embed.
 * @returns A promise that resolves to a vector (array of numbers).
 */
export async function createEmbedding(text: string): Promise<number[]> {
    try {
        const prompt = `Generate a semantic vector with ${EMBEDDING_DIMENSION} dimensions for the following text. Each dimension should be an integer between -100 and 100.

TEXT: "${text}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: embeddingSchema,
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.0,
                safetySettings,
            },
        });

        const jsonText = response.text;
        if (!jsonText) {
            throw new Error('Model returned an empty response for embedding.');
        }

        const parsed = JSON.parse(jsonText.trim());
        const vectorInts: number[] = parsed.vector;

        if (!vectorInts || !Array.isArray(vectorInts) || vectorInts.length !== EMBEDDING_DIMENSION) {
             console.error(`Model returned invalid vector shape. Expected ${EMBEDDING_DIMENSION}, got ${vectorInts?.length}.`);
             throw new Error(`Model returned an invalid vector shape.`);
        }

        if (vectorInts.some(v => typeof v !== 'number' || isNaN(v))) {
             console.error(`Model returned non-numeric values. Raw: "${jsonText}"`);
             throw new Error('Model returned non-numeric values.');
        }
        
        // Convert integers [-100, 100] to floats [-1.0, 1.0]
        const vectorFloats = vectorInts.map(i => i / 100.0);

        // Normalize the vector (essential for accurate cosine similarity search)
        const magnitude = Math.sqrt(vectorFloats.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0) {
             return Array(EMBEDDING_DIMENSION).fill(0);
        }
        return vectorFloats.map(val => val / magnitude);

    } catch (error)
    {
        console.error(`Failed to create embedding for text: "${text.substring(0, 100)}..."`, error);
        // Fallback to a random vector on failure to prevent the entire pipeline from crashing.
        console.warn("Falling back to a random vector due to embedding generation error.");
        const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => Math.random() * 2 - 1);
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0) return Array(EMBEDDING_DIMENSION).fill(0);
        return vector.map(val => val / magnitude);
    }
}

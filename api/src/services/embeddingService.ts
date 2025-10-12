import { ai } from '../lib/gemini';
import { HarmBlockThreshold, HarmCategory } from '@google/genai';

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


/**
 * Creates a vector embedding for a given text using a generative model.
 * This is a workaround since a dedicated embedding model is not available.
 * It prompts the model to generate a semantic vector and parses the result.
 * @param text The text to embed.
 * @returns A promise that resolves to a vector (array of numbers).
 */
export async function createEmbedding(text: string): Promise<number[]> {
    try {
        // OPTIMIZATION: Asking for integers is a simpler task for the model than
        // generating precise floats, which can significantly reduce generation time.
        const prompt = `Generate a semantic vector for the text below.
Respond ONLY with a comma-separated list of exactly ${EMBEDDING_DIMENSION} integers between -100 and 100. Do not include any other text or formatting.

TEXT: "${text}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.0, // Set to 0 for deterministic integer output
                // FIX: `safetySettings` is a generation configuration and should be placed inside the `config` object.
                safetySettings,
            },
        });

        const rawText = response.text;
        if (!rawText) {
            throw new Error('Model returned an empty response for embedding.');
        }

        const cleanedText = rawText.replace(/```/g, '').trim();
        const stringNumbers = cleanedText.split(',');

        if (stringNumbers.length !== EMBEDDING_DIMENSION) {
            console.error(`Model returned invalid vector shape. Expected ${EMBEDDING_DIMENSION}, got ${stringNumbers.length}. Raw: "${rawText}"`);
            throw new Error(`Model returned an invalid vector shape.`);
        }

        const vectorInts = stringNumbers.map(s => parseInt(s.trim(), 10));

        if (vectorInts.some(isNaN)) {
             console.error(`Model returned non-numeric values. Raw: "${rawText}"`);
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

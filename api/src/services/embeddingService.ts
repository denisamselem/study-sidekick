import { ai } from '../lib/gemini';
import { Type } from '@google/genai';

// We use a smaller dimension that is more suitable for a generative model.
// This is a balance between semantic richness and generation speed/reliability.
const EMBEDDING_DIMENSION = 64;

// Define the JSON schema we expect the model to return.
const embeddingSchema = {
    type: Type.OBJECT,
    properties: {
        embedding: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            description: `A vector of ${EMBEDDING_DIMENSION} numbers representing the text's semantic meaning.`
        }
    },
    required: ["embedding"]
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
        const prompt = `Generate a semantic vector embedding for the following text. The vector should capture the core meaning of the text and must be an array of exactly ${EMBEDDING_DIMENSION} floating-point numbers between -1 and 1.

        TEXT: "${text}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: embeddingSchema,
                // Disable thinking for this task, as we want a direct, fast transformation
                thinkingConfig: { thinkingBudget: 0 }, 
                // Lower temperature for more deterministic, less "creative" vectors
                temperature: 0.2 
            },
        });

        const jsonText = response.text;
        if (!jsonText) {
            throw new Error('Model returned an empty response for embedding.');
        }

        const parsed = JSON.parse(jsonText.trim());
        
        if (!parsed.embedding || !Array.isArray(parsed.embedding) || parsed.embedding.length !== EMBEDDING_DIMENSION) {
             console.error('Model returned invalid vector shape.', parsed);
             throw new Error(`Model returned an invalid vector shape. Expected ${EMBEDDING_DIMENSION} dimensions.`);
        }

        const vector: number[] = parsed.embedding;

        // Normalize the vector (essential for accurate cosine similarity search)
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0) {
             // Return a zero-vector if magnitude is zero to avoid division by zero
             return Array(EMBEDDING_DIMENSION).fill(0);
        }
        return vector.map(val => val / magnitude);

    } catch (error) {
        console.error(`Failed to create embedding for text: "${text.substring(0, 100)}..."`, error);
        // Fallback to a random vector on failure to prevent the entire pipeline from crashing.
        // This makes the system more resilient if the model occasionally fails to generate a valid vector.
        console.warn("Falling back to a random vector due to embedding generation error.");
        const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => Math.random() * 2 - 1);
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        // Avoid division by zero for the random vector as well
        if (magnitude === 0) return Array(EMBEDDING_DIMENSION).fill(0);
        return vector.map(val => val / magnitude);
    }
}

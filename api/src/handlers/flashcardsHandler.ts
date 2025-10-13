
import { RequestHandler } from 'express';
import { queryRelevantChunks } from '../services/ragService.js';
import { ai } from '../lib/gemini.js';
import { Type } from '@google/genai';

const flashcardsSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            front: { type: Type.STRING },
            back: { type: Type.STRING }
        },
        required: ["front", "back"]
    }
};

export const handleFlashcards: RequestHandler = async (req, res) => {
    const { documentIds } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ message: 'documentIds array is required.' });
    }

     try {
        const contextChunks = await queryRelevantChunks(documentIds, "key terms, definitions, and important facts", 15);
        const contextText = contextChunks.map(c => c.content).join('\n\n---\n\n');

        const prompt = `Based on the following document context, generate a set of 10-15 flashcards. Create a mix of question/answer and fill-in-the-blank styles.

CONTEXT:
---
${contextText}
---
`;
        const model = 'gemini-2.5-flash';
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: flashcardsSchema,
            },
        });

        const jsonText = response.text;
        if (!jsonText) {
            throw new Error('Failed to generate flashcards: model response was empty.');
        }
        res.status(200).json(JSON.parse(jsonText.trim()));

    } catch (error) {
        console.error('Error generating flashcards:', error);
        res.status(500).json({ message: 'Failed to generate flashcards.' });
    }
};

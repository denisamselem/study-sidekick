import { RequestHandler } from 'express';
import { queryRelevantChunks } from '../services/ragService';
import { ai } from '../lib/gemini';
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
    const { documentId } = req.body;

    if (!documentId) {
        return res.status(400).json({ message: 'documentId is required.' });
    }

     try {
        const contextChunks = await queryRelevantChunks(documentId, "key terms, definitions, and important facts", 15);
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

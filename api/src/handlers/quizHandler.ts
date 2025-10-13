
import { RequestHandler } from 'express';
import { getRepresentativeChunks } from '../services/ragService.js';
import { ai } from '../lib/gemini.js';
import { Type } from '@google/genai';

const quizSchema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING },
        questions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    questionText: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING }
                },
                required: ["questionText", "options", "correctAnswer"]
            }
        }
    },
    required: ["title", "questions"]
};

export const handleQuiz: RequestHandler = async (req, res) => {
    const { documentIds } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ message: 'documentIds array is required.' });
    }

    try {
        const contextChunks = await getRepresentativeChunks(documentIds, 10);
        const contextText = contextChunks.map(c => c.content).join('\n\n---\n\n');

        const prompt = `Based on the following document context, which is composed of text from multiple sources, generate a multiple-choice quiz with a title and around 5-10 questions. Ensure the quiz covers topics from the various sources. Each question should have 4 options and one correct answer.

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
                responseSchema: quizSchema,
            },
        });

        const jsonText = response.text;
        if (!jsonText) {
            throw new Error('Failed to generate quiz: model response was empty.');
        }
        res.status(200).json(JSON.parse(jsonText.trim()));

    } catch (error) {
        console.error('Error generating quiz:', error);
        res.status(500).json({ message: 'Failed to generate quiz.' });
    }
};
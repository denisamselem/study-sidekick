import { Request, Response } from 'express';
import { queryRelevantChunks } from '../services/ragService';
import { ai } from '../lib/gemini';
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

export async function handleQuiz(req: Request, res: Response) {
    const { documentId } = req.body;

    if (!documentId) {
        return res.status(400).json({ message: 'documentId is required.' });
    }

    try {
        // For a quiz, we retrieve a larger context from the document.
        // We use a generic query to get a broad selection of chunks.
        const contextChunks = await queryRelevantChunks(documentId, "key concepts and main ideas", 10);
        const contextText = contextChunks.map(c => c.content).join('\n\n---\n\n');

        const prompt = `Based on the following document context, generate a multiple-choice quiz with a title and around 5-10 questions. Each question should have 4 options and one correct answer.

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

        const jsonText = response.text.trim();
        res.status(200).json(JSON.parse(jsonText));

    } catch (error) {
        console.error('Error generating quiz:', error);
        res.status(500).json({ message: 'Failed to generate quiz.' });
    }
}

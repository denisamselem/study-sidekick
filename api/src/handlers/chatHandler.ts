
import { RequestHandler } from 'express';
import { z } from 'zod';
import { queryRelevantChunks } from '../services/ragService.js';
import { ai } from '../lib/gemini.js';
import { Message } from '../../../types.js'; 

const ChatSchema = z.object({
    documentIds: z.array(z.string().uuid()).min(1),
    history: z.array(z.object({
        role: z.enum(['user', 'model']),
        text: z.string(),
        sources: z.array(z.object({ content: z.string() })).optional(),
    })).default([]),
    message: z.string().min(1)
});

export const handleChat: RequestHandler = async (req, res) => {
    const parse = ChatSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ message: 'Invalid request', details: parse.error.flatten() });
    }
    const { documentIds, history, message } = parse.data;
    
    try {
        const contextChunks = await queryRelevantChunks(documentIds, message);
        const contextText = contextChunks.map(c => c.content).join('\n\n---\n\n');

        const model = 'gemini-2.5-flash';
        const historyText = history.map(m => `${m.role}: ${m.text}`).join('\n');

        const systemInstruction = `You are an expert study assistant. Your task is to answer questions based *only* on the provided context below. Do not use any external knowledge. If the answer is not in the context, say that you cannot find the answer in the document.

Here is the relevant context from the study material:
---
${contextText}
---

Here is the current conversation history:
---
${historyText}
---
`;

        const response = await ai.models.generateContent({
            model: model,
            contents: message,
            config: {
                systemInstruction: systemInstruction,
            }
        });

        const text = response.text;
        if (!text) {
             return res.status(200).json({ text: "I'm sorry, I couldn't generate a response based on the provided context.", sources: contextChunks });
        }

        res.status(200).json({ text, sources: contextChunks });

    } catch (error) {
        console.error('Error in chat handler:', error);
        res.status(500).json({ message: 'Failed to get chat response.' });
    }
};

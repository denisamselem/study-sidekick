import { RequestHandler } from 'express';
import { queryRelevantChunks } from '../services/ragService.js';
import { ai } from '../lib/gemini.js';
import { Message } from '../../../types.js'; 

export const handleChat: RequestHandler = async (req, res) => {
    const { documentId, history, message } = req.body as { documentId: string; history: Message[]; message: string };

    if (!documentId || !message) {
        return res.status(400).json({ message: 'documentId and message are required.' });
    }
    
    try {
        const contextChunks = await queryRelevantChunks(documentId, message);
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
import { Message, Quiz, Flashcard, Source } from '../types';

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || 'An unknown error occurred');
    }
    return response.json() as Promise<T>;
}

export const startProcessing = async (filePath: string, mimeType: string): Promise<{ jobId: string, documentId: string, totalChunks: number }> => {
    const response = await fetch('/api/process/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, mimeType }),
    });
    return handleResponse<{ jobId: string, documentId: string, totalChunks: number }>(response);
};

export const processBatch = async (jobId: string, startIndex: number, batchSize: number): Promise<{ success: boolean }> => {
    const response = await fetch('/api/process/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, startIndex, batchSize }),
    });
    return handleResponse<{ success: boolean }>(response);
};

export const finishProcessing = async (jobId: string): Promise<{ success: boolean }> => {
     const response = await fetch('/api/process/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
    });
    return handleResponse<{ success: boolean }>(response);
};


export const postMessage = async (documentId: string, history: Message[], message: string): Promise<{ text: string, sources: Source[] }> => {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, history, message }),
    });
    return handleResponse<{ text: string, sources: Source[] }>(response);
};

export const fetchQuiz = async (documentId: string): Promise<Quiz> => {
    const response = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
    });
    return handleResponse<Quiz>(response);
};

export const fetchFlashcards = async (documentId: string): Promise<Flashcard[]> => {
    const response = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
    });
    return handleResponse<Flashcard[]>(response);
};

import { Message, Quiz, Flashcard, Source } from '../types';

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || 'An unknown error occurred');
    }
    return response.json() as Promise<T>;
}

export const processTextDocument = async (text: string, fileName: string): Promise<{ documentId: string }> => {
    const response = await fetch('/api/document/process-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName }),
    });
    return handleResponse<{ documentId: string }>(response);
};

export const getDocumentStatus = async (documentId: string): Promise<{ isReady: boolean; isFinished: boolean; hasFailed: boolean; progress: number; message?: string }> => {
    const response = await fetch(`/api/document/status/${documentId}`);
    return handleResponse<{ isReady: boolean; isFinished: boolean; hasFailed: boolean; progress: number; message?: string }>(response);
};

export const postMessage = async (documentIds: string[], history: Message[], message: string): Promise<{ text: string, sources: Source[] }> => {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds, history, message }),
    });
    return handleResponse<{ text: string, sources: Source[] }>(response);
};

export const fetchQuiz = async (documentIds: string[]): Promise<Quiz> => {
    const response = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
    });
    return handleResponse<Quiz>(response);
};

export const fetchFlashcards = async (documentIds: string[]): Promise<Flashcard[]> => {
    const response = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
    });
    return handleResponse<Flashcard[]>(response);
};

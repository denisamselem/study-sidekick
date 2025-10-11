import { Message, Quiz, Flashcard, Source } from '../types';

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || 'An unknown error occurred');
    }
    return response.json() as Promise<T>;
}

export const uploadDocument = async (file: File): Promise<{ documentId: string }> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
    });
    return handleResponse<{ documentId: string }>(response);
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

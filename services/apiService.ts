import { Message, Quiz, Flashcard, Source } from '../types';
import { getSupabase } from './supabaseClient';
import { v4 as uuidv4 } from 'uuid';

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || 'An unknown error occurred');
    }
    return response.json() as Promise<T>;
}

export const uploadDocument = async (file: File): Promise<{ documentId: string }> => {
    const supabase = await getSupabase();

    // 1. Upload file directly to Supabase Storage to bypass Vercel's 4.5MB limit
    const fileExt = file.name.split('.').pop();
    const filePath = `${uuidv4()}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
        .from('documents') // The public bucket we created
        .upload(filePath, file);

    if (uploadError) {
        console.error("Supabase upload error:", uploadError);
        throw new Error('Failed to upload file to storage.');
    }

    // 2. Call our backend to process the file now that it's in storage
    const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, mimeType: file.type }),
    });

    // 3. If backend processing fails, try to clean up the orphaned file from storage
    if (!response.ok) {
        await supabase.storage.from('documents').remove([filePath]);
    }

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

import { supabase } from '../lib/supabase';
import { createEmbedding } from './embeddingService';
import { v4 as uuidv4 } from 'uuid';
import { chunkText } from '../lib/textChunker';

/**
 * Inserts a batch of pre-embedded chunks into the database and returns the newly created chunks with their IDs.
 * @param chunksToInsert An array of chunk objects (without IDs) to be inserted.
 * @returns A promise that resolves to the array of inserted chunks, including their database-generated IDs.
 */
export async function insertChunks(chunksToInsert: { document_id: string, content: string, embedding: number[] | null, processing_status: 'PENDING' | 'COMPLETED' | 'FAILED' }[]): Promise<{ id: number }[]> {
    if (chunksToInsert.length === 0) {
        return [];
    }
    
    const { data, error } = await supabase
        .from('documents')
        .insert(chunksToInsert)
        .select('id');

    if (error) {
        console.error(`Error inserting chunk batch:`, error);
        throw new Error('Failed to insert document chunks into vector store.');
    }

    if (!data) {
        throw new Error('Insert operation failed to return the new document chunks.');
    }

    return data;
}

/**
 * Finds text chunks relevant to a given query.
 * @param documentId The ID of the document to search within.
 * @param queryText The user's query.
 * @param matchCount The number of chunks to retrieve.
 * @returns An array of relevant text chunks.
 */
export async function queryRelevantChunks(documentId: string, queryText: string, matchCount: number = 5): Promise<{content: string}[]> {
    const queryEmbedding = await createEmbedding(queryText);

    const { data, error } = await supabase.rpc('match_documents', {
        document_id_filter: documentId,
        query_embedding: queryEmbedding,
        match_count: matchCount,
    });

    if (error) {
        console.error('Error matching documents:', error);
        throw new Error('Failed to query for relevant chunks.');
    }

    return data;
}
/**
 * Processes a document's text, creates embeddings, and stores it.
 * @param text The text content of the document.
 * @returns The ID of the newly created document.
 */
export async function addDocument(text: string): Promise<string> {
    const documentId = uuidv4();
    const chunks = chunkText(text);

    if (chunks.length === 0) {
        return documentId;
    }

    const embeddingPromises = chunks.map(chunk => createEmbedding(chunk));
    const embeddings = await Promise.all(embeddingPromises);

    const chunksToInsert = chunks.map((content, index) => ({
        document_id: documentId,
        content,
        embedding: embeddings[index],
        processing_status: 'COMPLETED' as const,
    }));
    
    // We don't need the returned IDs here since this is a one-shot operation
    const { error } = await supabase.from('documents').insert(chunksToInsert);
    if (error) {
        console.error(`Error inserting document:`, error);
        throw new Error('Failed to insert document into vector store.');
    }


    return documentId;
}
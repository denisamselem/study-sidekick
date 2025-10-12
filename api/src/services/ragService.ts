import { supabase } from '../lib/supabase';
import { createEmbedding } from './embeddingService';
import { v4 as uuidv4 } from 'uuid';
import { chunkText } from '../lib/textChunker';

/**
 * Inserts a batch of pre-embedded chunks into the database.
 * @param chunksToInsert An array of chunk objects to be inserted.
 */
export async function insertChunks(chunksToInsert: {document_id: string, content: string, embedding: number[]}[]) {
    const { error } = await supabase
        .from('documents')
        .insert(chunksToInsert);

    if (error) {
        console.error(`Error inserting chunk batch:`, error);
        throw new Error('Failed to insert document chunks into vector store.');
    }
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

// FIX: Implement and export the missing 'addDocument' function to resolve import error in uploadHandler.ts.
/**
 * Processes a whole document: chunks, embeds, and inserts it into the database.
 * This is part of a legacy flow and the new client-driven batch processing is preferred.
 * @param text The text content of the document.
 * @returns The ID of the newly created document.
 */
export async function addDocument(text: string): Promise<string> {
    const documentId = uuidv4();
    const chunks = chunkText(text);

    const embeddingPromises = chunks.map(chunk => createEmbedding(chunk));
    const embeddings = await Promise.all(embeddingPromises);

    const chunksToInsert = chunks.map((chunk, index) => ({
        document_id: documentId,
        content: chunk,
        embedding: embeddings[index],
    }));

    await insertChunks(chunksToInsert);

    return documentId;
}

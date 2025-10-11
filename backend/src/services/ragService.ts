import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { createEmbedding } from './embeddingService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Processes and adds a document to the vector store.
 * @param text The text content of the document.
 * @returns The unique ID for the processed document.
 */
export async function addDocument(text: string): Promise<string> {
    const documentId = uuidv4();
    const chunks = chunkText(text);

    for (const chunk of chunks) {
        const embedding = await createEmbedding(chunk);
        
        const { error } = await supabase
            .from('documents')
            .insert({
                document_id: documentId,
                content: chunk,
                embedding: embedding,
            });

        if (error) {
            console.error('Error inserting chunk:', error);
            throw new Error('Failed to insert document chunk into vector store.');
        }
    }
    return documentId;
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

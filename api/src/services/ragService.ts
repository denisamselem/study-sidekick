import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { createEmbedding } from './embeddingService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Processes and adds a document to the vector store.
 * Chunks the text, generates embeddings in parallel batches, and inserts them into Supabase.
 * @param text The text content of the document.
 * @returns The unique ID for the processed document.
 */
export async function addDocument(text: string): Promise<string> {
    const documentId = uuidv4();
    const chunks = chunkText(text);
    // Process chunks in parallel batches to avoid serverless timeouts, especially on platforms like Vercel.
    const BATCH_SIZE = 5; 

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const chunkBatch = chunks.slice(i, i + BATCH_SIZE);
        
        // Generate embeddings for the current batch in parallel for efficiency.
        const embeddingPromises = chunkBatch.map(chunk => createEmbedding(chunk));
        const embeddings = await Promise.all(embeddingPromises);

        const documentsToInsert = chunkBatch.map((chunk, index) => ({
            document_id: documentId,
            content: chunk,
            embedding: embeddings[index],
        }));
        
        // Insert the prepared batch into Supabase.
        const { error } = await supabase
            .from('documents')
            .insert(documentsToInsert);

        if (error) {
            console.error(`Error inserting chunk batch starting at index ${i}:`, error);
            throw new Error('Failed to insert document chunks into vector store.');
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
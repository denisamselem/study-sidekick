
import { supabase } from '../lib/supabase.js';
import { createEmbedding } from './embeddingService.js';
import { v4 as uuidv4 } from 'uuid';
import { chunkText } from '../lib/textChunker.js';

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
 * Finds text chunks relevant to a given query across multiple documents.
 * @param documentIds The IDs of the documents to search within.
 * @param queryText The user's query.
 * @param matchCount The total number of chunks to retrieve.
 * @returns An array of relevant text chunks.
 */
export async function queryRelevantChunks(documentIds: string[], queryText: string, matchCount: number = 5): Promise<{content: string}[]> {
    if (!documentIds || documentIds.length === 0) {
        return [];
    }

    const queryEmbedding = await createEmbedding(queryText);
    
    // To get a balanced set of chunks from all documents, calculate how many to fetch from each.
    const countPerDoc = Math.max(1, Math.ceil(matchCount / documentIds.length));

    const chunkPromises = documentIds.map(docId => 
        supabase.rpc('match_documents', {
            document_id_filter: docId,
            query_embedding: queryEmbedding,
            match_count: countPerDoc,
        })
    );

    const results = await Promise.all(chunkPromises);
    
    let combinedChunks: {content: string}[] = [];
    for (const result of results) {
        if (result.error) {
            console.error(`Error querying chunks for a document: ${result.error.message}`);
            // Continue even if one document fails to return results
        } else if (result.data) {
            combinedChunks.push(...result.data);
        }
    }

    // Since we cannot re-rank without similarity scores from the current RPC, we just return the collection.
    // A simple slice can truncate if needed to respect the original matchCount intent.
    return combinedChunks.slice(0, matchCount);
}

/**
 * Fetches a representative sample of chunks from each document, bypassing vector search.
 * This is useful for broad tasks like generating a quiz from the entire corpus.
 * @param documentIds The IDs of the documents to sample from.
 * @param chunkCount The total number of chunks to retrieve.
 * @returns An array of text chunks.
 */
export async function getRepresentativeChunks(documentIds: string[], chunkCount: number = 10): Promise<{content: string}[]> {
    if (!documentIds || documentIds.length === 0) {
        return [];
    }
    
    const countPerDoc = Math.max(1, Math.ceil(chunkCount / documentIds.length));

    const chunkPromises = documentIds.map(async (docId) => {
        const { data, error } = await supabase
            .from('documents')
            .select('content')
            .eq('document_id', docId)
            .eq('processing_status', 'COMPLETED')
            .order('id', { ascending: true }) // Ensure we get the first chunks
            .limit(countPerDoc);
        
        if (error) {
            console.error(`Error fetching representative chunks for doc ${docId}:`, error);
            return []; // Return empty array on error for this doc
        }
        return data || [];
    });

    const results = await Promise.all(chunkPromises);
    
    // Flatten the array of arrays into a single array of chunks
    const combinedChunks = results.flat();

    return combinedChunks.slice(0, chunkCount);
}

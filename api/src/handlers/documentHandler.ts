import { Request, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { insertChunks } from '../services/ragService';
import { createEmbedding } from '../services/embeddingService';

// Use require for pdf-parse to ensure compatibility with CommonJS module format in various environments.
const pdf = require('pdf-parse');

/**
 * Derives the base URL of the current server from request headers or environment variables.
 * This is crucial for the server to reliably call its own "worker" endpoint.
 * @param req The Express request object.
 * @returns The full base URL (e.g., https://your-app.vercel.app)
 */
const getBaseUrl = (req: Request): string => {
    const baseUrlEnv = process.env.BASE_URL || process.env.VERCEL_URL;
    if (baseUrlEnv) {
        return baseUrlEnv.startsWith('http') ? baseUrlEnv : `https://${baseUrlEnv}`;
    }

    // FIX: The Express Request type definition is missing the `protocol` property, causing a type error.
    // Casting to `any` bypasses the erroneous type check, consistent with other workarounds for Express type issues in the project.
    const protocol = (req as any).headers['x-forwarded-proto'] || (req as any).protocol;
    const host = (req as any).get('host');
    if (!host) {
        throw new Error("Could not determine the host from request headers to build worker URL.");
    }
    return `${protocol}://${host}`;
}

/**
 * Attempts to download a file from Supabase storage with retry logic.
 * This helps mitigate race conditions where the download is attempted before the file is fully available.
 * @param path The path to the file in the storage bucket.
 * @param retries The number of times to retry the download.
 * @param delay The delay in milliseconds between retries.
 * @returns The downloaded file blob and error status.
 */
async function downloadWithRetry(path: string, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        const { data, error } = await supabase.storage.from('documents').download(path);
        if (!error && data) {
            return { data, error: null };
        }
        console.warn(`Attempt ${i + 1} to download ${path} failed. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    // If all retries fail, return the final attempt's result
    return await supabase.storage.from('documents').download(path);
}

/**
 * A utility function to retry an async operation with exponential backoff.
 * @param fn The async function to execute.
 * @param retries The maximum number of retries.
 * @param delay The initial delay in milliseconds.
 * @returns The result of the async function.
 */
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (i < retries - 1) {
                const backoffDelay = delay * Math.pow(2, i);
                console.warn(`Attempt ${i + 1} failed. Retrying in ${backoffDelay}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }
    }
    throw lastError;
}


/**
 * Processes a single chunk: fetches its content, generates an embedding, and updates it in the database.
 * This function now throws an error on failure after marking the chunk as FAILED.
 * @param chunkId The database ID of the chunk to process.
 * @param documentId The parent document ID, used for logging.
 */
async function _processChunkEmbedding(chunkId: number, documentId: string) {
    console.log(`[${documentId}] [CHUNK ${chunkId}] Starting embedding process.`);
    try {
        const { data: chunk, error: fetchError } = await supabase
            .from('documents')
            .select('content')
            .eq('id', chunkId)
            .single();

        if (fetchError || !chunk) {
            throw new Error(`[${documentId}] [CHUNK ${chunkId}] Could not find chunk content: ${fetchError?.message}`);
        }
        
        console.log(`[${documentId}] [CHUNK ${chunkId}] Content fetched. Calling createEmbedding...`);
        const embedding = await retry(() => createEmbedding(chunk.content, documentId, chunkId));

        const { error: updateError } = await supabase
            .from('documents')
            .update({ embedding: embedding, processing_status: 'COMPLETED' })
            .eq('id', chunkId);
        
        if (updateError) {
            throw new Error(`[${documentId}] [CHUNK ${chunkId}] Failed to update with embedding: ${updateError.message}`);
        }

        console.log(`[${documentId}] [CHUNK ${chunkId}] Successfully processed and saved embedding.`);

    } catch (error) {
        console.error(`[${documentId}] [CHUNK ${chunkId}] FATAL: Error during embedding process. Marking as FAILED. Details:`, error);
        await supabase.from('documents').update({ processing_status: 'FAILED' }).eq('id', chunkId);
        // Re-throw so the calling worker knows to stop the chain.
        throw error;
    }
}

/**
 * The worker endpoint handler. It processes one chunk from a list and then
 * triggers the next worker in the chain for the subsequent chunk.
 */
export const handleProcessChunk: RequestHandler = async (req, res) => {
    const { documentId, allChunkIds, currentIndex } = req.body;
    
    console.log(`[${documentId}] handleProcessChunk INVOKED for index: ${currentIndex}.`);

    if (!documentId || !allChunkIds || currentIndex === undefined) {
        console.error(`[${documentId}] handleProcessChunk received malformed request.`);
        return res.status(400).json({ message: 'documentId, allChunkIds, and currentIndex are required.' });
    }

    const chunkIdToProcess = allChunkIds[currentIndex];
    console.log(`[${documentId}] Processing chunk with DB ID: ${chunkIdToProcess} at index ${currentIndex}.`);

    try {
        await _processChunkEmbedding(chunkIdToProcess, documentId);
    } catch (error) {
        // If processing a chunk fails, we log it and stop the chain.
        console.error(`[${documentId}] Chain stopped at index ${currentIndex} due to failure processing chunk ${chunkIdToProcess}.`);
        // Return 200 OK because the worker itself completed its task (of attempting to process).
        // The failure is recorded in the DB, and the polling will reflect it.
        return res.status(200).json({ message: 'Chunk processing failed, chain stopped.' });
    }

    // Check if there are more chunks to process
    const nextIndex = currentIndex + 1;
    if (nextIndex < allChunkIds.length) {
        const baseUrl = getBaseUrl(req);
        const nextWorkerUrl = `${baseUrl}/api/document/process-chunk`;

        console.log(`[${documentId}] [CHUNK ${chunkIdToProcess}] Triggering next worker for index ${nextIndex} at URL: ${nextWorkerUrl}`);
        
        // Use an IIFE to handle the async fire-and-forget call robustly.
        (async () => {
            try {
                const response = await fetch(nextWorkerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentId, allChunkIds, currentIndex: nextIndex }),
                });
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Next worker trigger failed with status ${response.status}: ${errorBody}`);
                }
                console.log(`[${documentId}] Successfully triggered next worker for index ${nextIndex}.`);
            } catch (err: any) {
                console.error(`[${documentId}] CRITICAL: Failed to trigger next chunk processor for index ${nextIndex}. Error: ${err.message}`);
                const remainingChunkIds = allChunkIds.slice(nextIndex);
                if (remainingChunkIds.length > 0) {
                     supabase.from('documents')
                      .update({ processing_status: 'FAILED' })
                      .in('id', remainingChunkIds)
                      .then(({ error }) => {
                         if (error) console.error(`[${documentId}] Failed to mark remaining chunks as FAILED after trigger failure:`, error);
                         else console.log(`[${documentId}] Successfully marked ${remainingChunkIds.length} remaining chunks as FAILED.`);
                      });
                }
            }
        })();

    } else {
        console.log(`[${documentId}] All chunks processed. Chain complete for document ${documentId}.`);
    }

    res.status(200).json({ message: 'Chunk processed. Next worker in chain triggered if applicable.' });
};


/**
 * Orchestrates the document processing.
 * 1. Downloads file from storage.
 * 2. Extracts text and chunks it.
 * 3. Inserts all chunks into DB with a 'PENDING' status.
 * 4. Kicks off the FIRST worker in the chained execution.
 * 5. Returns immediately to the client with a 202 Accepted status.
 */
export const handleProcessDocument: RequestHandler = async (req, res) => {
    const { path, mimeType } = req.body;
    if (!path || !mimeType) {
        return res.status(400).json({ message: 'File path and mimeType are required.' });
    }

    const documentId = uuidv4();
    console.log(`[${documentId}] Starting document processing for path: ${path}`);

    try {
        // 1. Download and parse file, with retries
        console.log(`[${documentId}] Attempting to download file from storage...`);
        const { data: blob, error: downloadError } = await downloadWithRetry(path);
        if (downloadError || !blob) {
            throw new Error(`Could not download file from storage after retries: ${downloadError?.message || 'File blob is null.'}`);
        }
        console.log(`[${documentId}] File downloaded successfully. Size: ${blob.size} bytes.`);
        
        const fileBuffer = Buffer.from(await blob.arrayBuffer());

        console.log(`[${documentId}] Extracting text from mimeType: ${mimeType}`);
        let text = '';
        if (mimeType === 'application/pdf') {
            const data = await pdf(fileBuffer);
            text = data.text;
        } else {
            text = fileBuffer.toString('utf8');
        }
        console.log(`[${documentId}] Text extracted successfully. Length: ${text.length}`);

        // 2. Chunk text and prepare for insertion
        console.log(`[${documentId}] Chunking text...`);
        const chunks = chunkText(text);
        if (chunks.length === 0) {
            console.log(`[${documentId}] Document is empty or contains no text. Aborting processing.`);
            await supabase.storage.from('documents').remove([path]);
            return res.status(200).json({ documentId });
        }
        console.log(`[${documentId}] Text chunked into ${chunks.length} pieces.`);

        const chunksToInsert = chunks.map(chunkContent => ({
            document_id: documentId,
            content: chunkContent,
            embedding: null,
            processing_status: 'PENDING' as const
        }));

        // 3. Insert all chunks into the database in batches and retrieve their generated IDs
        console.log(`[${documentId}] Inserting chunks into database...`);
        const BATCH_SIZE = 100;
        const insertedChunks = [];
        for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
            const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
            const returnedBatch = await insertChunks(batch);
            insertedChunks.push(...returnedBatch);
        }
        const allChunkIds = insertedChunks.map(c => c.id);

        // 4. Kick off the processing chain if there are chunks to process.
        if (allChunkIds.length > 0) {
             const baseUrl = getBaseUrl(req);
             const workerUrl = `${baseUrl}/api/document/process-chunk`;
             
             console.log(`[${documentId}] All chunks inserted. Kicking off processing chain for ${allChunkIds.length} chunks.`);
             console.log(`[${documentId}] Triggering first worker at URL: ${workerUrl}`);

             // Use an IIFE to handle the async fire-and-forget call robustly.
             (async () => {
                 try {
                     const response = await fetch(workerUrl, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ documentId, allChunkIds, currentIndex: 0 }),
                     });
                     if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`First worker trigger failed with status ${response.status}: ${errorBody}`);
                     }
                     console.log(`[${documentId}] Successfully triggered first worker.`);
                 } catch (err: any) {
                     console.error(`[${documentId}] CRITICAL: Failed to trigger the first chunk processor. Error: ${err.message}`);
                     supabase.from('documents')
                        .update({ processing_status: 'FAILED' })
                        .in('id', allChunkIds)
                        .then(({ error }) => {
                             if (error) console.error(`[${documentId}] Failed to mark all chunks as FAILED after initial trigger failure:`, error);
                             else console.log(`[${documentId}] Successfully marked all ${allChunkIds.length} chunks as FAILED.`);
                        });
                 }
             })();
        }
        
        // 5. Clean up the original file from storage
        console.log(`[${documentId}] Cleaning up original file from storage...`);
        await supabase.storage.from('documents').remove([path]);
        console.log(`[${documentId}] Processing job started successfully.`);

        res.status(202).json({ documentId });

    } catch (error) {
        console.error(`[${documentId}] FATAL ERROR during document processing orchestration:`, error);
        if (error instanceof Error && error.stack) {
            console.error('Stack trace:', error.stack);
        }
        res.status(500).json({ message: 'Failed to start file processing. Check server logs for details.' });
    }
};

/**
 * Polling endpoint for the frontend to check document readiness.
 */
export const handleGetDocumentStatus: RequestHandler = async (req, res) => {
    const { documentId } = req.params;
    if (!documentId) {
        return res.status(400).json({ message: 'documentId is required.' });
    }

    try {
        const { count: totalCount, error: totalError } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId);
        
        if (totalError) throw new Error(`Database error while fetching total count: ${totalError.message}`);
        
        const { count: completedCount, error: completedError } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId)
            .eq('processing_status', 'COMPLETED');

        if (completedError) throw new Error(`Database error while fetching completed count: ${completedError.message}`);

        const { count: failedCount, error: failedError } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId)
            .eq('processing_status', 'FAILED');

        if (failedError) throw new Error(`Database error while fetching failed count: ${failedError.message}`);


        const total = totalCount ?? 0;
        const completed = completedCount ?? 0;
        const failed = failedCount ?? 0;
        
        const hasFailed = failed > 0;
        const isFinished = total > 0 && (completed + failed) === total;
        const isReady = isFinished && !hasFailed; // Ready only if finished and no failures.
        const progress = total > 0 ? ((completed + failed) / total) * 100 : 0;
        
        // Don't spam logs on status check unless something interesting is happening.
        if (progress > 0 && progress < 100) {
            console.log(`[Status Check] DocID: ${documentId} | Progress: ${Math.round(progress)}% (${completed+failed}/${total})`);
        } else if (isFinished) {
            console.log(`[Status Check] DocID: ${documentId} | Finished. Total: ${total}, Completed: ${completed}, Failed: ${failed}`);
        }
        

        res.status(200).json({ isReady, isFinished, hasFailed, progress: Math.round(progress) }); 

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};
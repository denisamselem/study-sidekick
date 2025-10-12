import { Request, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { insertChunks } from '../services/ragService';
import { createEmbedding } from '../services/embeddingService';

// Use require for pdf-parse to ensure compatibility with CommonJS module format in various environments.
const pdf = require('pdf-parse');

const MAX_CONCURRENT_WORKERS = 5;

/**
 * Builds the necessary headers for internal worker-to-worker fetch requests.
 * It includes a Vercel-specific bypass token if available, which is crucial
 * for allowing serverless functions to call each other when deployment protection is enabled.
 * @returns A HeadersInit object for the fetch request.
 */
function getWorkerHeaders(): HeadersInit {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

    if (bypassSecret) {
        console.log(`[getWorkerHeaders] VERCEL_AUTOMATION_BYPASS_SECRET found. Adding 'x-vercel-protection-bypass' header.`);
        headers['x-vercel-protection-bypass'] = bypassSecret;
    } else {
        console.warn(`[getWorkerHeaders] WARNING: VERCEL_AUTOMATION_BYPASS_SECRET environment variable not found. Internal API calls will likely be blocked by Vercel Deployment Protection, causing a 401 error.`);
    }
    return headers;
}

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
            // Specific check for 429 (rate limit) errors to use the suggested retry delay.
            const isRateLimitError = error.status === 429;
            let backoffDelay = delay * Math.pow(2, i);

            if (isRateLimitError) {
                // A crude way to find a retry delay in the error message, typical of Google APIs.
                const retryAfterMatch = JSON.stringify(error).match(/retryDelay":"(\d+)s/);
                if (retryAfterMatch && retryAfterMatch[1]) {
                    backoffDelay = parseInt(retryAfterMatch[1], 10) * 1000 + 500; // Add 500ms buffer
                    console.warn(`Rate limit detected. Respecting API's suggested retry delay of ${backoffDelay}ms.`);
                }
            }
            
            if (i < retries - 1) {
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
 * A worker that processes a batch of chunks sequentially.
 */
export const handleProcessBatch: RequestHandler = async (req, res) => {
    const { documentId, chunkIds } = req.body;

    console.log(`[${documentId}] Batch Worker INVOKED for ${chunkIds.length} chunks.`);

    if (!documentId || !Array.isArray(chunkIds) || chunkIds.length === 0) {
        console.error(`[${documentId}] Worker received malformed request (missing documentId or chunkIds).`);
        return res.status(400).json({ message: 'documentId and a non-empty chunkIds array are required.' });
    }

    try {
        for (const chunkId of chunkIds) {
            await _processChunkEmbedding(chunkId, documentId);
        }
        res.status(200).json({ message: `Successfully processed batch of ${chunkIds.length} chunks.` });
    } catch (error) {
        console.error(`[${documentId}] Batch Worker failed while processing chunk. The rest of the batch is aborted.`);
        // The error is already logged and the failing chunk is marked as FAILED inside _processChunkEmbedding.
        // Return 500 to indicate that this batch worker invocation failed.
        res.status(500).json({ message: `Failed to process batch.` });
    }
};

/**
 * Orchestrates the document processing.
 * 1. Downloads file from storage.
 * 2. Extracts text and chunks it.
 * 3. Inserts all chunks into DB with a 'PENDING' status.
 * 4. Divides chunks into batches and triggers a parallel worker for EACH batch.
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

        // 4. Kick off batched workers in parallel (fire-and-forget)
        if (allChunkIds.length > 0) {
             const baseUrl = getBaseUrl(req);
             const workerUrl = `${baseUrl}/api/document/process-batch`;
             
             // Divide chunk IDs into batches for our workers
             const numWorkers = Math.min(MAX_CONCURRENT_WORKERS, allChunkIds.length);
             const batches: number[][] = Array.from({ length: numWorkers }, () => []);
             allChunkIds.forEach((chunkId, index) => {
                 batches[index % numWorkers].push(chunkId);
             });

             console.log(`[${documentId}] All chunks inserted. Triggering ${numWorkers} parallel batch workers at URL: ${workerUrl}`);
             
             (async () => {
                 const triggerPromises = batches.map((batchChunkIds, i) => {
                     console.log(`[${documentId}] Triggering worker ${i+1} with ${batchChunkIds.length} chunks.`);
                     return fetch(workerUrl, {
                         method: 'POST',
                         headers: getWorkerHeaders(),
                         body: JSON.stringify({ documentId, chunkIds: batchChunkIds }),
                     }).catch(err => {
                         console.error(`[${documentId}] Network error triggering worker for batch ${i+1}: ${err.message}`);
                         return { ok: false, status: 'NETWORK_ERROR', batch: batchChunkIds };
                     })
                 });

                 const results = await Promise.allSettled(triggerPromises);
                 
                 const failedChunksToMark: number[] = [];
                 results.forEach((result, i) => {
                     if (result.status === 'fulfilled') {
                         const response = result.value as Response | { ok: boolean, status: string, batch: number[] };
                         if (!response.ok) {
                             console.error(`[${documentId}] Trigger for batch ${i+1} failed with status: ${response.status}`);
                             failedChunksToMark.push(...batches[i]);
                         }
                     } else {
                         console.error(`[${documentId}] Trigger for batch ${i+1} failed catastrophically:`, result.reason);
                         failedChunksToMark.push(...batches[i]);
                     }
                 });

                 if (failedChunksToMark.length > 0) {
                     console.error(`[${documentId}] Marking ${failedChunksToMark.length} chunks as FAILED due to trigger failures.`);
                     await supabase
                         .from('documents')
                         .update({ processing_status: 'FAILED' })
                         .in('id', failedChunksToMark);
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
        
        // Always log the status check for debugging purposes, but make it concise.
        console.log(`[Status Check] DocID: ${documentId} | Total: ${total}, Completed: ${completed}, Failed: ${failed}, Progress: ${Math.round(progress)}%`);

        res.status(200).json({ isReady, isFinished, hasFailed, progress: Math.round(progress) }); 

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};
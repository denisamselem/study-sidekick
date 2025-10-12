import { Request, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { insertChunks } from '../services/ragService';
import { createEmbedding } from '../services/embeddingService';

// Use require for pdf-parse to ensure compatibility with CommonJS module format in various environments.
const pdf = require('pdf-parse');

// A custom error to signal that a long cooldown is required, and the task should be re-queued.
class RateLimitCoolDownError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitCoolDownError';
    }
}

// The maximum number of chunks to process concurrently.
// A low number is crucial to stay within serverless platform limits on a hobby plan.
const MAX_CONCURRENT_WORKERS = 3;

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
    return await supabase.storage.from('documents').download(path);
}

/**
 * A utility function to retry an async operation.
 * For 429 rate limit errors, it parses the suggested delay from the Gemini API.
 * If the delay is short, it waits. If it's long, it throws a special error
 * to signal that the task should be re-queued by the caller.
 * @param fn The async function to execute.
 * @param retries The maximum number of retries for non-rate-limit errors.
 * @param delay The initial delay in milliseconds for exponential backoff.
 * @returns The result of the async function.
 */
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            const isRateLimitError = error.status === 429 && error.message;
            let backoffDelay = delay * Math.pow(2, i);

            if (isRateLimitError) {
                const retryAfterMatchS = error.message.match(/Please retry in ([\d.]+)s/);
                const retryAfterMatchMs = error.message.match(/Please retry in ([\d.]+)ms/);

                let apiWaitTime: number | null = null;
                if (retryAfterMatchS && retryAfterMatchS[1]) {
                    apiWaitTime = parseFloat(retryAfterMatchS[1]) * 1000;
                } else if (retryAfterMatchMs && retryAfterMatchMs[1]) {
                    apiWaitTime = parseFloat(retryAfterMatchMs[1]);
                }
                
                if (apiWaitTime !== null) {
                    backoffDelay = apiWaitTime + 500; // Use API delay + buffer
                    console.warn(`Rate limit detected. API suggests retry delay of ~${Math.round(apiWaitTime)}ms.`);
                }
                
                if (backoffDelay > 5000) { // 5-second threshold
                     console.warn(`Required cooldown (${Math.round(backoffDelay)}ms) is too long. Re-queueing chunk.`);
                     throw new RateLimitCoolDownError(`Cooldown of ${Math.round(backoffDelay)}ms required.`);
                }
            }
            
            if (i < retries - 1) {
                console.warn(`Attempt ${i + 1} failed. Retrying in ${Math.round(backoffDelay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }
    }
    throw lastError;
}


/**
 * Processes a single chunk: generates an embedding and updates it in the database.
 * If it encounters a long rate-limit delay, it resets the chunk's status to PENDING
 * to be picked up by a later worker, and returns gracefully.
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
        if (error instanceof RateLimitCoolDownError) {
            // This is not a fatal error. We just need to wait.
            // Put the chunk back in the queue by resetting its status.
            console.log(`[${documentId}] [CHUNK ${chunkId}] Re-queueing chunk due to rate limit. Status -> PENDING.`);
            await supabase.from('documents').update({ processing_status: 'PENDING' }).eq('id', chunkId);
            // Return gracefully. The worker's job is done for now.
            return; 
        }

        // For all other errors, it's a real failure.
        console.error(`[${documentId}] [CHUNK ${chunkId}] FATAL: Error during embedding process. Marking as FAILED. Details:`, error);
        await supabase.from('documents').update({ processing_status: 'FAILED' }).eq('id', chunkId);
        throw error; // Propagate the error to the handler.
    }
}

/**
 * A simple, standalone worker that processes a single chunk.
 * It attempts to "claim" a chunk by atomically updating its status from PENDING to PROCESSING.
 * This prevents multiple workers from processing the same chunk in a concurrent environment.
 */
export const handleProcessChunk: RequestHandler = async (req, res) => {
    const { chunkId, documentId } = req.body;
    if (!chunkId || !documentId) {
        return res.status(400).json({ message: 'chunkId and documentId are required.' });
    }

    console.log(`[${documentId}] Worker INVOKED for chunk ID: ${chunkId}.`);

    // Atomically claim the chunk. Update status from PENDING to PROCESSING.
    // The .select() confirms if a row was actually updated.
    const { data, error: claimError } = await supabase
        .from('documents')
        .update({ processing_status: 'PROCESSING' })
        .eq('id', chunkId)
        .eq('processing_status', 'PENDING')
        .select('id');
    
    if (claimError || data?.length === 0) {
        console.log(`[${documentId}] [CHUNK ${chunkId}] Worker could not claim chunk. It was likely already picked up by another worker. Exiting gracefully.`);
        return res.status(200).json({ message: "Chunk already processed or in progress." });
    }

    console.log(`[${documentId}] [CHUNK ${chunkId}] Successfully claimed chunk. Starting processing.`);
    try {
        await _processChunkEmbedding(chunkId, documentId);
        res.status(200).json({ message: `Chunk ${chunkId} processed or re-queued successfully.` });
    } catch (error) {
        // This will now only catch fatal (non-requeue) errors.
        res.status(500).json({ message: `Failed to process chunk ${chunkId}.` });
    }
};


/**
 * Orchestrates the document processing setup.
 * 1. Downloads file, extracts text, and chunks it.
 * 2. Inserts all chunks into DB with a 'PENDING' status.
 * 3. Returns immediately. The frontend polling will kick off the processing.
 */
export const handleProcessDocument: RequestHandler = async (req, res) => {
    const { path, mimeType } = req.body;
    if (!path || !mimeType) {
        return res.status(400).json({ message: 'File path and mimeType are required.' });
    }

    const documentId = uuidv4();
    console.log(`[${documentId}] Starting document processing for path: ${path}`);

    try {
        console.log(`[${documentId}] Attempting to download file from storage...`);
        const { data: blob, error: downloadError } = await downloadWithRetry(path);
        if (downloadError || !blob) {
            throw new Error(`Could not download file from storage after retries: ${downloadError?.message || 'File blob is null.'}`);
        }
        
        const fileBuffer = Buffer.from(await blob.arrayBuffer());
        console.log(`[${documentId}] Extracting text from mimeType: ${mimeType}`);
        let text = '';
        if (mimeType === 'application/pdf') {
            const data = await pdf(fileBuffer);
            text = data.text;
        } else {
            text = fileBuffer.toString('utf8');
        }
        
        console.log(`[${documentId}] Chunking text...`);
        const chunks = chunkText(text);
        if (chunks.length === 0) {
            await supabase.storage.from('documents').remove([path]);
            return res.status(200).json({ documentId });
        }
        
        const chunksToInsert = chunks.map(chunkContent => ({
            document_id: documentId,
            content: chunkContent,
            embedding: null,
            processing_status: 'PENDING' as const
        }));

        console.log(`[${documentId}] Inserting ${chunksToInsert.length} chunks into database...`);
        const BATCH_SIZE = 100;
        for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
            const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
            await insertChunks(batch);
        }

        console.log(`[${documentId}] All chunks created in PENDING state. Cleaning up original file.`);
        await supabase.storage.from('documents').remove([path]);
        
        console.log(`[${documentId}] Processing job initialized. Workers will be triggered by polling.`);
        res.status(202).json({ documentId });

    } catch (error) {
        console.error(`[${documentId}] FATAL ERROR during document processing setup:`, error);
        res.status(500).json({ message: 'Failed to start file processing. Check server logs.' });
    }
};

/**
 * Polling endpoint that both reports status and triggers new workers.
 * This acts as the central controller for the "pull" architecture.
 */
export const handleGetDocumentStatus: RequestHandler = async (req, res) => {
    const { documentId } = req.params;
    if (!documentId) {
        return res.status(400).json({ message: 'documentId is required.' });
    }

    try {
        const { data: counts, error: countError } = await supabase
            .rpc('get_document_processing_status', { doc_id: documentId });

        if (countError) throw new Error(`Database error while fetching counts: ${countError.message}`);
        
        const { total_chunks, pending_chunks, processing_chunks, completed_chunks, failed_chunks } = counts[0];

        // If there's capacity, trigger new workers for pending chunks.
        const availableSlots = MAX_CONCURRENT_WORKERS - processing_chunks;
        if (availableSlots > 0 && pending_chunks > 0) {
            const { data: chunksToProcess, error: fetchPendingError } = await supabase
                .from('documents')
                .select('id')
                .eq('document_id', documentId)
                .eq('processing_status', 'PENDING')
                .limit(availableSlots);

            if (fetchPendingError) throw new Error(`Failed to fetch pending chunks: ${fetchPendingError.message}`);

            if (chunksToProcess && chunksToProcess.length > 0) {
                console.log(`[${documentId}] Polling controller found ${processing_chunks} active workers and ${pending_chunks} pending chunks. Triggering ${chunksToProcess.length} new workers.`);
                const baseUrl = getBaseUrl(req);
                const workerUrl = `${baseUrl}/api/document/process-chunk`;
                
                for (const chunk of chunksToProcess) {
                    // Fire-and-forget: trigger worker but don't wait for its response.
                    fetch(workerUrl, {
                        method: 'POST',
                        headers: getWorkerHeaders(),
                        body: JSON.stringify({ documentId, chunkId: chunk.id }),
                    }).catch(err => {
                        console.error(`[${documentId}] CRITICAL: Controller failed to trigger worker for chunk ${chunk.id}. Error: ${err.message}`);
                    });
                }
            }
        }
        
        const finishedCount = completed_chunks + failed_chunks;
        const hasFailed = failed_chunks > 0;
        const isFinished = total_chunks > 0 && finishedCount === total_chunks;
        const isReady = isFinished && !hasFailed;
        const progress = total_chunks > 0 ? (finishedCount / total_chunks) * 100 : (isFinished ? 100 : 0);
        
        console.log(`[Status Check] DocID: ${documentId} | Total: ${total_chunks}, Completed: ${completed_chunks}, Processing: ${processing_chunks}, Failed: ${failed_chunks}, Progress: ${Math.round(progress)}%`);

        res.status(200).json({ isReady, isFinished, hasFailed, progress: Math.round(progress) }); 

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};
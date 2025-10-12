// FIX: The namespace import `import * as express` was causing type resolution issues.
// Reverting to named imports is consistent with other handlers and resolves the type errors.
// FIX: Using a direct import for the Express Request type to resolve type errors.
// FIX: The `Request` type from Express is aliased to `ExpressRequest` to prevent conflicts with the global DOM `Request` type.
import { Request as ExpressRequest, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { insertChunks } from '../services/ragService';
import { createEmbedding } from '../services/embeddingService';

const pdf = require('pdf-parse');

const MAX_CONCURRENT_EMBEDDING_WORKERS = 3;

function getWorkerHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) {
        headers['x-vercel-protection-bypass'] = bypassSecret;
    }
    return headers;
}

// FIX: The `req` parameter is now typed as `ExpressRequest` to use the aliased type from the import, resolving property access errors.
const getBaseUrl = (req: ExpressRequest): string => {
    const baseUrlEnv = process.env.BASE_URL || process.env.VERCEL_URL;
    if (baseUrlEnv) {
        return baseUrlEnv.startsWith('http') ? baseUrlEnv : `https://${baseUrlEnv}`;
    }
    const protocol = req.headers['x-forwarded-proto'] as string || req.protocol;
    const host = req.get('host');
    if (!host) throw new Error("Could not determine host from request headers.");
    return `${protocol}://${host}`;
}

async function downloadWithRetry(path: string, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        const { data, error } = await supabase.storage.from('documents').download(path);
        if (!error && data) return { data, error: null };
        console.warn(`Attempt ${i + 1} to download ${path} failed. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
    return await supabase.storage.from('documents').download(path);
}

async function _processChunkEmbedding(chunkId: number, documentId: string) {
    console.log(`[${documentId}] [CHUNK ${chunkId}] Starting embedding process.`);
    try {
        const { data: chunk, error: fetchError } = await supabase.from('documents').select('content').eq('id', chunkId).single();
        if (fetchError || !chunk) throw new Error(`Could not find chunk content: ${fetchError?.message}`);
        
        // With the local model, this is now a fast and reliable operation. No complex retry logic is needed.
        const embedding = await createEmbedding(chunk.content);

        const { error: updateError } = await supabase.from('documents').update({ embedding: embedding, processing_status: 'COMPLETED' }).eq('id', chunkId);
        if (updateError) throw new Error(`Failed to update with embedding: ${updateError.message}`);

        console.log(`[${documentId}] [CHUNK ${chunkId}] Successfully processed and saved embedding.`);
    } catch (error) {
        console.error(`[${documentId}] [CHUNK ${chunkId}] FATAL: Error during embedding. Marking as FAILED.`, error);
        await supabase.from('documents').update({ processing_status: 'FAILED' }).eq('id', chunkId);
        throw error;
    }
}

export const handleProcessChunk: RequestHandler = async (req, res) => {
    const { chunkId, documentId } = req.body;
    if (!chunkId || !documentId) return res.status(400).json({ message: 'chunkId and documentId required.' });

    const { data, error: claimError } = await supabase.from('documents').update({ processing_status: 'PROCESSING' }).eq('id', chunkId).eq('processing_status', 'PENDING').select('id');
    
    if (claimError || data?.length === 0) {
        console.log(`[${documentId}] [CHUNK ${chunkId}] Worker could not claim chunk. Already processed or in progress.`);
        return res.status(200).json({ message: "Chunk already processed or in progress." });
    }

    console.log(`[${documentId}] [CHUNK ${chunkId}] Claimed chunk. Starting processing.`);
    try {
        await _processChunkEmbedding(chunkId, documentId);
        res.status(200).json({ message: `Chunk ${chunkId} processed successfully.` });
    } catch (error) {
        res.status(500).json({ message: `Failed to process chunk ${chunkId}.` });
    }
};

/**
 * [WORKER - STAGE 1] Downloads file, extracts text, chunks it, and saves chunks to DB.
 */
export const handleExtractAndChunk: RequestHandler = async (req, res) => {
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ message: 'documentId is required.' });

    try {
        const { data: job, error: jobError } = await supabase.from('document_jobs').select('storage_path, mime_type').eq('document_id', documentId).single();
        if (jobError || !job) throw new Error(`Job not found for documentId: ${documentId}`);

        console.log(`[${documentId}] [EXTRACT] Starting extraction for path: ${job.storage_path}`);
        const { data: blob, error: downloadError } = await downloadWithRetry(job.storage_path);
        if (downloadError || !blob) throw new Error(`Could not download file: ${downloadError?.message}`);
        
        const fileBuffer = Buffer.from(await blob.arrayBuffer());
        let text = '';
        if (job.mime_type === 'application/pdf') {
            const data = await pdf(fileBuffer);
            text = data.text;
        } else {
            text = fileBuffer.toString('utf8');
        }
        
        const chunks = chunkText(text);
        if (chunks.length > 0) {
            const chunksToInsert = chunks.map(content => ({ document_id: documentId, content, embedding: null, processing_status: 'PENDING' as const }));
            const BATCH_SIZE = 100;
            for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
                await insertChunks(chunksToInsert.slice(i, i + BATCH_SIZE));
            }
        }
        
        await supabase.storage.from('documents').remove([job.storage_path]);
        await supabase.from('document_jobs').update({ status: 'PENDING_EMBEDDING' }).eq('document_id', documentId);
        
        console.log(`[${documentId}] [EXTRACT] Successfully extracted and chunked. Status -> PENDING_EMBEDDING.`);
        res.status(200).json({ message: 'Extraction and chunking complete.' });
    } catch (error) {
        console.error(`[${documentId}] [EXTRACT] FATAL ERROR during extraction. Marking job as FAILED.`, error);
        await supabase.from('document_jobs').update({ status: 'FAILED' }).eq('document_id', documentId);
        res.status(500).json({ message: 'Failed to extract text from document.' });
    }
};

/**
 * [INITIATOR] Creates the initial processing job. Returns immediately.
 */
export const handleProcessDocument: RequestHandler = async (req, res) => {
    const { path, mimeType } = req.body;
    if (!path || !mimeType) return res.status(400).json({ message: 'File path and mimeType are required.' });

    const documentId = uuidv4();
    try {
        const { error } = await supabase.from('document_jobs').insert({ document_id: documentId, storage_path: path, mime_type: mimeType, status: 'PENDING_EXTRACTION' });
        if (error) throw error;
        
        console.log(`[${documentId}] Processing job created for path: ${path}. Polling will trigger workers.`);
        res.status(202).json({ documentId });
    } catch (error) {
        console.error(`[${documentId}] FATAL ERROR creating document job:`, error);
        res.status(500).json({ message: 'Failed to create document processing job.' });
    }
};

/**
 * [CONTROLLER] Polling endpoint that reports status and triggers workers for both stages.
 */
export const handleGetDocumentStatus: RequestHandler = async (req, res) => {
    const { documentId } = req.params;
    if (!documentId) return res.status(400).json({ message: 'documentId is required.' });

    try {
        const { data: job, error: jobError } = await supabase.from('document_jobs').select('status').eq('document_id', documentId).single();
        if (jobError || !job) return res.status(404).json({ message: 'Document job not found.' });

        const baseUrl = getBaseUrl(req);

        // STAGE 1: TEXT EXTRACTION
        if (job.status === 'PENDING_EXTRACTION') {
            const { error: claimError } = await supabase.from('document_jobs').update({ status: 'EXTRACTING' }).eq('document_id', documentId).eq('status', 'PENDING_EXTRACTION');
            if (!claimError) {
                console.log(`[${documentId}] [CONTROLLER] Claimed job for extraction, triggering worker.`);
                fetch(`${baseUrl}/api/document/extract-and-chunk`, {
                    method: 'POST', headers: getWorkerHeaders(), body: JSON.stringify({ documentId }),
                }).catch(err => console.error(`[${documentId}] CRITICAL: Controller failed to trigger extraction worker.`, err));
            }
            return res.status(200).json({ isReady: false, isFinished: false, hasFailed: false, progress: 0, message: 'Step 1: Extracting Text...' });
        }
        
        if (job.status === 'EXTRACTING') {
            return res.status(200).json({ isReady: false, isFinished: false, hasFailed: false, progress: 0, message: 'Step 1: Extracting Text...' });
        }

        // STAGE 2: EMBEDDING GENERATION
        if (job.status === 'PENDING_EMBEDDING') {
            const { data: counts, error: countError } = await supabase.rpc('get_document_processing_status', { doc_id: documentId });
            if (countError) throw new Error(`DB error fetching chunk counts: ${countError.message}`);
            
            const { total_chunks, pending_chunks, processing_chunks, completed_chunks, failed_chunks } = counts[0];

            const availableSlots = MAX_CONCURRENT_EMBEDDING_WORKERS - processing_chunks;
            if (availableSlots > 0 && pending_chunks > 0) {
                const { data: chunksToProcess, error: fetchError } = await supabase.from('documents').select('id').eq('document_id', documentId).eq('processing_status', 'PENDING').limit(availableSlots);
                if (fetchError) throw new Error(`Failed to fetch pending chunks: ${fetchError.message}`);

                if (chunksToProcess && chunksToProcess.length > 0) {
                    console.log(`[${documentId}] [CONTROLLER] Triggering ${chunksToProcess.length} new embedding workers.`);
                    for (const chunk of chunksToProcess) {
                        fetch(`${baseUrl}/api/document/process-chunk`, {
                            method: 'POST', headers: getWorkerHeaders(), body: JSON.stringify({ documentId, chunkId: chunk.id }),
                        }).catch(err => console.error(`[${documentId}] CRITICAL: Controller failed to trigger embedding worker for chunk ${chunk.id}.`, err));
                    }
                }
            }
            
            const finishedCount = completed_chunks + failed_chunks;
            const hasFailed = failed_chunks > 0;
            const progress = total_chunks > 0 ? Math.round((finishedCount / total_chunks) * 100) : 0;
            const isFinished = total_chunks > 0 && finishedCount === total_chunks;

            if (isFinished) {
                const finalStatus = hasFailed ? 'FAILED' : 'COMPLETED';
                await supabase.from('document_jobs').update({ status: finalStatus }).eq('document_id', documentId);
                return res.status(200).json({ isReady: !hasFailed, isFinished: true, hasFailed, progress: 100, message: `Processing ${finalStatus}.` });
            }
            
            return res.status(200).json({ isReady: false, isFinished: false, hasFailed, progress, message: 'Step 2: Generating Embeddings...' }); 
        }

        // FINAL STATES
        if (job.status === 'COMPLETED') {
            return res.status(200).json({ isReady: true, isFinished: true, hasFailed: false, progress: 100, message: 'Processing Complete.' });
        }

        if (job.status === 'FAILED') {
            return res.status(200).json({ isReady: false, isFinished: true, hasFailed: true, progress: 100, message: 'Processing Failed.' });
        }
        
        // Default case for any unknown status
        return res.status(500).json({ message: `Unhandled job status: ${job.status}` });

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};
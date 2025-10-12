

import express, { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase.js';
import { chunkText } from '../lib/textChunker.js';
import { insertChunks } from '../services/ragService.js';
import { createEmbedding } from '../services/embeddingService.js';

const MAX_CONCURRENT_EMBEDDING_WORKERS = 3;

function getWorkerHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) {
        headers['x-vercel-protection-bypass'] = bypassSecret;
    }
    return headers;
}

const getBaseUrl = (req: express.Request): string => {
    const baseUrlEnv = process.env.BASE_URL || process.env.VERCEL_URL;
    if (baseUrlEnv) {
        return baseUrlEnv.startsWith('http') ? baseUrlEnv : `https://${baseUrlEnv}`;
    }
    const protocol = req.headers['x-forwarded-proto'] as string || req.protocol;
    const host = req.get('host');
    if (!host) throw new Error("Could not determine host from request headers.");
    return `${protocol}://${host}`;
}

async function _processChunkEmbedding(chunkId: number, documentId: string) {
    console.log(`[${documentId}] [CHUNK ${chunkId}] Starting embedding process.`);
    try {
        const { data: chunk, error: fetchError } = await supabase.from('documents').select('content').eq('id', chunkId).single();
        if (fetchError || !chunk) throw new Error(`Could not find chunk content: ${fetchError?.message}`);
        
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
 * [INITIATOR] Creates the processing job and all document chunks from pre-extracted text.
 */
export const handleProcessTextDocument: RequestHandler = async (req, res) => {
    const { text, fileName } = req.body;
    if (!text || !fileName) {
        return res.status(400).json({ message: 'Text content and fileName are required.' });
    }

    const documentId = uuidv4();
    try {
        // 1. Create the main job entry
        const { error: jobError } = await supabase.from('document_jobs').insert({ 
            document_id: documentId, 
            storage_path: fileName, // Use storage_path to store the original file name
            mime_type: 'text/plain', // Mime-type is now uniform
            status: 'PENDING_EMBEDDING' 
        });
        if (jobError) throw jobError;

        // 2. Chunk the text
        const chunks = chunkText(text);
        
        // 3. Insert all chunks in batches, ready for embedding workers
        if (chunks.length > 0) {
            const chunksToInsert = chunks.map(content => ({ document_id: documentId, content, embedding: null, processing_status: 'PENDING' as const }));
            const BATCH_SIZE = 100;
            for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
                await insertChunks(chunksToInsert.slice(i, i + BATCH_SIZE));
            }
        }
        
        console.log(`[${documentId}] Processing job created for file: ${fileName}. ${chunks.length} chunks saved. Polling will trigger embedding workers.`);
        res.status(202).json({ documentId });

    } catch (error) {
        console.error(`[${documentId}] FATAL ERROR creating document job from text:`, error);
        res.status(500).json({ message: 'Failed to create document processing job.' });
    }
};


/**
 * [CONTROLLER] Polling endpoint that reports status and triggers embedding workers.
 */
export const handleGetDocumentStatus: RequestHandler = async (req, res) => {
    const { documentId } = req.params;
    if (!documentId) return res.status(400).json({ message: 'documentId is required.' });

    try {
        const { data: job, error: jobError } = await supabase.from('document_jobs').select('status').eq('document_id', documentId).single();
        if (jobError || !job) return res.status(404).json({ message: 'Document job not found.' });

        // The state machine is now simpler. It starts directly at the embedding stage.
        if (job.status === 'PENDING_EXTRACTION' || job.status === 'EXTRACTING') {
            // This state is deprecated but we handle it gracefully in case of old jobs.
            return res.status(200).json({ isReady: false, isFinished: false, hasFailed: false, progress: 0, message: 'Initializing...' });
        }

        const baseUrl = getBaseUrl(req);

        // STAGE 2: EMBEDDING GENERATION
        if (job.status === 'PENDING_EMBEDDING') {
            const { data: counts, error: countError } = await supabase.rpc('get_document_processing_status', { doc_id: documentId });
            if (countError) throw new Error(`DB error fetching chunk counts: ${countError.message}`);
            
            const { total_chunks, pending_chunks, processing_chunks, completed_chunks, failed_chunks } = counts[0];

            if (total_chunks === 0) { // Handle case where document was empty
                await supabase.from('document_jobs').update({ status: 'COMPLETED' }).eq('document_id', documentId);
                return res.status(200).json({ isReady: true, isFinished: true, hasFailed: false, progress: 100, message: 'Processing Complete.' });
            }

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
            const progress = total_chunks > 0 ? Math.round((finishedCount / total_chunks) * 100) : 100;
            const isFinished = finishedCount === total_chunks;

            if (isFinished) {
                const finalStatus = hasFailed ? 'FAILED' : 'COMPLETED';
                await supabase.from('document_jobs').update({ status: finalStatus }).eq('document_id', documentId);
                return res.status(200).json({ isReady: !hasFailed, isFinished: true, hasFailed, progress: 100, message: `Processing ${finalStatus}.` });
            }
            
            return res.status(200).json({ isReady: false, isFinished: false, hasFailed, progress, message: 'Generating Embeddings...' }); 
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
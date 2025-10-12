import { Request, RequestHandler } from 'express';
import pdf from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { createEmbedding } from '../services/embeddingService';
import { insertChunks } from '../services/ragService';
import fetch from 'node-fetch';

/**
 * Derives the base URL of the current server from request headers or environment variables.
 * This is crucial for the server to reliably call its own "worker" endpoint.
 * @param req The Express request object.
 * @returns The full base URL (e.g., https://your-app.vercel.app)
 */
const getBaseUrl = (req: Request): string => {
    // Prefer an environment variable if set (e.g., on Vercel)
    const baseUrlEnv = process.env.BASE_URL || process.env.VERCEL_URL;
    if (baseUrlEnv) {
        // Ensure it has a protocol
        return baseUrlEnv.startsWith('http') ? baseUrlEnv : `https://${baseUrlEnv}`;
    }

    // Fallback to deriving from request headers
    // FIX: The type definitions for express appear to be conflicting, causing properties to be missing.
    // Casting to `any` bypasses the erroneous type check and resolves the error.
    const protocol = (req as any).headers['x-forwarded-proto'] || (req as any).protocol;
    const host = (req as any).get('host');
    if (!host) {
        // This is a critical failure, we can't build the worker URL.
        throw new Error("Could not determine the host from request headers to build worker URL.");
    }
    return `${protocol}://${host}`;
}


/**
 * Orchestrates the document processing.
 * 1. Downloads file from storage.
 * 2. Extracts text and chunks it.
 * 3. Inserts all chunks into DB with a 'PENDING' status in manageable batches.
 * 4. Fires off asynchronous, non-blocking requests to the embedding worker for each chunk.
 * 5. Returns immediately to the client.
 */
export const handleProcessDocument: RequestHandler = async (req, res) => {
    const { path, mimeType } = req.body;
    if (!path || !mimeType) {
        return res.status(400).json({ message: 'File path and mimeType are required.' });
    }

    const documentId = uuidv4();

    try {
        // 1. Download and parse file
        const { data: blob, error: downloadError } = await supabase.storage.from('documents').download(path);
        if (downloadError) throw new Error(`Could not download file from storage: ${downloadError.message}`);

        const fileBuffer = Buffer.from(await blob.arrayBuffer());

        let text = '';
        if (mimeType === 'application/pdf') {
            const data = await (pdf as any)(fileBuffer);
            text = data.text;
        } else {
            text = fileBuffer.toString('utf8');
        }

        // 2. Chunk text and prepare for insertion
        const chunks = chunkText(text);
        if (chunks.length === 0) {
            // If the document is empty, clean up and return.
            await supabase.storage.from('documents').remove([path]);
            return res.status(200).json({ documentId });
        }

        const chunksToInsert = chunks.map(chunkContent => ({
            id: uuidv4(), // Assign a unique ID to each chunk
            document_id: documentId,
            content: chunkContent,
            embedding: null,
            processing_status: 'PENDING' as const
        }));

        // 3. Insert all chunks into the database in batches to avoid payload size limits
        const BATCH_SIZE = 100; // Process 100 chunks per insert
        for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
            const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
            await insertChunks(batch);
        }

        // 4. Asynchronously trigger embedding generation for each chunk
        const baseUrl = getBaseUrl(req);
        const workerUrl = `${baseUrl}/api/document/generate-embedding`;
        
        for (const chunk of chunksToInsert) {
             // We don't await this fetch call. This is "fire and forget".
             fetch(workerUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ chunkId: chunk.id }),
             }).catch(err => {
                 // Log errors, but don't let it stop the process. We will also update the status to FAILED.
                 console.error(`Failed to trigger embedding for chunk ${chunk.id}:`, err);
                 supabase.from('documents').update({ processing_status: 'FAILED' }).eq('id', chunk.id).then();
             });
        }
        
        // 5. Clean up the original file from storage
        await supabase.storage.from('documents').remove([path]);

        res.status(202).json({ documentId }); // 202 Accepted: The request has been accepted for processing

    } catch (error) {
        console.error('Error starting processing job:', error);
        res.status(500).json({ message: 'Failed to start file processing.' });
    }
};

/**
 * Worker endpoint to generate an embedding for a single chunk.
 */
export const handleGenerateEmbedding: RequestHandler = async (req, res) => {
    const { chunkId } = req.body;
    if (!chunkId) {
        return res.status(400).json({ message: 'chunkId is required.' });
    }

    try {
        // Get chunk content
        const { data: chunk, error: fetchError } = await supabase
            .from('documents')
            .select('content')
            .eq('id', chunkId)
            .single();

        if (fetchError || !chunk) {
            throw new Error(`Could not find chunk with ID ${chunkId}: ${fetchError?.message}`);
        }

        // Generate embedding
        const embedding = await createEmbedding(chunk.content);

        // Update the chunk with the new embedding and status
        const { error: updateError } = await supabase
            .from('documents')
            .update({ embedding: embedding, processing_status: 'COMPLETED' })
            .eq('id', chunkId);
        
        if (updateError) {
            throw new Error(`Failed to update chunk ${chunkId} with embedding: ${updateError.message}`);
        }

        res.status(200).json({ success: true });

    } catch (error) {
        console.error(`Error processing embedding for chunk ${chunkId}:`, error);
        // Update status to FAILED so we know something went wrong
        await supabase.from('documents').update({ processing_status: 'FAILED' }).eq('id', chunkId);
        res.status(500).json({ message: 'Failed to process embedding.' });
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
        const { count, error } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId)
            .in('processing_status', ['PENDING']);
        
        if (error) {
            throw new Error(`Database error while fetching status: ${error.message}`);
        }

        const { count: totalCount, error: totalError } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId);

        if (totalError) {
             throw new Error(`Database error while fetching total count: ${totalError.message}`);
        }
        
        const pendingCount = count ?? 0;
        const total = totalCount ?? 0;
        const processedCount = total - pendingCount;
        
        const isReady = total > 0 && pendingCount === 0;
        const progress = total > 0 ? (processedCount / total) * 100 : 0;
        
        res.status(200).json({ isReady, progress: Math.round(progress) }); 

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};
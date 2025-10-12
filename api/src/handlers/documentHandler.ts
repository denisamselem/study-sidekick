
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
            id: uuidv4(),
            document_id: documentId,
            content: chunkContent,
            embedding: null,
            processing_status: 'PENDING' as const
        }));

        // 3. Insert all chunks into the database in batches
        console.log(`[${documentId}] Inserting chunks into database...`);
        const BATCH_SIZE = 100;
        for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
            const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
            await insertChunks(batch);
        }
        console.log(`[${documentId}] All chunks inserted.`);

        // 4. Asynchronously trigger embedding generation for each chunk
        const baseUrl = getBaseUrl(req);
        const workerUrl = `${baseUrl}/api/document/generate-embedding`;
        console.log(`[${documentId}] Triggering embedding generation at worker URL: ${workerUrl}`);
        
        for (const chunk of chunksToInsert) {
             fetch(workerUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ chunkId: chunk.id }),
             }).catch(err => {
                 console.error(`[${documentId}] Failed to trigger embedding for chunk ${chunk.id}:`, err);
                 supabase.from('documents').update({ processing_status: 'FAILED' }).eq('id', chunk.id).then();
             });
        }
        
        // 5. Clean up the original file from storage
        console.log(`[${documentId}] Cleaning up original file from storage...`);
        await supabase.storage.from('documents').remove([path]);
        console.log(`[${documentId}] Processing job started successfully.`);

        res.status(202).json({ documentId });

    } catch (error) {
        console.error(`[${documentId}] FATAL ERROR during document processing:`, error);
        if (error instanceof Error && error.stack) {
            console.error('Stack trace:', error.stack);
        }
        res.status(500).json({ message: 'Failed to start file processing. Check server logs for details.' });
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
        const { data: chunk, error: fetchError } = await supabase
            .from('documents')
            .select('content')
            .eq('id', chunkId)
            .single();

        if (fetchError || !chunk) {
            throw new Error(`Could not find chunk with ID ${chunkId}: ${fetchError?.message}`);
        }

        const embedding = await createEmbedding(chunk.content);

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

        const total = totalCount ?? 0;
        const completed = completedCount ?? 0;
        
        const isReady = total > 0 && completed === total;
        const progress = total > 0 ? (completed / total) * 100 : 0;
        
        res.status(200).json({ isReady, progress: Math.round(progress) }); 

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};

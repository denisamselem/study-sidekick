import { Request, RequestHandler } from 'express';
import pdf from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { createEmbedding } from '../services/embeddingService';
import { insertChunks } from '../services/ragService';
import fetch from 'node-fetch';

/**
 * Orchestrates the document processing.
 * 1. Downloads file from storage.
 * 2. Extracts text and chunks it.
 * 3. Inserts all chunks into DB with a 'PENDING' status.
 * 4. Fires off asynchronous, non-blocking requests to the embedding worker for each chunk.
 * 5. Returns immediately to the client.
 */
// FIX: Remove explicit 'Request' type from 'req' to allow for correct type inference from 'RequestHandler'. This resolves errors where 'body', 'protocol', and 'get' were not found.
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

        // 3. Insert all chunks into the database
        await insertChunks(chunksToInsert);

        // 4. Asynchronously trigger embedding generation for each chunk
        const workerUrl = `${req.protocol}://${req.get('host')}/api/document/generate-embedding`;
        
        for (const chunk of chunksToInsert) {
             // We don't await this fetch call. This is "fire and forget".
             fetch(workerUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ chunkId: chunk.id }),
             }).catch(err => {
                 // Log errors, but don't let it stop the process.
                 console.error(`Failed to trigger embedding for chunk ${chunk.id}:`, err);
                 // You might want to update the chunk status to 'FAILED' here in a real app
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
        
        const isReady = count === 0;
        res.status(200).json({ isReady, progress: count }); // `progress` is the number of chunks remaining

    } catch (error) {
        console.error(`Error getting status for document ${documentId}:`, error);
        res.status(500).json({ message: 'Failed to get document status.' });
    }
};

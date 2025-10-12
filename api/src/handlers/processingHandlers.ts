import { RequestHandler } from 'express';
import pdf from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { chunkText } from '../lib/textChunker';
import { createEmbedding } from '../services/embeddingService';
import { insertChunks } from '../services/ragService';
import { storeJob, getJob, deleteJob } from '../services/processingCache';

/**
 * Starts the document processing job.
 * Downloads the file, extracts text, chunks it, and caches the chunks for batch processing.
 */
export const handleStart: RequestHandler = async (req, res) => {
    const { path, mimeType } = req.body;
    if (!path || !mimeType) {
        return res.status(400).json({ message: 'File path and mimeType are required.' });
    }

    try {
        const { data: blob, error: downloadError } = await supabase.storage.from('documents').download(path);
        if (downloadError) throw new Error('Could not download file from storage.');

        const fileBuffer = Buffer.from(await blob.arrayBuffer());

        let text = '';
        if (mimeType === 'application/pdf') {
            const data = await (pdf as any)(fileBuffer);
            text = data.text;
        } else {
            text = fileBuffer.toString('utf8');
        }

        const chunks = chunkText(text);
        const jobId = uuidv4();
        const documentId = uuidv4();

        await storeJob(jobId, { documentId, chunks, filePath: path });

        res.status(200).json({ jobId, documentId, totalChunks: chunks.length });

    } catch (error) {
        console.error('Error starting processing job:', error);
        res.status(500).json({ message: 'Failed to start file processing.' });
    }
};

/**
 * Processes a single batch of chunks for a given job.
 * Generates embeddings and inserts them into the database.
 */
export const handleBatch: RequestHandler = async (req, res) => {
    const { jobId, startIndex, batchSize } = req.body;
    if (!jobId || startIndex == null || !batchSize) {
        return res.status(400).json({ message: 'jobId, startIndex, and batchSize are required.' });
    }

    try {
        const job = await getJob(jobId);
        if (!job) {
            return res.status(404).json({ message: 'Job not found or expired.' });
        }

        const chunkBatch = job.chunks.slice(startIndex, startIndex + batchSize);
        if (chunkBatch.length === 0) {
            return res.status(200).json({ success: true, message: "No chunks to process in this batch." });
        }

        const embeddingPromises = chunkBatch.map(chunk => createEmbedding(chunk));
        const embeddings = await Promise.all(embeddingPromises);

        const documentsToInsert = chunkBatch.map((chunk, index) => ({
            document_id: job.documentId,
            content: chunk,
            embedding: embeddings[index],
        }));

        await insertChunks(documentsToInsert);

        res.status(200).json({ success: true });

    } catch (error) {
        console.error(`Error processing batch for job ${jobId}:`, error);
        res.status(500).json({ message: 'Failed to process batch.' });
    }
};

/**
 * Finishes the processing job by cleaning up cached data and the original file.
 */
export const handleFinish: RequestHandler = async (req, res) => {
    const { jobId } = req.body;
    if (!jobId) {
        return res.status(400).json({ message: 'jobId is required.' });
    }
    
    try {
        const job = await getJob(jobId);
        if (job && job.filePath) {
             const { error: deleteError } = await supabase.storage
                .from('documents')
                .remove([job.filePath]);

            if (deleteError) {
                console.warn(`Failed to delete temporary file from storage: ${job.filePath}`, deleteError);
            }
        }
        
        await deleteJob(jobId);
        res.status(200).json({ success: true });

    } catch (error) {
         console.error(`Error finishing job ${jobId}:`, error);
         res.status(500).json({ message: 'Failed to finish job.' });
    }
};
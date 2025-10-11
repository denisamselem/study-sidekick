import { RequestHandler } from 'express';
import pdf from 'pdf-parse';
import { addDocument } from '../services/ragService';
import { supabase } from '../lib/supabase';

export const handleProcess: RequestHandler = async (req, res) => {
    const { path, mimeType } = req.body;

    if (!path || !mimeType) {
        return res.status(400).json({ message: 'File path and mimeType are required.' });
    }

    try {
        // 1. Download the file from Supabase Storage
        const { data: blob, error: downloadError } = await supabase.storage
            .from('documents') // The public bucket
            .download(path);

        if (downloadError) {
            console.error('Error downloading file from Supabase:', downloadError);
            throw new Error('Could not download file from storage.');
        }

        const fileBuffer = Buffer.from(await blob.arrayBuffer());

        // 2. Extract text from the file buffer
        let text = '';
        if (mimeType === 'application/pdf') {
            const data = await (pdf as any)(fileBuffer);
            text = data.text;
        } else {
            text = fileBuffer.toString('utf8');
        }

        // 3. Add document to RAG service (chunking, embedding, storing)
        const documentId = await addDocument(text);

        // 4. Clean up the file from storage now that it's processed
        const { error: deleteError } = await supabase.storage
            .from('documents')
            .remove([path]);

        if (deleteError) {
             console.warn(`Failed to delete file from storage: ${path}`, deleteError);
        }
        
        res.status(200).json({ documentId });

    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).json({ message: 'Failed to process file.' });
    }
};
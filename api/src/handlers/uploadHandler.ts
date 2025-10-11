import { RequestHandler } from 'express';
import { formidable } from 'formidable';
import fs from 'fs';
import pdf from 'pdf-parse';
import { addDocument } from '../services/ragService';

export const handleUpload: RequestHandler = async (req, res) => {
    const form = formidable({});
    let tempFilepath: string | undefined;

    try {
        const [fields, files] = await form.parse(req);

        const file = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }
        
        tempFilepath = file.filepath;

        let text = '';
        if (file.mimetype === 'application/pdf') {
            const dataBuffer = fs.readFileSync(file.filepath);
            // FIX: The type definitions for 'pdf-parse' are likely incompatible with how the module is structured.
            // Casting to `any` bypasses the compile-time error, assuming `pdf` is a callable function at runtime.
            const data = await (pdf as any)(dataBuffer);
            text = data.text;
        } else {
            text = fs.readFileSync(file.filepath, 'utf8');
        }

        const documentId = await addDocument(text);
        
        res.status(200).json({ documentId });
    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).json({ message: 'Failed to process file.' });
    } finally {
        // Clean up the temporary file
        if (tempFilepath) {
            fs.unlinkSync(tempFilepath);
        }
    }
};

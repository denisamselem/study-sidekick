import { Request, Response } from 'express';
import { formidable } from 'formidable';
import fs from 'fs';
import pdf from 'pdf-parse';
import { addDocument } from '../services/ragService';

export async function handleUpload(req: Request, res: Response) {
    const form = formidable({});

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error('Error parsing form:', err);
            return res.status(500).json({ message: 'Error parsing form data.' });
        }

        const file = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        try {
            let text = '';
            if (file.mimetype === 'application/pdf') {
                const dataBuffer = fs.readFileSync(file.filepath);
                const data = await pdf(dataBuffer);
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
            fs.unlinkSync(file.filepath);
        }
    });
}

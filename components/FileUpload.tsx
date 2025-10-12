
import React, { useState, useRef, useCallback } from 'react';
import { processTextDocument } from '../services/apiService';
import { UploadIcon, LoadingSpinner } from './common/Icons';

// Import pdfjs-dist and set up the worker
// FIX: Import the main library from a direct, version-locked URL to bypass the
// problematic importmap and guarantee version consistency with the worker.
import * as pdfjsLib from 'https://aistudiocdn.com/pdfjs-dist@4.4.168/build/pdf.mjs';

// The pdf.js library loads its worker via a mechanism that does not use the importmap.
// Using a relative path (`/pdfjs-dist/...`) caused the server's catch-all route to return
// index.html, leading to a MIME type error. This direct URL bypasses server routing
// and ensures the correct worker script is loaded.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://aistudiocdn.com/pdfjs-dist@4.4.168/build/pdf.worker.mjs';

interface FileUploadProps {
    onFileUpload: (documentId: string, fileName: string) => void;
    setIsLoading: (isLoading: boolean) => void;
    isLoading: boolean;
}

const extractTextFromFile = async (file: File): Promise<string> => {
    if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => (item as any).str).join(' ');
            fullText += '\n\n'; // Add space between pages
        }
        return fullText;
    } else {
        // For .txt, .md, etc.
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }
};

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, setIsLoading, isLoading }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setError(null);
        setFileName(file.name);

        try {
            // 1. Extract text on the client-side
            const text = await extractTextFromFile(file);

            if (!text.trim()) {
                throw new Error("Could not extract any text from the document.");
            }

            // 2. Send extracted text to the backend to start the processing job.
            const { documentId } = await processTextDocument(text, file.name);
            
            // 3. Notify parent component to start polling for embedding status.
            onFileUpload(documentId, file.name);

        } catch (err) {
            console.error("Error during file processing:", err);
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Processing failed. ${errorMessage}`);
            setFileName(null);
        } finally {
            // FIX: This must be called to reset the initial loading state and hand
            // control over to the main app's polling state (`isProcessing`).
            setIsLoading(false); 
        }
    }, [onFileUpload, setIsLoading]);

    const handleButtonClick = () => {
        fileInputRef.current?.click();
    };
    
    return (
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf, .txt, .md"
                disabled={isLoading}
            />
            <button
                onClick={handleButtonClick}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:bg-indigo-400"
                disabled={isLoading}
            >
                {isLoading && !fileName ? (
                    <>
                        <LoadingSpinner />
                        <span>Processing...</span>
                    </>
                ) : (
                    <>
                        <UploadIcon className="w-6 h-6 mr-2" />
                        Upload Study Material
                    </>
                )}
            </button>
            {fileName && !isLoading && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Loaded: <span className="font-semibold">{fileName}</span></p>}
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
    );
};

import React, { useState, useRef, useCallback } from 'react';
import { startProcessing, processBatch, finishProcessing } from '../services/apiService';
import { getSupabase } from '../services/supabaseClient';
import { UploadIcon, LoadingSpinner } from './common/Icons';
import { v4 as uuidv4 } from 'uuid';


interface FileUploadProps {
    onFileUpload: (documentId: string, fileName: string) => void;
    setIsLoading: (isLoading: boolean) => void;
    isLoading: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, setIsLoading, isLoading }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setError(null);
        setProgress(null);
        setFileName(file.name);

        try {
            // 1. Upload file directly to Supabase Storage to get a path
            const supabase = await getSupabase();
            const fileExt = file.name.split('.').pop();
            const filePath = `${uuidv4()}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, file);

            if (uploadError) {
                throw new Error('Failed to upload file to storage.');
            }

            // 2. Start the processing job on the backend
            const { jobId, documentId, totalChunks } = await startProcessing(filePath, file.type);

            if (totalChunks === 0) {
                 onFileUpload(documentId, file.name);
                 return;
            }

            setProgress({ processed: 0, total: totalChunks });

            // 3. Process the document in batches, driven by the client
            const BATCH_SIZE = 1; // This is the number of chunks per batch
            for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
                await processBatch(jobId, i, BATCH_SIZE);
                setProgress(p => ({ ...p!, processed: Math.min(i + BATCH_SIZE, totalChunks) }));
            }

            // 4. Finalize the job
            await finishProcessing(jobId);

            onFileUpload(documentId, file.name);

        } catch (err) {
            console.error("Error during file processing:", err);
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Processing failed. ${errorMessage}`);
            setFileName(null);
        } finally {
            setIsLoading(false);
            setProgress(null);
        }
    }, [onFileUpload, setIsLoading]);

    const handleButtonClick = () => {
        fileInputRef.current?.click();
    };

    const renderButtonContent = () => {
        if (isLoading && progress) {
            const percentage = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
            return (
                <div className="w-full text-center">
                    <p className="text-sm font-semibold">Processing... {percentage}%</p>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-2">
                        <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${percentage}%`, transition: 'width 0.3s ease-in-out' }}></div>
                    </div>
                </div>
            );
        }
        if (isLoading) {
             return (
                 <>
                    <LoadingSpinner />
                    <span>Uploading...</span>
                 </>
             )
        }
        return (
            <>
                <UploadIcon className="w-6 h-6 mr-2" />
                Upload Study Material
            </>
        );
    };

    return (
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".txt, .md, .pdf"
                disabled={isLoading}
            />
            <button
                onClick={handleButtonClick}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:bg-indigo-400"
                disabled={isLoading}
            >
                {renderButtonContent()}
            </button>
            {fileName && !isLoading && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Loaded: <span className="font-semibold">{fileName}</span></p>}
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
    );
};
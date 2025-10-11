import React, { useState, useRef, useCallback } from 'react';
import { uploadDocument } from '../services/apiService';
import { UploadIcon, LoadingSpinner } from './common/Icons';

interface FileUploadProps {
    onFileUpload: (documentId: string, fileName: string) => void;
    setIsLoading: (isLoading: boolean) => void;
    isLoading: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, setIsLoading, isLoading }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setIsLoading(true);
            setError(null);
            setFileName(file.name);

            try {
                const { documentId } = await uploadDocument(file);
                onFileUpload(documentId, file.name);
            } catch (err) {
                console.error("Error uploading file:", err);
                const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
                setError(`Failed to upload and process the file. ${errorMessage}`);
                setFileName(null);
            } finally {
                setIsLoading(false);
            }
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
                accept=".txt, .md, .pdf"
            />
            <button
                onClick={handleButtonClick}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:bg-indigo-400"
                disabled={isLoading}
            >
                {isLoading ? (
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
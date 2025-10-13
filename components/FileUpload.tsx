
import React, { useState, useRef, useCallback } from 'react';
import { UploadIcon, LoadingSpinner } from './common/Icons';

interface FileUploadProps {
    onFilesUpload: (files: File[]) => void;
    isProcessing: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFilesUpload, isProcessing }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        onFilesUpload(Array.from(files));

        // Reset the input so the user can upload the same file(s) again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [onFilesUpload]);

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
                disabled={isProcessing}
                multiple // Allow multiple files to be selected
            />
            <button
                onClick={handleButtonClick}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:bg-indigo-400 disabled:cursor-not-allowed"
                disabled={isProcessing}
            >
                {isProcessing ? (
                    <>
                        <LoadingSpinner />
                        <span>Processing...</span>
                    </>
                ) : (
                    <>
                        <UploadIcon className="w-6 h-6 mr-2" />
                        Upload Study Materials
                    </>
                )}
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">You can select multiple files.</p>
        </div>
    );
};

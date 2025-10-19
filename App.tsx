
import React, { useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { ChatWindow } from './components/ChatWindow';
import { QuizView } from './components/QuizView';
import { FlashcardView } from './components/FlashcardView';
import { postMessage, fetchQuiz, fetchFlashcards, getDocumentStatus, processTextDocument } from './services/apiService';
import { Message, StudyAid, ViewType, Quiz, Flashcard } from './types';
import { ChatIcon, QuizIcon, FlashcardIcon, LoadingSpinner, PageLoader, DocumentIcon, TrashIcon } from './components/common/Icons';
import { useToast } from './components/ToastProvider';

// Use local pdfjs-dist with an ESM worker under Vite
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;


const POLLING_INTERVAL_MS = 2000;

const extractTextFromFile = async (file: File): Promise<string> => {
    if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => (item as any).str).join(' ');
            fullText += '\n\n';
        }
        return fullText;
    } else {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }
};


const App: React.FC = () => {
    const [documents, setDocuments] = useState<{ id: string, name: string }[]>([]);
    const [isUploading, setIsUploading] = useState<boolean>(false); // For initial file read + API call
    const [isProcessing, setIsProcessing] = useState<boolean>(false); // For backend embedding generation
    const [processingProgress, setProcessingProgress] = useState(0);
    const [processingMessage, setProcessingMessage] = useState<string>('Processing Document...');
    const [chatHistory, setChatHistory] = useState<Message[]>([]);
    const [studyAid, setStudyAid] = useState<StudyAid>(null);
    const [currentView, setCurrentView] = useState<ViewType>('chat');
    const [isLoading, setIsLoading] = useState<boolean>(false); // For study aid generation
    const [error, setError] = useState<string | null>(null);

    const pollingIntervalRef = useRef<number | null>(null);
    const { addToast, addPersistentToast } = useToast();

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);
    
    useEffect(() => {
        if (isProcessing && documents.length > 0) {
            // Clear previous poller if it exists
            stopPolling();
            const progressToast = addPersistentToast('Generating embeddings... 0%', 'info');

            pollingIntervalRef.current = window.setInterval(async () => {
                try {
                    const statuses = await Promise.all(documents.map(doc => getDocumentStatus(doc.id)));

                    const totalProgress = statuses.reduce((sum, s) => sum + s.progress, 0) / statuses.length;
                    const allFinished = statuses.every(s => s.isFinished);
                    const anyFailed = statuses.some(s => s.hasFailed);

                    const percent = Math.round(totalProgress);
                    setProcessingProgress(percent);
                    
                    if (allFinished) {
                        stopPolling();
                        setIsProcessing(false);
                        if (anyFailed) {
                           setError("Some documents failed to process. Results may be incomplete.");
                        }
                        progressToast.update('Processing complete', 'success');
                        window.setTimeout(() => progressToast.dismiss(), 1200);
                    } else {
                         setProcessingMessage(`Generating embeddings...`);
                         // In-place update of progress
                         progressToast.update(`Generating embeddings... ${percent}%`, 'info');
                    }
                } catch (err) {
                    console.error("Polling error:", err);
                    setError("Failed to get document status. Please try reloading.");
                    setIsProcessing(false);
                    stopPolling();
                    progressToast.update('Failed to get status', 'error');
                    window.setTimeout(() => progressToast.dismiss(), 1500);
                }
            }, POLLING_INTERVAL_MS);
        }

        return () => stopPolling();
    }, [isProcessing, documents, stopPolling, addPersistentToast]);


    const handleFilesUpload = useCallback(async (files: File[]) => {
        setIsUploading(true);
        setError(null);
        setProcessingProgress(0);
        setProcessingMessage(`Extracting text from ${files.length} new document(s)...`);
        
        try {
            const uploadPromises = files.map(async (file) => {
                const text = await extractTextFromFile(file);
                if (!text.trim()) {
                    console.warn(`Skipping empty file: ${file.name}`);
                    return null;
                }
                const { documentId } = await processTextDocument(text, file.name);
                return { id: documentId, name: file.name };
            });

            const results = (await Promise.all(uploadPromises)).filter(res => res !== null) as { id: string, name: string }[];
            
            if (results.length > 0) {
                setDocuments(prevDocs => [...prevDocs, ...results]);
                setProcessingMessage('Initializing processing...');
                setIsProcessing(true); // This triggers the poller with the updated documents list
                addToast(`Added ${results.length} document(s)`, 'success');
            } else if (files.length > 0) {
                 throw new Error("None of the selected files could be processed or they were empty.");
            }

        } catch(err) {
            const message = err instanceof Error ? err.message : "An unknown error occurred during upload.";
            setError(message);
            addToast(message, 'error');
        } finally {
            setIsUploading(false);
        }
    }, []);

    const handleClearSession = useCallback(() => {
        stopPolling();
        setDocuments([]);
        setChatHistory([]);
        setStudyAid(null);
        setCurrentView('chat');
        setIsProcessing(false);
        setIsUploading(false);
        setError(null);
        setProcessingProgress(0);
        setProcessingMessage('Processing Document...');
        addToast('Session cleared', 'info');
    }, [stopPolling]);

    const handleRemoveDocument = useCallback((documentId: string) => {
        // Remove a single document from the active session
        setDocuments(prev => prev.filter(d => d.id !== documentId));
    }, []);


    const handleSendMessage = useCallback(async (message: string) => {
        if (documents.length === 0) return;
        const controller = new AbortController();
        const documentIds = documents.map(d => d.id);
        const userMessage: Message = { role: 'user', text: message };
        setChatHistory(prev => [...prev, userMessage]);
        setIsLoading(true);

        const historySnapshot = [...chatHistory, userMessage];

        try {
            const response = await postMessage(documentIds, historySnapshot, message);
            const modelMessage: Message = { role: 'model', text: response.text, sources: response.sources };
            setChatHistory(prev => [...prev, modelMessage]);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred';
            setChatHistory(prev => [...prev, {role: 'model', text: `Sorry, I encountered an error: ${errorMessage}`}]);
            addToast(errorMessage, 'error');
        } finally {
            setIsLoading(false);
            controller.abort();
        }
    }, [documents, chatHistory]);

    const handleGenerateStudyAid = async (type: 'quiz' | 'flashcards') => {
        if (documents.length === 0) return;
        
        const documentIds = documents.map(d => d.id);
        setIsLoading(true);
        setCurrentView(type);
        setStudyAid(null);
        setError(null);

        try {
            if (type === 'quiz') {
                const quiz = await fetchQuiz(documentIds);
                setStudyAid(quiz);
                addToast('Quiz generated', 'success');
            } else {
                const flashcards = await fetchFlashcards(documentIds);
                setStudyAid(flashcards);
                addToast('Flashcards generated', 'success');
            }
        } catch (e) {
            setError(`Failed to generate ${type}. Please try again.`);
            console.error(e);
            addToast(`Failed to generate ${type}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };
    
    const renderProcessingOverlay = () => (
        <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex flex-col items-center justify-center z-10 text-center p-4">
            <LoadingSpinner />
            <h3 className="mt-4 text-lg font-semibold">{processingMessage} ({processingProgress}%)</h3>
            <div className="w-full max-w-md bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-2">
                <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${processingProgress}%` }}></div>
            </div>
            <p className="text-slate-600 dark:text-slate-400 mt-2">This may take a few moments. We're preparing your study materials...</p>
        </div>
    );

    const renderContent = (): ReactNode => {
        if (isLoading && (currentView === 'quiz' || currentView === 'flashcards')) {
            return (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg h-full flex flex-col items-center justify-center">
                     <PageLoader />
                     <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">Generating {currentView}... this might take a moment.</p>
                </div>
            )
        }
        
        if (error && currentView !== 'chat') {
             return <div className="text-center p-8 text-red-500">{error}</div>;
        }

        switch (currentView) {
            case 'quiz':
                if (studyAid && !Array.isArray(studyAid)) return <QuizView quiz={studyAid as Quiz} />;
                return null;
            case 'flashcards':
                if (studyAid && Array.isArray(studyAid)) return <FlashcardView flashcards={studyAid as Flashcard[]} />;
                return null;
            case 'chat':
            default:
                return <ChatWindow messages={chatHistory} onSendMessage={handleSendMessage} isLoading={isLoading || isProcessing || isUploading} />;
        }
    }

    const isUiDisabled = isLoading || isProcessing || isUploading;

    return (
        <div className="min-h-screen flex flex-col md:flex-row text-slate-800 dark:text-slate-200">
            <aside className="w-full md:w-96 bg-white dark:bg-slate-800 p-6 flex flex-col space-y-6 border-r border-slate-200 dark:border-slate-700">
                <header>
                    <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">Study Sidekick</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Your AI-powered learning partner.</p>
                </header>

                <FileUpload onFilesUpload={handleFilesUpload} isProcessing={isUploading || isProcessing} />

                {documents.length > 0 && (
                    <div className={`flex-grow flex flex-col space-y-4 transition-opacity ${isProcessing ? 'opacity-50' : 'opacity-100'}`}>
                        <div className="p-4 bg-slate-100 dark:bg-slate-900/50 rounded-lg">
                           <div className="flex justify-between items-center mb-2">
                               <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Loaded Materials:</h3>
                                <button
                                    onClick={handleClearSession}
                                    className="text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Start New Session"
                                    aria-label="Start new session"
                                    disabled={isUiDisabled}
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                           </div>
                           <ul className="space-y-2">
                                {documents.map(doc => (
                                    <li key={doc.id} className="flex items-center justify-between text-sm text-indigo-600 dark:text-indigo-400">
                                        <div className="flex items-center min-w-0">
                                            <DocumentIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                                            <span className="truncate" title={doc.name}>{doc.name}</span>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveDocument(doc.id)}
                                            className="ml-3 text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 disabled:opacity-50"
                                            title="Remove document"
                                            aria-label={`Remove ${doc.name}`}
                                            disabled={isUiDisabled}
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                           </ul>
                           {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                        </div>

                        <h2 className="text-xl font-semibold border-b border-slate-200 dark:border-slate-700 pb-2">Tools</h2>
                        <fieldset disabled={isUiDisabled} className="contents">
                            <nav className="flex flex-col space-y-2">
                               <button onClick={() => setCurrentView('chat')} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${currentView === 'chat' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                    <ChatIcon className="w-6 h-6" />
                                    <span>Chat with Documents</span>
                                </button>
                                <button onClick={() => handleGenerateStudyAid('quiz')} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${currentView === 'quiz' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                    <QuizIcon className="w-6 h-6" />
                                    <span>Generate Quiz</span>
                                </button>
                                 <button onClick={() => handleGenerateStudyAid('flashcards')} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${currentView === 'flashcards' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                    <FlashcardIcon className="w-6 h-6" />
                                    <span>Generate Flashcards</span>
                                </button>
                            </nav>
                        </fieldset>
                    </div>
                )}
            </aside>

            <main className="flex-1 p-6 bg-slate-100 dark:bg-slate-900">
                {documents.length === 0 && !isProcessing && !isUploading ? (
                    <div className="flex items-center justify-center h-full bg-white dark:bg-slate-800 rounded-lg shadow-inner">
                        <div className="text-center text-slate-500 dark:text-slate-400">
                            <h2 className="text-2xl font-semibold">Welcome to Study Sidekick</h2>
                            <p className="mt-2">Upload your study materials (.pdf, .txt, or .md) to get started.</p>
                        </div>
                    </div>
                ) : (
                    <div className="h-full relative">
                        {isProcessing && renderProcessingOverlay()}
                        <div className={`${isProcessing ? 'blur-sm' : ''}`}>
                            {renderContent()}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default App;

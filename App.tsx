
import React, { useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { ChatWindow } from './components/ChatWindow';
import { QuizView } from './components/QuizView';
import { FlashcardView } from './components/FlashcardView';
import { postMessage, fetchQuiz, fetchFlashcards, getDocumentStatus } from './services/apiService';
import { Message, StudyAid, ViewType, Quiz, Flashcard } from './types';
import { ChatIcon, QuizIcon, FlashcardIcon, LoadingSpinner } from './components/common/Icons';

const App: React.FC = () => {
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [documentName, setDocumentName] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [chatHistory, setChatHistory] = useState<Message[]>([]);
    const [studyAid, setStudyAid] = useState<StudyAid>(null);
    const [currentView, setCurrentView] = useState<ViewType>('chat');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const pollingIntervalRef = useRef<number | null>(null);

    const stopPolling = () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    };

    useEffect(() => {
        if (isProcessing && documentId) {
            pollingIntervalRef.current = window.setInterval(async () => {
                try {
                    const status = await getDocumentStatus(documentId);
                    setProcessingProgress(status.progress);
                    
                    // Check if the overall processing job has concluded (either success or failure)
                    if (status.isFinished) {
                        stopPolling(); // Stop polling immediately
                        setIsProcessing(false); // Hide the processing overlay

                        if (status.hasFailed) {
                            setError("Document processing completed, but some parts failed. Results may be incomplete.");
                        }
                        // Always set progress to 100% when finished to avoid a stuck progress bar
                        setProcessingProgress(100);
                    }
                } catch (err) {
                    console.error("Polling error:", err);
                    setError("Failed to get document status. Please try reloading.");
                    setIsProcessing(false);
                    stopPolling();
                }
            }, 3000);
        }

        return () => stopPolling();
    }, [isProcessing, documentId]);


    const handleFileUpload = useCallback((newDocumentId: string, fileName: string) => {
        setDocumentId(newDocumentId);
        setDocumentName(fileName);
        setChatHistory([]);
        setStudyAid(null);
        setCurrentView('chat');
        setError(null);
        setProcessingProgress(0);
        setIsProcessing(true); // Start polling
    }, []);

    const handleSendMessage = useCallback(async (message: string) => {
        if (!documentId) return;
        
        const userMessage: Message = { role: 'user', text: message };
        setChatHistory(prev => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const response = await postMessage(documentId, chatHistory, message);
            const modelMessage: Message = { role: 'model', text: response.text, sources: response.sources };
            setChatHistory(prev => [...prev, modelMessage]);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred';
            setChatHistory(prev => [...prev, {role: 'model', text: `Sorry, I encountered an error: ${errorMessage}`}]);
        } finally {
            setIsLoading(false);
        }
    }, [documentId, chatHistory]);

    const handleGenerateStudyAid = async (type: 'quiz' | 'flashcards') => {
        if (!documentId) return;
        
        setIsLoading(true);
        setCurrentView(type);
        setStudyAid(null);
        setError(null);

        try {
            if (type === 'quiz') {
                const quiz = await fetchQuiz(documentId);
                setStudyAid(quiz);
            } else {
                const flashcards = await fetchFlashcards(documentId);
                setStudyAid(flashcards);
            }
        } catch (e) {
            setError(`Failed to generate ${type}. Please try again.`);
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };
    
    const renderProcessingOverlay = () => (
        <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex flex-col items-center justify-center z-10">
            <LoadingSpinner />
            <h3 className="mt-4 text-lg font-semibold">Processing Document ({processingProgress}%)</h3>
            <p className="text-slate-600 dark:text-slate-400">This may take a few moments. We're preparing your study materials...</p>
        </div>
    );

    const renderContent = (): ReactNode => {
        if (isLoading && (currentView === 'quiz' || currentView === 'flashcards')) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 dark:text-slate-300">
                     <LoadingSpinner />
                     <p className="mt-4 text-lg">Generating {currentView}... this might take a moment.</p>
                </div>
            )
        }
        
        if (error && currentView !== 'chat') { // Show specific error for study aids
             return <div className="text-center p-8 text-red-500">{error}</div>;
        }

        switch (currentView) {
            case 'quiz':
                if (studyAid && !Array.isArray(studyAid)) {
                    return <QuizView quiz={studyAid as Quiz} />;
                }
                return null;
            case 'flashcards':
                if (studyAid && Array.isArray(studyAid)) {
                    return <FlashcardView flashcards={studyAid as Flashcard[]} />;
                }
                return null;
            case 'chat':
            default:
                return (
                     <ChatWindow
                        messages={chatHistory}
                        onSendMessage={handleSendMessage}
                        isLoading={isLoading}
                    />
                );
        }
    }

    const isUiDisabled = isLoading || isProcessing;

    return (
        <div className="min-h-screen flex flex-col md:flex-row text-slate-800 dark:text-slate-200">
            <aside className="w-full md:w-96 bg-white dark:bg-slate-800 p-6 flex flex-col space-y-6 border-r border-slate-200 dark:border-slate-700">
                <header>
                    <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">Study Sidekick</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Your AI-powered learning partner.</p>
                </header>

                <FileUpload onFileUpload={handleFileUpload} setIsLoading={setIsLoading} isLoading={isLoading || isProcessing} />

                {documentId && (
                    <div className={`flex-grow flex flex-col space-y-4 transition-opacity ${isProcessing ? 'opacity-50' : 'opacity-100'}`}>
                        <div className="p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg">
                           <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Current Document:</p>
                           <p className="text-sm text-indigo-600 dark:text-indigo-400 truncate">{documentName}</p>
                           {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                        </div>
                        <h2 className="text-xl font-semibold border-b border-slate-200 dark:border-slate-700 pb-2">Tools</h2>
                        <fieldset disabled={isUiDisabled} className="contents">
                            <nav className="flex flex-col space-y-2">
                               <button onClick={() => setCurrentView('chat')} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${currentView === 'chat' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                    <ChatIcon className="w-6 h-6" />
                                    <span>Chat with Document</span>
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
                {!documentId ? (
                    <div className="flex items-center justify-center h-full bg-white dark:bg-slate-800 rounded-lg shadow-inner">
                        <div className="text-center text-slate-500 dark:text-slate-400">
                            <h2 className="text-2xl font-semibold">Welcome to Study Sidekick</h2>
                            <p className="mt-2">Upload your study material (.pdf, .txt, or .md) to get started.</p>
                        </div>
                    </div>
                ) : (
                    <div className="h-full relative">
                        {isProcessing && renderProcessingOverlay()}
                        {renderContent()}
                    </div>
                )}
            </main>
        </div>
    );
};

export default App;

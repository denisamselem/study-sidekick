import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { SendIcon, LoadingSpinner } from './common/Icons';

interface ChatWindowProps {
    messages: Message[];
    onSendMessage: (message: string) => void;
    isLoading: boolean;
}

const SourceViewer: React.FC<{ sources: NonNullable<Message['sources']> }> = ({ sources }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (!sources || sources.length === 0) {
        return null;
    }

    return (
        <div className="mt-2">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-xs text-indigo-500 dark:text-indigo-400 hover:underline"
            >
                {isOpen ? 'Hide Sources' : 'View Sources'}
            </button>
            {isOpen && (
                <div className="mt-2 space-y-2 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                    <h4 className="font-semibold text-xs text-slate-600 dark:text-slate-300">Sources:</h4>
                    {sources.map((source, index) => (
                        <div key={index} className="border-t border-slate-200 dark:border-slate-600 pt-2">
                            <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap font-mono">
                                {source.content}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


export const ChatWindow: React.FC<ChatWindowProps> = ({ messages, onSendMessage, isLoading }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSend = () => {
        if (input.trim()) {
            onSendMessage(input.trim());
            setInput('');
        }
    };
    
    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !isLoading) {
            handleSend();
        }
    }

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-lg shadow-lg">
            <div className="flex-1 p-6 overflow-y-auto">
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                        <p>Ask a question about your uploaded document to get started.</p>
                    </div>
                ) : (
                    messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
                            <div className={`max-w-xl px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>
                               <p className="whitespace-pre-wrap">{msg.text}</p>
                               {msg.role === 'model' && msg.sources && <SourceViewer sources={msg.sources} />}
                            </div>
                        </div>
                    ))
                )}
                 {isLoading && messages.length > 0 && messages[messages.length-1].role === 'user' && (
                     <div className="flex justify-start mb-4">
                         <div className="max-w-lg px-4 py-3 rounded-2xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                             <div className="flex items-center">
                                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse mr-2"></div>
                                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse delay-75 mr-2"></div>
                                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse delay-150"></div>
                             </div>
                         </div>
                     </div>
                 )}
                <div ref={messagesEndRef} />
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <div className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask a follow-up question..."
                        className="w-full py-3 pl-4 pr-12 text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-900 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors"
                        disabled={isLoading || !input.trim()}
                    >
                        {isLoading ? <LoadingSpinner /> : <SendIcon className="w-5 h-5" />}
                    </button>
                </div>
            </div>
        </div>
    );
};
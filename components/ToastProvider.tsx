import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type ToastType = 'info' | 'success' | 'error';

export type Toast = {
    id: string;
    message: string;
    type: ToastType;
};

type ToastHandle = { dismiss: () => void; update: (message: string, type?: ToastType) => void };

type ToastContextValue = {
    addToast: (message: string, type?: ToastType, durationMs?: number) => void;
    addPersistentToast: (message: string, type?: ToastType) => ToastHandle;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = (): ToastContextValue => {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const addToast = useCallback((message: string, type: ToastType = 'info', durationMs: number = 3500) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts(prev => [...prev, { id, message, type }]);
        window.setTimeout(() => removeToast(id), durationMs);
    }, [removeToast]);

    const addPersistentToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts(prev => [...prev, { id, message, type }]);
        const update = (nextMessage: string, nextType: ToastType = type) => {
            setToasts(prev => prev.map(t => t.id === id ? { ...t, message: nextMessage, type: nextType } : t));
        };
        return { dismiss: () => removeToast(id), update };
    }, [removeToast]);

    const value = useMemo(() => ({ addToast, addPersistentToast }), [addToast, addPersistentToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="fixed bottom-4 right-4 z-50 space-y-2">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        className={
                            `min-w-[240px] max-w-sm px-4 py-3 rounded-lg shadow-lg border transition ` +
                            (t.type === 'success' ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-200' :
                             t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200' :
                             'bg-slate-50 border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100')
                        }
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-start justify-between">
                            <span className="pr-3">{t.message}</span>
                            <button
                                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                aria-label="Dismiss notification"
                                onClick={() => removeToast(t.id)}
                            >
                                ×
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};



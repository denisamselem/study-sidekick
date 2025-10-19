import React from 'react';

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.error('Uncaught error:', error);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900">
                    <div className="p-6 bg-white dark:bg-slate-800 rounded-lg shadow">
                        <h2 className="text-xl font-semibold mb-2">Something went wrong.</h2>
                        <p className="text-slate-600 dark:text-slate-300">Please reload the page and try again.</p>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}



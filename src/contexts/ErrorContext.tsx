import React, { createContext, useState, useContext, ReactNode } from 'react';
import { AlertTriangle, XCircle, X } from 'lucide-react';

export interface ErrorDetails {
  code: string;
  message: string;
  cause: string;
  fix: string;
}

interface ErrorContextType {
  showError: (error: ErrorDetails | any) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ErrorDetails | null>(null);

  const showError = (err: any) => {
    console.error('System Error Captured:', err);
    if (err && err.code && err.message) {
      setError(err as ErrorDetails);
    } else if (err instanceof Error) {
      setError({
        code: 'UNKNOWN_ERROR',
        message: err.message,
        cause: 'An unexpected client-side error occurred.',
        fix: 'Try refreshing the page or restarting the app.'
      });
    } else {
      setError({
        code: 'UNKNOWN_ERROR',
        message: 'An unknown error occurred.',
        cause: JSON.stringify(err),
        fix: 'Try refreshing the page.'
      });
    }
  };

  const clearError = () => setError(null);

  return (
    <ErrorContext.Provider value={{ showError, clearError }}>
      {children}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-red-50 dark:bg-red-900/20">
              <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-6 h-6" />
                <h2 className="text-lg font-semibold">System Error</h2>
              </div>
              <button 
                onClick={clearError}
                className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">Message</h3>
                <p className="text-neutral-900 dark:text-neutral-100 font-medium text-lg">
                  {error.message}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 font-mono">
                  Error Code: {error.code}
                </p>
              </div>

              <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-4 space-y-3 border border-neutral-100 dark:border-neutral-800">
                <div>
                  <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Root Cause</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {error.cause}
                  </p>
                </div>
                
                <div className="h-px bg-neutral-200 dark:bg-neutral-700 w-full" />
                
                <div>
                  <h3 className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-1">Possible Fix</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {error.fix}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-neutral-50 dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-3">
              <button
                onClick={() => {
                  console.log('Reporting error to devs:', error);
                  alert('Error report simulated. In production, this would send telemetry to the developers.');
                  clearError();
                }}
                className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg transition-colors"
              >
                Report to Devs
              </button>
              <button
                onClick={clearError}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </ErrorContext.Provider>
  );
}

export function useError() {
  const context = useContext(ErrorContext);
  if (context === undefined) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
}

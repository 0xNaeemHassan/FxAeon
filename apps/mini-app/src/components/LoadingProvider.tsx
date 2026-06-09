'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface LoadingContextType {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  loadingMessage: string;
  setLoadingMessage: (message: string) => void;
  loadingProgress: number | null;
  setLoadingProgress: (progress: number | null) => void;
  showLoading: (message?: string) => void;
  hideLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<string[]>([]);

  const showLoading = useCallback((message?: string) => {
    const msg = message || 'Loading...';
    setLoadingMessage(msg);
    setLoadingHistory(prev => [...prev, msg]);
    setIsLoading(true);
    setLoadingProgress(null);
  }, []);

  const hideLoading = useCallback(() => {
    setIsLoading(false);
    setLoadingProgress(null);
    setLoadingHistory([]);
  }, []);

  return (
    <LoadingContext.Provider 
      value={{ 
        isLoading, 
        setIsLoading, 
        loadingMessage, 
        setLoadingMessage,
        loadingProgress,
        setLoadingProgress,
        showLoading,
        hideLoading,
      }}
    >
      {children}
      
      {isLoading && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={loadingMessage}
        >
          {/* Backdrop with blur */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {}} /* Prevent clicks while loading */
            aria-hidden="true"
          />
          
          {/* Loading card */}
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-2xl flex flex-col items-center max-w-xs w-full mx-4 border border-slate-200 dark:border-slate-700">
            {/* Animated spinner */}
            <div className="relative mb-5">
              <div className="w-12 h-12 rounded-full border-4 border-slate-200 dark:border-slate-600" />
              <div 
                className="absolute inset-0 w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"
                aria-hidden="true"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg 
                  className="w-5 h-5 text-blue-600 animate-pulse" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            
            {/* Message */}
            <p className="text-slate-800 dark:text-slate-100 font-medium text-center mb-3">
              {loadingMessage}
            </p>
            
            {/* Progress bar */}
            {loadingProgress !== null && (
              <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 mb-3 overflow-hidden">
                <div 
                  className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, loadingProgress))}%` }}
                  role="progressbar"
                  aria-valuenow={loadingProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            )}
            
            {/* Loading history dots */}
            {loadingHistory.length > 1 && (
              <div className="flex gap-1.5 mt-1">
                {loadingHistory.slice(-5).map((_, i) => (
                  <div 
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                      i === loadingHistory.slice(-5).length - 1 
                        ? 'bg-blue-600 scale-125' 
                        : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            
            {/* Subtle hint */}
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-center">
              This may take a few seconds
            </p>
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
}

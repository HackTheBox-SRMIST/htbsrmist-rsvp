'use client';

import React, { useEffect } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  visible: boolean;
  onClose: () => void;
  position?: 'top' | 'bottom';
}

export default function Toast({
  message,
  type,
  visible,
  onClose,
  position = 'bottom',
}: ToastProps) {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        onClose();
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [visible, onClose]);

  if (!visible) return null;

  const getTypeStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          icon: (
            <svg className="w-4 h-4 text-htb-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ),
          borderColor: 'border-htb-green/40',
          bgColor: 'bg-htb-card',
        };
      case 'error':
        return {
          icon: (
            <svg className="w-4 h-4 text-htb-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          borderColor: 'border-htb-error/40',
          bgColor: 'bg-htb-card',
        };
      case 'warning':
        return {
          icon: (
            <svg className="w-4 h-4 text-htb-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          borderColor: 'border-htb-warning/40',
          bgColor: 'bg-htb-card',
        };
      case 'info':
        return {
          icon: (
            <svg className="w-4 h-4 text-htb-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          borderColor: 'border-htb-border',
          bgColor: 'bg-htb-card',
        };
    }
  };

  const styles = getTypeStyles(type);

  return (
    <div
      className={`fixed z-50 animate-slide-up ${
        position === 'top'
          ? 'top-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-auto sm:min-w-[320px] max-w-md'
          : 'bottom-5 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:w-auto sm:min-w-[320px] max-w-md'
      }`}
    >
      <div
        className={`${styles.bgColor} border ${styles.borderColor} p-3.5 shadow-2xl rounded-xl flex items-center justify-between gap-3`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {styles.icon}
          <span className="text-htb-heading text-xs font-medium break-words">{message}</span>
        </div>
        <button
          onClick={onClose}
          className="text-htb-muted hover:text-htb-heading p-1 transition-colors shrink-0"
          aria-label="Close toast"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

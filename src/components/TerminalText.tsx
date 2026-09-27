'use client';

import React, { useState, useEffect } from 'react';

interface TerminalTextProps {
  lines: string[];
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

export default function TerminalText({ lines, speed = 20, className = '', onComplete }: TerminalTextProps) {
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (currentLineIndex >= lines.length) {
      if (!isComplete) {
        setIsComplete(true);
        if (onComplete) onComplete();
      }
      return;
    }

    const targetLine = lines[currentLineIndex];
    
    if (currentText === targetLine) {
      const timer = setTimeout(() => {
        setCurrentLineIndex(prev => prev + 1);
        setCurrentText('');
      }, speed * 10);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setCurrentText(targetLine.substring(0, currentText.length + 1));
    }, speed);

    return () => clearTimeout(timer);
  }, [currentText, currentLineIndex, lines, speed, isComplete, onComplete]);

  return (
    <div className={`font-mono text-sm space-y-1 ${className}`}>
      {lines.slice(0, currentLineIndex).map((line, idx) => (
        <div key={idx} className="flex">
          <span className="text-[#9fef00] mr-2">&gt;</span>
          <span className="text-[#c5c8c6]">{line}</span>
        </div>
      ))}
      
      {currentLineIndex < lines.length && (
        <div className="flex">
          <span className="text-[#9fef00] mr-2">&gt;</span>
          <span className="text-[#c5c8c6]">
            {currentText}
            <span className="inline-block w-2 h-4 bg-[#9fef00] ml-1 animate-pulse" />
          </span>
        </div>
      )}
    </div>
  );
}

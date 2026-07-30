import React from 'react';
import { cn } from '../../lib/cn';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded-lg text-fog',
        'hover:text-bone hover:bg-line/50 transition-colors duration-150',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        '[&_svg]:w-[14px] [&_svg]:h-[14px]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

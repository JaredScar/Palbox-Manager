import React from 'react';
import { cn } from '../../lib/cn';

interface PanelSectionProps {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  noPad?: boolean;
  className?: string;
}

export function PanelSection({ title, description, children, noPad, className }: PanelSectionProps) {
  return (
    <div
      className={cn(
        'bg-panel border border-line/80 rounded-2xl mb-5',
        !noPad && 'p-5',
        className,
      )}
    >
      {(title || description) && (
        <div className={cn(noPad && 'px-5 pt-5', 'mb-4')}>
          {title && (
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[11px] uppercase tracking-[0.09em] text-fog font-semibold">
                {title}
              </div>
            </div>
          )}
          {description && (
            <p className="text-[12.5px] text-fog/80 leading-relaxed">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

export function ToggleRow({ label, description, children }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 border-b border-line last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-bone">{label}</div>
        {description && <div className="text-[11.5px] text-fog mt-0.5 leading-snug">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

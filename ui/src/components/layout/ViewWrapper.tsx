import React from 'react';

interface ViewWrapperProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  accentVar?: string;
}

export function ViewWrapper({ eyebrow, title, description, actions, children, accentVar }: ViewWrapperProps) {
  return (
    <main className="flex-1 overflow-y-auto p-8 min-h-0">
      <div className="flex items-start justify-between gap-6 mb-7 pb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="min-w-0">
          <div
            className="text-[10px] uppercase tracking-[0.14em] font-bold mb-2 flex items-center gap-1.5"
            style={{ color: accentVar ?? 'var(--fog)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {eyebrow}
          </div>
          <h1 className="text-[26px] font-display font-bold text-bone leading-none mb-1.5">{title}</h1>
          {description && (
            <p className="text-[12.5px] text-fog/80 leading-relaxed max-w-xl">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0 pt-1">{actions}</div>
        )}
      </div>
      {children}
    </main>
  );
}

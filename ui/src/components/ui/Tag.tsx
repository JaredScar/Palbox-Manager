import { cn } from '../../lib/cn';

type TagVariant = 'auto' | 'manual' | 'whitelist' | 'banned' | 'enabled' | 'disabled';

const VARIANTS: Record<TagVariant, string> = {
  auto:      'bg-aqua/15 text-aqua border-aqua/30',
  manual:    'bg-violet/15 text-violet border-violet/30',
  whitelist: 'bg-lime/15 text-lime border-lime/30',
  banned:    'bg-rust/15 text-rust border-rust/30',
  enabled:   'bg-lime/15 text-lime border-lime/30',
  disabled:  'bg-fog/10 text-fog border-fog/20',
};

export function Tag({ variant, children }: { variant: TagVariant; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-mono font-medium border uppercase tracking-wider',
        VARIANTS[variant],
      )}
    >
      {children}
    </span>
  );
}

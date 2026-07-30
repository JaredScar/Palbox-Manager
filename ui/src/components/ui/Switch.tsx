import { cn } from '../../lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function Switch({ checked, onChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0',
        checked ? 'bg-lime' : 'bg-line',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-void transition-transform duration-200',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

import { useState } from 'react';
import { cn } from '../lib/cn';

interface PalIconProps {
  /** Icon file name from the dex, without extension. */
  icon: string | null;
  name: string;
  size?: number;
  className?: string;
}

/**
 * Icons ship with the panel rather than being fetched from a wiki, so they work
 * on a server with no outbound internet. A handful of raid-boss body parts have
 * no artwork at all, which falls back to an initial.
 */
export function PalIcon({ icon, name, size = 48, className }: PalIconProps) {
  const [failed, setFailed] = useState(false);

  if (!icon || failed) {
    return (
      <div
        className={cn('rounded-full bg-line/60 flex items-center justify-center text-fog font-bold shrink-0', className)}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        title={name}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={`/pals/${icon}.webp`}
      alt={name}
      title={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('rounded-full bg-ink/40 object-cover shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
}

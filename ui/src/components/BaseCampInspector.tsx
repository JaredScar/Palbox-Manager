import { useEffect, useState, useMemo } from 'react';
import { useInstance } from '../context/InstanceContext';
import { PalIcon } from './PalIcon';
import { cn } from '../lib/cn';
import { dexIndex, lookup, WORK_LABELS } from '../lib/palDex';
import { worldToGameCoords } from '../lib/mapProject';
import type { BaseCampDetail, BaseWorker, PalDexEntry } from '../api/client';

/**
 * Everything a base camp can be staffed for. Showing the jobs with nobody on
 * them is the whole point, so the list is fixed rather than derived from the
 * workers present.
 */
const WORK_TYPES = Object.keys(WORK_LABELS);

interface Coverage {
  work: string;
  best: number;
  workers: number;
}

/**
 * A base's ability at a job is really its best worker plus how many can share
 * the load, so both are reported rather than a single total.
 */
function coverage(workers: BaseWorker[]): Coverage[] {
  return WORK_TYPES.map((work) => {
    const able = workers.filter((w) => (w.work[work] ?? 0) > 0 && !w.sick);
    return {
      work,
      best: able.reduce((n, w) => Math.max(n, w.work[work] ?? 0), 0),
      workers: able.length,
    };
  });
}

function WorkerRow({ worker, entry }: { worker: BaseWorker; entry: PalDexEntry | null }) {
  const jobs = Object.entries(worker.work)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${WORK_LABELS[k] ?? k} ${v}`);

  const sanityColour =
    worker.sanity >= 70 ? 'text-emerald-400' :
    worker.sanity >= 40 ? 'text-amber-300' : 'text-rose-400';

  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-line/50 last:border-b-0">
      <PalIcon icon={entry?.icon ?? null} name={worker.name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] text-bone truncate">
            {worker.nickname || worker.name}
          </span>
          {worker.lucky && <span className="text-[9px] font-bold text-amber-300">LUCKY</span>}
          {worker.sick && <span className="text-[9px] font-bold text-rose-400">SICK</span>}
        </div>
        <div className="text-[10.5px] text-fog truncate">
          Lv {worker.level}
          {worker.rank > 1 && ` · Rank ${worker.rank}`}
          {worker.workSpeedBonus > 0 && ` · Work +${worker.workSpeedBonus}`}
        </div>
        {jobs.length > 0 && (
          <div className="text-[10px] text-fog/70 truncate mt-0.5">{jobs.join(' · ')}</div>
        )}
      </div>
      <div className={cn('text-[11px] tabular-nums shrink-0', sanityColour)}>
        {Math.round(worker.sanity)}
      </div>
    </div>
  );
}

export function BaseCampInspector({
  baseId, colour, onClose,
}: {
  baseId: string;
  colour: string;
  onClose: () => void;
}) {
  const { api } = useInstance();
  const [detail, setDetail] = useState<BaseCampDetail | null>(null);
  const [dex, setDex] = useState<Record<string, PalDexEntry>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setDetail(null);
    setError(null);

    api.baseCamp(baseId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });

    // Icons need the dex; a failure here only costs the artwork.
    api.palDex().then((d) => { if (!cancelled) setDex(d); }).catch(() => {});

    return () => { cancelled = true; };
  }, [api, baseId]);

  const index = useMemo(() => dexIndex(dex), [dex]);
  const cover = useMemo(() => (detail ? coverage(detail.workers) : []), [detail]);

  const game = detail ? worldToGameCoords(detail.x, detail.y) : null;
  const sick = detail?.workers.filter((w) => w.sick).length ?? 0;
  const lowSanity = detail?.workers.filter((w) => !w.sick && w.sanity < 50).length ?? 0;

  return (
    <div className="absolute top-3 right-3 bottom-3 w-[330px] bg-panel border border-line rounded-2xl shadow-2xl flex flex-col z-40">
      <div className="flex items-start gap-2 p-4 border-b border-line">
        <div className="w-2.5 h-2.5 rotate-45 mt-1 shrink-0" style={{ background: colour }} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-bone truncate">
            {detail?.guild?.name || 'Unclaimed base'}
          </div>
          <div className="text-[11px] text-fog">
            Base camp
            {detail?.guild ? ` · Lv ${detail.guild.baseCampLevel}` : ''}
            {game ? ` · ${game.x}, ${game.y}` : ''}
          </div>
        </div>
        <button onClick={onClose} className="text-fog hover:text-bone text-lg leading-none shrink-0">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="text-[12px] text-amber-300">{error}</div>
        ) : !detail ? (
          <div className="text-[12px] text-fog">Loading…</div>
        ) : (
          <>
            {!detail.workersKnown ? (
              <div className="text-[12px] text-fog leading-relaxed mb-4">
                This camp's save entry has no worker list, so its Pals cannot be
                identified. Everything else below still applies.
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[20px] font-bold text-bone">{detail.workers.length}</span>
                  <span className="text-[11.5px] text-fog">
                    worker{detail.workers.length === 1 ? '' : 's'}
                  </span>
                </div>
                {(sick > 0 || lowSanity > 0) && (
                  <div className="text-[11.5px] mb-3">
                    {sick > 0 && <span className="text-rose-400">{sick} sick</span>}
                    {sick > 0 && lowSanity > 0 && <span className="text-fog"> · </span>}
                    {lowSanity > 0 && <span className="text-amber-300">{lowSanity} low sanity</span>}
                  </div>
                )}

                <div className="text-[10px] uppercase tracking-wider text-fog mt-4 mb-2">
                  Work coverage
                </div>
                <div className="space-y-1 mb-4">
                  {cover.map((c) => (
                    <div key={c.work} className="flex items-center gap-2">
                      <span className={cn(
                        'text-[11px] w-[86px] shrink-0',
                        c.best === 0 ? 'text-rose-400/80' : 'text-fog',
                      )}>
                        {WORK_LABELS[c.work] ?? c.work}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-line/60 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            // Rank 4 is the practical ceiling for a work suitability.
                            width: `${Math.min(c.best / 4, 1) * 100}%`,
                            background: c.best === 0 ? 'transparent' : colour,
                          }}
                        />
                      </div>
                      <span className="text-[10.5px] text-fog/70 w-12 text-right tabular-nums shrink-0">
                        {c.best === 0 ? 'none' : `${c.best} ×${c.workers}`}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="text-[10px] uppercase tracking-wider text-fog mb-1">Workers</div>
                {detail.workers.length === 0 ? (
                  <div className="text-[12px] text-fog/70">No Pals assigned.</div>
                ) : (
                  detail.workers.map((w) => (
                    <WorkerRow key={w.uid} worker={w} entry={lookup(index, w.characterId)} />
                  ))
                )}
              </>
            )}

            {detail.guild && detail.guild.members.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-fog mt-5 mb-1">
                  Guild members
                </div>
                {detail.guild.members.map((m) => (
                  <div key={m.playerId} className="text-[12px] text-bone py-1 truncate">
                    {m.name || 'Unknown'}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

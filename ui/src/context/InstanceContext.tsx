import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { instanceApi, makeApi, Instance } from '../api/client';

interface InstanceCtx {
  instances: Instance[];
  active: Instance | null;
  setActiveId: (id: number) => void;
  api: ReturnType<typeof makeApi> | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<InstanceCtx>({
  instances: [],
  active: null,
  setActiveId: () => {},
  api: null,
  reload: async () => {},
});

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeId, setActiveId] = useState<number>(1);

  const reload = async () => {
    const list = await instanceApi.list();
    setInstances(list);
    if (list.length > 0 && !list.find((i) => i.id === activeId)) {
      setActiveId(list[0].id);
    }
  };

  useEffect(() => { reload().catch(() => {}); }, []);

  const active = instances.find((i) => i.id === activeId) ?? null;
  const api = useMemo(() => (activeId ? makeApi(activeId) : null), [activeId]);

  return (
    <Ctx.Provider value={{ instances, active, setActiveId, api, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInstance() {
  return useContext(Ctx);
}

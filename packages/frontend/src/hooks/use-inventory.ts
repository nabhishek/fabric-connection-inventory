import { useCallback, useEffect, useRef, useState } from 'react';
import type { InventorySnapshot } from '@rayfin-app/shared';

import { loadInventory } from '@/services/inventory';

interface InventoryState {
  snapshot: InventorySnapshot;
  loading: boolean;
  cancelled: boolean;
}

function initialState(): InventoryState {
  return {
    snapshot: {
      connections: [],
      inventoryComplete: false,
      phase: 'connections',
      updatedAt: null,
    },
    loading: true,
    cancelled: false,
  };
}

export function useInventory() {
  const [state, setState] = useState(initialState);
  const [revision, setRevision] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;

    async function run() {
      try {
        const snapshot = await loadInventory({
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setState({ snapshot: progress, loading: true, cancelled: false });
            }
          },
        });
        if (!controller.signal.aborted) {
          setState({ snapshot, loading: false, cancelled: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState((previous) => ({
            ...previous,
            loading: false,
            snapshot: {
              ...previous.snapshot,
              phase: 'error',
              updatedAt: null,
              error: {
                code: 'UnexpectedInventoryError',
                message: 'The inventory could not be loaded. Refresh to try again.',
              },
            },
          }));
        }
      }
    }

    void run();
    return () => controller.abort();
  }, [revision]);

  const refresh = useCallback(() => {
    activeRequest.current?.abort();
    setState(initialState());
    setRevision((value) => value + 1);
  }, []);

  const cancel = useCallback(() => {
    activeRequest.current?.abort();
    setState((previous) => ({
      ...previous,
      loading: false,
      cancelled: true,
    }));
  }, []);

  return { ...state, refresh, cancel };
}

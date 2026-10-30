import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventorySnapshot, LoadInventoryOptions } from '@rayfin-app/shared';

import { loadInventory } from '@/services/inventory';
import { syntheticConnection, syntheticSnapshot } from '@/test/inventory-fixtures';
import { useInventory } from './use-inventory';

vi.mock('@/services/inventory', () => ({ loadInventory: vi.fn() }));
const mockLoad = vi.mocked(loadInventory);

function deferred() {
  let resolve!: (value: InventorySnapshot) => void;
  const promise = new Promise<InventorySnapshot>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('useInventory request lifecycle', () => {
  it('exposes progress and only uses the service-provided completion timestamp', async () => {
    const request = deferred();
    let options!: LoadInventoryOptions;
    mockLoad.mockImplementation((value) => { options = value; return request.promise; });
    const { result } = renderHook(useInventory);
    const partial = syntheticSnapshot([syntheticConnection({ ownerStatus: 'pending' })], {
      phase: 'owners', updatedAt: null,
    });
    act(() => options.onProgress(partial));
    expect(result.current.snapshot).toEqual(partial);
    expect(result.current.loading).toBe(true);

    const done = syntheticSnapshot();
    await act(async () => request.resolve(done));
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot.updatedAt).toBe(done.updatedAt);
  });

  it('clears rows on refresh, aborts the old request and ignores its late progress or completion', async () => {
    const first = deferred();
    const second = deferred();
    const options: LoadInventoryOptions[] = [];
    mockLoad
      .mockImplementationOnce((value) => { options.push(value); return first.promise; })
      .mockImplementationOnce((value) => { options.push(value); return second.promise; });
    const { result } = renderHook(useInventory);
    act(() => options[0].onProgress(syntheticSnapshot([syntheticConnection({ id: 'old' })], {
      phase: 'owners', updatedAt: null,
    })));
    act(() => result.current.refresh());
    expect(options[0].signal.aborted).toBe(true);
    expect(result.current.snapshot.connections).toEqual([]);
    expect(result.current.snapshot.updatedAt).toBeNull();
    const fresh = syntheticSnapshot([syntheticConnection({ id: 'fresh' })]);
    await act(async () => second.resolve(fresh));
    await act(async () => {
      options[0].onProgress(syntheticSnapshot([syntheticConnection({ id: 'stale-progress' })]));
      first.resolve(syntheticSnapshot([syntheticConnection({ id: 'stale-final' })]));
    });
    expect(result.current.snapshot).toEqual(fresh);
  });

  it('cancels without discarding partial rows or accepting a late result', async () => {
    const request = deferred();
    let options!: LoadInventoryOptions;
    mockLoad.mockImplementation((value) => { options = value; return request.promise; });
    const { result } = renderHook(useInventory);
    const partial = syntheticSnapshot([syntheticConnection({ ownerStatus: 'pending' })], {
      phase: 'connections', inventoryComplete: false, updatedAt: null,
    });
    act(() => options.onProgress(partial));
    act(() => result.current.cancel());
    await act(async () => request.resolve(syntheticSnapshot()));
    expect(options.signal.aborted).toBe(true);
    expect(result.current.cancelled).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot).toEqual(partial);
  });

  it('aborts on unmount and tolerates late callbacks', async () => {
    const request = deferred();
    let options!: LoadInventoryOptions;
    mockLoad.mockImplementation((value) => { options = value; return request.promise; });
    const { unmount } = renderHook(useInventory);
    unmount();
    expect(options.signal.aborted).toBe(true);
    await act(async () => {
      options.onProgress(syntheticSnapshot());
      request.resolve(syntheticSnapshot());
    });
  });

  it('shows an explicit sanitized error for an unexpected rejection', async () => {
    mockLoad.mockRejectedValue(new Error('Synthetic internal provider diagnostic'));
    const { result } = renderHook(useInventory);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshot.phase).toBe('error');
    expect(result.current.snapshot.inventoryComplete).toBe(false);
    expect(result.current.snapshot.updatedAt).toBeNull();
    expect(result.current.snapshot.error?.message).toContain('Refresh to try again');
    expect(result.current.snapshot.error?.message).not.toContain('internal provider');
  });
});

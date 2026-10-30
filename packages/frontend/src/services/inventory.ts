import { FabricInventory, safeResult, type ApiFailure, type InventorySnapshot, type LoadInventoryOptions } from '@rayfin-app/shared';
import { AdminAuthError, getAdminAccessToken } from '@/services/admin-auth';

function requestFailure(): ApiFailure {
  return {
    code: 'InventoryRequestFailed',
    message: 'The app could not complete its inventory request. Check admin sign-in, tenant-read consent, and network access, then retry.',
  };
}

function waitForRequest<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

export async function loadInventory({ signal, onProgress }: LoadInventoryOptions): Promise<InventorySnapshot> {
  let snapshot: InventorySnapshot = {
    connections: [], inventoryComplete: false, phase: 'connections', updatedAt: null,
  };
  const publish = () => {
    signal.throwIfAborted();
    onProgress(snapshot);
  };
  publish();
  try {
    const api = async () => new FabricInventory(await getAdminAccessToken(), fetch, Date.now, undefined, signal);
    const seenTokens = new Set<string>();
    const seenIds = new Set<string>();
    let continuationToken = '';
    for (let index = 0; ; index++) {
      signal.throwIfAborted();
      if (index >= 10_000) {
        snapshot = { ...snapshot, phase: 'error', error: { code: 'PageLimitExceeded', message: 'Connection enumeration reached the safety page limit; this inventory is incomplete.' } };
        publish();
        return snapshot;
      }
      const currentApi = await api();
      signal.throwIfAborted();
      const result = await waitForRequest(safeResult(() => currentApi.listConnections(continuationToken)), signal);
      signal.throwIfAborted();
      if (!result.ok) {
        snapshot = { ...snapshot, phase: 'error', error: result.error };
        publish();
        return snapshot;
      }
      const newRows = result.data.connections.filter((row) => {
        if (seenIds.has(row.id)) return false;
        seenIds.add(row.id);
        return true;
      }).map((row) => ({ ...row, owners: [], ownerStatus: 'pending' as const }));
      snapshot = { ...snapshot, connections: [...snapshot.connections, ...newRows] };
      publish();
      if (!result.data.nextToken) break;
      if (seenTokens.has(result.data.nextToken)) {
        snapshot = { ...snapshot, phase: 'error', error: { code: 'PaginationLoop', message: 'Fabric repeated a continuation token. The displayed connection inventory is incomplete.' } };
        publish();
        return snapshot;
      }
      seenTokens.add(result.data.nextToken);
      continuationToken = result.data.nextToken;
    }
    snapshot = { ...snapshot, inventoryComplete: true, phase: 'owners' };
    publish();
    for (let offset = 0; offset < snapshot.connections.length; offset += 6) {
      signal.throwIfAborted();
      const connectionIds = snapshot.connections.slice(offset, offset + 6).map((row) => row.id);
      let lookups;
      try {
        const currentApi = await api();
        signal.throwIfAborted();
        const batch = await waitForRequest(
          safeResult(() => currentApi.listConnectionOwners(connectionIds)), signal,
        );
        lookups = batch.ok ? batch.data.results : connectionIds.map((connectionId) => ({
          connectionId, result: { ok: false as const, error: batch.error },
        }));
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof AdminAuthError) throw error;
        lookups = connectionIds.map((connectionId) => ({
          connectionId, result: { ok: false as const, error: requestFailure() },
        }));
      }
      signal.throwIfAborted();
      const results = new Map(lookups.map((lookup) => [lookup.connectionId, lookup.result]));
      snapshot = {
        ...snapshot,
        connections: snapshot.connections.map((row) => {
          if (!connectionIds.includes(row.id)) return row;
          const result = results.get(row.id);
          if (!result) return { ...row, ownerStatus: 'error', ownerError: { code: 'MissingOwnerResult', message: 'The function did not return this connection owner result.' } };
          return result.ok ? { ...row, owners: result.data, ownerStatus: 'loaded' } :
            { ...row, ownerStatus: 'error', ownerError: result.error };
        }),
      };
      publish();
      const throttled = lookups.find((lookup) => !lookup.result.ok &&
        (lookup.result.error.status === 429 || lookup.result.error.code === 'RetryBudgetExceeded'));
      if (throttled && !throttled.result.ok) {
        snapshot = { ...snapshot, phase: 'error', error: throttled.result.error };
        publish();
        return snapshot;
      }
    }
    snapshot = { ...snapshot, phase: 'done', updatedAt: new Date().toISOString() };
  } catch (error) {
    signal.throwIfAborted();
    snapshot = { ...snapshot, phase: 'error', error: error instanceof AdminAuthError ?
      { code: error.code, message: error.message } : requestFailure() };
  }
  publish();
  return snapshot;
}

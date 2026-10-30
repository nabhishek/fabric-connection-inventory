import type { ConnectionRow, InventorySnapshot } from '@rayfin-app/shared';

export type OwnerFilter = 'all' | 'pending' | 'loaded' | 'error' | 'none';
export type SortColumn = 'displayName' | 'owners' | 'connectorType' | 'endpoint';
export interface InventoryFilters {
  search: string;
  connectorType: string;
  ownerStatus: OwnerFilter;
}
export interface InventorySort {
  column: SortColumn;
  direction: 'asc' | 'desc';
}

export const PAGE_SIZE = 25;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function ownerSearchText(row: ConnectionRow): string {
  return row.owners
    .map((owner) =>
      [owner.id, owner.type, owner.displayName, owner.userPrincipalName, owner.role]
        .filter(Boolean)
        .join(' ')
    )
    .join(' ');
}

export function selectConnections(
  rows: ConnectionRow[],
  filters: InventoryFilters,
  sort: InventorySort
): ConnectionRow[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return rows
    .filter((row) => {
      if (filters.connectorType && row.connectorType !== filters.connectorType) return false;
      if (filters.ownerStatus === 'none') {
        if (row.ownerStatus !== 'loaded' || row.owners.length !== 0) return false;
      } else if (filters.ownerStatus !== 'all' && row.ownerStatus !== filters.ownerStatus) {
        return false;
      }
      return !query || [
        row.displayName,
        row.id,
        row.connectorType,
        row.connectivityType,
        row.endpoint,
        ownerSearchText(row),
      ].join(' ').toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => {
      const left = sort.column === 'owners' ? `${a.ownerStatus} ${ownerSearchText(a)}` : a[sort.column];
      const right = sort.column === 'owners' ? `${b.ownerStatus} ${ownerSearchText(b)}` : b[sort.column];
      const comparison = collator.compare(left, right) || collator.compare(a.id, b.id);
      return sort.direction === 'asc' ? comparison : -comparison;
    });
}

export function summarizeInventory(snapshot: InventorySnapshot) {
  const rows = snapshot.connections;
  return {
    total: rows.length,
    connectorTypes: new Set(rows.map((row) => row.connectorType).filter(Boolean)).size,
    resolved: rows.filter((row) => row.ownerStatus === 'loaded').length,
    pending: rows.filter((row) => row.ownerStatus === 'pending').length,
    failed: rows.filter((row) => row.ownerStatus === 'error').length,
    noOwners: rows.filter((row) => row.ownerStatus === 'loaded' && row.owners.length === 0).length,
  };
}

export function formatTimestamp(value?: string | null): string {
  if (!value) return 'Not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not provided' : date.toLocaleString();
}

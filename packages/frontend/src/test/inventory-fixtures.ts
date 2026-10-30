import type { ConnectionRow, InventorySnapshot } from '@rayfin-app/shared';

// Synthetic test data only. This module is never imported by the application.
export function syntheticConnection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: 'synthetic-connection-1',
    displayName: 'Synthetic warehouse',
    connectorType: 'SyntheticSQL',
    connectivityType: 'ShareableCloud',
    endpoint: 'synthetic.example.invalid;database=test',
    owners: [],
    ownerStatus: 'loaded',
    ...overrides,
  };
}

export function syntheticSnapshot(
  connections: ConnectionRow[] = [syntheticConnection()],
  overrides: Partial<InventorySnapshot> = {}
): InventorySnapshot {
  return {
    connections,
    inventoryComplete: true,
    phase: 'done',
    updatedAt: '2026-01-02T03:04:05Z',
    ...overrides,
  };
}

import { describe, expect, it } from 'vitest';

import { syntheticConnection, syntheticSnapshot } from '@/test/inventory-fixtures';
import { formatTimestamp, selectConnections, summarizeInventory } from './inventory-model';

const filters = { search: '', connectorType: '', ownerStatus: 'all' as const };
const sort = { column: 'displayName' as const, direction: 'asc' as const };

describe('inventory filtering and summaries', () => {
  it('counts only successful empty owner results as having no owners', () => {
    const snapshot = syntheticSnapshot([
      syntheticConnection({ id: 'empty' }),
      syntheticConnection({ id: 'pending', ownerStatus: 'pending' }),
      syntheticConnection({ id: 'failed', ownerStatus: 'error' }),
      syntheticConnection({
        id: 'owned',
        owners: [{ id: 'synthetic-principal', type: 'Group', role: 'Owner' }],
      }),
    ]);

    expect(summarizeInventory(snapshot)).toEqual({
      total: 4, connectorTypes: 1, resolved: 2, pending: 1, failed: 1, noOwners: 1,
    });
    expect(selectConnections(snapshot.connections, { ...filters, ownerStatus: 'none' }, sort).map((row) => row.id))
      .toEqual(['empty']);
  });

  it.each([
    'WAREHOUSE', 'synthetic-connection-1', 'syntheticsql', 'SHAREABLECLOUD',
    'example.invalid', 'PRINCIPAL-ALPHA', 'Synthetic Owner', 'owner@example.invalid', 'ServicePrincipal',
  ])('searches names, ids, types, endpoints and owner metadata for %s', (search) => {
    const row = syntheticConnection({
      owners: [{
        id: 'principal-alpha',
        displayName: 'Synthetic Owner',
        userPrincipalName: 'owner@example.invalid',
        type: 'ServicePrincipal',
        role: 'Owner',
      }],
    });
    expect(selectConnections([row], { ...filters, search: ` ${search} ` }, sort)).toEqual([row]);
  });

  it('combines connector and owner filters without mutating input', () => {
    const rows = [
      syntheticConnection({ id: 'wrong-type', connectorType: 'SyntheticWeb', ownerStatus: 'error' }),
      syntheticConnection({ id: 'match', ownerStatus: 'error' }),
      syntheticConnection({ id: 'wrong-status' }),
    ];
    expect(selectConnections(rows, { ...filters, connectorType: 'SyntheticSQL', ownerStatus: 'error' }, sort).map((row) => row.id))
      .toEqual(['match']);
    expect(rows.map((row) => row.id)).toEqual(['wrong-type', 'match', 'wrong-status']);
  });

  it('sorts numerically with a stable id tie-breaker in either direction', () => {
    const rows = [
      syntheticConnection({ id: 'c', displayName: 'Synthetic 10' }),
      syntheticConnection({ id: 'b', displayName: 'Synthetic 2' }),
      syntheticConnection({ id: 'a', displayName: 'Synthetic 2' }),
    ];
    expect(selectConnections(rows, filters, sort).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(selectConnections(rows, filters, { ...sort, direction: 'desc' }).map((row) => row.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0].id).toBe('c');
  });

  it('does not present absent or invalid dates as real timestamps', () => {
    expect(formatTimestamp()).toBe('Not provided');
    expect(formatTimestamp('invalid')).toBe('Not provided');
    expect(formatTimestamp('2026-01-02T03:04:05Z')).not.toBe('Not provided');
  });
});

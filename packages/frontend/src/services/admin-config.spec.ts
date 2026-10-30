import { describe, expect, it } from 'vitest';

import { getInventoryLabels, readAdminConfig } from './admin-config';
import { syntheticAdminEnvironment, syntheticClientId, syntheticTenantId } from '@/test/admin-config-fixtures';

describe('admin deployment configuration', () => {
  it('requires all authentication fields with no built-in deployment defaults', () => {
    expect(() => readAdminConfig({})).toThrow('VITE_ADMIN_TENANT_ID, VITE_ADMIN_CLIENT_ID, VITE_ADMIN_HOSTED_ORIGIN');
    expect(() => readAdminConfig({})).toThrow('packages/frontend/.env');
  });

  it.each(['VITE_ADMIN_TENANT_ID', 'VITE_ADMIN_CLIENT_ID', 'VITE_ADMIN_HOSTED_ORIGIN'] as const)(
    'rejects a missing or blank %s', (field) => {
      expect(() => readAdminConfig({ ...syntheticAdminEnvironment, [field]: undefined })).toThrow(field);
      expect(() => readAdminConfig({ ...syntheticAdminEnvironment, [field]: '   ' })).toThrow(field);
    }
  );

  it.each(['VITE_ADMIN_TENANT_ID', 'VITE_ADMIN_CLIENT_ID'] as const)(
    'rejects invalid and placeholder GUID values for %s', (field) => {
      for (const value of ['not-a-guid', 'organizations', 'common', '00000000-0000-0000-0000-000000000000']) {
        expect(() => readAdminConfig({ ...syntheticAdminEnvironment, [field]: value })).toThrow('non-zero GUID');
      }
    }
  );

  it.each([
    'https://inventory.example.test',
    'https://inventory.example.test:8443',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])('accepts a canonical safe origin %s', (origin) => {
    expect(readAdminConfig({ ...syntheticAdminEnvironment, VITE_ADMIN_HOSTED_ORIGIN: origin })).toEqual({
      tenantId: syntheticTenantId, clientId: syntheticClientId, hostedOrigin: origin,
    });
  });

  it.each([
    'http://inventory.example.test',
    'http://localhost.example.test',
    'http://127.0.0.2:5173',
    'https://inventory.example.test/',
    'https://inventory.example.test/path',
    'https://inventory.example.test?query=1',
    'https://inventory.example.test#fragment',
    'https://user:password@inventory.example.test',
    'https://inventory.example.test:443',
    'https://INVENTORY.example.test',
    '//inventory.example.test',
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///path',
    'not-an-origin',
  ])('rejects a non-canonical or unsafe origin %s', (origin) => {
    expect(() => readAdminConfig({ ...syntheticAdminEnvironment, VITE_ADMIN_HOSTED_ORIGIN: origin }))
      .toThrow('VITE_ADMIN_HOSTED_ORIGIN must be a canonical HTTPS origin');
  });

  it('uses neutral labels by default and treats custom labels as cosmetic only', () => {
    expect(getInventoryLabels({})).toEqual({ tenant: 'Your tenant', workspace: 'Fabric workspace' });
    expect(getInventoryLabels({ VITE_TENANT_LABEL: '  Synthetic tenant  ', VITE_WORKSPACE_LABEL: '  Synthetic workspace ' }))
      .toEqual({ tenant: 'Synthetic tenant', workspace: 'Synthetic workspace' });
    expect(() => readAdminConfig({ VITE_TENANT_LABEL: 'Synthetic tenant' })).toThrow('Admin sign-in setup is required');
  });

  it('normalizes GUID casing without accepting another tenant or client', () => {
    const config = readAdminConfig({
      ...syntheticAdminEnvironment,
      VITE_ADMIN_TENANT_ID: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    });
    expect(config.tenantId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(config.clientId).toBe(syntheticClientId);
  });
});

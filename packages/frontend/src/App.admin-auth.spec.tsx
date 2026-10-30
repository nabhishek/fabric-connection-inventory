import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventorySnapshot, LoadInventoryOptions } from '@rayfin-app/shared';

import App from '@/App';
import {
  disconnectAdmin, getAdminSession, signInAdmin, type AdminSession,
} from '@/services/admin-auth';
import { loadInventory } from '@/services/inventory';
import { syntheticConnection, syntheticSnapshot } from '@/test/inventory-fixtures';
import { configureSyntheticAdminEnvironment, syntheticTenantId } from '@/test/admin-config-fixtures';

vi.mock('@/services/admin-auth', () => ({
  getAdminSession: vi.fn(),
  signInAdmin: vi.fn(),
  disconnectAdmin: vi.fn(),
}));
vi.mock('@/services/inventory', () => ({ loadInventory: vi.fn() }));

const mockSession = vi.mocked(getAdminSession);
const mockSignIn = vi.mocked(signInAdmin);
const mockDisconnect = vi.mocked(disconnectAdmin);
const mockLoad = vi.mocked(loadInventory);
const syntheticAdmin: AdminSession = {
  username: 'synthetic-admin@example.test',
  tenantId: syntheticTenantId,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  configureSyntheticAdminEnvironment();
  mockSession.mockReturnValue(null);
  mockSignIn.mockResolvedValue(syntheticAdmin);
  mockDisconnect.mockResolvedValue();
  mockLoad.mockResolvedValue(syntheticSnapshot());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Dedicated admin sign-in gate', () => {
  it('does not load inventory or initiate a popup until an explicit connection click', async () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Connect admin account' })).toBeVisible();
    expect(screen.getByText(/This app keeps its admin session only in memory/)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Connect admin account' }));
    expect(await screen.findByText('Synthetic warehouse')).toBeVisible();
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByText(syntheticAdmin.username)).toBeVisible();
    expect(screen.getByText(/Fabric enforces tenant-admin permissions/)).toBeVisible();
  });

  it('disables repeated connection attempts while a popup is pending and waits before loading data', async () => {
    const pending = deferred<AdminSession>();
    mockSignIn.mockReturnValue(pending.promise);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect admin account' }));

    expect(screen.getByRole('button', { name: 'Connect admin account' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Microsoft admin sign-in');
    expect(mockLoad).not.toHaveBeenCalled();

    await act(async () => pending.resolve(syntheticAdmin));
    expect(await screen.findByText('Synthetic warehouse')).toBeVisible();
  });

  it('surfaces a rejected popup as a retryable sign-in error without loading data', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('Synthetic raw MSAL diagnostic'));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect admin account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Admin sign-in did not complete');
    expect(screen.queryByText('Synthetic raw MSAL diagnostic')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect admin account' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Connect admin account' }));
    expect(await screen.findByText('Synthetic warehouse')).toBeVisible();
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it('uses an established in-memory admin session without opening another popup', async () => {
    mockSession.mockReturnValue(syntheticAdmin);
    render(<App />);

    expect(await screen.findByText('Synthetic warehouse')).toBeVisible();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(screen.getByText(syntheticAdmin.username)).toBeVisible();
  });

  it('unmounts rows and aborts work before clearing admin auth, ignoring a late inventory result', async () => {
    const inventory = deferred<InventorySnapshot>();
    const clearing = deferred<void>();
    let options!: LoadInventoryOptions;
    mockSession.mockReturnValue(syntheticAdmin);
    mockLoad.mockImplementation((value) => { options = value; return inventory.promise; });
    mockDisconnect.mockImplementation(() => {
      expect(options.signal.aborted).toBe(true);
      expect(screen.queryByText('Synthetic warehouse')).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      return clearing.promise;
    });
    render(<App />);
    act(() => options.onProgress(syntheticSnapshot(
      [syntheticConnection({ ownerStatus: 'pending' })],
      { phase: 'owners', updatedAt: null }
    )));
    expect(screen.getByText('Synthetic warehouse')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect admin account' }));

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Connect admin account' })).toBeDisabled();
    await act(async () => inventory.resolve(syntheticSnapshot()));
    expect(screen.queryByText('Synthetic warehouse')).not.toBeInTheDocument();
    await act(async () => clearing.resolve());
    expect(screen.getByRole('button', { name: 'Connect admin account' })).toBeEnabled();
    expect(screen.getByText(/does not sign you out of Microsoft in other apps/)).toBeVisible();
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('keeps data cleared and offers a retry if local admin-cache clearing fails', async () => {
    mockSession.mockReturnValue(syntheticAdmin);
    mockDisconnect.mockRejectedValueOnce(new Error('Synthetic cache error'));
    render(<App />);
    await screen.findByText('Synthetic warehouse');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect admin account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The inventory has been cleared');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry disconnect' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mockDisconnect).toHaveBeenCalledTimes(2);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('allows explicit reconnection after access failure without automatically starting a popup', async () => {
    mockSession.mockReturnValue(syntheticAdmin);
    mockLoad.mockResolvedValueOnce(syntheticSnapshot([], {
      phase: 'error', inventoryComplete: false, updatedAt: null,
      error: { code: 'SyntheticAdminInteractionRequired', message: 'Synthetic sign-in required' },
    }));
    const newSession = { ...syntheticAdmin, username: 'synthetic-other-admin@example.test' };
    mockSignIn.mockResolvedValue(newSession);
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic sign-in required');
    expect(mockSignIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect again' }));
    expect(await screen.findByText(newSession.username)).toBeVisible();
    expect(await screen.findByText('Synthetic warehouse')).toBeVisible();
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it('ignores a popup result that resolves after the outer app is unmounted', async () => {
    const pending = deferred<AdminSession>();
    mockSignIn.mockReturnValue(pending.promise);
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect admin account' }));
    unmount();
    await act(async () => pending.resolve(syntheticAdmin));
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it.each([null, syntheticAdmin])(
    'renders the inventory inside an iframe after sign-in, with initial session %j',
    async (session) => {
      mockSession.mockReturnValue(session);
      vi.spyOn(window, 'self', 'get').mockReturnValue({} as Window & typeof globalThis);
      render(<App />);

      expect(screen.queryByRole('link', { name: /Open admin inventory/ })).not.toBeInTheDocument();
      if (!session) {
        expect(screen.getByText(/Your inventory stays inside Fabric/)).toBeVisible();
        expect(mockLoad).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Connect admin account' }));
        expect(mockSignIn).toHaveBeenCalledOnce();
      } else {
        expect(mockSignIn).not.toHaveBeenCalled();
      }
      expect(await screen.findByText('Synthetic warehouse')).toBeVisible();
      expect(screen.getByRole('table')).toBeVisible();
      expect(mockLoad).toHaveBeenCalledOnce();
    }
  );

  it('renders a setup-required shell with no inventory or sign-in when required settings are missing', () => {
    vi.stubEnv('VITE_ADMIN_TENANT_ID', undefined);
    mockSession.mockReturnValue(syntheticAdmin);
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Admin sign-in setup required' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_ADMIN_TENANT_ID');
    expect(screen.queryByRole('button', { name: 'Connect admin account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('never makes an invalid configured origin clickable in an embedded view', () => {
    vi.stubEnv('VITE_ADMIN_HOSTED_ORIGIN', 'javascript:alert(1)');
    vi.spyOn(window, 'self', 'get').mockReturnValue({} as Window & typeof globalThis);
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('VITE_ADMIN_HOSTED_ORIGIN');
    expect(screen.queryByRole('link', { name: /Open admin inventory/ })).not.toBeInTheDocument();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

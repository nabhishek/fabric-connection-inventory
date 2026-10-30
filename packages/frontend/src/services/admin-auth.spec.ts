import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureSyntheticAdminEnvironment, syntheticClientId, syntheticHostedOrigin, syntheticTenantId,
} from '@/test/admin-config-fixtures';

const msal = vi.hoisted(() => ({
  configure: vi.fn(),
  initialize: vi.fn(),
  loginPopup: vi.fn(),
  acquireTokenSilent: vi.fn(),
  setActiveAccount: vi.fn(),
  clearCache: vi.fn(),
}));

vi.mock('@azure/msal-browser', () => {
  class AuthError extends Error {
    constructor(readonly errorCode: string) { super(errorCode); }
  }
  return {
    AuthError,
    InteractionRequiredAuthError: class extends AuthError {},
    BrowserCacheLocation: { MemoryStorage: 'memoryStorage' },
    PublicClientApplication: class {
      constructor(config: unknown) { msal.configure(config); }
      initialize = msal.initialize;
      loginPopup = msal.loginPopup;
      acquireTokenSilent = msal.acquireTokenSilent;
      setActiveAccount = msal.setActiveAccount;
      clearCache = msal.clearCache;
    },
  };
});

const tenant = syntheticTenantId;
const origin = syntheticHostedOrigin;
const identity = { username: 'admin@example.test', tenantId: tenant, homeAccountId: 'synthetic-home' };
const token = (tid = tenant, scp = 'Tenant.Read.All') =>
  `header.${btoa(JSON.stringify({ tid, scp }))}.synthetic-signature`;
const success = () => ({ account: identity, accessToken: token() });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  configureSyntheticAdminEnvironment();
  const top = {};
  vi.stubGlobal('window', { location: { origin }, top, self: top });
  msal.initialize.mockResolvedValue(undefined);
  msal.clearCache.mockResolvedValue(undefined);
  msal.loginPopup.mockResolvedValue(success());
  msal.acquireTokenSilent.mockResolvedValue(success());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('configured single-tenant delegated authentication', () => {
  it('does not silently sign in or request a token before an explicit connection', async () => {
    const auth = await import('./admin-auth');
    expect(auth.getAdminSession()).toBeNull();
    await expect(auth.getAdminAccessToken()).rejects.toMatchObject({ code: 'AdminSignInRequired' });
    expect(msal.loginPopup).not.toHaveBeenCalled();
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it('uses single-tenant PKCE browser auth, memory cache, and only the tenant read scope', async () => {
    const auth = await import('./admin-auth');
    expect(await auth.signInAdmin()).toEqual({ username: identity.username, tenantId: tenant });
    expect(msal.configure).toHaveBeenCalledWith(expect.objectContaining({
      auth: {
        clientId: syntheticClientId,
        authority: `https://login.microsoftonline.com/${tenant}`,
        redirectUri: `${origin}/admin-auth.html`,
      },
      cache: { cacheLocation: 'memoryStorage' },
    }));
    expect(msal.loginPopup).toHaveBeenCalledWith({ scopes: [auth.ADMIN_SCOPE], prompt: 'select_account' });
    expect(await auth.getAdminAccessToken()).toBe(token());
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ account: identity, scopes: [auth.ADMIN_SCOPE] });
  });

  it('rejects a wrong-tenant account before showing a connected session', async () => {
    const otherTenant = '44444444-4444-4444-8444-444444444444';
    msal.loginPopup.mockResolvedValue({ account: { ...identity, tenantId: otherTenant }, accessToken: token(otherTenant) });
    const auth = await import('./admin-auth');
    await expect(auth.signInAdmin()).rejects.toMatchObject({ code: 'WrongTenant' });
    expect(auth.getAdminSession()).toBeNull();
  });

  it('rejects a valid tenant token without tenant-read consent', async () => {
    msal.loginPopup.mockResolvedValue({ account: identity, accessToken: token(tenant, 'Connection.ReadWrite.All') });
    const auth = await import('./admin-auth');
    await expect(auth.signInAdmin()).rejects.toMatchObject({ code: 'AdminScopeMissing' });
    expect(auth.getAdminSession()).toBeNull();
  });

  it('uses the same-origin MSAL popup relay for embedded sign-in without changing scope or tenant', async () => {
    vi.stubGlobal('window', { location: { origin }, top: {}, self: {} });
    const auth = await import('./admin-auth');
    expect(await auth.signInAdmin()).toEqual({ username: identity.username, tenantId: tenant });
    expect(msal.configure).toHaveBeenCalledWith(expect.objectContaining({
      auth: {
        clientId: syntheticClientId,
        authority: `https://login.microsoftonline.com/${tenant}`,
        redirectUri: `${origin}/admin-auth.html`,
        popupRelayUri: `${origin}/admin-auth-relay.html`,
      },
      cache: { cacheLocation: 'memoryStorage' },
    }));
    expect(msal.loginPopup).toHaveBeenCalledWith({ scopes: [auth.ADMIN_SCOPE], prompt: 'select_account' });
  });

  it('rejects an unregistered origin before opening sign-in', async () => {
    const top = {};
    vi.stubGlobal('window', { location: { origin: 'https://unregistered.example.test' }, top, self: top });
    const auth = await import('./admin-auth');
    await expect(auth.signInAdmin()).rejects.toMatchObject({ code: 'UnregisteredOrigin' });
    expect(msal.loginPopup).not.toHaveBeenCalled();
  });

  it('clears only this app cache and removes the active admin immediately', async () => {
    const auth = await import('./admin-auth');
    await auth.signInAdmin();
    const disconnect = auth.disconnectAdmin();
    expect(auth.getAdminSession()).toBeNull();
    await disconnect;
    expect(msal.clearCache).toHaveBeenCalledOnce();
    expect(msal.setActiveAccount).toHaveBeenLastCalledWith(null);
    await expect(auth.getAdminAccessToken()).rejects.toMatchObject({ code: 'AdminSignInRequired' });
  });

  it('does not reconnect from a late popup response after disconnect', async () => {
    let finish!: (value: ReturnType<typeof success>) => void;
    msal.loginPopup.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const auth = await import('./admin-auth');
    const connecting = auth.signInAdmin();
    await vi.waitFor(() => expect(msal.loginPopup).toHaveBeenCalledOnce());
    await auth.disconnectAdmin();
    finish(success());
    await expect(connecting).rejects.toMatchObject({ code: 'SignInCancelled' });
    expect(auth.getAdminSession()).toBeNull();
  });

  it('does not expose raw authentication error details or retry with a popup silently', async () => {
    const auth = await import('./admin-auth');
    await auth.signInAdmin();
    msal.acquireTokenSilent.mockRejectedValue(new Error('synthetic-sensitive-error-payload'));
    await expect(auth.getAdminAccessToken()).rejects.not.toThrow('synthetic-sensitive-error-payload');
    expect(msal.loginPopup).toHaveBeenCalledOnce();
  });

  it.each([
    ['VITE_ADMIN_TENANT_ID', undefined, 'AdminConfigurationRequired'],
    ['VITE_ADMIN_CLIENT_ID', 'invalid-client', 'InvalidAdminConfiguration'],
    ['VITE_ADMIN_HOSTED_ORIGIN', 'https://inventory.example.test/path', 'InvalidAdminConfiguration'],
  ] as const)('fails closed before authentication or API calls for invalid %s', async (field, value, code) => {
    vi.stubEnv(field, value);
    const request = vi.spyOn(globalThis, 'fetch');
    const auth = await import('./admin-auth');

    expect(auth.getAdminSession()).toBeNull();
    await expect(auth.signInAdmin()).rejects.toMatchObject({ code });
    await expect(auth.getAdminAccessToken()).rejects.toMatchObject({ code });
    expect(msal.configure).not.toHaveBeenCalled();
    expect(msal.loginPopup).not.toHaveBeenCalled();
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it('pins the token tenant independently of the account metadata', async () => {
    msal.loginPopup.mockResolvedValue({
      account: identity,
      accessToken: token('44444444-4444-4444-8444-444444444444'),
    });
    const auth = await import('./admin-auth');
    await expect(auth.signInAdmin()).rejects.toMatchObject({ code: 'WrongTenant' });
    expect(auth.getAdminSession()).toBeNull();
  });

  it('supports an explicitly configured localhost SPA origin without changing the tenant guard', async () => {
    const localOrigin = 'http://127.0.0.1:5173';
    vi.stubEnv('VITE_ADMIN_HOSTED_ORIGIN', localOrigin);
    const top = {};
    vi.stubGlobal('window', { location: { origin: localOrigin }, top, self: top });
    const auth = await import('./admin-auth');

    await auth.signInAdmin();
    expect(msal.configure).toHaveBeenCalledWith(expect.objectContaining({
      auth: {
        clientId: syntheticClientId,
        authority: `https://login.microsoftonline.com/${tenant}`,
        redirectUri: `${localOrigin}/admin-auth.html`,
      },
    }));
    expect(await auth.getAdminAccessToken()).toBe(token());
  });
});

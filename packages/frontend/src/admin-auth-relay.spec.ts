import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const { runPopupRelay } = vi.hoisted(() => ({ runPopupRelay: vi.fn() }));
vi.mock('@azure/msal-browser/popup-relay', () => ({ runPopupRelay }));

beforeEach(() => {
  vi.resetModules();
  runPopupRelay.mockReset();
  document.body.innerHTML = '<p id="relay-status" role="status"></p><button id="relay-continue">Continue</button>';
});

afterEach(() => { document.body.innerHTML = ''; });

it('waits for a user gesture and restricts the relay to Microsoft sign-in', async () => {
  await import('./admin-auth-relay');
  expect(runPopupRelay).not.toHaveBeenCalled();
  const button = document.querySelector<HTMLButtonElement>('#relay-continue')!;
  button.click();
  expect(runPopupRelay).toHaveBeenCalledWith({
    allowedAuthorityOrigins: ['https://login.microsoftonline.com'],
    timeoutMs: 300_000,
  });
  expect(button.disabled).toBe(true);
  button.click();
  expect(runPopupRelay).toHaveBeenCalledOnce();
});

it('surfaces a malformed relay request without disclosing raw authorization material', async () => {
  runPopupRelay.mockImplementation(() => { throw new Error('synthetic-sensitive-payload'); });
  await import('./admin-auth-relay');
  document.querySelector<HTMLButtonElement>('#relay-continue')!.click();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not continue');
  expect(document.body.textContent).not.toContain('synthetic-sensitive-payload');
});

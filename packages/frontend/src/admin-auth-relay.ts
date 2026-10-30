import { runPopupRelay } from '@azure/msal-browser/popup-relay';
import './global.css';

const button = document.getElementById('relay-continue');
const status = document.getElementById('relay-status');
if (!(button instanceof HTMLButtonElement) || !status) {
  throw new Error('The administrator sign-in relay page is incomplete.');
}

button.addEventListener('click', () => {
  button.disabled = true;
  status.textContent = 'Complete Microsoft sign-in in the temporary window. Your inventory will remain in Fabric.';
  try {
    runPopupRelay({
      allowedAuthorityOrigins: ['https://login.microsoftonline.com'],
      timeoutMs: 300_000,
    });
  } catch {
    status.setAttribute('role', 'alert');
    status.textContent = 'This sign-in request could not continue. Close this window and choose Connect admin account again in Fabric.';
  }
});

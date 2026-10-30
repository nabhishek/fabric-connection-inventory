import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
import './global.css';

void broadcastResponseToMainFrame().catch(() => {
  const status = document.getElementById('auth-status');
  if (status) {
    status.textContent = 'Sign-in could not return to the app. Close this window and reconnect from the connection inventory.';
  }
});

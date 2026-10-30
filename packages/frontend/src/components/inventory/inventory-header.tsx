import type { ReactNode } from 'react';
import { Database, LockKeyhole, Moon, Sun } from 'lucide-react';

import { useThemeContext } from '@/hooks/theme.context';
import { getInventoryLabels } from '@/services/admin-config';

export function InventoryHeader({ children }: { children?: ReactNode }) {
  const { isDark, toggleTheme } = useThemeContext();
  const labels = getInventoryLabels();

  return (
    <header className="inventory-topbar">
      <div className="inventory-container flex flex-wrap items-center justify-between gap-300">
        <div className="flex items-center gap-300">
          <span className="inventory-mark"><Database className="icon-size-300" aria-hidden="true" /></span>
          <div>
            <p className="font-semibold">{labels.tenant} <span className="font-regular text-muted-foreground">/ Tenant administration</span></p>
            <p className="text-200 text-muted-foreground">Fabric Connection Inventory</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-300">
          <span className="inventory-badge">
            <LockKeyhole className="icon-size-100" aria-hidden="true" /> Read-only
          </span>
          {children}
          <button
            className="inventory-icon-button"
            onClick={toggleTheme}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
          >
            {isDark ? <Sun className="icon-size-300" aria-hidden="true" /> : <Moon className="icon-size-300" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  );
}

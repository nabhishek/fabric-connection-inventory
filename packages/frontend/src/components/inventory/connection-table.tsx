import { Fragment, useId, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from 'lucide-react';
import type { ConnectionRow } from '@rayfin-app/shared';

import { formatTimestamp, type InventorySort, type SortColumn } from './inventory-model';

interface ConnectionTableProps {
  rows: ConnectionRow[];
  sort: InventorySort;
  onSort: (column: SortColumn) => void;
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
}

function Owners({ row }: { row: ConnectionRow }) {
  return (
    <div className="space-y-300">
      {row.ownerStatus === 'pending' && (
        <p className="inline-flex items-center gap-200 text-muted-foreground">
          <span className="inventory-status-dot" aria-hidden="true" />
          Not yet resolved
        </p>
      )}
      {row.ownerStatus === 'error' && (
        <p className="font-medium text-destructive">Owner lookup failed</p>
      )}
      {row.ownerStatus === 'loaded' && row.owners.length === 0 && (
        <p className="text-muted-foreground">No owners returned</p>
      )}
      {row.owners.length > 0 && (
        <ul className="space-y-300" aria-label="Connection owners">
          {row.owners.map((owner) => (
            <li key={`${owner.type}:${owner.id}:${owner.role}`} className="space-y-100">
              <div className="flex flex-wrap items-center gap-200">
                <span className={owner.displayName || owner.userPrincipalName ? 'font-medium' : 'font-monospace text-200'}>
                  {owner.displayName || owner.userPrincipalName || owner.id}
                </span>
                {owner.role === 'PendingOwner' && (
                  <span className="inventory-badge inventory-badge-accent">Pending owner</span>
                )}
              </div>
              <div className="text-200 text-muted-foreground">
                {owner.type || 'Principal type not provided'}
                {(owner.displayName || owner.userPrincipalName) && (
                  <span className="block font-monospace">{owner.id}</span>
                )}
                {owner.displayName && owner.userPrincipalName && (
                  <span className="block">{owner.userPrincipalName}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionDetails({ row }: { row: ConnectionRow }) {
  const details = [
    ['Connectivity', row.connectivityType],
    ['Gateway ID', row.gatewayId],
    ['Privacy level', row.privacyLevel],
    ['Authentication type', row.credentialType],
    ['Created', formatTimestamp(row.createdDateTime)],
    ['Credentials last used', formatTimestamp(row.lastCredentialUsedDateTime)],
  ];

  return (
    <div className="space-y-400 p-500">
      <h3 className="font-semibold">Connection details</h3>
      <dl className="grid gap-400 sm:grid-cols-2 xl:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-200 text-muted-foreground">{label}</dt>
            <dd className="mt-100 break-words">{value || 'Not provided'}</dd>
          </div>
        ))}
      </dl>
      {row.ownerStatus === 'error' && (
        <div className="space-y-100 border-t pt-400">
          <p className="font-medium text-destructive">
            {row.ownerError?.message || 'Owners could not be retrieved for this connection.'}
          </p>
          {row.ownerError?.code && <p className="text-200">Error code: {row.ownerError.code}</p>}
          {row.ownerError?.status && <p className="text-200">HTTP status: {row.ownerError.status}</p>}
          {row.ownerError?.requestId && (
            <p className="break-all font-monospace text-200">
              Request ID: {row.ownerError.requestId}
            </p>
          )}
          <p className="text-200 text-muted-foreground">Refresh the inventory to retry owner lookups.</p>
        </div>
      )}
    </div>
  );
}

export function ConnectionTable({
  rows, sort, onSort, loading, emptyTitle, emptyDescription,
}: ConnectionTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tableId = useId();
  const columns: { key: SortColumn; label: string }[] = [
    { key: 'displayName', label: 'Connection' },
    { key: 'owners', label: 'Owners' },
    { key: 'connectorType', label: 'Connector type' },
    { key: 'endpoint', label: 'Endpoint / path' },
  ];

  function toggleDetails(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="inventory-table-scroll" role="region" aria-label="Connections table" tabIndex={0}>
      <table className="inventory-table" aria-busy={loading}>
        <caption className="sr-only">
          Tenant connections and owner lookup results. Sort using the column headings; expand a connection for details.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="inventory-expand-column"><span className="sr-only">Details</span></th>
            {columns.map(({ key, label }) => (
              <th
                scope="col"
                key={key}
                aria-sort={sort.column === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button className="inventory-sort" onClick={() => onSort(key)}>
                  {label}
                  {sort.column !== key ? <ArrowUpDown aria-hidden="true" className="icon-size-100" /> :
                    sort.direction === 'asc' ? <ArrowUp aria-hidden="true" className="icon-size-100" /> :
                      <ArrowDown aria-hidden="true" className="icon-size-100" />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expanded.has(row.id);
            const detailId = `${tableId}-${row.id}`;
            return (
              <Fragment key={row.id}>
                <tr className="inventory-data-row">
                  <td className="inventory-expand-column">
                    <button
                      className="inventory-icon-button"
                      aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${row.displayName || row.id}`}
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? detailId : undefined}
                      onClick={() => toggleDetails(row.id)}
                    >
                      {isExpanded ? <ChevronDown aria-hidden="true" className="icon-size-200" /> :
                        <ChevronRight aria-hidden="true" className="icon-size-200" />}
                    </button>
                  </td>
                  <th scope="row">
                    <p className="font-semibold">{row.displayName || 'Unnamed connection'}</p>
                    <p className="mt-100 font-monospace text-200 font-regular text-muted-foreground">{row.id}</p>
                  </th>
                  <td><Owners row={row} /></td>
                  <td>
                    <span className="inventory-badge">{row.connectorType || 'Not provided'}</span>
                  </td>
                  <td className="font-monospace text-200">{row.endpoint || 'Not provided'}</td>
                </tr>
                {isExpanded && (
                  <tr id={detailId} className="inventory-detail-row">
                    <td colSpan={5}><ConnectionDetails row={row} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>
                <div className="inventory-empty">
                  <p className="text-400 font-semibold">{emptyTitle}</p>
                  <p className="mt-200 text-muted-foreground">{emptyDescription}</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

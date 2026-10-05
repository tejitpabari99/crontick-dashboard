import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CardLink, isAllowedLink } from '../../frame/CardLink.tsx';
import type { CardTypeProps } from '../../registry/registry.ts';
import type { Cell, TableData } from '../../../../src/index.js';
import { clampProps } from '../shared/clamp.ts';
import { highlight } from '../shared/highlight.tsx';
import { PageMore, ShowMore } from '../shared/ShowMore.tsx';
import { useQueryFilter } from '../shared/useQueryFilter.ts';
import {
  cellText,
  filterRows,
  inferColumnType,
  nextSort,
  normalizeColumns,
  sortRows,
  type ColumnType,
  type SortState,
} from './logic.ts';
import './table.css';

const COMPACT_CAP = 50;
const PAGE = 200;
const SEARCH_MIN_ROWS = 5;

interface Row {
  link?: string | undefined;
  cells: Cell[];
}

function str(cell: Cell | undefined): string {
  if (cell === undefined) return '';
  const v = cellText(cell);
  return v === null || v === undefined ? '' : String(v);
}

function rowText(row: Row): string {
  return row.cells.map(str).join(' ');
}

function cellLink(cell: Cell | undefined): string | undefined {
  return cell !== null && typeof cell === 'object' && typeof cell.link === 'string' ? cell.link : undefined;
}

function CellContent({ cell, query, compact }: { cell: Cell | undefined; query: string; compact: boolean }) {
  const v = cell === undefined ? null : cellText(cell);
  const link = cellLink(cell);
  let body: ReactNode;
  if (typeof v === 'boolean') {
    body = (
      <>
        <span aria-hidden="true">{v ? '✓' : '–'}</span>
        <span className="tbl-sr">{v ? 'Yes' : 'No'}</span>
      </>
    );
  } else if (v === null || v === undefined) {
    body = '–';
  } else {
    body = highlight(String(v), query);
  }
  const text = str(cell);
  if (link !== undefined && text !== '') {
    return (
      <span className="tbl-cell-link">
        <CardLink href={link} title={text}>
          {body}
        </CardLink>
      </span>
    );
  }
  return compact && typeof v !== 'boolean' ? <span {...clampProps(text, 1)}>{body}</span> : <>{body}</>;
}

export function TableBody({ card, data, mode, query }: CardTypeProps<TableData>) {
  const compact = mode !== 'fullscreen';
  const columns = useMemo(() => normalizeColumns(Array.isArray(data?.columns) ? data.columns : []), [data]);
  const rows = useMemo<Row[]>(() => (Array.isArray(data?.rows) ? (data.rows as Row[]) : []), [data]);
  const defaultSort = data?.defaultSort ?? null;
  const [sort, setSort] = useState<SortState | null>(defaultSort);
  const [ownQuery, setOwnQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const types = useMemo<ColumnType[]>(
    () => columns.map((c, i) => inferColumnType(rows.map((r) => r.cells[i] as Cell), c.sort)),
    [columns, rows],
  );

  const pre = useQueryFilter(rows, query, rowText);
  // Seam for 04 Task 5: per-column `filters` (fullscreen only) join the same filterRows call.
  const matched = useMemo(() => filterRows(pre.visible, { ownQuery }), [pre.visible, ownQuery]);
  const sorted = useMemo(
    () => (sort ? sortRows(matched, sort.column, sort.dir, types[sort.column] ?? 'text') : matched),
    [matched, sort, types],
  );
  const onSort = useCallback((c: number) => setSort((s) => nextSort(s, c, defaultSort)), [defaultSort]);

  const searchable = data?.searchable !== false && (!compact || rows.length > SEARCH_MIN_ROWS);
  const cap = compact ? COMPACT_CAP : shown;
  const visible = sorted.slice(0, cap);
  const remaining = sorted.length - visible.length;
  const hl = `${query} ${ownQuery}`;
  const linkOf = (row: Row) => (typeof row.link === 'string' && isAllowedLink(row.link) ? row.link : undefined);

  let empty: ReactNode = null;
  if (rows.length === 0) empty = <p className="tbl-empty">No rows</p>;
  else if (pre.zeroMatch)
    empty = (
      <p className="tbl-empty">
        {`No rows match “${query}” (${pre.hidden} hidden) — `}
        <button type="button" className="show-more" onClick={pre.showAll}>
          Show all
        </button>
      </p>
    );
  else if (sorted.length === 0) empty = <p className="tbl-empty">{`No rows match “${ownQuery}”`}</p>;

  return (
    <div className="tbl-root">
      {searchable && (
        <div className="tbl-toolbar">
          <input
            type="search"
            className="tbl-search"
            aria-label="Search rows"
            placeholder="Search rows"
            value={ownQuery}
            onChange={(e) => setOwnQuery(e.target.value)}
          />
          <span className="tbl-count" aria-live="polite">{`${sorted.length} of ${rows.length} rows`}</span>
        </div>
      )}
      {rows.length > 0 && visible.length > 0 && (
        <div className="tbl-wrap">
          <table className={`tbl${compact ? ' tbl--compact' : ''}`}>
            <thead>
              <tr>
                {columns.map((c, i) => {
                  const active = sort?.column === i ? sort.dir : null;
                  return (
                    <th
                      key={i}
                      scope="col"
                      className={types[i] === 'number' ? 'tbl-num' : undefined}
                      {...(active ? { 'aria-sort': active === 'asc' ? ('ascending' as const) : ('descending' as const) } : {})}
                    >
                      <button type="button" className="tbl-sort" onClick={() => onSort(i)}>
                        {c.label}
                        <span className="tbl-sort__arrow" aria-hidden="true">
                          {active === 'asc' ? ' ▲' : active === 'desc' ? ' ▼' : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, r) => {
                const href = linkOf(row);
                const name = row.cells.slice(0, 2).map(str).filter(Boolean).join(' ');
                return (
                  <tr key={r} className={href ? 'tbl-row tbl-row--link' : 'tbl-row'}>
                    {columns.map((_, i) => (
                      <td key={i} className={`tbl-cell${types[i] === 'number' ? ' tbl-num' : ''}`}>
                        {i === 0 && href && (
                          <span className="tbl-rowlink">
                            <CardLink href={href} title={name}>
                              <span className="tbl-sr">{name}</span>
                            </CardLink>
                          </span>
                        )}
                        <CellContent cell={row.cells[i]} query={hl} compact={compact} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {empty}
      {remaining > 0 &&
        (compact ? (
          <ShowMore cardId={card.id} count={remaining} />
        ) : (
          <PageMore count={Math.min(PAGE, remaining)} onMore={() => setShown((n) => n + PAGE)} />
        ))}
    </div>
  );
}

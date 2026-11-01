import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Spinner } from './ui.jsx';
import { useDebounced } from '../lib/useAsync.js';

/**
 * Async searchable dropdown. `fetchItems(query)` returns { items }.
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 */
export function SearchSelect({ fetchItems, onSelect, renderItem, placeholder = 'Search…', footer, emptyText = 'No matches', autoFocus }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(0);
  const [meta, setMeta] = useState(null);
  const debounced = useDebounced(query, 220);
  const root = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    setError(null);
    fetchItems(debounced)
      .then((res) => {
        if (stale) return;
        setItems(res.items || []);
        setMeta(res.source || null);
        setActive(0);
      })
      .catch((e) => !stale && setError(e.message))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [debounced, open, fetchItems]);

  useEffect(() => {
    const onDoc = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (item) => {
    onSelect(item);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && items[active]) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="ss" ref={root}>
      <div className={`ss-input ${open ? 'is-open' : ''}`}>
        <Icon name="search" className="muted" />
        <input
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
        />
        {loading && open && <Spinner size={14} />}
      </div>
      {open && (
        <div className="ss-menu" ref={listRef} role="listbox">
          {error && <div className="ss-empty text-danger">{error}</div>}
          {!error && meta && !meta.exists && (
            <div className="ss-empty">
              Collection <code>{meta.collection}</code> was not found in <code>{meta.database}</code>.
            </div>
          )}
          {!error && (!meta || meta.exists) && !loading && items.length === 0 && <div className="ss-empty">{emptyText}</div>}
          {items.map((item, i) => (
            <button
              type="button"
              key={item._id}
              className="ss-item"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              role="option"
              aria-selected={i === active}
            >
              {renderItem(item)}
            </button>
          ))}
          {footer && <div className="ss-footer" onClick={() => setOpen(false)}>{footer}</div>}
        </div>
      )}
    </div>
  );
}

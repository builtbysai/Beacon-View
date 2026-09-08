import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brand, Icon, type IconName } from './Icon';

const preferenceKey = 'beacon.sidebar.collapsed.v1';

export function Sidebar({
  email,
  items,
  onLogout,
}: {
  email: string;
  items: {
    label: string;
    icon: IconName;
    current: boolean;
    onSelect: () => void;
  }[];
  onLogout: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === 'true';
    } catch {
      return false;
    }
  });
  const [tip, setTip] = useState<{
    label: string;
    top: number;
    left: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function hideTip() {
    clearTimeout(timer.current);
    setTip(null);
  }
  function deferHideTip() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(null), 120);
  }
  function showTip(target: EventTarget) {
    if (!collapsed || !window.matchMedia('(min-width: 761px)').matches) return;
    const control =
      target instanceof Element
        ? target.closest<HTMLElement>('[data-tooltip]')
        : null;
    if (!control) return;
    clearTimeout(timer.current);
    const rect = control.getBoundingClientRect();
    setTip({
      label: control.dataset.tooltip!,
      top: Math.max(4, Math.min(rect.top, window.innerHeight - 48)),
      left: rect.right + 8,
    });
  }
  useEffect(() => {
    const dismiss = () => {
      clearTimeout(timer.current);
      setTip(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, []);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    hideTip();
    try {
      localStorage.setItem(preferenceKey, String(next));
    } catch {
      /* Navigation remains usable if browser storage is unavailable. */
    }
  }
  return (
    <aside
      id="beacon-sidebar"
      className="sidebar"
      data-collapsed={collapsed}
      onFocus={(event) => showTip(event.target)}
      onBlur={deferHideTip}
      onPointerOver={(event) => showTip(event.target)}
      onPointerLeave={deferHideTip}
    >
      <div className="sidebar-header">
        <a className="sidebar-brand" href="/" aria-label="Beacon home">
          <Brand compact={collapsed} />
        </a>
      </div>
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="beacon-sidebar"
        data-tooltip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={toggle}
      >
        <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
      </button>
      <nav aria-label="Primary navigation">
        {items.map((item) => (
          <button
            type="button"
            key={item.label}
            className={item.current ? 'nav-active' : 'nav-button'}
            aria-current={item.current ? 'page' : undefined}
            aria-label={item.label}
            data-tooltip={item.label}
            onClick={() => {
              hideTip();
              item.onSelect();
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a
          href="/trust"
          aria-label="Trust and privacy"
          data-tooltip="Trust and privacy"
        >
          <Icon name="shield" />
          <span>Trust &amp; privacy</span>
        </a>
        <div className="sidebar-account">
          <strong title={email}>{email}</strong>
          <button
            className="secondary"
            aria-label="Sign out"
            data-tooltip="Sign out"
            onClick={onLogout}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
      {tip &&
        createPortal(
          <span
            className="sidebar-tooltip"
            role="tooltip"
            style={{ top: tip.top, left: tip.left }}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={deferHideTip}
          >
            {tip.label}
          </span>,
          document.body,
        )}
    </aside>
  );
}

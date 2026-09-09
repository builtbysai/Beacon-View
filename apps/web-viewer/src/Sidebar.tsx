import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brand, Icon, type IconName } from './Icon';

const preferenceKey = 'beacon.sidebar.collapsed.v1';

function Avatar({
  email,
  avatarUrl,
}: {
  email: string;
  avatarUrl?: string | null | undefined;
}) {
  const [broken, setBroken] = useState(false);
  if (avatarUrl && !broken) {
    return (
      <img
        className="sidebar-avatar"
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="sidebar-avatar sidebar-avatar-initial" aria-hidden="true">
      {email.charAt(0).toUpperCase()}
    </span>
  );
}

export function Sidebar({
  email,
  avatarUrl,
  items,
  onLogout,
}: {
  email: string;
  avatarUrl?: string | null | undefined;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const accountRef = useRef<HTMLButtonElement>(null);
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
      if (event.key === 'Escape') {
        dismiss();
        setMenuOpen(false);
      }
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
  useEffect(() => {
    if (!menuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        accountRef.current &&
        !accountRef.current.parentElement?.contains(event.target)
      )
        setMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismissOutside);
    return () => window.removeEventListener('pointerdown', dismissOutside);
  }, [menuOpen]);
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
        <button
          ref={accountRef}
          type="button"
          className="sidebar-account"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-tooltip={email}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Avatar email={email} avatarUrl={avatarUrl} />
          <strong title={email}>{email}</strong>
          <Icon name="chevronRight" className="sidebar-account-chevron" />
        </button>
        {menuOpen && (
          <div className="sidebar-account-menu" role="menu">
            <span className="sidebar-account-menu-email" title={email}>
              {email}
            </span>
            <a role="menuitem" href="/trust" onClick={() => setMenuOpen(false)}>
              <Icon name="shield" />
              Trust &amp; privacy
            </a>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              <Icon name="logout" />
              Sign out
            </button>
          </div>
        )}
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

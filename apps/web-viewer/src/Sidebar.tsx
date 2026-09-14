import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import { Brand, Icon, type IconName } from './Icon';
import { useMenuKeyboardNav } from './useMenuKeyboardNav';

const preferenceKey = 'beacon.sidebar.collapsed.v1';

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
      const stored = localStorage.getItem(preferenceKey);
      if (stored !== null) return stored === 'true';
    } catch {
      /* No storage available — fall through to the width-based default. */
    }
    // No explicit preference yet: default to the compact icon rail at
    // tablet-portrait widths, where a full labeled sidebar costs too much
    // content width, and to the full sidebar everywhere wider. The user's
    // own choice (above) always overrides this default once they make one.
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 761px) and (max-width: 1024px)').matches
    );
  });
  const [tip, setTip] = useState<{
    label: string;
    top: number;
    left: number;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    bottom: number;
    left: number;
    width: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const accountRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  function hideTip() {
    clearTimeout(timer.current);
    setTip(null);
  }
  function deferHideTip() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(null), 120);
  }
  function showTip(target: EventTarget) {
    if (
      !collapsed ||
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(min-width: 761px)').matches
    )
      return;
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
        if (menuOpen) {
          setMenuOpen(false);
          accountRef.current?.focus();
        }
      }
      if (
        event.key.toLowerCase() === 'b' &&
        (event.ctrlKey || event.metaKey) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        toggle();
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
  });
  useEffect(() => {
    if (!menuOpen) return;
    const positionMenu = () => {
      const rect = accountRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = collapsed ? 224 : Math.max(224, rect.width);
      setMenuPosition({
        bottom: Math.max(12, window.innerHeight - rect.bottom),
        left: collapsed
          ? Math.min(rect.right + 10, window.innerWidth - width - 12)
          : Math.min(rect.left, window.innerWidth - width - 12),
        width,
      });
    };
    positionMenu();
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        !accountRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [collapsed, menuOpen]);
  useMenuKeyboardNav(menuOpen, menuRef, accountRef, () => setMenuOpen(false));
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
      </div>
      <div className="sidebar-content">
        <span className="sidebar-group-label">Workspace</span>
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
      </div>
      <div className="sidebar-footer">
        <button
          ref={accountRef}
          type="button"
          className="sidebar-account"
          aria-label={`Open account menu for ${email}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-tooltip={email}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Avatar email={email} avatarUrl={avatarUrl} />
          <strong title={email}>{email}</strong>
          <Icon name="chevronRight" className="sidebar-account-chevron" />
        </button>
      </div>
      <button
        className="sidebar-rail"
        type="button"
        aria-label="Toggle sidebar from edge"
        aria-pressed={!collapsed}
        onClick={toggle}
      />
      {menuOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className="sidebar-account-menu"
            role="menu"
            style={menuPosition}
          >
            <div className="sidebar-account-menu-profile">
              <Avatar email={email} avatarUrl={avatarUrl} />
              <span className="sidebar-account-menu-email" title={email}>
                <small>Signed in as</small>
                {email}
              </span>
            </div>
            <div className="sidebar-account-menu-separator" />
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
          </div>,
          document.body,
        )}
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

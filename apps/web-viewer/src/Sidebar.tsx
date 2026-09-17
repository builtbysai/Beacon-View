import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import { Brand, Icon, type IconName } from './Icon';
import { useMenuKeyboardNav } from './useMenuKeyboardNav';
import './Sidebar.css';

type SidebarContextType = {
  state: 'expanded' | 'collapsed';
  toggleSidebar: () => void;
  isMobile: boolean;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [state, setState] = useState<'expanded' | 'collapsed'>(() => {
    try {
      const stored = localStorage.getItem('beacon.sidebar.state');
      if (stored === 'collapsed') return 'collapsed';
    } catch {}
    return 'expanded';
  });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const toggleSidebar = () => {
    if (isMobile) {
      setMobileOpen((prev) => !prev);
    } else {
      const next = state === 'expanded' ? 'collapsed' : 'expanded';
      setState(next);
      try {
        localStorage.setItem('beacon.sidebar.state', next);
      } catch {}
    }
  };

  return (
    <SidebarContext.Provider value={{ state, toggleSidebar, isMobile, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function SidebarTrigger({ className = '' }: { className?: string }) {
  const { toggleSidebar } = useSidebar();
  return (
    <button 
      type="button"
      className={`sidebar-trigger ${className}`} 
      onClick={toggleSidebar}
      aria-label="Toggle Sidebar"
    >
      <Icon name="list" />
    </button>
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
  const { state, toggleSidebar, isMobile, mobileOpen, setMobileOpen } = useSidebar();
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ bottom: number; left: number; width?: number } | null>(null);
  
  const accountRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [theme, setTheme] = useState<'system'|'light'|'dark'>(() => {
    try {
      return (localStorage.getItem('beacon.theme') as ('system'|'light'|'dark')) || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem('beacon.theme', theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    if (isMobile && mobileOpen) {
      setMobileOpen(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.find(i => i.current)?.label, isMobile]);

  function hideTip() {
    clearTimeout(timer.current);
    setTip(null);
  }
  function deferHideTip() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(null), 120);
  }
  function showTip(target: EventTarget) {
    if (state !== 'collapsed' || isMobile) return;
    const control = target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    if (!control) return;
    clearTimeout(timer.current);
    const rect = control.getBoundingClientRect();
    setTip({
      label: control.dataset.tooltip!,
      top: Math.max(4, Math.min(rect.top + rect.height/2 - 12, window.innerHeight - 30)),
      left: rect.right + 8,
    });
  }

  useEffect(() => {
    const dismiss = () => { clearTimeout(timer.current); setTip(null); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
        if (menuOpen) {
          setMenuOpen(false);
          accountRef.current?.focus();
        } else if (isMobile && mobileOpen) {
          setMobileOpen(false);
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
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
    };
  }, [menuOpen, mobileOpen, isMobile, toggleSidebar]);

  useEffect(() => {
    if (!menuOpen) return;
    const positionMenu = () => {
      const rect = accountRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (isMobile) {
        setMenuPosition({
          bottom: Math.max(16, window.innerHeight - rect.bottom + 8),
          left: 16,
          width: window.innerWidth - 32,
        });
      } else {
        setMenuPosition({
          bottom: Math.max(16, window.innerHeight - rect.bottom),
          left: rect.right + 12,
        });
      }
    };
    positionMenu();
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!accountRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('resize', positionMenu);
    return () => {
      window.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('resize', positionMenu);
    };
  }, [menuOpen, isMobile]);

  useMenuKeyboardNav(menuOpen, menuRef, accountRef, () => setMenuOpen(false));

  return (
    <>
      {isMobile && mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <aside 
        className="sidebar" 
        data-state={isMobile ? (mobileOpen ? 'expanded' : 'closed') : state}
        aria-label="Primary navigation"
        onFocus={(event) => showTip(event.target)}
        onBlur={deferHideTip}
        onPointerOver={(event) => showTip(event.target)}
        onPointerLeave={deferHideTip}
      >
        <div className="sidebar-header">
          <a className="sidebar-brand" href="/" aria-label="Beacon home">
            {state === 'collapsed' && !isMobile ? (
              <Brand compact />
            ) : (
              <Brand />
            )}
          </a>
          {isMobile && (
            <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <Icon name="plus" />
            </button>
          )}
        </div>
        
        <div className="sidebar-content">
          <nav aria-label="Main menu">
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
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <button
            ref={accountRef}
            type="button"
            className="account-button"
            aria-label={`Open account menu for ${email}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-tooltip={email}
            onClick={() => {
              hideTip();
              setMenuOpen((o) => !o);
            }}
          >
            <Avatar email={email} avatarUrl={avatarUrl} size="md" className="account-avatar" />
            <div className="account-details">
              <span className="account-email" title={email}>{email}</span>
            </div>
            <Icon name="chevronRight" className="account-chevron" />
          </button>
        </div>
        {!isMobile && (
          <button
            type="button"
            className="sidebar-rail"
            aria-label="Toggle Sidebar"
            title="Toggle Sidebar"
            onClick={toggleSidebar}
          />
        )}
      </aside>

      {menuOpen && menuPosition && createPortal(
        <div ref={menuRef} className="account-menu" role="menu" style={menuPosition}>
          <div className="account-menu-header">
            <Avatar email={email} avatarUrl={avatarUrl} size="md" />
            <div className="account-details-full">
              <span className="account-email" title={email}>{email}</span>
              <span className="account-label">Signed in</span>
            </div>
          </div>
          
          <div className="account-menu-item theme-section" role="none">
            <div className="theme-label">Theme</div>
            <div className="theme-toggle-group" role="group" aria-label="Theme preference">
              <button 
                type="button" 
                className="theme-toggle-btn" 
                aria-pressed={theme === 'light'} 
                onClick={() => setTheme('light')}
              >
                <Icon name="sun" /> Light
              </button>
              <button 
                type="button" 
                className="theme-toggle-btn" 
                aria-pressed={theme === 'system'} 
                onClick={() => setTheme('system')}
              >
                <Icon name="browser" /> System
              </button>
              <button 
                type="button" 
                className="theme-toggle-btn" 
                aria-pressed={theme === 'dark'} 
                onClick={() => setTheme('dark')}
              >
                <Icon name="moon" /> Dark
              </button>
            </div>
          </div>
          
          <a className="account-menu-item" role="menuitem" href="/trust" onClick={() => setMenuOpen(false)}>
            <div className="account-menu-item-left">
              <Icon name="shield" />
              <span>Trust & privacy</span>
            </div>
          </a>
          
          <button
            className="account-menu-item account-menu-logout"
            role="menuitem"
            type="button"
            onClick={() => { setMenuOpen(false); onLogout(); }}
          >
            <div className="account-menu-item-left">
              <Icon name="logout" />
              <span>Sign out</span>
            </div>
          </button>
        </div>,
        document.body
      )}

      {tip && createPortal(
        <span className="sidebar-tooltip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </span>,
        document.body
      )}
    </>
  );
}

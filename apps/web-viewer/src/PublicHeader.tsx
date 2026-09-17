import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Brand, Icon } from './Icon';
import './PublicHeader.css';

export interface NavLink {
  label: string;
  href: string;
  isActive?: boolean;
}

interface PublicHeaderProps {
  links?: NavLink[];
  action?: React.ReactNode;
  sticky?: boolean;
  alignContainer?: 'splash' | 'trust' | 'auth' | 'contact';
}

export function PublicHeader({ links = [], action, sticky = false, alignContainer = 'splash' }: PublicHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <>
      <header className={`public-header ${sticky ? 'sticky' : ''} align-${alignContainer}`}>
        <div className="ph-wrap">
          <a className="ph-brand" href="/" aria-label="Beacon home">
            <Brand compact />
            <span className="ph-brand-word">Beacon</span>
          </a>

          {links.length > 0 && (
            <nav className="ph-nav-desktop" aria-label="Main navigation">
              {links.map((link) => (
                <a 
                  key={link.href} 
                  href={link.href}
                  className={link.isActive ? 'active' : ''}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}

          <div className="ph-actions">
            {action && <div className="ph-action-slot">{action}</div>}
            
            {links.length > 0 && (
              <button 
                className="ph-menu-trigger" 
                aria-expanded={menuOpen}
                aria-controls="mobile-nav-menu"
                aria-label="Toggle navigation menu"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <Icon name={menuOpen ? 'close' : 'list'} />
              </button>
            )}
          </div>
        </div>
      </header>

      {menuOpen && createPortal(
        <div className="ph-mobile-overlay" onClick={() => setMenuOpen(false)}>
          <div 
            className="ph-mobile-menu" 
            id="mobile-nav-menu"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <div className="ph-mobile-header">
              <span className="ph-brand-word">Menu</span>
              <button 
                className="ph-menu-close" 
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <Icon name="close" />
              </button>
            </div>
            <nav className="ph-mobile-nav">
              {links.map((link) => (
                <a 
                  key={link.href} 
                  href={link.href}
                  className={link.isActive ? 'active' : ''}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              {action && (
                <div className="ph-mobile-action" onClick={() => setMenuOpen(false)}>
                  {action}
                </div>
              )}
            </nav>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

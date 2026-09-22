import type { ReactNode } from 'react';
import './Settings.css';

/**
 * Shared building blocks for every Settings section. The goal is that no
 * section hand-rolls its own row/grid layout: a new setting is a
 * <SettingsRow> or a <SettingsCard> with <SettingsFieldRow>s inside it, and
 * it gets correct spacing, typography and responsive wrapping for free.
 *
 * Field layout in particular is flexbox-based (flex-wrap + flex-basis), not
 * CSS grid with fixed minmax() tracks -- a grid track's minimum can exceed
 * its container and overflow it with no way to shrink further; a flex item
 * with a basis just wraps to the next line instead. See ADR-less commit
 * "Replace the settings overflow fix's window-width breakpoint with a
 * container query" for the incident this replaces.
 */

export function SettingsSectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="settings-section-header">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {description && (
        <p className="settings-section-description">{description}</p>
      )}
    </div>
  );
}

/** A distinct, bordered block within a section -- use for a form, a
 * self-contained feature (Danger zone, Join another household), or a list.
 * Plain content that's just a sequence of <SettingsRow>s doesn't need one. */
export function SettingsCard({
  title,
  description,
  tone,
  'aria-label': ariaLabel,
  children,
}: {
  title?: string;
  description?: ReactNode;
  tone?: 'danger';
  'aria-label'?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`settings-card${tone ? ` settings-card-${tone}` : ''}`}
      aria-label={ariaLabel ?? title}
    >
      {(title || description) && (
        <header className="settings-card-header">
          {title && <h3>{title}</h3>}
          {description && <p>{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A label + optional description on the left, one control on the right;
 * wraps to stack on narrow containers. This is the workhorse row for
 * everything from "Turn on notifications" to "Delete account". */
export function SettingsRow({
  leading,
  title,
  description,
  tone,
  children,
}: {
  /** An avatar or icon before the title/description, for an identity-style
   * row -- most rows don't need this. */
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'danger';
  children?: ReactNode;
}) {
  return (
    <div className={`settings-row${tone ? ` settings-row-${tone}` : ''}`}>
      <div className="settings-row-identity">
        {leading}
        <div>
          <strong>{title}</strong>
          {description && <p>{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** A row of form fields that wraps naturally instead of overflowing --
 * each <SettingsField> gets a flex-basis, not a hard-minimum grid track. */
export function SettingsFieldRow({
  label,
  description,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-field-row-group">
      {(label || description) && (
        <div className="settings-field-row-copy">
          {label && <strong>{label}</strong>}
          {description && <p>{description}</p>}
        </div>
      )}
      <div className="settings-field-row">{children}</div>
    </div>
  );
}

export function SettingsField({
  label,
  htmlFor,
  grow,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  /** This field should claim extra space before others wrap (e.g. an email
   * address next to a short role dropdown). */
  grow?: boolean;
  /** This field's own natural width is large (e.g. a one-time code) and
   * should get more room before wrapping than the 10rem default. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`settings-field${grow ? ' settings-field-grow' : ''}${
        wide ? ' settings-field-wide' : ''
      }`}
    >
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

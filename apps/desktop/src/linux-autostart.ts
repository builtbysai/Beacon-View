/**
 * Electron's login-item API covers Windows and macOS only. On Linux the
 * freedesktop.org autostart spec is a .desktop file in
 * $XDG_CONFIG_HOME/autostart.
 */
export const LINUX_AUTOSTART_FILE = 'beacon-secureview.desktop';

/**
 * Desktop Entry spec "Exec key" quoting. The spec applies the string-value
 * escape (`\\` -> `\`) before the Exec quoting rule, so every backslash the
 * quoting rule produces is doubled again, and `%` (field codes) becomes `%%`.
 */
export function quoteExecArgument(value: string): string {
  if (/[\n\r]/.test(value)) throw new Error('Exec arguments cannot span lines');
  const escapedPercent = value.replace(/%/g, '%%');
  if (value !== '' && !/[\s"'\\`$<>|&;()*?#~=]/.test(value))
    return escapedPercent;
  const quoted = `"${escapedPercent.replace(/["`$\\]/g, '\\$&')}"`;
  return quoted.replace(/\\/g, '\\\\');
}

export function linuxAutostartEntry(
  executable: string,
  args: readonly string[],
): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Beacon',
    'Comment=Keep Beacon running in the background',
    `Exec=${[executable, ...args].map(quoteExecArgument).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

import path from 'node:path';

import { Menu, nativeImage, Tray } from 'electron';

export interface TrayActions {
  autostart: { enabled: boolean; get(): boolean; set(value: boolean): void };
  open(): void;
  quit(): void;
  reload(): void;
}

/**
 * The tray is how Beacon stays reachable while its window is hidden, and it
 * is the desktop counterpart of Android's foreground-service notification:
 * whenever Camera Mode is broadcasting, the icon and tooltip say so.
 */
export class BeaconTray {
  private readonly tray: Tray;
  private readonly icons;
  private live = false;

  constructor(
    assetsDirectory: string,
    private readonly actions: TrayActions,
  ) {
    this.icons = {
      idle: nativeImage.createFromPath(path.join(assetsDirectory, 'tray.png')),
      live: nativeImage.createFromPath(
        path.join(assetsDirectory, 'tray-live.png'),
      ),
    };
    this.tray = new Tray(this.icons.idle);
    this.tray.on('click', () => actions.open());
    this.render();
  }

  setLive(live: boolean): void {
    if (live === this.live) return;
    this.live = live;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private render(): void {
    const { actions } = this;
    this.tray.setImage(this.live ? this.icons.live : this.icons.idle);
    this.tray.setToolTip(this.live ? 'Beacon — Camera Mode is live' : 'Beacon');
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Beacon', click: () => actions.open() },
        ...(this.live
          ? [{ enabled: false, label: '● Camera Mode is live' } as const]
          : []),
        { type: 'separator' },
        {
          checked: actions.autostart.get(),
          click: (item) => {
            actions.autostart.set(item.checked);
            this.render();
          },
          enabled: actions.autostart.enabled,
          label: 'Start Beacon when I sign in',
          type: 'checkbox',
        },
        { label: 'Reload', click: () => actions.reload() },
        { type: 'separator' },
        { label: 'Quit Beacon', click: () => actions.quit() },
      ]),
    );
  }
}

import path from 'node:path';

import {
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  Tray,
} from 'electron';

export type CameraActivity = 'off' | 'standby' | 'live';

export interface TrayActions {
  autostart: { enabled: boolean; get(): boolean; set(value: boolean): void };
  open(): void;
  quit(): void;
  reload(): void;
}

/**
 * The tray is how Beacon stays reachable while its window is hidden, and it
 * is the desktop counterpart of Android's foreground-service notification:
 * whenever this computer's camera is on, the icon (red dot), tooltip, and
 * menu say so. On standby (camera off, waiting for a viewer) the tooltip and
 * menu say that too.
 */
export class BeaconTray {
  private readonly tray: Tray;
  private readonly icons;
  private activity: CameraActivity = 'off';

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

  setActivity(activity: CameraActivity): void {
    if (activity === this.activity) return;
    this.activity = activity;
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
    const live = this.activity === 'live';
    this.tray.setImage(live ? this.icons.live : this.icons.idle);
    this.tray.setToolTip(
      live
        ? 'Beacon — camera is on'
        : this.activity === 'standby'
          ? 'Beacon — camera on standby (off until someone views)'
          : 'Beacon',
    );
    const status: MenuItemConstructorOptions[] =
      this.activity === 'off'
        ? []
        : [
            {
              enabled: false,
              label: live
                ? '● Camera is on'
                : '○ Camera on standby — camera off',
            },
          ];
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Beacon', click: () => actions.open() },
        ...status,
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

import path from 'node:path';

import {
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  Tray,
} from 'electron';

import {
  showsWall,
  type TrayCamera,
  trayCameraLabel,
  trayCameraPath,
  WALL_PATH,
} from './tray-cameras.js';

export type CameraActivity = 'off' | 'standby' | 'live';

export interface TrayActions {
  autostart: { enabled: boolean; get(): boolean; set(value: boolean): void };
  open(): void;
  openPath(path: string): void;
  quit(): void;
  reload(): void;
  version: string;
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
  private update: { label: string; run(): void } | null = null;
  private cameras: TrayCamera[] = [];

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

  /** The favorite cameras to offer as shortcuts (ADR 0095). */
  setCameras(cameras: TrayCamera[]): void {
    if (JSON.stringify(cameras) === JSON.stringify(this.cameras)) return;
    this.cameras = cameras;
    this.render();
  }

  /** Shows (or removes) the update entry, e.g. "Restart to update". */
  setUpdate(update: { label: string; run(): void } | null): void {
    this.update = update;
    this.render();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private cameraItems(): MenuItemConstructorOptions[] {
    if (this.cameras.length === 0) return [];
    const { actions } = this;
    return [
      { type: 'separator' },
      ...(showsWall(this.cameras)
        ? [
            {
              click: () => actions.openPath(WALL_PATH),
              label: 'Camera wall',
            },
          ]
        : []),
      ...this.cameras.map((camera) => ({
        click: () => actions.openPath(trayCameraPath(camera.id)),
        label: trayCameraLabel(camera),
      })),
    ];
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
        ...this.cameraItems(),
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
        ...(this.update
          ? [{ click: () => this.update?.run(), label: this.update.label }]
          : []),
        { type: 'separator' },
        { enabled: false, label: `Beacon ${actions.version}` },
        { label: 'Quit Beacon', click: () => actions.quit() },
      ]),
    );
  }
}

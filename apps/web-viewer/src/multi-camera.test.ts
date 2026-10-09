import { describe, expect, it, vi } from 'vitest';

import { AnnounceRegistry, type AnnounceTarget } from './announce';
import { autoColumns, MAX_WALL_TILES } from './CameraWall';
import {
  DATA_SAVER_KBPS,
  limitVideoBitrate,
  loadDataSaver,
  saveDataSaver,
} from './data-saver';

const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=recvonly',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'b=AS:2500',
  'a=recvonly',
  '',
].join('\r\n');

describe('data saver bitrate cap', () => {
  it('adds a bandwidth line to the video section only', () => {
    const limited = limitVideoBitrate(SDP, DATA_SAVER_KBPS).split('\r\n');
    const video = limited.indexOf('m=video 9 UDP/TLS/RTP/SAVPF 96');
    expect(limited.slice(video)).toContain(`b=AS:${DATA_SAVER_KBPS}`);
    expect(limited.slice(0, video).some((line) => line.startsWith('b='))).toBe(
      false,
    );
  });

  it('replaces an existing cap instead of adding a second', () => {
    const limited = limitVideoBitrate(SDP, 300);
    expect(limited.match(/b=AS:/gu)).toHaveLength(1);
    expect(limited).toContain('b=AS:300');
    expect(limited).not.toContain('b=AS:2500');
  });

  it('keeps the line endings and never goes below a usable floor', () => {
    expect(limitVideoBitrate(SDP, 5)).toContain('b=AS:30');
    expect(limitVideoBitrate(SDP.replaceAll('\r\n', '\n'), 300)).not.toContain(
      '\r',
    );
  });

  it('remembers the choice and announces changes', () => {
    const heard = vi.fn();
    window.addEventListener('beacon:data-saver', heard);
    expect(loadDataSaver()).toBe(false);
    saveDataSaver(true);
    expect(loadDataSaver()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    saveDataSaver(false);
    window.removeEventListener('beacon:data-saver', heard);
  });
});

describe('camera wall layout', () => {
  it('fills the page with one camera and grows with the count', () => {
    expect(autoColumns(1)).toBe(1);
    expect(autoColumns(2)).toBe(2);
    expect(autoColumns(4)).toBe(2);
    expect(autoColumns(5)).toBe(3);
    expect(autoColumns(MAX_WALL_TILES)).toBe(3);
  });
});

describe('announce on all cameras', () => {
  function target(id: string, overrides: Partial<AnnounceTarget> = {}) {
    return {
      eligible: true,
      id,
      start: vi.fn(),
      state: 'idle' as const,
      stop: vi.fn(),
      ...overrides,
    };
  }

  it('talks only through cameras that can take it', () => {
    const registry = new AnnounceRegistry();
    const ready = target('porch');
    const paused = target('baby', { eligible: false });
    registry.register(ready);
    registry.register(paused);
    expect(registry.reachable).toBe(1);
    expect(registry.startAll()).toBe(1);
    expect(ready.start).toHaveBeenCalledOnce();
    expect(paused.start).not.toHaveBeenCalled();
  });

  it('counts cameras being talked through and stops them all', () => {
    const registry = new AnnounceRegistry();
    const one = target('a', { state: 'speaking' });
    const two = target('b', { state: 'busy' });
    registry.register(one);
    registry.register(two);
    expect(registry.speaking).toBe(1);
    registry.stopAll();
    expect(one.stop).toHaveBeenCalledOnce();
    expect(two.stop).toHaveBeenCalledOnce();
  });

  it('forgets a camera when its tile goes away and tells listeners', () => {
    const registry = new AnnounceRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const leave = registry.register(target('a'));
    expect(registry.reachable).toBe(1);
    leave();
    expect(registry.reachable).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores an old tile leaving after a new one registered', () => {
    const registry = new AnnounceRegistry();
    const first = target('a');
    const second = target('a');
    const leaveFirst = registry.register(first);
    registry.register(second);
    leaveFirst();
    expect(registry.reachable).toBe(1);
  });
});

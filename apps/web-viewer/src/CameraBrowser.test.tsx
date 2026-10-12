import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraBrowser } from './CameraBrowser';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});
const base = {
  enabled: true,
  credentialRevoked: false,
  online: true,
  streaming: false,
  deviceName: 'Spare phone',
};
const cameras = [
  { ...base, name: 'Hallway' },
  { ...base, name: 'Garden', deviceName: 'Pixel tablet', streaming: true },
  { ...base, name: 'Bedroom', privacyMode: true, streaming: true },
  { ...base, name: 'Garage', online: false },
  { ...base, name: 'Old phone', credentialRevoked: true, privacyMode: true },
];
function mount(items = cameras) {
  return render(
    <CameraBrowser cameras={items}>
      {(visible) => (
        <ul>
          {visible.map((camera) => (
            <li key={camera.name}>{camera.name}</li>
          ))}
        </ul>
      )}
    </CameraBrowser>,
  );
}
describe('camera browsing', () => {
  it('searches names and source devices, ignoring case and surrounding spaces', () => {
    mount();
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search cameras' }),
      { target: { value: '  PIXEL  ' } },
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Garden');
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 camera matches “PIXEL”.',
    );
    expect(window.location.search).toBe('?query=PIXEL');
  });
  it('restores an availability filter from the camera URL', () => {
    window.history.replaceState({}, '', '/cameras?availability=privacy');
    mount();
    expect(screen.getByRole('radio', { name: 'Privacy on' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Bedroom');
  });
  it('keeps unavailable cameras out of ready results even with stale streaming', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Ready to view' }));
    expect(
      screen.getAllByRole('listitem').map((item) => item.textContent),
    ).toEqual(['Hallway', 'Garden']);
    expect(
      screen.getByRole('radio', { name: 'Ready to view' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
  it('uses revoked access ahead of privacy when filtering attention', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Need attention' }));
    expect(
      screen.getAllByRole('listitem').map((item) => item.textContent),
    ).toEqual(['Garage', 'Old phone']);
    fireEvent.click(screen.getByRole('radio', { name: 'Privacy on' }));
    expect(screen.getByRole('listitem')).toHaveTextContent('Bedroom');
  });
  it('combines query and status and can clear both from the empty result', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'Hallway' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Privacy on' }));
    expect(
      screen.getByRole('heading', { name: 'No matching cameras' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
  it('passes an empty household to the existing setup state', () => {
    mount([]);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toBeEmptyDOMElement();
    expect(screen.queryByText('No matching cameras')).not.toBeInTheDocument();
  });
});

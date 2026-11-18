import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { buildMapViewport, type MapPinInput } from '../utils/mapMath';
import { TripMap, buildMapHtml } from './TripMap';

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View: MockView } = require('react-native');

  return {
    WebView: React.forwardRef((props: { onMessage?: unknown; testID?: string }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }));
      return React.createElement(MockView, {
        onMessage: props.onMessage,
        testID: 'mock-webview',
      });
    }),
  };
});

const PINS: MapPinInput[] = [
  { id: 'u1', latitude: 10.7905, longitude: 78.7047, label: 'VM', isSelf: true },
  { id: 'u2', latitude: 10.7925, longitude: 78.7067, label: 'B', isSelf: false },
];

describe('buildMapHtml', () => {
  it('draws tiles and one pin per member', () => {
    const html = buildMapHtml(buildMapViewport(PINS, { width: 320, height: 240 }));

    expect(html).toContain('https://tile.openstreetmap.org/');
    expect(html).toContain('data-id="u1"');
    expect(html).toContain('data-id="u2"');
    expect(html).toContain('class="pin self"');
    expect(html).toContain('>You<');
  });

  it('escapes member labels', () => {
    const html = buildMapHtml(
      buildMapViewport([{ ...PINS[0], isSelf: false, label: '<img src=x>' }], { width: 320, height: 240 }),
    );

    expect(html).not.toContain('<img src=');
    expect(html).toContain('&lt;im');
  });

  it('drops ids that could break out of the attribute', () => {
    const html = buildMapHtml(
      buildMapViewport([{ ...PINS[0], id: 'x" onload="alert(1)' }], { width: 320, height: 240 }),
    );

    expect(html).not.toContain('onload=');
  });
});

describe('TripMap', () => {
  it('reports the member whose pin was tapped', () => {
    const onSelect = jest.fn();

    render(<TripMap onSelect={onSelect} pins={PINS} />);
    fireEvent(screen.getByTestId('trip-map-frame'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 240 } },
    });
    fireEvent(screen.getByTestId('mock-webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'select', id: 'u2' }) },
    });

    expect(onSelect).toHaveBeenCalledWith('u2');
  });

  it('ignores ids that are not on this trip', () => {
    const onSelect = jest.fn();

    render(<TripMap onSelect={onSelect} pins={PINS} />);
    fireEvent(screen.getByTestId('trip-map-frame'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 240 } },
    });
    fireEvent(screen.getByTestId('mock-webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'select', id: 'stranger' }) },
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores malformed messages from the page', () => {
    const onSelect = jest.fn();

    render(<TripMap onSelect={onSelect} pins={PINS} />);
    fireEvent(screen.getByTestId('trip-map-frame'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 240 } },
    });
    fireEvent(screen.getByTestId('mock-webview'), 'message', { nativeEvent: { data: 'not json' } });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a spinner until the container has been measured', () => {
    render(<TripMap pins={PINS} />);

    expect(screen.queryByTestId('mock-webview')).toBeNull();
    expect(screen.getByTestId('trip-map-frame')).toBeTruthy();
    expect(View).toBeDefined();
  });
});

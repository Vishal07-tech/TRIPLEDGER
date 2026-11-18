import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { colors, radius, spacing } from '../theme/tokens';
import { buildMapViewport, type MapPinInput, type MapViewport } from '../utils/mapMath';

type Props = {
  pins: MapPinInput[];
  height?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Only ids we generated ourselves are ever written into the page. */
function safeId(value: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '';
}

/** Exported so the generated page can be checked without a real WebView. */
export function buildMapHtml(viewport: MapViewport) {
  const tiles = viewport.tiles
    .map(
      (tile) =>
        `<img class="tile" alt="" draggable="false" src="${tile.url}" style="left:${tile.left}px;top:${tile.top}px" />`,
    )
    .join('');

  const pins = viewport.pins
    .map((pin) => {
      const id = safeId(pin.id);
      if (!id) return '';
      const label = escapeHtml(pin.isSelf ? 'You' : pin.label.slice(0, 3));
      return `<div class="pin${pin.isSelf ? ' self' : ''}" data-id="${id}" style="left:${pin.left}px;top:${pin.top}px">`
        + `<div class="dot">${label}</div><div class="tail"></div></div>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; background: #eaf1e6; overflow: hidden; }
  .map { position: relative; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; background: #eaf1e6; }
  .tile { position: absolute; width: 256px; height: 256px; pointer-events: none; user-select: none; }
  .pin { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; cursor: pointer; }
  .dot {
    align-items: center;
    background: #ea580c;
    border: 2px solid #ffffff;
    border-radius: 18px;
    box-shadow: 0 2px 6px rgba(11, 18, 32, 0.35);
    color: #ffffff;
    display: flex;
    font-family: -apple-system, Roboto, "Segoe UI", sans-serif;
    font-size: 11px;
    font-weight: 800;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
  .pin.self .dot { background: #0e7490; }
  .pin.selected .dot { background: #b45309; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.55); }
  .tail { background: #ffffff; height: 7px; width: 2px; }
</style>
</head>
<body>
<div class="map" id="map">${tiles}${pins}</div>
<script>
  window.__movePins = function (list) {
    for (var i = 0; i < list.length; i += 1) {
      var pin = document.querySelector('.pin[data-id="' + list[i].id + '"]');
      if (pin) {
        pin.style.left = list[i].left + 'px';
        pin.style.top = list[i].top + 'px';
      }
    }
  };

  window.__select = function (id) {
    var pins = document.querySelectorAll('.pin');
    for (var i = 0; i < pins.length; i += 1) {
      pins[i].classList.toggle('selected', pins[i].getAttribute('data-id') === id);
    }
  };

  document.getElementById('map').addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('pin')) {
        var id = node.getAttribute('data-id');
        if (id && window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', id: id }));
        }
        return;
      }
      node = node.parentNode;
    }
  }, false);
</script>
</body>
</html>`;
}

/**
 * Pins can be moved inside the already-loaded page as long as the same tiles
 * still cover them and nobody has joined or left the map.
 */
function isSameLayout(previous: MapViewport, next: MapViewport) {
  if (previous.zoom !== next.zoom) return false;
  if (previous.tiles.length !== next.tiles.length) return false;

  const previousIds = previous.pins.map((pin) => pin.id).sort().join('|');
  const nextIds = next.pins.map((pin) => pin.id).sort().join('|');
  if (previousIds !== nextIds) return false;

  const maxDrift = 4;

  for (let index = 0; index < next.tiles.length; index += 1) {
    const before = previous.tiles[index];
    const after = next.tiles[index];
    if (!before || before.key !== after.key) return false;
    if (Math.abs(before.left - after.left) > maxDrift) return false;
    if (Math.abs(before.top - after.top) > maxDrift) return false;
  }

  return true;
}

/**
 * A lightweight map of the group built from OpenStreetMap raster tiles, so
 * members can be shown inside the app without a billed map provider.
 */
export function TripMap({ pins, height = 240, selectedId, onSelect }: Props) {
  const [width, setWidth] = useState(0);
  const [html, setHtml] = useState('');
  const [failed, setFailed] = useState(false);
  const webviewRef = useRef<WebView>(null);
  const selectedRef = useRef<string | null>(selectedId ?? null);
  const renderedRef = useRef<{ html: string; viewport: MapViewport } | null>(null);
  selectedRef.current = selectedId ?? null;

  const viewport = useMemo(
    () => buildMapViewport(pins, { width, height }),
    [pins, height, width],
  );
  const pinIds = useMemo(() => new Set(pins.map((pin) => pin.id)), [pins]);

  // Refreshing positions every 15 seconds must not reload the page (tiles would
  // flash), so pins are moved in place whenever the same tiles still cover them.
  useEffect(() => {
    if (viewport.pins.length === 0 || viewport.tiles.length === 0) return;

    const previous = renderedRef.current;

    if (previous && isSameLayout(previous.viewport, viewport)) {
      const moves = viewport.pins
        .map((pin) => ({ id: safeId(pin.id), left: pin.left, top: pin.top }))
        .filter((pin) => pin.id.length > 0);
      webviewRef.current?.injectJavaScript(
        `window.__movePins && window.__movePins(${JSON.stringify(moves)}); true;`,
      );
      renderedRef.current = { html: previous.html, viewport };
      return;
    }

    const nextHtml = buildMapHtml(viewport);
    renderedRef.current = { html: nextHtml, viewport };
    setHtml(nextHtml);
  }, [viewport]);

  const applySelection = useCallback((id: string | null) => {
    const safe = id ? safeId(id) : '';
    webviewRef.current?.injectJavaScript(`window.__select && window.__select(${JSON.stringify(safe)}); true;`);
  }, []);

  useEffect(() => {
    applySelection(selectedId ?? null);
  }, [applySelection, selectedId]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string };
        if (payload.type === 'select' && payload.id && pinIds.has(payload.id)) {
          onSelect?.(payload.id);
        }
      } catch {
        // Ignore anything the page sends that we do not understand.
      }
    },
    [onSelect, pinIds],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);

  return (
    <View onLayout={handleLayout} style={[styles.wrapper, { height }]} testID="trip-map-frame">
      {width > 0 ? (
        <WebView<{}>
          ref={webviewRef}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          applicationNameForUserAgent="SutrulaPayanam/1.0"
          domStorageEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mediaPlaybackRequiresUserAction
          mixedContentMode="never"
          nestedScrollEnabled
          onLoadEnd={() => applySelection(selectedRef.current)}
          onError={() => setFailed(true)}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={(request: { url: string }) => request.url.startsWith('about:')}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
          setSupportMultipleWindows={false}
          source={{ html }}
          startInLoadingState
          style={styles.webview}
          testID="trip-map"
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      <Text style={styles.credit}>© OpenStreetMap contributors</Text>

      {failed ? (
        <View style={styles.failed}>
          <Text style={styles.failedTitle}>Map could not load</Text>
          <Text style={styles.failedBody}>
            Check your internet connection. The member list below still shows every shared position.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#EAF1E6',
    borderRadius: radius.input,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  webview: { backgroundColor: '#EAF1E6', flex: 1 },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 120 },
  credit: {
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    bottom: spacing.xs,
    borderRadius: radius.xs,
    color: colors.mutedForeground,
    fontSize: 9,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    position: 'absolute',
    right: spacing.xs,
  },
  failed: {
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
    backgroundColor: '#F7F3EA',
    gap: spacing.xs,
    justifyContent: 'center',
    padding: spacing.lg,
    position: 'absolute',
  },
  failedTitle: { color: colors.foreground, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  failedBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});

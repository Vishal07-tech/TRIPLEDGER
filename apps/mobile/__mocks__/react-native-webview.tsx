import { forwardRef, useImperativeHandle } from 'react';
import { View, type ViewProps } from 'react-native';

type MockWebViewProps = {
  testID?: string;
  onMessage?: unknown;
  onLoadEnd?: unknown;
};

/**
 * Jest cannot load the real WebView native module, and the map is the only
 * consumer, so tests get a plain view that still forwards the ref methods.
 */
export const WebView = forwardRef(function MockWebView(
  { testID, onMessage }: MockWebViewProps,
  ref,
) {
  useImperativeHandle(ref, () => ({
    injectJavaScript: jest.fn(),
    postMessage: jest.fn(),
    reload: jest.fn(),
    stopLoading: jest.fn(),
  }));

  const props = { onMessage, testID: testID ?? 'webview' } as unknown as ViewProps;

  return <View {...props} />;
});

export default WebView;

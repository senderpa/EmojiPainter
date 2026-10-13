/**
 * FactoryFeed — embeds the live 3D-Factory camera (printer / machine / scanner
 * stations) as a WebView. Reuses the same factory URL + UI-hiding trick as the
 * Coin Workshop's factory cam, but exposes a controlled `cam` prop so callers
 * can auto-switch stations as a job advances.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { WebView } from 'react-native-webview';

import { getApi3DFactoryUrl } from '../services/aiContentService';

const HIDE_FACTORY_UI_JS = `(function(){var s=document.createElement('style');s.textContent='[class*="info"],[class*="status"],[class*="overlay"],[class*="label"],[class*="counter"],[class*="stats"],[class*="hud"],[class*="ui-"],[class*="-ui"],[class*="badge"],[class*="bubble"],[class*="toast"],[class*="progress"],[class*="stage"],[class*="queue"],[class*="fps"]{display:none!important}canvas,video,img{will-change:transform;transform:translateZ(0)}body{background:#000!important;overflow:hidden!important}';if(document.head)document.head.appendChild(s);})();true;`;

let _factoryUrlCache: string | null = null;
function getFactoryUrlCached(): Promise<string> {
  if (_factoryUrlCache) return Promise.resolve(_factoryUrlCache);
  return getApi3DFactoryUrl().then((url) => {
    _factoryUrlCache = url;
    return url;
  });
}

interface FactoryFeedProps {
  /** Camera station id: overview | printer | machine | scanner | belt | bucket */
  cam?: string;
  height?: number;
  borderRadius?: number;
}

const FactoryFeed: React.FC<FactoryFeedProps> = ({ cam = 'overview', height = 220, borderRadius = 16 }) => {
  const [factoryUrl, setFactoryUrl] = useState<string | null>(null);
  const [webLoaded, setWebLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const webRef = useRef<any>(null);
  const loadTimerRef = useRef<any>(null);

  useEffect(() => {
    getFactoryUrlCached().then(setFactoryUrl).catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    if (!factoryUrl || webLoaded || loadFailed) return;
    loadTimerRef.current = setTimeout(() => setLoadFailed(true), 30_000);
    return () => clearTimeout(loadTimerRef.current);
  }, [factoryUrl, webLoaded, loadFailed]);

  // Switch station whenever `cam` changes (and the page is loaded).
  useEffect(() => {
    if (!webLoaded || !webRef.current) return;
    webRef.current.injectJavaScript(
      `(function(){var id=${JSON.stringify(cam)};if(typeof window.setCamera==='function')window.setCamera(id);else if(typeof window.switchCamera==='function')window.switchCamera(id);else window.postMessage(JSON.stringify({type:'camera',id:id}),'*');})();true;`
    );
  }, [cam, webLoaded]);

  const handleError = () => {
    clearTimeout(loadTimerRef.current);
    if (factoryUrl?.includes('192.168.')) {
      _factoryUrlCache = null;
      setWebLoaded(false);
      getFactoryUrlCached().then(setFactoryUrl).catch(() => setLoadFailed(true));
    } else {
      setLoadFailed(true);
    }
  };

  const handleLoadEnd = () => {
    clearTimeout(loadTimerRef.current);
    webRef.current?.injectJavaScript(HIDE_FACTORY_UI_JS);
    setTimeout(() => setWebLoaded(true), 400);
  };

  if (loadFailed) {
    return (
      <View style={[styles.fallback, { height, borderRadius }]}>
        <Text style={{ fontSize: 26 }}>📡</Text>
        <Text style={styles.fallbackText}>Factory cam offline{'\n'}(still building your head…)</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height, borderRadius }]}>
      {factoryUrl ? (
        <WebView
          ref={webRef}
          source={{ uri: factoryUrl }}
          style={{ flex: 1, backgroundColor: '#000' }}
          scrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onError={handleError}
          onHttpError={(e) => { if ((e.nativeEvent?.statusCode ?? 0) >= 500) handleError(); }}
          onLoadEnd={handleLoadEnd}
          onContentProcessDidTerminate={() => webRef.current?.reload()}
        />
      ) : null}
      {!webLoaded && (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator color="#ce93d8" size="small" />
          <Text style={styles.loaderText}>Connecting to the factory…</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(206,147,216,0.25)',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0f',
    gap: 8,
  },
  loaderText: { color: '#666', fontSize: 11 },
  fallback: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0a0a0f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  fallbackText: { color: '#555', fontSize: 11, textAlign: 'center' },
});

export default FactoryFeed;

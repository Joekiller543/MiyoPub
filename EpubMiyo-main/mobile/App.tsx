import React, { useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, ActivityIndicator, Text, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

// ── Configuration ─────────────────────────────────────────────────────────────
// Set EXPO_PUBLIC_APP_URL in your .env file (or Expo EAS secrets) to the URL
// where your Nexus EPUB Reader server is deployed.
//
//   For development:  EXPO_PUBLIC_APP_URL=https://<your-replit-dev-domain>.repl.co
//   For production:   EXPO_PUBLIC_APP_URL=https://your-deployed-domain.com
//
// The variable is substituted at build time by Expo's config system.
const APP_URL: string | undefined = process.env.EXPO_PUBLIC_APP_URL;

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!APP_URL) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Text style={styles.errorTitle}>App URL not configured</Text>
        <Text style={styles.errorBody}>
          Set EXPO_PUBLIC_APP_URL in your .env file to the URL where{'\n'}
          your Nexus EPUB Reader server is hosted, then rebuild.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />

      {loading && !error && (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Could not connect</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Text style={styles.errorHint}>URL: {APP_URL}</Text>
        </View>
      )}

      <WebView
        source={{ uri: APP_URL }}
        style={[styles.webview, error ? styles.hidden : null]}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onLoadEnd={() => setLoading(false)}
        onError={(e) => {
          setLoading(false);
          setError(e.nativeEvent.description || 'Failed to load the app.');
        }}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        // Prevent text-size adjustment and double-tap zoom on iOS
        injectedJavaScript={`
          const meta = document.querySelector('meta[name="viewport"]');
          if (meta) {
            meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0');
          }
          true;
        `}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  hidden: {
    display: 'none',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    zIndex: 10,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#ffffff',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#171717',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 14,
    color: '#525252',
    textAlign: 'center',
    lineHeight: 22,
  },
  errorHint: {
    fontSize: 12,
    color: '#a3a3a3',
    marginTop: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

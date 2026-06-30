import { Stack } from 'expo-router';

/**
 * Root layout. Configures the navigation stack:
 *   - index            → branded landing (enter a meeting code)
 *   - v/[token]        → the meeting screen (WebView to the visitor experience)
 *
 * NOT: Expo Go ile çalışacak şekilde tasarlandı. Toplantının gerçek WebRTC
 * (ses + avatar) kısmı bir WebView içinde, telefonun tarayıcı motorunda çalışıyor.
 */
export default function RootLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#0b0b12' }
            }}
        />
    );
}

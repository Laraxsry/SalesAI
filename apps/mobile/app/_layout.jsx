import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getNotificationRoute } from '../src/notificationRoute';

// Intercept global fetch to bypass localtunnel reminder pages automatically
if (typeof global.fetch === 'function') {
    const _fetch = global.fetch;
    global.fetch = function (url, options = {}) {
        const headers = {
            'Bypass-Tunnel-Reminder': 'true',
            ...(options.headers || {}),
        };
        return _fetch(url, { ...options, headers });
    };
}

// The native LiveKit package calls native component APIs at module load time,
// so it must never be evaluated by the React Native Web runtime.
if (Platform.OS !== 'web') {
    require('@livekit/react-native').registerGlobals();
}

// Ignore some WebRTC/LiveKit-related warnings that don't affect runtime
LogBox.ignoreLogs([
    'Non-serializable values were found in the navigation state',
    'Setting a timer for a long period of time',
]);

export default function RootLayout() {
    const router = useRouter();

    useEffect(() => {
        if (Platform.OS === 'web') return undefined;

        const openNotification = (response) => {
            const route = getNotificationRoute(response?.notification?.request?.content?.data);
            if (route) router.push(route);
        };

        Notifications.getLastNotificationResponseAsync().then(openNotification).catch(() => {});
        const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
        return () => subscription.remove();
    }, [router]);

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#0b0b12' },
            }}
        />
    );
}

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFS_KEY = 'salesai:notification-prefs';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false
    })
});

/**
 * Phase 3 (mock): the backend has no `POST /devices` endpoint yet, so we
 * request the OS permission and mint a real Expo push token, but only log/
 * store it locally instead of registering it server-side. Swap `registerDeviceMock`
 * for a real `POST /api/v1/devices` call once that endpoint exists.
 */
export async function requestPushPermission() {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
    }

    if (status !== 'granted') {
        await setNotificationPref(false);
        return { granted: false };
    }

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'SalesAI',
            importance: Notifications.AndroidImportance.DEFAULT
        });
    }

    let token = null;
    try {
        token = (await Notifications.getExpoPushTokenAsync()).data;
    } catch (err) {
        console.warn('Could not obtain Expo push token (needs a real device + EAS project id):', err?.message);
    }

    await registerDeviceMock(token);
    await setNotificationPref(true);
    return { granted: true, token };
}

/** Stands in for `POST /api/v1/devices` — logs instead of hitting a real backend. */
async function registerDeviceMock(expoPushToken) {
    console.log('[push:mock] would register device token with backend:', expoPushToken);
    await AsyncStorage.setItem(`${PREFS_KEY}:token`, expoPushToken || '');
}

export async function setNotificationPref(enabled) {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ enabled }));
}

export async function getNotificationPref() {
    try {
        const raw = await AsyncStorage.getItem(PREFS_KEY);
        return raw ? JSON.parse(raw).enabled : false;
    } catch {
        return false;
    }
}

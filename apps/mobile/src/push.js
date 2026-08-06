import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushToken } from './visitorIdentity';

const PREFS_KEY = 'salesai:notification-prefs';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false
    })
});

/** Requests OS push permission, mints an Expo push token, and registers it via POST /api/v1/devices. */
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

    if (token) {
        await registerPushToken(token, Platform.OS);
    }
    await setNotificationPref(true);
    return { granted: true, token };
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

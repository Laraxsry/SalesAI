import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
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
    if (Platform.OS === 'web') return { granted: false, reason: 'unsupported-platform' };

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

    const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
        await setNotificationPref(false);
        return { granted: false, reason: 'project-not-configured' };
    }

    let token = null;
    try {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (err) {
        console.warn('Could not obtain Expo push token (needs a real device + EAS project id):', err?.message);
    }

    const registration = token ? await registerPushToken(token, Platform.OS) : null;
    const enabled = Boolean(token && registration);
    await setNotificationPref(enabled);
    return { granted: enabled, token, reason: enabled ? null : 'registration-failed' };
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

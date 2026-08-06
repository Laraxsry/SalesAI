import { Platform } from 'react-native';

/* global __DEV__ */

// In development:
// - iOS Simulator can use localhost (127.0.0.1)
// - Android Emulator must use 10.0.2.2 to access the host's localhost
// - Physical devices need the computer's actual local IP address (e.g. 192.168.1.X)
//
// EXPO_PUBLIC_* env vars (Expo inlines these into the bundle automatically —
// see https://docs.expo.dev/guides/environment-variables/) always win, so a
// physical device or a non-default backend URL never requires editing this
// file: `EXPO_PUBLIC_API_URL=http://192.168.1.42:5001 npx expo start`.
const LOCAL_IP = '127.0.0.1';

const getApiUrl = () => {
    if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
    if (__DEV__) {
        if (Platform.OS === 'android') {
            return 'http://10.0.2.2:5001';
        }
        return `http://${LOCAL_IP}:5001`;
    }
    throw new Error('EXPO_PUBLIC_API_URL must be configured for production builds.');
};

const getLiveKitUrl = () => {
    if (process.env.EXPO_PUBLIC_LIVEKIT_URL) return process.env.EXPO_PUBLIC_LIVEKIT_URL;
    if (__DEV__) {
        if (Platform.OS === 'android') {
            return 'ws://10.0.2.2:7880';
        }
        return `ws://${LOCAL_IP}:7880`;
    }
    throw new Error('EXPO_PUBLIC_LIVEKIT_URL must be configured for production builds.');
};

export const CONFIG = {
    API_URL: getApiUrl(),
    LIVEKIT_URL: getLiveKitUrl(),
};

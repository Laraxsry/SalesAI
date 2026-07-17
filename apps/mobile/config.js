import { Platform } from 'react-native';

// In development:
// - iOS Simulator can use localhost (127.0.0.1)
// - Android Emulator must use 10.0.2.2 to access the host's localhost
// - Physical devices need the computer's actual local IP address (e.g. 192.168.1.X)
// Replace the IP below with your computer's local IP address if testing on a physical device.
const LOCAL_IP = '192.168.1.49';

const getApiUrl = () => {
    if (__DEV__) {
        if (Platform.OS === 'android') {
            return 'http://10.0.2.2:5001';
        }
        return `http://${LOCAL_IP}:5001`;
    }
    // Production API URL
    return 'https://api.salesai.example.com';
};

const getLiveKitUrl = () => {
    if (__DEV__) {
        if (Platform.OS === 'android') {
            return 'ws://10.0.2.2:7880';
        }
        return `ws://${LOCAL_IP}:7880`;
    }
    // Production LiveKit URL
    return 'wss://livekit.salesai.example.com';
};

export const CONFIG = {
    API_URL: getApiUrl(),
    LIVEKIT_URL: getLiveKitUrl(),
};

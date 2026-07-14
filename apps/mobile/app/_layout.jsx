import { registerGlobals } from '@livekit/react-native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { LogBox } from 'react-native';

// Polyfill WebRTC and standard browser elements needed by LiveKit
registerGlobals();

// Ignore some WebRTC/LiveKit-related warnings that don't affect runtime
LogBox.ignoreLogs([
    'Non-serializable values were found in the navigation state',
    'Setting a timer for a long period of time',
]);

export default function RootLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#0b0b12' },
            }}
        />
    );
}

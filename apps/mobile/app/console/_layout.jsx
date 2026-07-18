import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { CONFIG } from '../../config';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const STORAGE_KEY = 'salesai-console-auth';

export default function ConsoleLayout() {
    const [token, setToken] = useState(null);
    const [refreshToken, setRefreshToken] = useState(null);
    const [user, setUser] = useState(null);
    const [restoring, setRestoring] = useState(true);

    const persist = useCallback(async (authToken, refresh, userProfile) => {
        try {
            await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ token: authToken, refreshToken: refresh, user: userProfile }));
        } catch (err) {
            console.warn('Failed to persist session:', err);
        }
    }, []);

    const login = useCallback((authToken, userProfile, refresh = null) => {
        setToken(authToken);
        setUser(userProfile);
        setRefreshToken(refresh);
        persist(authToken, refresh, userProfile);
    }, [persist]);

    const logout = useCallback(() => {
        setToken(null);
        setUser(null);
        setRefreshToken(null);
        SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
    }, []);

    // Restore the session on cold start. Access tokens only live 15min, so
    // rather than trusting whatever was stored, immediately trade the saved
    // refresh token for a fresh pair — same account, same workspace, no
    // re-login required.
    useEffect(() => {
        (async () => {
            try {
                const raw = await SecureStore.getItemAsync(STORAGE_KEY);
                if (!raw) return;

                const saved = JSON.parse(raw);
                if (!saved?.refreshToken) return;

                const res = await fetch(`${CONFIG.API_URL}/api/v1/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: saved.refreshToken }),
                });
                if (!res.ok) throw new Error('Session refresh failed');

                const tokens = await res.json();
                setToken(tokens.accessToken);
                setRefreshToken(tokens.refreshToken);
                setUser(saved.user);
                await persist(tokens.accessToken, tokens.refreshToken, saved.user);
            } catch (err) {
                console.warn('Could not restore session:', err.message);
                await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
            } finally {
                setRestoring(false);
            }
        })();
    }, [persist]);

    if (restoring) {
        return (
            <View style={styles.splash}>
                <ActivityIndicator size="large" color="#6d5efc" />
            </View>
        );
    }

    return (
        <AuthContext.Provider value={{ token, refreshToken, user, login, logout }}>
            <Stack
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: '#0b0b12' },
                }}
            />
        </AuthContext.Provider>
    );
}

const styles = StyleSheet.create({
    splash: {
        flex: 1,
        backgroundColor: '#0b0b12',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

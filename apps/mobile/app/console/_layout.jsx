import { createContext, useState, useContext } from 'react';
import { Stack } from 'expo-router';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export default function ConsoleLayout() {
    const [token, setToken] = useState(null);
    const [user, setUser] = useState(null);

    const login = (authToken, userProfile) => {
        setToken(authToken);
        setUser(userProfile);
    };

    const logout = () => {
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ token, user, login, logout }}>
            <Stack
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: '#0b0b12' },
                }}
            />
        </AuthContext.Provider>
    );
}

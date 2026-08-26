import { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DARK_COLORS, LIGHT_COLORS } from './theme';

const STORAGE_KEY = 'salesai-theme';
const ThemeContext = createContext(null);

export function AppThemeProvider({ children }) {
    const systemScheme = useColorScheme();
    const [preference, setPreference] = useState(null);

    useEffect(() => {
        AsyncStorage.getItem(STORAGE_KEY)
            .then((saved) => {
                if (saved === 'light' || saved === 'dark') setPreference(saved);
            })
            .catch(() => {});
    }, []);

    const theme = preference || (systemScheme === 'dark' ? 'dark' : 'light');
    const isDark = theme === 'dark';

    const setTheme = (nextTheme) => {
        setPreference(nextTheme);
        AsyncStorage.setItem(STORAGE_KEY, nextTheme).catch(() => {});
    };

    const value = {
        theme,
        isDark,
        colors: isDark ? DARK_COLORS : LIGHT_COLORS,
        setTheme,
        toggleTheme: () => setTheme(isDark ? 'light' : 'dark'),
    };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useAppTheme must be used inside AppThemeProvider');
    return context;
}

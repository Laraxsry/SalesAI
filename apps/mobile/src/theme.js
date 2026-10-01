import { Platform } from 'react-native';

const BASE_LIGHT_COLORS = {
    ink: '#050705',
    inkSoft: '#0E140F',
    inkRaised: '#17221A',
    canvas: '#F6F9F7',
    surface: '#FFFFFF',
    surfaceMuted: '#EDF3EF',
    line: '#D5E2D9',
    text: '#050705',
    muted: '#526357',
    soft: '#7E9184',
    teal: '#047857',
    tealDark: '#064E3B',
    lime: '#10B981',
    amber: '#D97706',
    danger: '#DC2626',
    white: '#FFFFFF',
};

const BASE_DARK_COLORS = {
    ink: '#050705',
    inkSoft: '#0C120E',
    inkRaised: '#141E17',
    canvas: '#050705',
    surface: '#0B110D',
    surfaceMuted: '#121C15',
    line: '#1B2B20',
    text: '#FFFFFF',
    muted: '#94A89A',
    soft: '#627768',
    teal: '#047857',
    tealDark: '#064E3B',
    lime: '#FFFFFF',
    amber: '#F59E0B',
    danger: '#F43F5E',
    white: '#FFFFFF',
};

export const LIGHT_COLORS = BASE_LIGHT_COLORS;
export const DARK_COLORS = BASE_DARK_COLORS;

// Dark-only live meeting components keep using the established static palette.
export const COLORS = DARK_COLORS;

export const FONT = {
    regular: Platform.select({ ios: 'Avenir Next', android: 'sans-serif', default: 'sans-serif' }),
    medium: Platform.select({ ios: 'Avenir Next Medium', android: 'sans-serif-medium', default: 'sans-serif' }),
    bold: Platform.select({ ios: 'Avenir Next Demi Bold', android: 'sans-serif-medium', default: 'sans-serif' }),
};

export const SHADOWS = {
    card: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.35,
        shadowRadius: 30,
        elevation: 7,
    },
    button: {
        shadowColor: '#047857',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.42,
        shadowRadius: 18,
        elevation: 6,
    },
};

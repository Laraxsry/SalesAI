import { Platform } from 'react-native';

const BASE_LIGHT_COLORS = {
    ink: '#071426',
    inkSoft: '#0F2547',
    inkRaised: '#193B69',
    canvas: '#EEF2FB',
    surface: '#FFFFFF',
    surfaceMuted: '#E6EDFA',
    line: '#D3DEF1',
    text: '#0C1A33',
    muted: '#5A6B88',
    soft: '#8A99B5',
    teal: '#2563EB',
    tealDark: '#1D4ED8',
    lime: '#38BDF8',
    amber: '#F3B64A',
    danger: '#E7584A',
    white: '#FFFFFF',
};

const BASE_DARK_COLORS = {
    ink: '#071426',
    inkSoft: '#0F2547',
    inkRaised: '#193B69',
    canvas: '#050C18',
    surface: '#0B1830',
    surfaceMuted: '#10284B',
    line: '#25466F',
    text: '#F3F6FF',
    muted: '#94A8C5',
    soft: '#60789B',
    teal: '#67E8F9',
    tealDark: '#4D7CFF',
    lime: '#67E8F9',
    amber: '#FFD166',
    danger: '#FF7568',
    white: '#FFFFFF',
};

export const LIGHT_COLORS = BASE_LIGHT_COLORS;
export const DARK_COLORS = BASE_DARK_COLORS;

// Dark-only live meeting components keep using the established static palette.
export const COLORS = LIGHT_COLORS;

export const FONT = {
    regular: Platform.select({ ios: 'Avenir Next', android: 'sans-serif', default: 'sans-serif' }),
    medium: Platform.select({ ios: 'Avenir Next Medium', android: 'sans-serif-medium', default: 'sans-serif' }),
    bold: Platform.select({ ios: 'Avenir Next Demi Bold', android: 'sans-serif-medium', default: 'sans-serif' }),
};

export const SHADOWS = {
    card: {
        shadowColor: COLORS.ink,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.12,
        shadowRadius: 30,
        elevation: 8,
    },
    button: {
        shadowColor: COLORS.ink,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
        elevation: 5,
    },
};

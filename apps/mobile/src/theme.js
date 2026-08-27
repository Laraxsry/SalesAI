import { Platform } from 'react-native';

export const LIGHT_COLORS = {
    ink: '#071713',
    inkSoft: '#0D2923',
    inkRaised: '#15372F',
    canvas: '#F3F6F2',
    surface: '#FFFFFF',
    surfaceMuted: '#EAF0EB',
    line: '#D9E3DC',
    text: '#13231F',
    muted: '#6B7973',
    soft: '#97A39D',
    teal: '#14B8A6',
    tealDark: '#0F766E',
    lime: '#D7F95B',
    amber: '#F3B64A',
    danger: '#E7584A',
    white: '#FFFFFF',
};

export const DARK_COLORS = {
    ink: '#071713',
    inkSoft: '#0D2923',
    inkRaised: '#15372F',
    canvas: '#07110F',
    surface: '#0D1F1B',
    surfaceMuted: '#163029',
    line: '#25443B',
    text: '#EDF5F1',
    muted: '#91A59D',
    soft: '#657A72',
    teal: '#2DD4BF',
    tealDark: '#14B8A6',
    lime: '#D7F95B',
    amber: '#F3B64A',
    danger: '#FF7568',
    white: '#FFFFFF',
};

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

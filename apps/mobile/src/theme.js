import { Platform } from 'react-native';

export const COLORS = {
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

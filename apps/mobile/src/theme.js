import { Platform } from 'react-native';

// One identity across web and mobile: the landing page's indigo night with a
// violet → pink aurora accent (see apps/console/src/index.css for the web
// tokens these mirror).
const BASE_LIGHT_COLORS = {
    ink: '#0B0726',
    inkSoft: '#0F0A2E',
    inkRaised: '#140D38',
    canvas: '#F4F1FD',
    surface: '#FFFFFF',
    surfaceMuted: '#EFEAFC',
    line: '#DDD6F6',
    text: '#1E1B4B',
    muted: '#6B6790',
    soft: '#8B86AD',
    primary: '#7C3AED',
    primaryDark: '#6D28D9',
    // Light violet that reads on the indigo night surfaces and carries dark ink.
    accent: '#C4B5FD',
    pink: '#F472B6',
    // Status inks for light surfaces: dark enough for the 10px status labels
    // (success 4.76:1 on its #ECFDF5 tint, amber 5.02:1 on white).
    success: '#15803D',
    amber: '#B45309',
    danger: '#DC2626',
    white: '#FFFFFF',
};

const BASE_DARK_COLORS = {
    ink: '#0B0726',
    inkSoft: '#0F0A2E',
    inkRaised: '#140D38',
    canvas: '#0B0726',
    surface: '#140D38',
    surfaceMuted: '#1D1458',
    line: '#2F2668',
    text: '#F5F3FF',
    muted: '#A8A3C7',
    soft: '#7C76A6',
    // The same call-to-action violet as the light theme and the web: a white
    // label reads 5.7:1 on it. On the night surfaces it is a fill only (3.2:1
    // against them), so text, icons and carets use `accent` instead.
    primary: '#7C3AED',
    primaryDark: '#6D28D9',
    accent: '#C4B5FD',
    pink: '#F472B6',
    success: '#34D399',
    amber: '#F59E0B',
    danger: '#F43F5E',
    white: '#FFFFFF',
};

export const LIGHT_COLORS = BASE_LIGHT_COLORS;
export const DARK_COLORS = BASE_DARK_COLORS;

// Dark-only live meeting components keep using the established static palette.
export const COLORS = DARK_COLORS;

/**
 * Brand caret and selection colours for a <TextInput>, spread onto it as props.
 * iOS derives its own translucent selection highlight from the tint. Android
 * paints `selectionColor` exactly as given behind the selected text, so there
 * the highlight carries an alpha (the text keeps at least 5.9:1 on it) and the
 * caret and the selection handles take the solid tint.
 */
export function inputTint(colors, isDark) {
    const tint = isDark ? colors.accent : colors.primary;
    if (Platform.OS !== 'android') return { selectionColor: tint };
    return {
        selectionColor: isDark ? 'rgba(196, 181, 253, 0.4)' : 'rgba(124, 58, 237, 0.4)',
        cursorColor: tint,
        selectionHandleColor: tint,
    };
}

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
        shadowColor: '#7C3AED',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.42,
        shadowRadius: 18,
        elevation: 6,
    },
};

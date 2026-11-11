/**
 * Shared Tailwind v4 design tokens for SalesAI web apps.
 * Tailwind v4 is configured via CSS (@theme); this file exports tokens that
 * apps can import for JS-side usage (charts, canvas avatar, etc).
 *
 * The palette mirrors the landing page: indigo night surfaces with a
 * violet → pink aurora accent.
 */
export const tokens = {
    colors: {
        brand: '#7c3aed',
        brandLight: '#8b5cf6',
        brandDark: '#6d28d9',
        accent: '#c4b5fd',
        pink: '#f472b6',
        bg: '#0b0726',
        surface: '#140d38',
        surfaceRaised: '#1d1458',
        ink: '#1e1b4b',
        text: '#f5f3ff'
    },
    gradients: {
        primary: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #6d28d9 100%)',
        brand: 'linear-gradient(90deg, #a78bfa 0%, #f472b6 100%)'
    },
    radius: '12px'
};

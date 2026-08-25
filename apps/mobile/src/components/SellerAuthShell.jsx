import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SHADOWS } from '../theme';

export function SellerAuthShell({ eyebrow, title, subtitle, children, footer }) {
    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}>
            <StatusBar style="light" />
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={styles.hero}>
                    <View style={styles.glow} />
                    <View style={styles.brandRow}>
                        <Text style={styles.brand}>Sales<Text style={styles.brandAccent}>AI</Text></Text>
                        <View style={styles.consolePill}><Text style={styles.consolePillText}>YÖNETİM</Text></View>
                    </View>
                    <Text style={styles.eyebrow}>{eyebrow}</Text>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>

                <View style={styles.sheet}>
                    {children}
                    {footer}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

export function SellerAuthField({ icon, error, ...props }) {
    return (
        <View style={[styles.field, error && styles.fieldError]}>
            <Ionicons name={icon} size={18} color={COLORS.muted} />
            <TextInput
                style={styles.fieldInput}
                placeholderTextColor={COLORS.soft}
                selectionColor={COLORS.tealDark}
                {...props}
            />
        </View>
    );
}

export function SellerAuthButton({ loading, children, ...props }) {
    return (
        <TouchableOpacity style={styles.button} activeOpacity={0.88} disabled={loading} {...props}>
            {loading ? (
                <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
                <>
                    <Text style={styles.buttonText}>{children}</Text>
                    <View style={styles.buttonIcon}><Ionicons name="arrow-forward" size={17} color={COLORS.ink} /></View>
                </>
            )}
        </TouchableOpacity>
    );
}

export const sellerAuthStyles = StyleSheet.create({
    formLabel: { marginTop: 18, marginBottom: 8, color: COLORS.muted, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1.35 },
    error: { marginTop: 12, color: COLORS.danger, fontFamily: FONT.medium, fontSize: 12.5, lineHeight: 18 },
    footerLink: { marginTop: 22, alignItems: 'center', paddingVertical: 6 },
    footerText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 12.5 },
    footerStrong: { color: COLORS.tealDark, fontFamily: FONT.bold },
    visitorLink: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
    visitorLinkText: { color: COLORS.soft, fontFamily: FONT.medium, fontSize: 11.5 },
});

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: COLORS.canvas },
    scroll: { flexGrow: 1, backgroundColor: COLORS.canvas },
    hero: {
        minHeight: 330,
        overflow: 'hidden',
        backgroundColor: COLORS.ink,
        paddingTop: Platform.OS === 'ios' ? 64 : 38,
        paddingHorizontal: 22,
        paddingBottom: 68,
    },
    glow: {
        position: 'absolute',
        width: 280,
        height: 280,
        borderRadius: 140,
        backgroundColor: 'rgba(20,184,166,0.11)',
        right: -130,
        top: -86,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center' },
    brand: { color: COLORS.white, fontFamily: FONT.bold, fontSize: 19, letterSpacing: -0.5 },
    brandAccent: { color: COLORS.lime },
    consolePill: { marginLeft: 'auto', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 9, paddingVertical: 6 },
    consolePillText: { color: 'rgba(255,255,255,0.48)', fontFamily: FONT.bold, fontSize: 8.5, letterSpacing: 1.2 },
    eyebrow: { marginTop: 50, color: COLORS.lime, fontFamily: FONT.bold, fontSize: 9.5, letterSpacing: 1.6 },
    title: { marginTop: 10, color: COLORS.white, fontFamily: FONT.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 },
    subtitle: { marginTop: 11, maxWidth: 325, color: 'rgba(255,255,255,0.55)', fontFamily: FONT.regular, fontSize: 14, lineHeight: 21 },
    sheet: {
        flex: 1,
        marginTop: -32,
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        backgroundColor: COLORS.surface,
        paddingHorizontal: 22,
        paddingTop: 29,
        paddingBottom: 34,
        ...SHADOWS.card,
    },
    field: {
        minHeight: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: COLORS.line,
        backgroundColor: '#F7F9F7',
        paddingHorizontal: 15,
    },
    fieldError: { borderColor: COLORS.danger, backgroundColor: '#FFF8F7' },
    fieldInput: { flex: 1, color: COLORS.text, fontFamily: FONT.medium, fontSize: 15, paddingVertical: 14 },
    button: {
        minHeight: 55,
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
        backgroundColor: COLORS.ink,
        paddingHorizontal: 8,
        ...SHADOWS.button,
    },
    buttonText: { color: COLORS.white, fontFamily: FONT.bold, fontSize: 15 },
    buttonIcon: { position: 'absolute', right: 8, width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: COLORS.lime },
});

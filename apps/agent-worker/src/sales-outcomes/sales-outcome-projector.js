function cleanContact(contact = {}) {
    return Object.fromEntries(['name', 'email', 'phone', 'company']
        .filter((field) => typeof contact?.[field] === 'string' && contact[field].trim())
        .map((field) => [field, contact[field].trim()]));
}

/** Backward-compatible read projection; new writes still use participant-aware services. */
export function projectSessionContacts({ session = {}, lead = null, leadContacts = [] } = {}) {
    if (leadContacts.length > 0) {
        return leadContacts.map((record) => ({
            participantId: String(record.participantId),
            contact: cleanContact(record.contact),
            source: 'participant_contact'
        }));
    }

    const legacy = cleanContact({
        ...(lead?.contact ?? {}),
        ...(session.confirmedContact ?? {})
    });
    if (Object.keys(legacy).length === 0) return [];
    const primary = session.participants?.[0];
    return [{
        participantId: primary?.participantId ?? 'legacy-primary',
        contact: legacy,
        source: 'legacy_adapter'
    }];
}

/** Private survey delivery must resolve to one connected trusted identity. */
export function resolveTargetedSurveyDelivery({ registry, targetParticipantId }) {
    if (!targetParticipantId) return { allowed: false, reason: 'target_required' };
    const participant = registry?.getByParticipantId?.(targetParticipantId);
    if (!participant) return { allowed: false, reason: 'participant_unknown' };
    if (!participant.connected || !participant.livekitIdentity) {
        return { allowed: false, reason: 'participant_not_connected' };
    }
    return {
        allowed: true,
        targetParticipantId: participant.participantId,
        destinationIdentities: [participant.livekitIdentity]
    };
}

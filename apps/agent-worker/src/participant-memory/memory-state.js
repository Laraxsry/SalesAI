import { ParticipantScopedMemoryInput } from '@repo/contracts';

export function createParticipantScopedMemory(initial = {}) {
    return ParticipantScopedMemoryInput.parse(initial);
}

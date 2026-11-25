import { User, Users } from 'lucide-react';
import { MAX_ROOM_PARTICIPANTS } from '@repo/contracts';

/** Size a meeting starts at when the owner switches from one-on-one. */
const DEFAULT_MEETING_SIZE = 4;

/**
 * "Birebir görüşme" or "Toplantı" (with a visitor count). The value is the
 * agent's maxParticipants: 1 means one-on-one, 2+ is a group meeting (the
 * agent itself is not counted).
 */
export function ParticipantPicker({ value, onChange, disabled = false }) {
    const count = Math.max(1, Number(value) || 1);
    const meeting = count > 1;

    const option = (active) =>
        `flex flex-1 items-center gap-2 rounded-[var(--radius-input)] border px-3 py-2 text-left text-xs transition-colors disabled:opacity-60 ${
            active ? 'border-brand bg-brand/10 text-text' : 'border-border bg-bg text-text-muted hover:border-brand/50'
        }`;

    return (
        <div>
            <div className="flex gap-2">
                <button type="button" disabled={disabled} aria-pressed={!meeting} onClick={() => onChange(1)} className={option(!meeting)}>
                    <User size={15} className={!meeting ? 'text-brand' : ''} />
                    <span className="font-semibold">Birebir görüşme</span>
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={meeting}
                    onClick={() => !meeting && onChange(DEFAULT_MEETING_SIZE)}
                    className={option(meeting)}
                >
                    <Users size={15} className={meeting ? 'text-brand' : ''} />
                    <span className="font-semibold">Toplantı</span>
                </button>
            </div>
            {meeting && (
                <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                    <input
                        type="number"
                        min={2}
                        max={MAX_ROOM_PARTICIPANTS}
                        value={count}
                        disabled={disabled}
                        onChange={(e) => onChange(Math.min(MAX_ROOM_PARTICIPANTS, Math.max(2, Number(e.target.value) || 2)))}
                        className="h-8 w-16 rounded-[var(--radius-input)] border border-border bg-bg px-2 text-right text-sm text-text outline-none focus:border-brand"
                    />
                    kişi katılabilir (en fazla {MAX_ROOM_PARTICIPANTS}, agent hariç)
                </label>
            )}
        </div>
    );
}

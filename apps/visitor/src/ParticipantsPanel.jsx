import { useState } from 'react';
import {
    useParticipants,
    useSpeakingParticipants,
    useTracks,
    useVoiceAssistant
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Mic, MicOff, Users, ChevronRight, Bot, Hand } from 'lucide-react';
import { buildParticipantRows, shouldShowPanel } from './participant-rows.js';
import { useMeetingState } from './useMeetingState.js';

/**
 * A Teams-style collapsible "People" pane, pinned to the right edge. Collapsed
 * by default (a slim rail with a count badge) so it never steals space or
 * bothers the visitor; expands into a 264px drawer that slides in.
 *
 * Shown when the session is group-capable (`maxParticipants > 1`) or 2+ humans
 * are present — a plain 1-on-1 call is unchanged.
 * Renders inside <LiveKitRoom>, so all the LiveKit hooks have room context.
 */
export function ParticipantsPanel({ maxParticipants }) {
    const [open, setOpen] = useState(false);
    const participants = useParticipants();
    const speaking = useSpeakingParticipants();
    // onlySubscribed:false so a remote mic that isn't audibly subscribed still
    // reports its mute state; re-renders on TrackMuted/TrackUnmuted.
    const micTracks = useTracks([Track.Source.Microphone], { onlySubscribed: false });
    const { state: agentState } = useVoiceAssistant();

    const speakingIdentities = new Set(speaking.map((p) => p.identity));
    const micByIdentity = new Map(
        micTracks.map((t) => [t.participant.identity, !(t.publication?.isMuted ?? true)])
    );

    const { agent, humans, humanCount } = buildParticipantRows({
        participants,
        speakingIdentities,
        micByIdentity,
        agentState
    });

    const meeting = useMeetingState();
    const floorIdentity = meeting?.floor?.identity || null;
    // identity -> 1-based place in the raised-hand queue
    const handPlace = new Map((meeting?.hands || []).map((h, i) => [h.identity, i + 1]));

    if (!shouldShowPanel({ humanCount, maxParticipants })) return null;

    const initial = (name) => (name || '?').trim().charAt(0).toLocaleUpperCase('tr') || '?';

    return (
        <>
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label={`Katılımcılar (${humanCount})`}
                    className="absolute right-0 top-24 z-30 flex items-center gap-2 rounded-l-2xl border border-r-0 border-white/10 bg-[#071713]/90 py-3 pl-3 pr-2.5 text-white/70 backdrop-blur-xl transition-colors hover:text-white"
                >
                    <Users size={16} />
                    <span className="min-w-[20px] rounded-full bg-[#d7f95b] px-1.5 text-center text-[11px] font-bold text-[#071713]">
                        {humanCount}
                    </span>
                </button>
            )}

            <aside
                className={`absolute right-0 top-0 bottom-0 z-30 flex w-[264px] max-w-[82vw] flex-col border-l border-white/8 bg-[#071713]/95 backdrop-blur-xl transition-transform duration-300 ${
                    open ? 'translate-x-0' : 'translate-x-full'
                }`}
                aria-hidden={!open}
            >
                <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/8 px-4">
                    <span className="text-sm font-semibold text-white">
                        Katılımcılar
                        <span className="ml-1.5 text-white/40">{humanCount}</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Katılımcı panelini kapat"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>

                <ul className="flex-1 overflow-y-auto px-2 py-3">
                    <li className="mb-1 flex items-center gap-3 rounded-xl px-2 py-2">
                        <span
                            className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#15372f] to-[#0b211c] text-[#d7f95b] ${
                                agent.speaking ? 'ring-2 ring-[#d7f95b]' : 'ring-1 ring-white/10'
                            }`}
                        >
                            <Bot size={16} />
                        </span>
                        <span className="flex-1 truncate text-sm text-white">{agent.name}</span>
                        {agent.speaking && (
                            <span className="text-[11px] font-medium text-[#d7f95b]">konuşuyor</span>
                        )}
                    </li>

                    {humans.map((h) => {
                        const hasFloor = h.identity === floorIdentity;
                        const place = handPlace.get(h.identity);
                        return (
                            <li
                                key={h.identity}
                                className={`flex items-center gap-3 rounded-xl px-2 py-2 ${
                                    hasFloor ? 'bg-[#d7f95b]/10' : 'hover:bg-white/[0.04]'
                                }`}
                            >
                                <span
                                    className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-sm font-semibold text-white/80 ${
                                        h.speaking || hasFloor ? 'ring-2 ring-[#d7f95b]' : 'ring-1 ring-white/10'
                                    }`}
                                >
                                    {initial(h.name)}
                                </span>
                                <span className="flex-1 truncate text-sm text-white/90">
                                    {h.name}
                                    {h.isLocal && <span className="ml-1 text-white/40">(siz)</span>}
                                    {hasFloor && (
                                        <span className="ml-1.5 text-[11px] font-medium text-[#d7f95b]">· söz onda</span>
                                    )}
                                </span>
                                {place && (
                                    <span
                                        className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[#d7f95b]"
                                        title={`El kaldırdı — sıra ${place}`}
                                    >
                                        <Hand size={13} />
                                        {place}
                                    </span>
                                )}
                                {h.micOn ? (
                                    <Mic size={15} className="shrink-0 text-white/50" aria-label="Mikrofon açık" />
                                ) : (
                                    <MicOff
                                        size={15}
                                        className="shrink-0 text-red-300/80"
                                        aria-label="Mikrofon kapalı"
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
            </aside>
        </>
    );
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
    persist(
        (set) => ({
            user: null,
            workspace: null,
            accessToken: null,
            refreshToken: null,
            setSession: ({ user, workspace, accessToken, refreshToken }) =>
                set((state) => ({
                    user: user ?? state.user,
                    workspace: workspace ?? state.workspace,
                    accessToken: accessToken ?? state.accessToken,
                    refreshToken: refreshToken ?? state.refreshToken
                })),
            logout: () => set({ user: null, workspace: null, accessToken: null, refreshToken: null })
        }),
        { name: 'salesai-auth' }
    )
);

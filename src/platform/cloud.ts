import type { SaveData } from '../core/save';

/**
 * Cloud saves and sign-in (Supabase). Skeleton: everything here is a no-op until the cloud engineer lands the
 * real module. The UI only ever calls these, so it compiles and works with or without a backend configured
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time; portal builds leave them unset).
 */
export interface CloudContext {
  save: SaveData;
  /** Write the local save (after a cloud load replaced it, or after a change worth syncing). */
  persist: () => void;
  /** Replace the running save with one loaded from the cloud (menus re-read from it). */
  reload: (d: SaveData) => void;
}

/** True when a backend is configured for this build. */
export function cloudAvailable(): boolean {
  return false;
}

/** Signed-in display name (or null). */
export function cloudUser(): { name: string; provider: string } | null {
  return null;
}

/** Open the account / cloud-sync panel (sign in, sync status, sign out). */
export function openAccount(_ctx: CloudContext, _onClose: () => void): void {
  _onClose();
}

/** On boot: if signed in, pull the newer of local/cloud; afterwards push local changes (debounced). */
export async function cloudBoot(_ctx: CloudContext): Promise<void> {}

// Auth state + actions for the web app. Mirrors the iOS account model (email/password). The
// Firebase ID token returned by getIdToken() is what authenticates calls to the sync backend
// (/api/sync/*), where the Worker verifies it and maps it to the account uid.
import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { deleteAccountData } from "../sync/api";

interface AuthState {
  user: User | null;
  ready: boolean; // true once the initial auth state has resolved
  set: (p: Partial<AuthState>) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  set: (p) => set(p),
}));

let started = false;
/** Start listening for auth changes (call once at app start). */
export function initAuth(): void {
  if (started) return;
  started = true;
  onAuthStateChanged(getFirebaseAuth(), (user) => useAuth.getState().set({ user, ready: true }));
}

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(getFirebaseAuth(), email, password);
export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
export const resetPassword = (email: string) => sendPasswordResetEmail(getFirebaseAuth(), email);
export const signOutUser = () => fbSignOut(getFirebaseAuth());

/** The current user's Firebase ID token (for Authorization: Bearer …), or null if signed out. */
export async function getIdToken(): Promise<string | null> {
  const u = getFirebaseAuth().currentUser;
  return u ? u.getIdToken() : null;
}

/**
 * Delete the account: re-authenticate with the password, erase all cloud data (R2 PDFs/content +
 * D1 rows), then remove the Firebase auth user. Re-auth first refreshes the session so deleteUser
 * won't fail with `auth/requires-recent-login`, and keeps a valid token for the cloud purge.
 * Throws on failure (the purge throwing aborts deletion, so we never orphan cloud data). Local
 * data in this browser is left untouched — the app still works offline without an account.
 */
export async function deleteAccount(password: string): Promise<void> {
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) return;
  if (u.email) {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  }
  await deleteAccountData(); // erase cloud data while we still hold a valid token
  await deleteUser(u);
}

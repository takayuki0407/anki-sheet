// Auth state + actions for the web app. Mirrors the iOS account model (email/password). The
// Firebase ID token returned by getIdToken() is what authenticates calls to the sync backend
// (/api/sync/*), where the Worker verifies it and maps it to the account uid.
import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

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

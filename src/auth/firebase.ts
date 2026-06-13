// Firebase Auth for the web app. The same email/password account works on iOS + web, so one
// login unlocks cross-platform sync (Pro). These are PUBLIC client identifiers — safe to commit;
// Firebase security comes from Authorized Domains + our backend verifying the ID token, not from
// hiding these values. (Add the deployed origins — `kiokumate.tkdevlab.com` and the fallback
// `anki-sheet.pages.dev` — under Firebase Auth → Settings → Authorized domains, or login fails
// on that origin.)
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC_Ivzt1wfZL2fh0s9OKgdEsTNGFvZOceI",
  authDomain: "anki-sheet-b73b0.firebaseapp.com",
  projectId: "anki-sheet-b73b0",
  appId: "1:1086206264584:web:e3b96800980a59e062d8bd",
  messagingSenderId: "1086206264584",
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!auth) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  }
  return auth;
}

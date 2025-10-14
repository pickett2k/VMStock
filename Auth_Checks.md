Auth & Organization Flow – Fix Summary
📍 Problem

Two main issues observed in the current app flow:

Auth token not persisted — users must log in every time the app starts.

Brief flash of OrganizationSetupScreen even for existing users immediately after login.

⚙️ Root Causes
1. Firebase Auth Persistence (React Native)

On React Native / Expo, Firebase does not persist auth sessions by default.

Using getAuth(app) alone means sessions are in-memory only.

The SDK requires explicit initialization with AsyncStorage persistence.

2. Race Condition Between Auth & Organization Contexts

OrganizationContext sets loading false before confirming if the user already has an organization.

This makes the app momentarily think setup is incomplete → causing a brief flash of the setup screen.

✅ Fix 1 – Use Persistent Auth Initialization

In your firebase.ts (or equivalent):

import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const app = initializeApp(firebaseConfig);

// ✅ Correct initialization for React Native
export const FirebaseAuth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});


Then, always import FirebaseAuth instead of getAuth(app) anywhere you reference auth.

✅ Fix 2 – Ensure Auth Context Waits for Initialization

In AuthProvider:

Keep loading true until the first onAuthStateChanged event fires.

Don’t flip it early inside signIn or signUp.

Remove or increase the 3-second “auth initialization timeout” — it can fire before Firebase restores the session.

useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    setUser(user);
    setLoading(false); // ✅ only clear loading here
  });
  return unsubscribe;
}, []);

✅ Fix 3 – Prevent Setup Screen Flash

Wait for both the auth and organization states to settle before routing:

if (!authInitialized || authLoading) return <Splash />;

if (isAuthenticated) {
  if (!hasCheckedExistingUser) return <Splash />;
  if (!isSetupComplete) return <OrganizationSetupScreen />;
  return <AppStack />;
}

return <LoginScreen />;


or ensure inside OrganizationProvider that:

setLoading(false) is not called until checkExistingUserOrganization() has completed at least once.

🧠 Summary Checklist
Area	Action
Firebase Auth	Use initializeAuth(...getReactNativePersistence(AsyncStorage))
Auth Context	Only clear loading after onAuthStateChanged
Timeout	Remove or extend 3s fallback
Org Context	Gate on both isSetupComplete and hasCheckedExistingUser
Routing	Show Setup only after org check completes
Entry Screen	Keep as Home; entry point not related to persistence issue
🚀 Result

After applying these fixes:

Users stay signed in across restarts.

No more flash of the Organization Setup screen.

Cleaner, predictable loading flow between contexts.

Potential fixes (use as guide not gospel)

🔧 Patch Set — Auth Persistence & Org Setup Flicker
1) firebase.ts — initialize React-Native persistence
diff --git a/src/firebase.ts b/src/firebase.ts
--- a/src/firebase.ts
+++ b/src/firebase.ts
@@
-import { getAuth } from "firebase/auth";
+import { initializeAuth, getReactNativePersistence } from "firebase/auth";
+import AsyncStorage from "@react-native-async-storage/async-storage";
 import { initializeApp } from "firebase/app";
 
 const app = initializeApp(firebaseConfig);
 
-// export const auth = getAuth(app);
+// IMPORTANT for React Native/Expo: persist session across cold starts
+export const auth = initializeAuth(app, {
+  persistence: getReactNativePersistence(AsyncStorage),
+});
 
 export { app };


If you currently export getAuth(app) from any other file (e.g. FirebaseService.ts), replace it with the exported auth above and make imports consistent across the app.

2) AuthContext.tsx — only clear loading from onAuthStateChanged, remove early timeouts
diff --git a/src/context/AuthContext.tsx b/src/context/AuthContext.tsx
--- a/src/context/AuthContext.tsx
+++ b/src/context/AuthContext.tsx
@@
-import React, { useEffect, useState, useMemo, useCallback } from "react";
+import React, { useEffect, useState, useMemo, useCallback } from "react";
 import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
 import { auth } from "../firebase";
 
 export const AuthContext = React.createContext(/* ... */);
 
 export const AuthProvider: React.FC = ({ children }) => {
-  const [loading, setLoading] = useState(true);
+  const [loading, setLoading] = useState(true);     // stays true until onAuthStateChanged fires once
   const [user, setUser] = useState(null);
-  const [initialized, setInitialized] = useState(false);
+  const [initialized, setInitialized] = useState(false);
 
   useEffect(() => {
-    // Don't use a short manual timeout to flip "initialized" — can race with Firebase restoration.
-    const timeout = setTimeout(() => setInitialized(true), 3000);
-    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
+    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
       setUser(firebaseUser);
-      setLoading(false);
-      setInitialized(true);
+      setLoading(false);        // ✅ only here
+      setInitialized(true);     // ✅ set after auth reports
     });
 
-    return () => { clearTimeout(timeout); unsub(); };
+    return () => { unsub(); };
   }, []);
 
   const signIn = useCallback(async (email: string, password: string) => {
-    setLoading(true);
     await signInWithEmailAndPassword(auth, email, password);
-    // don't setLoading(false) here; let onAuthStateChanged do it
+    // ✅ do NOT set loading here; let onAuthStateChanged handle it
   }, []);
 
   const logOut = useCallback(async () => {
-    setLoading(true);
     await signOut(auth);
-    // let onAuthStateChanged update state
+    // ✅ let onAuthStateChanged update state
   }, []);
 
   const value = useMemo(() => ({
     user,
     isAuthenticated: !!user,
     loading,
     initialized,
     signIn,
     logOut,
   }), [user, loading, initialized, signIn, logOut]);
 
   return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
 };

3) OrganizationContext.tsx — gate UI until the “existing org check” has finished
diff --git a/src/context/OrganizationContext.tsx b/src/context/OrganizationContext.tsx
--- a/src/context/OrganizationContext.tsx
+++ b/src/context/OrganizationContext.tsx
@@
-import React, { useEffect, useState, useMemo, useCallback } from "react";
+import React, { useEffect, useState, useMemo, useCallback } from "react";
 import AsyncStorage from "@react-native-async-storage/async-storage";
 import { useAuth } from "./AuthContext";
 
 export const OrganizationContext = React.createContext(/* ... */);
 
 export const OrganizationProvider: React.FC = ({ children }) => {
-  const [loading, setLoading] = useState(true);
+  const [loading, setLoading] = useState(true);
   const [organization, setOrganization] = useState(null);
   const [isSetupComplete, setIsSetupComplete] = useState(false);
-  const [hasCheckedExistingUser, setHasCheckedExistingUser] = useState(false);
+  const [hasCheckedExistingUser, setHasCheckedExistingUser] = useState(false);
   const { user, initialized: authInitialized, loading: authLoading, isAuthenticated } = useAuth();
 
   const loadOrganizationFromCache = useCallback(async () => {
     const raw = await AsyncStorage.getItem("org.overlay");
     return raw ? JSON.parse(raw) : null;
   }, []);
 
-  const checkExistingUserOrganization = useCallback(async () => {
-    setHasCheckedExistingUser(true); // optimistic
-    // ... your API/Firestore check here ...
-    // setOrganization(foundOrg)
-    // setIsSetupComplete(!!foundOrg)
-  }, []);
+  const checkExistingUserOrganization = useCallback(async () => {
+    // mark that we are now performing the definitive check
+    setHasCheckedExistingUser(false);
+    try {
+      // ... your API/Firestore check here ...
+      // const foundOrg = await fetchOrgForUser(user?.uid)
+      // setOrganization(foundOrg ?? null);
+      // setIsSetupComplete(!!foundOrg);
+    } finally {
+      setHasCheckedExistingUser(true);  // ✅ only true after the check completes
+    }
+  }, [/* deps incl user */]);
 
   useEffect(() => {
-    if (!authInitialized || authLoading) return;
-    (async () => {
-      const overlay = await loadOrganizationFromCache();
-      if (overlay) {
-        setOrganization(overlay);
-        setIsSetupComplete(true);
-        setLoading(false);
-        return;
-      }
-      // no overlay — fall back to remote check
-      await checkExistingUserOrganization();
-      setLoading(false);
-    })();
+    if (!authInitialized || authLoading) return;
+    (async () => {
+      // Try fast-path from cache/overlay
+      const overlay = await loadOrganizationFromCache();
+      if (overlay) {
+        setOrganization(overlay);
+        setIsSetupComplete(true);
+        setHasCheckedExistingUser(true); // ✅ we have a definitive answer
+        setLoading(false);
+        return;
+      }
+      // No overlay → run the remote check; keep loading true until it completes
+      await checkExistingUserOrganization();
+      setLoading(false);  // ✅ only after the remote check
+    })();
   }, [authInitialized, authLoading, isAuthenticated, loadOrganizationFromCache, checkExistingUserOrganization]);
 
   const value = useMemo(() => ({
     organization,
     isSetupComplete,
     hasCheckedExistingUser,
     loading,
   }), [organization, isSetupComplete, hasCheckedExistingUser, loading]);
 
   return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
 };

4) AuthWrapper / Router guard — wait for both Auth & Org readiness

Wherever you choose between Login, OrganizationSetupScreen, and your main AppStack, add these guards.

diff --git a/src/navigation/AuthWrapper.tsx b/src/navigation/AuthWrapper.tsx
--- a/src/navigation/AuthWrapper.tsx
+++ b/src/navigation/AuthWrapper.tsx
@@
 import { useAuth } from "../context/AuthContext";
 import { useOrganization } from "../context/OrganizationContext";
 
 export default function AuthWrapper() {
   const { initialized: authInitialized, loading: authLoading, isAuthenticated } = useAuth();
   const { loading: orgLoading, isSetupComplete, hasCheckedExistingUser } = useOrganization();
 
-  if (!authInitialized || authLoading) return <Splash />;
-  if (!isAuthenticated) return <LoginScreen />;
-  // Previously: if (!isSetupComplete) return <OrganizationSetupScreen />;
-  // This could flash for existing users; add guard:
-  if (orgLoading || !hasCheckedExistingUser) return <Splash />;
-  if (!isSetupComplete) return <OrganizationSetupScreen />;
+  if (!authInitialized || authLoading) return <Splash />;
+  if (!isAuthenticated) return <LoginScreen />;
+  // ✅ Prevent setup flash: wait until org check is complete
+  if (orgLoading || !hasCheckedExistingUser) return <Splash />;
+  if (!isSetupComplete) return <OrganizationSetupScreen />;
 
   return <AppStack />;
 }

5) Optional — remove “manual initialization timeout”

If you have a custom timeout that flips initialized after ~3s, remove it or bump it (e.g., 15–20s). The onAuthStateChanged callback should be the single source of truth.

✅ After these patches

Firebase sessions persist across cold starts on RN/Expo.

No more brief navigation to OrganizationSetupScreen for existing users.

All routing decisions are gated on both auth restoration and org resolution.

If you’d like, I can also generate a single git apply-ready patch file — just tell me your exact file paths.
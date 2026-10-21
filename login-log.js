// login-log.js — drop into any portal so its sign-ins show up in User Manager → login history.
// Usage (after the user is signed in and you have `db` from getFirestore):
//
//   import { logLogin } from "./login-log.js";
//   await logLogin(db, user.uid, "Worship Suite");   // portal name shown in the history
//
// It writes users/{uid}/loginHistory/{auto-id} = { at, portal, device } once per browser session
// and also keeps lastLogin / lastPortal on the profile up to date. It never throws, so a logging
// problem can't block a login.
import { collection, addDoc, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function deviceLabel() {
    const ua = navigator.userAgent || "";
    const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
    const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    return br + " · " + os;
}

export async function logLogin(db, uid, portal) {
    const key = `loginLogged:${uid}:${portal}`;
    try { if (sessionStorage.getItem(key)) return; } catch (e) {}
    try {
        await updateDoc(doc(db, "users", uid), { lastLogin: serverTimestamp(), lastPortal: portal });
        await addDoc(collection(db, "users", uid, "loginHistory"), { at: serverTimestamp(), portal, device: deviceLabel() });
        try { sessionStorage.setItem(key, "1"); } catch (e) {}
    } catch (e) {
        console.warn("Login history not recorded:", e.message);
    }
}

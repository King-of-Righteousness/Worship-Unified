import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp as firestoreTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 2. CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyCWAxUm_Z_i-EP_xqayhQrwsL4Qkmh5fMA",
  authDomain: "slidesync-37cd4.firebaseapp.com",
  databaseURL: "https://slidesync-37cd4-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "slidesync-37cd4",
  storageBucket: "slidesync-37cd4.firebasestorage.app",
  messagingSenderId: "996754972458",
  appId: "1:996754972458:web:7f8be6880c3463ac6a4853",
  measurementId: "G-GCBS3X7STT"
};

// 3. INITIALIZE
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const firestore = getFirestore(app);
const auth = getAuth(app); 
window.auth = auth;        

// === ⏳ IDLE TIMER LOGIC ===
let idleTimer;
const IDLE_LIMIT = 15 * 60 * 1000; 

function resetIdleTimer() {
    if (!window.auth.currentUser) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        console.log("💤 User idle for 15m. Logging out...");
        alert("Session timed out due to inactivity.");
        window.logout(true); 
    }, IDLE_LIMIT);
}

const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
activityEvents.forEach(evt => document.addEventListener(evt, resetIdleTimer));

// 4. AUTH STATE LISTENER (🔥 UPDATED FOR MULTI-ROLE)
const overlay = document.getElementById('securityOverlay');
const statusMsg = document.getElementById('loginMsg');

onAuthStateChanged(window.auth, async (user) => {
  if (user) {
    statusMsg.innerText = "Checking permissions...";
    statusMsg.style.color = "var(--text)";

    try {
        const userRef = doc(firestore, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            
            if (data.accountStatus === 'disabled') {
              throw new Error("Account disabled.");
            }

            let userRoles = [];
            if (data.role) userRoles.push(String(data.role).toLowerCase().trim());
            if (data.roles && Array.isArray(data.roles)) {
                const clean = data.roles.map(r => String(r).toLowerCase().trim());
                userRoles = [...userRoles, ...clean];
            }
            userRoles = [...new Set(userRoles)]; 

            const ALLOWED_ACCESS = ['admin', 'worship1', 'worship2', 'worship3'];
            const hasAccess = userRoles.some(r => ALLOWED_ACCESS.includes(r));

            if (hasAccess) {
                 console.log(`✅ Welcome ${data.displayName || user.email} [${userRoles.join(', ')}]`);
                 unlockDashboard(userRoles);
            } else {
                 throw new Error("Access Denied: Restricted Role.");
            }
        } else {
            throw new Error("User profile not found.");
        }
    } catch (error) {
        console.error("Auth Error:", error);
        statusMsg.innerText = error.message;
        statusMsg.style.color = "var(--danger)";
        setTimeout(() => window.logout(true), 5000);
    }
  } else {
    overlay.style.display = 'flex';
  }
});

// 5. LOGIN ACTION
document.getElementById('loginBtn').addEventListener('click', () => {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginBtn');
  
  btn.innerText = "Verifying...";
  statusMsg.innerText = "";
  
  signInWithEmailAndPassword(window.auth, email, pass).catch((error) => {
    statusMsg.innerText = "Error: " + error.message;
     statusMsg.style.color = "var(--danger)";
    btn.innerText = "Login";
  });
});

// 6. LOGOUT ACTION
window.logout = (force = false) => {
    if (force || confirm("Are you sure you want to log off?")) {
        signOut(window.auth).then(() => {
             window.location.reload(); 
        }).catch((error) => {
             alert("Error logging out: " + error.message);
        });
    }
};
const logoutBtn = document.getElementById('logoutBtn');
if(logoutBtn) logoutBtn.addEventListener('click', () => window.logout(false));

// 7. HELPER: UNLOCK & ROLE UI RESTRICTIONS
function unlockDashboard(roles) {
    overlay.style.display = 'none';
    resetIdleTimer();

    const isAdmin = roles.includes('admin');
    if (!isAdmin) {
        console.log("🛡️ Standard Mode: Hiding Admin Controls");
    }

    if(window.initApp) window.initApp();
}

// --- HYBRID EXPORTS ---
window.firebaseSaveSetlistConfig = (playlist) => {
    // 🎯 POINT TO THE NEW MASTER CONFIG FOLDER
    const r = ref(db, 'library/configs/arrange_songs');
    return set(r, { playlist: playlist, updatedAt: serverTimestamp() });
};

window.firebasePublishSong = (song) => {
    if(!song.id) song.id = 'song_' + Math.random().toString(36).substr(2, 9);
    // 🎯 POINT TO THE NEW MASTER SONG FOLDER AND TAG AS PUBLIC
    song.isPublic = true; 
    const r = ref(db, 'library/songs/' + song.id);
    return set(r, song);
};

window.pushSongToFirebase = (songId, songData) => {
    return set(ref(db, 'presentation/live_edit'), {
        songId: songId,
        data: songData,
        timestamp: serverTimestamp()
    });
};

window.signalLibraryUpdate = (action) => {
    set(ref(db, 'presentation/library_signal'), {
        action: action,
        timestamp: serverTimestamp()
    });
};

console.log("🔥 Firebase Hybrid Library & Auth Active");

// 1. LOGIN TRACKER 
onAuthStateChanged(auth, (user) => {
    if (user) {
        updateDoc(doc(firestore, "users", user.uid), {
            lastLogin: firestoreTimestamp()
        }).then(() => {
            console.log("Login timestamp updated successfully.");
        }).catch((error) => {
            console.error("Failed to update timestamp:", error);
        });
    }
});
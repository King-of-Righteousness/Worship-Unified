/* === CONFIG & GLOBALS === */
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbxQYdhffYORnUrXlhnx8Jgf5u25tpGRSm8mX-p4BO9t4aEXsWSVmVBmO4rlgh29XQTN/exec';
const HIDDEN_FILES = new Set(['setlist.json', 'dashboard.config.json']);

/* === SECURE REQUESTER === */
async function jsonpRequest(action, params) {
  // 1. GET TOKEN AUTOMATICALLY
  let idToken = "";
  if (typeof window.auth !== 'undefined' && window.auth.currentUser) {
      try {
         idToken = await window.auth.currentUser.getIdToken(true);
      } catch (e) { console.warn("Token error:", e); }
  }

  // 2. PACK DATA SECURELY
  const formData = new URLSearchParams();
  formData.append('action', action);
  if(idToken) formData.append('token', idToken);
  
  if (params) {
      for (const k in params) {
          const val = typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k];
          formData.append(k, val);
      }
  }

  // 3. SEND (No Size Limits!)
  try {
      const response = await fetch(BACKEND_URL, {
          method: "POST",
          body: formData
      });
      if (!response.ok) throw new Error("Script Error: " + response.statusText);
      return await response.json();
  } catch (e) {
      throw new Error("Connection failed: " + e.message);
  }
}
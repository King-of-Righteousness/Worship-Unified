let triggerEditorRefresh = async () => {};
let triggerLibraryRefresh = async () => {};

/* === THEME === */
const themeBtn = document.getElementById('themeToggleBtn');
const mThemeBtn = document.getElementById('mThemeBtn');
function toggleTheme() {
    const isL = document.body.classList.toggle('light');
    localStorage.setItem('kor_theme', isL ? 'light' : 'dark');
    themeBtn.textContent = isL ? '☀️' : '🌙';
}

themeBtn.onclick = toggleTheme;
mThemeBtn.onclick = () => { toggleTheme(); window.toggleMobileMenu(); }; 

if(localStorage.getItem('kor_theme') === 'light') {
    document.body.classList.add('light');
    themeBtn.textContent = '☀️';
}

/* === APP INIT === */
// Exposed globally so Firebase can call it on successful login
window.initApp = function() {
    populateKeyDropdown();
    refreshAllData();
    loadSetlistConfig(); 
}

/* === MENU LOGIC === */
window.toggleMobileMenu = function() {
    document.getElementById('mobileDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobileDropdown');
    const btn = document.getElementById('mobileMenuTrigger');
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('open');
    }
});

window.switchTabMobile = (id) => {
    window.switchTab(id);
    window.toggleMobileMenu();
}

window.openSetlistMobile = () => {
    document.getElementById('setlistBtn').click();
    window.toggleMobileMenu();
}

/* === TAB LOGIC === */
window.switchTab = (id) => {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        if (b.textContent.toLowerCase().includes(id)) b.classList.add('active');
    });
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    if (id === 'library') refreshAllData();
};

async function refreshAllData(silent=false) {
    await Promise.all([triggerEditorRefresh(silent), triggerLibraryRefresh(silent)]);
}

/* === EDITOR LOGIC (SINGLE SOURCE OF TRUTH) === */
let allSongs = [];
let setlistDraft = []; 

function populateKeyDropdown() {
    const select = document.getElementById('keyInput');
    if (select.children.length === 0) {
        const keys = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
        select.innerHTML = keys.map(k => `<option value="${k}">${k}</option>`).join('');
    }
}

let editorListenerSet = false;

async function refreshEditor(silent=false) {
    // Prevent creating multiple listeners if the function is called again
    if(editorListenerSet) return; 
    editorListenerSet = true;
    
    const loadMeta = document.getElementById('loadMeta');
    if(!silent) loadMeta.textContent = 'Connecting to Live Data...';
    
    try {
        const { getDatabase, ref, onValue } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
        const db = getDatabase();
        
        // ⚡ onValue automatically triggers EVERY time a song changes!
        onValue(ref(db, 'library/songs'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                
                allSongs = Object.keys(data)
                    .filter(key => data[key].isPublic === true)
                    .map(key => ({
                        id: key,
                        name: (data[key].title || "Untitled") + ".json",
                        title: data[key].title || "",
                        artist: data[key].artist || "",
                        key: data[key].key || "C",
                        content: data[key].content || "",
                        _fileId: data[key]._fileId || null,
                        isPublic: data[key].isPublic
                    })).filter(f => !HIDDEN_FILES.has(f.name));

                window.allPublicSongs = allSongs; 
                renderSongList(); // Automatically redraws the sidebar list!
                loadMeta.textContent = `${allSongs.length} songs`;
            } else {
                allSongs = [];
                renderSongList();
                loadMeta.textContent = '0 songs';
            }
        });
    } catch(e) { 
        console.error("Firebase Load Error:", e);
        loadMeta.textContent = 'Connection Error'; 
    }
}
triggerEditorRefresh = refreshEditor;

function renderSongList() {
    const list = document.getElementById('songListPane');
    const q = document.getElementById('searchInput').value.toLowerCase();
    list.innerHTML = allSongs.filter(s => s.name.toLowerCase().includes(q)).map(s => 
        `<li class="paneSong" onclick="loadSong('${s.id}')">
            <div class="t">${s.name.replace('.json','')}</div>
         </li>`
    ).join('');
}
document.getElementById('searchInput').oninput = renderSongList;
document.getElementById('refreshBtn').onclick = () => refreshEditor(false);

let selectedSong = null;

// Loading is now INSTANT because the song data is already downloaded in allSongs!
window.loadSong = function(id) {
    const song = allSongs.find(s => s.id === id);
    if(song) {
        selectedSong = song;
        document.getElementById('titleInput').value = song.title || '';
        document.getElementById('artistInput').value = song.artist || '';
        document.getElementById('contentInput').value = song.content || '';
        
        populateKeyDropdown();
        document.getElementById('keyInput').value = song.key || 'C';

        document.getElementById('fileMeta').textContent = song.name;
        document.getElementById('loadMeta').textContent = 'Ready';
        renderPreview();
        
        // FIXED MOBILE LOGIC
        if(window.innerWidth <= 768) {
            document.querySelector('.editor-sidebar').classList.add('mobile-collapsed');
            // Force the "Edit" tab to be the default view when opening a song
            document.getElementById('contentInput').classList.add('active-pane-mobile');
            document.getElementById('previewArea').classList.remove('active-pane-mobile');
            document.getElementById('mobileEditToggle').classList.add('active');
            document.getElementById('mobilePreviewToggle').classList.remove('active');
        }
    }
}

/* === DUAL SAVE (FIREBASE FIRST + DRIVE BACKUP) === */
document.getElementById('saveBtn').onclick = async () => {
    const payload = {
        id: selectedSong ? selectedSong.id : 'song_' + Math.random().toString(36).substr(2, 9),
        _fileId: selectedSong ? selectedSong._fileId : null,
        title: document.getElementById('titleInput').value,
        artist: document.getElementById('artistInput').value,
        key: document.getElementById('keyInput').value,
        content: document.getElementById('contentInput').value,
        isPublic: true // 🏷️ Force it to stay Public in the master list!
    };
    
    const btn = document.getElementById('saveBtn');
    const oldText = btn.textContent;
    
    try {
        const { getDatabase, ref, set } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
        const db = getDatabase();

        // 1. FIREBASE (Instant Save & UI Sync to MASTER node)
        btn.textContent = "Saving to Firebase...";
        await set(ref(db, 'library/songs/' + payload.id), payload);
        
        btn.textContent = "Saved!";
        // Update the local list instantly
        refreshEditor(true);

        // 2. DRIVE (Silent Background Backup)
        btn.textContent = "Backing up to Drive...";
        
        // Notice there is NO 'await' here. This runs silently in the background 
        // so you can keep working without the UI freezing!
        jsonpRequest('editorSaveSong', { song: payload })
            .then(res => {
                console.log("☁️ Drive Backup Complete");
                btn.textContent = oldText;
            })
            .catch(err => {
                console.error("Drive Backup Error", err);
                btn.textContent = "Backup Failed";
                setTimeout(() => btn.textContent = oldText, 2000);
            });

    } catch (e) {
        alert("Error saving: " + e.message);
        btn.textContent = oldText;
    }
};

document.getElementById('newSongBtn').onclick = () => {
    selectedSong = null;
    populateKeyDropdown();
    document.getElementById('keyInput').value = 'C';
    document.getElementById('titleInput').value = '';
    document.getElementById('artistInput').value = ''; 
    document.getElementById('contentInput').value = '';
    document.getElementById('fileMeta').textContent = 'New Song';
    document.getElementById('previewArea').innerHTML = ''; 
};

document.getElementById('contentInput').oninput = renderPreview;
function renderPreview() {
    const txt = document.getElementById('contentInput').value;
    document.getElementById('previewArea').innerHTML = txt.replace(/\b([A-G][#b]?(m|maj|dim|7)?)\b/g, '<span class="chord">$1</span>');
}

/* === SETLIST LOGIC (SINGLE SOURCE OF TRUTH) === */
async function loadSetlistConfig() {
    try {
        const { getDatabase, ref, get } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
        const db = getDatabase();
        
        // Fetch the setlist instantly from the new unified Firebase config path
        const snapshot = await get(ref(db, 'library/configs/arrange_songs'));
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (data.playlist) {
                setlistDraft = data.playlist;
            }
        }
    } catch(e) {
        console.error("Failed to load setlist from Firebase:", e);
    }
}

document.getElementById('setlistBtn').onclick = () => {
    document.getElementById('setlistModal').classList.remove('hidden');
    renderSetlist();
};
window.closeSetlistModal = () => document.getElementById('setlistModal').classList.add('hidden');

function renderSetlist() {
    const body = document.getElementById('setlistBody');
    body.innerHTML = '';
    setlistDraft.forEach((id, i) => {
        const song = allSongs.find(s => s.id === id); 
        const name = song ? song.name.replace('.json','') : `<span style="color:var(--danger)">ID: ${id} (Missing or Private)</span>`;
        const row = document.createElement('div');
        row.className = 'setlist-item';
        
        // Replaced arrows with a number input field
        row.innerHTML = `
            <span style="font-weight:bold; flex:1;">${name}</span>
            <span style="font-size: 10px; color: var(--muted); margin-right: 4px;">Pos:</span>
            <input type="number" class="inp" style="width: 50px; text-align: center; padding: 2px; height: 26px; font-size: 13px; margin-right: 8px;" value="${i + 1}" onchange="slReorder(${i}, this.value)">
            <button class="action-btn" onclick="slRemove(${i})" style="color: var(--danger); border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.1);">✕</button>
        `;
        body.appendChild(row);
    });
}

// 🧠 The smart reordering logic
window.slReorder = (oldIndex, newVal) => {
    let newIndex = parseInt(newVal, 10) - 1; // Convert display number (1-based) to array index (0-based)
    
    // If they delete the number or type text, just reset the view
    if (isNaN(newIndex)) return renderSetlist(); 
    
    // Constrain the number so it doesn't break if they type a number too high or low
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= setlistDraft.length) newIndex = setlistDraft.length - 1;
    
    // Snip it out and plug it into the new position
    if (oldIndex !== newIndex) {
        const item = setlistDraft.splice(oldIndex, 1)[0];
        setlistDraft.splice(newIndex, 0, item);
    }
    
    renderSetlist();
};

window.slRemove = (i) => { setlistDraft.splice(i,1); renderSetlist(); };

window.regenerateSetlist = () => {
    if(!confirm('Recycle? Loads all public songs into the setlist.')) return;
    setlistDraft = allSongs.map(s => s.id);
    renderSetlist();
};

/* === SETLIST SAVE (FIREBASE ONLY) === */
document.getElementById('saveSetlistBtn').onclick = async () => {
    const btn = document.getElementById('saveSetlistBtn');
    const oldText = btn.textContent;
    btn.disabled = true;
    
    try {
        btn.textContent = '🔥 Saving to Firebase...';
        
        // This function is provided by your firebase-service.js
        if(window.firebaseSaveSetlistConfig) {
             await window.firebaseSaveSetlistConfig(setlistDraft);
        } else {
             // Fallback pointed to the new unified config path
             const { getDatabase, ref, set } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
             await set(ref(getDatabase(), 'library/configs/arrange_songs'), { playlist: setlistDraft, updatedAt: Date.now() });
        }

        alert('✅ Setlist Saved to Firebase!');
        window.closeSetlistModal();
    } catch(e) {
        alert('Error: ' + e.message);
    } finally {
        btn.textContent = oldText; // Restores the button text
        btn.disabled = false;
    }
};


/* === LIBRARY LOGIC (SINGLE SOURCE OF TRUTH) === */
(function(){
    let publicFiles = [];
    let privateFiles = [];
    const selectedPublicIds = new Set();
    const selectedPrivateIds = new Set();
    
    const el = id => document.getElementById(id);
    const showBox = (id, s) => { const e = el(id); if(e) e.style.display = s ? 'block' : 'none'; };

    // --- 1. INSTANT FIREBASE MASTER LOADING ---
    async function refreshAll(silent=false) {
        if(!silent) {
            el('pubList').innerHTML = '<div style="padding:10px; color:#64748b;">Loading Master DB...</div>';
            el('priList').innerHTML = '<div style="padding:10px; color:#64748b;">Loading Master DB...</div>';
        }
        
        try {
            const { getDatabase, ref, get } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
            const db = getDatabase();
            
            // Fetch everything ONCE from the master list!
            const snapshot = await get(ref(db, 'library/songs'));
            publicFiles = [];
            privateFiles = [];
            
            if (snapshot.exists()) {
                const data = snapshot.val();
                Object.keys(data).forEach(key => {
                    const song = data[key];
                    if (HIDDEN_FILES.has((song.title || "Untitled") + ".json")) return;
                    
                    const fileObj = {
                        fileId: key,
                        name: (song.title || "Untitled") + ".json",
                        size: JSON.stringify(song).length,
                        rawData: song
                    };
                    
                    // SPLIT THEM VISUALLY based on the isPublic switch
                    if (song.isPublic === true) publicFiles.push(fileObj);
                    else privateFiles.push(fileObj);
                });
            }
            
            renderList('public');
            renderList('private');
        } catch(e) { 
            console.error(e); 
        }
    }
    triggerLibraryRefresh = refreshAll;
    
    function renderList(scope) {
        const listEl = el(scope === 'public' ? 'pubList' : 'priList');
        const searchVal = el(scope === 'public' ? 'pubSearch' : 'priSearch').value.toLowerCase();
        const files = (scope === 'public' ? publicFiles : privateFiles).filter(f => 
            f.name.toLowerCase().includes(searchVal)
        );
        const set = scope === 'public' ? selectedPublicIds : selectedPrivateIds;
        
        listEl.innerHTML = '';
        files.forEach(f => {
            const isChecked = set.has(f.fileId);
            const row = document.createElement('div');
            row.className = 'item' + (isChecked ? ' active' : '');
            
            row.innerHTML = `
               <div style="flex:1;">
                   <div class="name">${escapeHtml(f.name)}</div>
                   <div class="meta">${Math.round((f.size||0)/1024)} KB</div>
                </div>
              `;
            row.onclick = () => { 
                if(set.has(f.fileId)) set.delete(f.fileId); else set.add(f.fileId);
                renderList(scope); 
                updateSel(scope);
           };
            listEl.appendChild(row);
        });
    }
    
    function updateSel(scope) {
        const set = scope === 'public' ? selectedPublicIds : selectedPrivateIds;
        const files = scope === 'public' ? publicFiles : privateFiles;
        const listEl = el(scope === 'public' ? 'pubSelList' : 'priSelList');
        const countEl = el(scope === 'public' ? 'pubSelCount' : 'priSelCount');
        const selected = files.filter(f => set.has(f.fileId));
        countEl.textContent = selected.length;
        
        if (scope === 'public') showBox('pubWarn', selected.length > 0);
        listEl.innerHTML = selected.map(s => 
            `<div class="selItem">${escapeHtml(s.name)}</div>`
        ).join('');
    }


// --- 2. INSTANT FIREBASE TAG TOGGLING & DELETION ---
    async function runAction(action, dataKey, scope) {
        const set = scope === 'public' ? selectedPublicIds : selectedPrivateIds;
        const ids = Array.from(set);
        if(ids.length === 0) return alert('Select files first');
        
        const btn = el(action === 'deletePrivate' ? 'priDeleteBtn' : (scope === 'public' ? 'pubMoveBtn' : 'priPublishBtn'));
        const originalText = btn.textContent;

        // Add a safety check for deletion!
        if (action === 'deletePrivate') {
            if(!confirm(`⚠️ Are you sure you want to PERMANENTLY delete ${ids.length} song(s)? This cannot be undone.`)) return;
        } else if (action === 'bulkMovePublicToPrivate' && !el('pubConfirmMove').checked) {
            return alert('Check confirm box');
        }

        try {
            const { getDatabase, ref, update: fbUpdate } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
            const db = getDatabase();

            btn.textContent = 'Updating Master DB...';
            btn.disabled = true;

            const updates = {};
            
            // If deleting, set the data to null to remove it from Firebase
            if (action === 'deletePrivate') {
                for (const fileId of ids) {
                    updates[`library/songs/${fileId}`] = null; 
                }
            } else {
                // Otherwise, just flip the isPublic tag
                const isNowPublic = (action === 'bulkPublishPrivateToPublic');
                for (const fileId of ids) {
                    updates[`library/songs/${fileId}/isPublic`] = isNowPublic;
                }
            }
            
            await fbUpdate(ref(db), updates);
            
            set.clear();
            refreshAll();

            btn.textContent = originalText;
            btn.disabled = false;

        } catch(e) { 
            alert('Error: ' + e.message); 
            btn.textContent = originalText; 
            btn.disabled = false; 
        }
    }
    
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" }[c]));
    }

    el('pubRefreshBtn').onclick = () => refreshAll();
    el('priRefreshBtn').onclick = () => refreshAll();
    el('pubSearch').oninput = () => renderList('public');
    el('priSearch').oninput = () => renderList('private');
    el('pubSelectAllBtn').onclick = () => { publicFiles.forEach(f => selectedPublicIds.add(f.fileId)); renderList('public'); updateSel('public'); };
    el('pubClearBtn').onclick = () => { selectedPublicIds.clear(); renderList('public'); updateSel('public'); };
    el('priSelectAllBtn').onclick = () => { privateFiles.forEach(f => selectedPrivateIds.add(f.fileId)); renderList('private'); updateSel('private'); };
    el('priClearBtn').onclick = () => { selectedPrivateIds.clear(); renderList('private'); updateSel('private'); };
    
    el('pubMoveBtn').onclick = () => runAction('bulkMovePublicToPrivate', 'publicFileIds', 'public');
    el('priPublishBtn').onclick = () => runAction('bulkPublishPrivateToPublic', 'privateFileIds', 'private');
	el('priDeleteBtn').onclick = () => runAction('deletePrivate', 'privateFileIds', 'private');
})();

/* === MOBILE VIEW CONTROLLER === */
const mobileBackBtn = document.getElementById('mobileBackBtn');
const mobileEditToggle = document.getElementById('mobileEditToggle');
const mobilePreviewToggle = document.getElementById('mobilePreviewToggle');
const editorContentArea = document.getElementById('contentInput');
const previewContentArea = document.getElementById('previewArea');

// 1. Back Button: Slides the song list back onto the screen
if (mobileBackBtn) {
    mobileBackBtn.onclick = () => {
        document.querySelector('.editor-sidebar').classList.remove('mobile-collapsed');
    };
}

// 2. Edit Tab: Shows the text box, hides the preview
if (mobileEditToggle) {
    mobileEditToggle.onclick = () => {
        mobileEditToggle.classList.add('active');
        mobilePreviewToggle.classList.remove('active');
        editorContentArea.classList.add('active-pane-mobile');
        previewContentArea.classList.remove('active-pane-mobile');
    };
}

// 3. Preview Tab: Shows the rendered chords, hides the text box
if (mobilePreviewToggle) {
    mobilePreviewToggle.onclick = () => {
        mobilePreviewToggle.classList.add('active');
        mobileEditToggle.classList.remove('active');
        previewContentArea.classList.add('active-pane-mobile');
        editorContentArea.classList.remove('active-pane-mobile');
    };
}

// Ensure the editor text box is visible by default when the page first loads on mobile
if (window.innerWidth <= 768) {
    if(editorContentArea) editorContentArea.classList.add('active-pane-mobile');
}

/* =========================================
   MOBILE CHORD WRAPPER (STRICT ALIGNMENT)
   ========================================= */

// 1. The formatting engine (Smart Push & Trailing Chord Lock)
function formatChordProForMobile(rawText, maxWords = 4) { 
    const lines = rawText.split('\n');
    let formattedOutput = [];

    for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i].trimEnd();
        
        // Identify if it's a chord line
        const isChordLine = /^\s*([A-G][#b]?(m|min|maj|dim|aug|sus|add|\d)*(\/[A-G][#b]?)?(\s+|$))+$/i.test(currentLine);

        if (isChordLine && i + 1 < lines.length) {
            let nextLine = lines[i + 1].trimEnd(); 
            
            while (currentLine.trim().length > 0 || nextLine.trim().length > 0) {
                let cutIdx = 0;

                // Find where to cut based on the number of lyric words
                if (nextLine.trim().length > 0) {
                    let wordRegex = new RegExp(`^(\\s*\\S+\\s*){1,${maxWords}}`);
                    let match = nextLine.match(wordRegex);
                    cutIdx = match ? match[0].length : nextLine.length;
                    
                    let remainingLyrics = nextLine.substring(cutIdx).trim();
                    
                    if (remainingLyrics.length === 0) {
                        // SMART FEATURE 2: Trailing Chords Lock
                        // If there are no more lyrics after this chunk, grab ALL remaining chords 
                        // so they stay attached to the end of the sentence!
                        cutIdx = Math.max(cutIdx, currentLine.length);
                    } else {
                        // Ensure we safely clear chords that hang slightly past the lyric cut
                        while (cutIdx < currentLine.length && currentLine.charAt(cutIdx) !== ' ' && currentLine.charAt(cutIdx - 1) !== ' ') {
                            cutIdx++;
                        }
                    }
                } else {
                    // No lyrics left, but chords remain
                    cutIdx = currentLine.length; 
                }

                // CHORD SAFETY CHECK
                while (cutIdx > 0 && cutIdx < currentLine.length && currentLine.charAt(cutIdx) !== ' ' && currentLine.charAt(cutIdx - 1) !== ' ') {
                    cutIdx--;
                }

                if (cutIdx <= 0) cutIdx = Math.max(currentLine.length, nextLine.length);

                let chordPart = currentLine.substring(0, cutIdx);
                let lyricPart = nextLine.substring(0, cutIdx);

                // SMART FEATURE 1: Space Saver
                // Only push the chord line if it actually has letters in it.
                // (.trimEnd() ensures we don't save useless trailing spaces)
                if (chordPart.trim().length > 0) {
                    formattedOutput.push(chordPart.trimEnd());
                }
                
                // Only push the lyric line if it actually has words in it.
                if (lyricPart.trim().length > 0) {
                    formattedOutput.push(lyricPart.trimEnd());
                }

                // Get leftovers
                currentLine = currentLine.substring(cutIdx);
                nextLine = nextLine.substring(cutIdx);

                // ALIGNMENT LOCK
                let trimCount = 0;
                while (trimCount < currentLine.length && trimCount < nextLine.length && currentLine.charAt(trimCount) === ' ' && nextLine.charAt(trimCount) === ' ') {
                    trimCount++;
                }

                currentLine = currentLine.substring(trimCount);
                nextLine = nextLine.substring(trimCount);

                if (cutIdx === 0 && trimCount === 0) break; 
            }
            i++; 
        } else {
            formattedOutput.push(currentLine); 
        }
    }
    
    return formattedOutput.join('\n'); 
}

// 2. The Button Click Event Listener
const formatBtn = document.getElementById('formatMobileBtn');
const editorInput = document.getElementById('contentInput'); 

if (formatBtn && editorInput) {
    formatBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        
        const rawContent = editorInput.value;
        const formattedContent = formatChordProForMobile(rawContent, 4); // Set to 4 words
        
        editorInput.value = formattedContent;
        
        if (typeof renderChords === 'function') {
            renderChords(); 
        }
        
        alert("Text wrapped for mobile! You can now click Save.");
    });
}

/* =========================================
   CTRL+S HOTKEY OVERRIDE
   ========================================= */
document.addEventListener('keydown', function(e) {
    // Check if Ctrl (Windows) or Cmd (Mac) is pressed along with 's' or 'S'
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        
        e.preventDefault(); // 🛑 This stops the browser from saving the whole webpage!

        // Trigger the click event on your save button
        // NOTE: Replace 'saveBtn' with the actual ID of your "Save (Dual Sync)" button from your HTML
        const saveButton = document.getElementById('saveBtn'); 
        
        if (saveButton) {
            saveButton.click(); // Simulates a physical click on your save button
        } else {
            console.warn("Ctrl+S pressed, but the Save button ID was not found.");
        }
    }
});
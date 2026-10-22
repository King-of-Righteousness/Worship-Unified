let triggerEditorRefresh = async () => {};
let triggerLibraryRefresh = async () => {};

/* === SMALL HELPERS === */
const $id = (id) => document.getElementById(id);
// Escapes text before it is put into HTML (the old version mapped every character to itself, i.e. escaped nothing)
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isHiddenFile = (name) => (typeof HIDDEN_FILES !== 'undefined' && HIDDEN_FILES && HIDDEN_FILES.has(name));
const FIREBASE_DB = "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

function toast(msg, kind) {
    const box = $id('toasts'); if (!box) { console.log(msg); return; }
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, kind === 'err' ? 5000 : 2600);
}

// Styled replacement for window.confirm → returns a Promise<boolean>
let confirmResolve = null;
function ask(message, opts = {}) {
    return new Promise(resolve => {
        if (confirmResolve) confirmResolve(false);
        confirmResolve = resolve;
        const modal = $id('confirmModal'), yes = $id('confirmYes'), no = $id('confirmNo');
        $id('confirmTitle').textContent = opts.title || 'Are you sure?';
        $id('confirmMsg').textContent = message;
        yes.textContent = opts.confirmText || 'Confirm';
        yes.className = 'btn ' + (opts.danger ? 'btn-danger solid' : 'btn-primary');
        const done = (v) => { modal.classList.add('hidden'); confirmResolve = null; resolve(v); };
        yes.onclick = () => done(true);
        no.onclick = () => done(false);
        modal.classList.remove('hidden');
        no.focus();
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmResolve) { const r = confirmResolve; confirmResolve = null; $id('confirmModal').classList.add('hidden'); r(false); return; }
    const sl = $id('setlistModal'); if (sl && !sl.classList.contains('hidden')) window.closeSetlistModal();
});

/* === THEME (light/dark toggle + shared accent colours) === */
const themeBtn = $id('themeToggleBtn');
const mThemeBtn = $id('mThemeBtn');
function applyDark(isDark) {
    document.documentElement.classList.toggle('dark', isDark);
    themeBtn.textContent = isDark ? '🌙' : '☀️';
}
function toggleTheme() {
    const isDark = !document.documentElement.classList.contains('dark');
    applyDark(isDark);
    try { localStorage.setItem('kor_theme', isDark ? 'dark' : 'light'); } catch (e) {}
}
themeBtn.onclick = toggleTheme;
mThemeBtn.onclick = () => { toggleTheme(); window.toggleMobileMenu(); };
applyDark(document.documentElement.classList.contains('dark'));

(function accentThemes() {
    const root = document.documentElement;
    const mark = (t) => document.querySelectorAll('.theme-dot').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
    mark(root.getAttribute('data-theme') || 'indigo');
    document.addEventListener('click', (e) => {
        const b = e.target.closest('.theme-dot'); if (!b) return;
        root.setAttribute('data-theme', b.dataset.theme);
        mark(b.dataset.theme);
        try { localStorage.setItem('worship-theme', b.dataset.theme); } catch (err) {}
    });
})();

/* === APP INIT === */
// Exposed globally so Firebase can call it on successful login
window.initApp = function() {
    populateKeyDropdown();
    refreshAllData();
    loadSetlistConfig();
}

/* === MENU LOGIC === */
window.toggleMobileMenu = function() {
    $id('mobileDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
    const menu = $id('mobileDropdown');
    const btn = $id('mobileMenuTrigger');
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('open');
    }
});

window.switchTabMobile = (id) => {
    window.switchTab(id);
    window.toggleMobileMenu();
}

window.openSetlistMobile = () => {
    $id('setlistBtn').click();
    window.toggleMobileMenu();
}

/* === TAB LOGIC === */
window.switchTab = (id) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    $id('tab-' + id).classList.add('active');
    if (id === 'library') refreshAllData();
};

async function refreshAllData(silent=false) {
    await Promise.all([triggerEditorRefresh(silent), triggerLibraryRefresh(silent)]);
}

/* === EDITOR LOGIC (SINGLE SOURCE OF TRUTH) === */
let allSongs = [];
let setlistDraft = [];

function populateKeyDropdown() {
    const select = $id('keyInput');
    if (select.children.length === 0) {
        const keys = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
        select.innerHTML = keys.map(k => `<option value="${k}">${k}</option>`).join('');
    }
}

/* --- unsaved-changes tracking --- */
let dirty = false;
function setDirty(v, text, cls) {
    dirty = v;
    const el = $id('saveState'); if (!el) return;
    el.className = v ? 'dirty' : (cls || '');
    el.textContent = v ? '● Unsaved changes' : (text || '');
}
['titleInput', 'artistInput', 'contentInput'].forEach(id => $id(id).addEventListener('input', () => setDirty(true)));
$id('keyInput').addEventListener('change', () => setDirty(true));
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

let editorListenerSet = false;

async function refreshEditor(silent=false) {
    // Prevent creating multiple listeners if the function is called again
    if(editorListenerSet) return;
    editorListenerSet = true;

    const loadMeta = $id('loadMeta');
    if(!silent) loadMeta.textContent = 'Connecting to Live Data...';

    try {
        const { getDatabase, ref, onValue } = await import(FIREBASE_DB);
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
                    })).filter(f => !isHiddenFile(f.name));

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
        editorListenerSet = false;   // let the Refresh button try again
    }
}
triggerEditorRefresh = refreshEditor;

let selectedSong = null;

function renderSongList() {
    const list = $id('songListPane');
    const q = $id('searchInput').value.trim().toLowerCase();
    const shown = allSongs
        .filter(s => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    list.innerHTML = '';
    if (!shown.length) {
        const li = document.createElement('li');
        li.className = 'empty-note';
        li.textContent = allSongs.length ? 'No songs match your search.' : 'No songs yet.';
        list.appendChild(li);
        return;
    }
    shown.forEach(s => {
        const li = document.createElement('li');
        li.className = 'paneSong' + (selectedSong && selectedSong.id === s.id ? ' active' : '');
        li.tabIndex = 0;
        li.dataset.id = s.id;

        const ico = document.createElement('div'); ico.className = 'song-ico'; ico.textContent = '♪';
        const txt = document.createElement('div'); txt.className = 'song-text';
        const t = document.createElement('div'); t.className = 't'; t.textContent = s.name.replace('.json', '');
        txt.appendChild(t);
        if (s.artist) { const a = document.createElement('div'); a.className = 'a'; a.textContent = s.artist; txt.appendChild(a); }
        const k = document.createElement('span'); k.className = 'key-chip'; k.textContent = s.key;

        li.append(ico, txt, k);
        li.addEventListener('click', () => window.loadSong(s.id));
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.loadSong(s.id); } });
        list.appendChild(li);
    });
}
$id('searchInput').oninput = renderSongList;
$id('refreshBtn').onclick = () => { refreshEditor(false); toast('Song list is live — it updates automatically.'); };

async function confirmDiscard() {
    if (!dirty) return true;
    return ask('You have unsaved changes to this song. Discard them?', { title: 'Unsaved changes', confirmText: 'Discard', danger: true });
}

// Loading is INSTANT because the song data is already downloaded in allSongs!
window.loadSong = async function(id) {
    const song = allSongs.find(s => s.id === id);
    if (!song) return;
    if (!(selectedSong && selectedSong.id === id) && !(await confirmDiscard())) return;

    selectedSong = song;
    $id('titleInput').value = song.title || '';
    $id('artistInput').value = song.artist || '';
    $id('contentInput').value = song.content || '';

    populateKeyDropdown();
    $id('keyInput').value = song.key || 'C';

    $id('fileMeta').textContent = song.name;
    $id('loadMeta').textContent = `${allSongs.length} songs`;
    setDirty(false);
    renderPreview();
    renderSongList();   // moves the highlight

    // MOBILE LOGIC
    if(window.innerWidth <= 768) {
        document.querySelector('.editor-sidebar').classList.add('mobile-collapsed');
        // Force the "Edit" tab to be the default view when opening a song
        $id('contentInput').classList.add('active-pane-mobile');
        $id('previewArea').classList.remove('active-pane-mobile');
        $id('mobileEditToggle').classList.add('active');
        $id('mobilePreviewToggle').classList.remove('active');
    }
}

/* === DUAL SAVE (FIREBASE FIRST + DRIVE BACKUP) === */
let saving = false;
$id('saveBtn').onclick = async () => {
    if (saving) return;
    const title = $id('titleInput').value.trim();
    if (!title) { toast('Add a song title before saving.', 'err'); $id('titleInput').focus(); return; }

    // A brand-new song with the same name as an existing one would silently create a duplicate
    if (!selectedSong) {
        const clash = allSongs.some(s => s.title.trim().toLowerCase() === title.toLowerCase());
        if (clash && !(await ask(`A song called "${title}" already exists. Save this as another copy?`, { title: 'Duplicate title', confirmText: 'Save copy' }))) return;
    }

    const payload = {
        id: selectedSong ? selectedSong.id : 'song_' + Math.random().toString(36).substr(2, 9),
        _fileId: selectedSong ? selectedSong._fileId : null,
        title: title,
        artist: $id('artistInput').value.trim(),
        key: $id('keyInput').value,
        content: $id('contentInput').value,
        isPublic: true // 🏷️ Force it to stay Public in the master list!
    };

    const btn = $id('saveBtn');
    const oldText = btn.textContent;
    saving = true; btn.disabled = true;

    try {
        const { getDatabase, ref, set } = await import(FIREBASE_DB);
        const db = getDatabase();

        // 1. FIREBASE (Instant Save & UI Sync to MASTER node)
        btn.textContent = "Saving...";
        await set(ref(db, 'library/songs/' + payload.id), payload);

        // Remember the song we just saved, so the NEXT save updates it instead of creating another copy
        selectedSong = { ...payload, name: payload.title + '.json' };
        $id('fileMeta').textContent = selectedSong.name;
        toast('Saved to Firebase ✓');
        setDirty(false, 'Saved · backing up to Drive…', 'ok');
        refreshEditor(true);

        // 2. DRIVE (Silent Background Backup) - no 'await', so you can keep working
        if (typeof jsonpRequest === 'function') {
            const savedId = payload.id;
            jsonpRequest('editorSaveSong', { song: payload })
                .then(() => {
                    console.log("☁️ Drive Backup Complete");
                    if (!dirty && selectedSong && selectedSong.id === savedId) setDirty(false, 'Saved · backed up to Drive', 'ok');
                })
                .catch(err => {
                    console.error("Drive Backup Error", err);
                    toast('Saved, but the Drive backup failed.', 'err');
                    if (!dirty) setDirty(false, 'Saved · Drive backup failed', 'bad');
                });
        } else {
            setDirty(false, 'Saved', 'ok');
        }
    } catch (e) {
        toast("Error saving: " + e.message, 'err');
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
        saving = false;
    }
};

$id('newSongBtn').onclick = async () => {
    if (!(await confirmDiscard())) return;
    selectedSong = null;
    populateKeyDropdown();
    $id('keyInput').value = 'C';
    $id('titleInput').value = '';
    $id('artistInput').value = '';
    $id('contentInput').value = '';
    $id('fileMeta').textContent = 'New Song';
    $id('previewArea').innerHTML = '';
    setDirty(false);
    renderSongList();
    $id('titleInput').focus();
};

$id('contentInput').addEventListener('input', renderPreview);
function renderPreview() {
    // Escape first (lyrics can contain < & >), then highlight chords
    const txt = escapeHtml($id('contentInput').value);
    $id('previewArea').innerHTML = txt.replace(/\b([A-G][#b]?(m|maj|dim|7)?)\b/g, '<span class="chord">$1</span>');
}

/* === SETLIST LOGIC (SINGLE SOURCE OF TRUTH) === */
async function loadSetlistConfig() {
    try {
        const { getDatabase, ref, get } = await import(FIREBASE_DB);
        const db = getDatabase();

        // Fetch the setlist instantly from the unified Firebase config path
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

$id('setlistBtn').onclick = () => {
    $id('setlistModal').classList.remove('hidden');
    renderSetlist();
};
window.closeSetlistModal = () => $id('setlistModal').classList.add('hidden');

function renderSetlist() {
    const body = $id('setlistBody');
    body.innerHTML = '';
    if (!setlistDraft.length) {
        const d = document.createElement('div'); d.className = 'empty-note';
        d.textContent = 'The setlist is empty. Use ♻️ Recycle to load all public songs.';
        body.appendChild(d);
        return;
    }
    setlistDraft.forEach((id, i) => {
        const song = allSongs.find(s => s.id === id);
        const row = document.createElement('div');
        row.className = 'setlist-item';

        const num = document.createElement('div'); num.className = 'sl-num'; num.textContent = i + 1;
        const name = document.createElement('div');
        name.className = 'sl-name' + (song ? '' : ' missing');
        name.textContent = song ? song.name.replace('.json', '') : `ID: ${id} (Missing or Private)`;
        if (song) name.title = name.textContent;

        const pos = document.createElement('input');
        pos.type = 'number'; pos.className = 'inp sl-pos'; pos.min = 1; pos.max = setlistDraft.length; pos.value = i + 1;
        pos.title = 'Position';
        let moved = false;   // the list is rebuilt on change; browsers can fire a 2nd 'change' when the focused input is removed
        pos.addEventListener('change', () => { if (moved) return; moved = true; window.slReorder(i, pos.value); });

        const up = document.createElement('button'); up.className = 'action-btn'; up.textContent = '▲'; up.title = 'Move up';
        up.disabled = i === 0; up.addEventListener('click', () => window.slReorder(i, i));        // position i (1-based) = one above
        const down = document.createElement('button'); down.className = 'action-btn'; down.textContent = '▼'; down.title = 'Move down';
        down.disabled = i === setlistDraft.length - 1; down.addEventListener('click', () => window.slReorder(i, i + 2));
        const del = document.createElement('button'); del.className = 'action-btn del'; del.textContent = '✕'; del.title = 'Remove';
        del.addEventListener('click', () => window.slRemove(i));

        row.append(num, name, pos, up, down, del);
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

window.regenerateSetlist = async () => {
    if (!(await ask('Loads all public songs into the setlist, replacing the current order.', { title: 'Recycle setlist?', confirmText: 'Recycle' }))) return;
    setlistDraft = allSongs.map(s => s.id);
    renderSetlist();
};

/* === SETLIST SAVE (FIREBASE ONLY) === */
$id('saveSetlistBtn').onclick = async () => {
    const btn = $id('saveSetlistBtn');
    const oldText = btn.textContent;
    btn.disabled = true;

    try {
        btn.textContent = '🔥 Saving...';

        // This function is provided by your firebase-service.js
        if(window.firebaseSaveSetlistConfig) {
             await window.firebaseSaveSetlistConfig(setlistDraft);
        } else {
             // Fallback pointed to the unified config path
             const { getDatabase, ref, set } = await import(FIREBASE_DB);
             await set(ref(getDatabase(), 'library/configs/arrange_songs'), { playlist: setlistDraft, updatedAt: Date.now() });
        }

        toast('Setlist saved to Firebase ✓');
        window.closeSetlistModal();
    } catch(e) {
        toast('Error: ' + e.message, 'err');
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
    const note = (text) => { const d = document.createElement('div'); d.className = 'empty-note'; d.textContent = text; return d; };

    // --- 1. INSTANT FIREBASE MASTER LOADING ---
    async function refreshAll(silent=false) {
        if(!silent) {
            el('pubList').replaceChildren(note('Loading Master DB...'));
            el('priList').replaceChildren(note('Loading Master DB...'));
        }

        try {
            const { getDatabase, ref, get } = await import(FIREBASE_DB);
            const db = getDatabase();

            // Fetch everything ONCE from the master list!
            const snapshot = await get(ref(db, 'library/songs'));
            publicFiles = [];
            privateFiles = [];

            if (snapshot.exists()) {
                const data = snapshot.val();
                Object.keys(data).forEach(key => {
                    const song = data[key];
                    if (isHiddenFile((song.title || "Untitled") + ".json")) return;

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

            // forget selections for songs that no longer exist
            const live = new Set([...publicFiles, ...privateFiles].map(f => f.fileId));
            [selectedPublicIds, selectedPrivateIds].forEach(s => [...s].forEach(id => { if (!live.has(id)) s.delete(id); }));

            renderList('public');
            renderList('private');
            updateSel('public');
            updateSel('private');
        } catch(e) {
            console.error(e);
            el('pubList').replaceChildren(note('Could not load the library.'));
            el('priList').replaceChildren(note('Could not load the library.'));
        }
    }
    triggerLibraryRefresh = refreshAll;

    function renderList(scope) {
        const listEl = el(scope === 'public' ? 'pubList' : 'priList');
        const searchVal = el(scope === 'public' ? 'pubSearch' : 'priSearch').value.trim().toLowerCase();
        const files = (scope === 'public' ? publicFiles : privateFiles)
            .filter(f => f.name.toLowerCase().includes(searchVal))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        const set = scope === 'public' ? selectedPublicIds : selectedPrivateIds;

        listEl.innerHTML = '';
        if (!files.length) { listEl.appendChild(note(searchVal ? 'No matches.' : 'Nothing here yet.')); return; }
        files.forEach(f => {
            const isChecked = set.has(f.fileId);
            const row = document.createElement('div');
            row.className = 'item' + (isChecked ? ' active' : '');
            row.tabIndex = 0;
            row.setAttribute('role', 'checkbox');
            row.setAttribute('aria-checked', isChecked ? 'true' : 'false');

            const wrap = document.createElement('div'); wrap.style.flex = '1'; wrap.style.minWidth = '0';
            const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = f.name;
            const mt = document.createElement('div'); mt.className = 'meta';
            const artist = f.rawData && f.rawData.artist ? f.rawData.artist + ' · ' : '';
            mt.textContent = artist + Math.max(1, Math.round((f.size||0)/1024)) + ' KB';
            wrap.append(nm, mt);
            row.appendChild(wrap);

            const toggle = () => {
                if(set.has(f.fileId)) set.delete(f.fileId); else set.add(f.fileId);
                renderList(scope);
                updateSel(scope);
            };
            row.onclick = toggle;
            row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
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

        if (scope === 'public') {
            showBox('pubWarn', selected.length > 0);
            if (!selected.length) el('pubConfirmMove').checked = false;
        }
        listEl.innerHTML = '';
        if (!selected.length) { listEl.appendChild(note('Nothing selected.')); return; }
        selected.forEach(s => {
            const d = document.createElement('div'); d.className = 'selItem'; d.textContent = s.name; listEl.appendChild(d);
        });
    }


// --- 2. INSTANT FIREBASE TAG TOGGLING & DELETION ---
    async function runAction(action, dataKey, scope) {
        const set = scope === 'public' ? selectedPublicIds : selectedPrivateIds;
        const ids = Array.from(set);
        if(ids.length === 0) return toast('Select files first', 'err');

        const btn = el(action === 'deletePrivate' ? 'priDeleteBtn' : (scope === 'public' ? 'pubMoveBtn' : 'priPublishBtn'));
        const originalText = btn.textContent;

        // Add a safety check for deletion!
        if (action === 'deletePrivate') {
            if(!(await ask(`Permanently delete ${ids.length} song(s)? This cannot be undone.`, { title: 'Delete songs?', confirmText: 'Delete', danger: true }))) return;
        } else if (action === 'bulkMovePublicToPrivate' && !el('pubConfirmMove').checked) {
            return toast('Tick the confirm box first', 'err');
        }

        try {
            const { getDatabase, ref, update: fbUpdate } = await import(FIREBASE_DB);
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
            el('pubConfirmMove').checked = false;
            await refreshAll(true);   // also refreshes the "Selected" boxes (they used to keep showing old selections)
            toast(action === 'deletePrivate' ? `Deleted ${ids.length} song(s).` : (action === 'bulkPublishPrivateToPublic' ? `Published ${ids.length} song(s).` : `Moved ${ids.length} song(s) to Private.`));
        } catch(e) {
            toast('Error: ' + e.message, 'err');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
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
    updateSel('public'); updateSel('private');
})();

/* === MOBILE VIEW CONTROLLER === */
const mobileBackBtn = $id('mobileBackBtn');
const mobileEditToggle = $id('mobileEditToggle');
const mobilePreviewToggle = $id('mobilePreviewToggle');
const editorContentArea = $id('contentInput');
const previewContentArea = $id('previewArea');

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
const formatBtn = $id('formatMobileBtn');
const editorInput = $id('contentInput');

if (formatBtn && editorInput) {
    formatBtn.addEventListener('click', (e) => {
        e.preventDefault();

        const rawContent = editorInput.value;
        const formattedContent = formatChordProForMobile(rawContent, 4); // Set to 4 words

        if (formattedContent !== rawContent) setDirty(true);
        editorInput.value = formattedContent;

        renderPreview();   // (the old code called renderChords(), which doesn't exist, so the preview never refreshed)

        toast('Text wrapped for mobile! You can now click Save.');
    });
}

/* =========================================
   CTRL+S HOTKEY OVERRIDE
   ========================================= */
document.addEventListener('keydown', function(e) {
    // Check if Ctrl (Windows) or Cmd (Mac) is pressed along with 's' or 'S'
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {

        e.preventDefault(); // 🛑 This stops the browser from saving the whole webpage!

        // Only save from the Editor tab (otherwise Ctrl+S on the Library tab would save a hidden song)
        if (!$id('tab-editor').classList.contains('active')) return;

        const saveButton = $id('saveBtn');
        if (saveButton) saveButton.click();
    }
});

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getDatabase, ref, set, push, get, onValue, off, runTransaction, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FACES = ['6', '7', 'J', 'Q', 'K', 'A'];
const SCORES = { TRIPLE_A: 1000, TRIPLE_K: 500, TRIPLE_Q: 400, TRIPLE_J: 300, TRIPLE_7: 200, TRIPLE_6: 100, SINGLE_A: 100, SINGLE_K: 50 };
const NUM_DICE = 5;
const WIN = 5000;

let db, auth, user, roomId, roomData, unsub = [], rolling = false, chatOpen = false;
let lastSeenChatAt = 0, chatMessages = null, updateLastSeenDebounce = null;

// Version Indicator
document.title = "5000 (v19)";


function uuid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); }

async function hashPass(code, pass) {
    const buf = new TextEncoder().encode(code.toUpperCase() + ':' + pass);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function calcScore(dice) {
    const active = dice.filter(d => !d.held);
    const counts = {};
    FACES.forEach(f => counts[f] = 0);
    active.forEach(d => counts[d.value]++);
    let score = 0;
    const used = new Set();
    const order = ['A', 'K', 'Q', 'J', '7', '6'];
    order.forEach(f => {
        if (counts[f] >= 3) {
            score += SCORES['TRIPLE_' + f];
            counts[f] -= 3;
            let n = 0;
            active.forEach((d, i) => { if (n < 3 && d.value === f && !used.has(i)) { used.add(i); n++; } });
        }
    });
    active.forEach((d, i) => { if (d.value === 'A' && !used.has(i)) { score += SCORES.SINGLE_A; used.add(i); } });
    active.forEach((d, i) => { if (d.value === 'K' && !used.has(i)) { score += SCORES.SINGLE_K; used.add(i); } });
    const scoringIdx = [];
    dice.forEach((d, i) => { if (!d.held) { const localIdx = dice.slice(0, i).filter(x => !x.held).length; if (used.has(localIdx)) scoringIdx.push(i); } });
    return { score, scoringIdx };
}

function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = $('#screen-' + id);
    if (el) el.classList.add('active');
}

function render() {
    if (!roomData) return;
    if (roomData.status === 'waiting') renderLobby();
    else if (roomData.status === 'playing' || roomData.status === 'finished') renderGame();
}

function renderLobby() {
    showScreen('lobby');
    $('#lobby-code').textContent = roomId;
    const list = $('#lobby-players');
    list.innerHTML = '';
    const order = roomData.playerOrder || {};
    Object.keys(order).sort((a, b) => +a - +b).forEach(k => {
        const uid = order[k];
        const p = roomData.players?.[uid];
        if (!p) return;
        const pres = roomData.presence?.[uid];
        const li = document.createElement('li');
        li.className = 'player-item hand';
        li.innerHTML = `<span class="presence ${pres?.state === 'online' ? 'online' : ''}"></span>${esc(p.name)} ${uid === roomData.hostUid ? '(Host)' : ''}`;
        list.appendChild(li);
    });
    const isHost = user && roomData.hostUid === user.uid;
    $('#btn-start').classList.toggle('hidden', !isHost);
    $('#chat-trigger').classList.remove('hidden');
}

function renderGame() {
    showScreen('game');
    const g = roomData.game || {};
    const isMyTurn = user && roomData.turnUid === user.uid;
    const turnPlayer = roomData.players?.[roomData.turnUid];
    $('#turn-label').textContent = isMyTurn ? 'Your Turn' : (turnPlayer?.name || '') + "'s Turn";
    $('#turn-score').textContent = '+' + ((g.turnScore || 0) + (g.rollScore || 0));
    const diceRow = $('#dice-row');
    let diceHtml = '';

    // Safety check for dice array
    let dice = [];
    if (Array.isArray(g.dice)) dice = g.dice;
    else if (g.dice && typeof g.dice === 'object') dice = Array(NUM_DICE).fill(0).map((_, i) => g.dice[i] || { value: '6', held: false, scoring: false });
    else dice = Array(NUM_DICE).fill(0).map(() => ({ value: '6', held: false, scoring: false }));

    // Debug: Log dice state to see scoring flags
    console.log('Rendering Dice:', JSON.stringify(dice));

    dice.forEach((d, i) => {
        const cls = 'die' + (d.held ? ' held' : '') + (d.scoring ? ' scoring' : '') + (rolling && !d.held ? ' rolling' : '');
        // Allow toggle only if scoring
        const canClick = isMyTurn && g.rollCount > 0 && d.scoring && !rolling;
        const onclick = canClick ? `onclick="window.toggleHold(${i})"` : '';
        diceHtml += `<div class="${cls}" ${onclick}>${d.value}</div>`;
    });
    diceRow.innerHTML = diceHtml;
    $('#game-msg').textContent = g.message || '';
    const cards = $('#score-cards');
    cards.innerHTML = '';
    const order = roomData.playerOrder || {};
    Object.keys(order).sort((a, b) => +a - +b).forEach(k => {
        const uid = order[k];
        const p = roomData.players?.[uid];
        if (!p) return;
        const div = document.createElement('div');
        div.className = 'score-card' + (uid === roomData.turnUid ? ' active' : '');
        div.innerHTML = `<div class="hand" style="font-size:0.9rem;color:var(--ink-light)">${esc(p.name)}</div><div style="font-weight:bold;font-size:1.2rem">${p.score}</div>`;
        cards.appendChild(div);
    });
    const ctrls = $('#game-controls');
    ctrls.innerHTML = '';
    if (roomData.status === 'finished') {
        const w = roomData.players?.[roomData.winnerUid];
        const isHost = user && roomData.hostUid === user.uid;
        let finishedHtml = `<div class="msg">${esc(w?.name || '?')} wins! 🎉</div>`;
        if (isHost) {
            finishedHtml += `<button class="btn btn-green" id="btn-play-again" onclick="window.restartGame()">Play Again</button>`;
        }
        finishedHtml += `<button class="btn btn-red" id="btn-leave-game" onclick="window.leaveRoom()">Leave</button>`;
        ctrls.innerHTML = finishedHtml;
    } else if (isMyTurn) {
        let html = '';
        const pts = (g.turnScore || 0) + (g.rollScore || 0);
        const myScore = roomData.players?.[user.uid]?.score || 0;
        const canBank = (myScore === 0 ? pts >= 600 : pts > 0) && g.rollCount > 0 && g.rollScore > 0;
        const isFarkle = g.rollCount > 0 && g.rollScore === 0;
        if (isFarkle) {
            html += `<button class="btn btn-red" id="btn-pass" onclick="window.handleBank()">Farkle! Pass Turn</button>`;
        } else {
            html += `
        <button class="btn btn-blue" id="btn-roll" onclick="window.handleRoll()">${g.rollCount === 0 ? 'Roll Dice' : 'Roll Remaining'}</button>
        <button class="btn btn-green" id="btn-bank" onclick="window.handleBank()" ${canBank ? '' : 'disabled'}>Bank ${pts}</button>
      `;
        }
        html += `<button class="btn btn-red" id="btn-leave-game" onclick="window.leaveRoom()" style="margin-top:20px;font-size:1rem;padding:8px">Leave Room</button>`;
        ctrls.innerHTML = html;
    } else {
        ctrls.innerHTML = `<div class="msg">Waiting for ${esc(turnPlayer?.name || '?')}...</div><button class="btn btn-red" id="btn-leave-game" onclick="window.leaveRoom()" style="font-size:1rem;padding:8px">Leave Room</button>`;
    }
    $('#chat-trigger').classList.remove('hidden');
}




// Expose for inline HTML events
window.restartGame = restartGame;
window.handleRoll = handleRoll;
window.handleBank = handleBank;
window.leaveRoom = leaveRoom;
window.toggleHold = toggleHold;

async function toggleHold(i) {
    const g = roomData?.game;
    if (!g || rolling) return;
    const d = g.dice[i];

    // Strict rule: Can only hold/unhold dice that are scoring
    if (!d.scoring) return;

    try {
        await runTransaction(ref(db, `rooms/${roomId}/game/dice/${i}/held`), cur => {
            return !cur;
        });
    } catch (e) {
        console.error('Hold error', e);
    }
}

async function handleRoll() {
    // ... existing handleRoll ...
    // (I will use a separate replace for handleRoll if needed, but I need to make sure toggleHold is exposed first)
    // actually the replacement range I selected in invalid for just exposing.
    // I should split this.
    // I will just refactor renderGame here to use window.toggleHold and expose it at the top.

    if (rolling) { console.warn('Roll blocked: rolling'); return; }
    if (!roomId) { alert('Roll blocked: No Room ID'); return; }
    if (!user) { alert('Roll blocked: No User'); return; }

    // Optimistic UI updates
    rolling = true;
    render();

    try {
        const actionId = uuid();
        const res = await runTransaction(ref(db, `rooms/${roomId}`), cur => {
            if (cur === null) return cur; // Retry

            // Debugging checks inside transaction
            if (cur.turnUid !== user.uid) {
                console.warn('Roll Abort: Not your turn', cur.turnUid, user.uid);
                // Return undefined to abort, handle in completion
                return;
            }
            if (cur.lastActionId === actionId) return;

            cur.lastActionId = actionId;
            const g = cur.game || {};

            // Fix: Accumulate previous rollScore into turnScore if re-rolling
            if ((g.rollCount || 0) > 0) {
                g.turnScore = (g.turnScore || 0) + (g.rollScore || 0);
            }

            // Ensure dice array
            let diceRaw = g.dice;
            let dice = [];

            if (Array.isArray(diceRaw)) {
                dice = diceRaw;
            } else if (diceRaw && typeof diceRaw === 'object') {
                // Firebase sparse array handling
                dice = Array(NUM_DICE).fill(0).map((_, i) => diceRaw[i] || { value: '6', held: false, scoring: false });
            } else {
                dice = Array(NUM_DICE).fill(0).map(() => ({ value: '6', held: false, scoring: false }));
            }

            const allHeld = dice.every(d => d.held);
            if (allHeld) dice = dice.map(d => ({ ...d, held: false }));

            // Roll unheld dice
            dice = dice.map(d => d.held ? { ...d, scoring: false } : { value: FACES[Math.floor(Math.random() * 6)], held: false, scoring: false });

            const { score, scoringIdx } = calcScore(dice);
            // Auto-hold scoring dice based on user expectation
            scoringIdx.forEach(i => {
                dice[i].scoring = true;
                dice[i].held = true;
            });

            g.dice = dice;
            g.rollScore = score;
            g.rollCount = (g.rollCount || 0) + 1;

            if (score === 0) {
                g.message = 'Farkle! 0 Points.';
                g.turnScore = 0;
                g.rollScore = 0;
            } else {
                const heldCnt = dice.filter(d => d.held).length;
                g.message = (heldCnt === NUM_DICE) ? 'Hot Dice!' : 'Roll or Bank';
            }
            cur.game = g;
            return cur;
        });

        if (res.committed) {
            // Success
        } else {
            console.error('Roll transaction yielded no commit.', res);
            // This happens if we returned undefined or other abort
            const val = res.snapshot.val();
            if (val && val.turnUid !== user.uid) {
                console.warn(`Roll failed: Not your turn! It is ${val.players?.[val.turnUid]?.name}'s turn.`);
            } else {
                console.warn('Roll failed to commit. Check console for transaction result.');
            }
        }

    } catch (e) {
        console.error('Roll failed exception:', e);
    } finally {
        rolling = false;
        render();
    }
}

async function handleBank() {
    if (rolling || !roomId || !user) return;
    const actionId = uuid();
    await runTransaction(ref(db, `rooms/${roomId}`), cur => {
        if (cur === null) return cur;
        if (cur.turnUid !== user.uid || cur.lastActionId === actionId) return;
        cur.lastActionId = actionId;
        const g = cur.game;
        const pts = (g.turnScore || 0) + (g.rollScore || 0);
        const p = cur.players[user.uid];
        if (pts === 0 || (p.score === 0 && pts < 600)) { advanceTurn(cur); return cur; }
        let newTotal = p.score + pts;
        if (newTotal > WIN) { advanceTurn(cur); return cur; }
        p.score = newTotal;
        Object.keys(cur.players).forEach(uid => { if (uid !== user.uid && cur.players[uid].score === newTotal) cur.players[uid].score = 0; });
        if (newTotal === WIN) { cur.status = 'finished'; cur.winnerUid = user.uid; }
        advanceTurn(cur);
        return cur;
    });
}

function advanceTurn(cur) {
    const order = cur.playerOrder || {};
    const len = Object.keys(order).length;
    let idx = cur.turnIndex || 0;
    let attempts = 0;
    // Find next valid player
    while (attempts < len + 1) {
        idx = (idx + 1) % len;
        const uid = order[String(idx)];
        if (cur.players[uid]) {
            cur.turnIndex = idx;
            cur.turnUid = uid;
            cur.game = { dice: Array(NUM_DICE).fill(0).map(() => ({ value: '6', held: false, scoring: false })), turnScore: 0, rollScore: 0, rollCount: 0, message: (cur.players[uid].name) + "'s Turn" };
            return;
        }
        attempts++;
    }
}

// ... createRoom, joinRoom, etc same as before but ensure update ...

async function createRoom() {
    const name = $('#create-name').value.trim();
    const pass = $('#create-pass').value.trim();
    if (!name || name.length > 20) return alert('Name 1-20 chars');
    if (pass.length < 4) return alert('Password min 4 chars');
    if (!user) return alert('Auth not ready');
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hash = await hashPass(code, pass);

    // Ensure dice exist
    const room = {
        hostUid: user.uid,
        passHash: hash,
        status: 'waiting',
        createdAt: Date.now(),
        turnUid: user.uid,
        turnIndex: 0,
        playerOrder: { '0': user.uid },
        players: { [user.uid]: { name, score: 0, joinedAt: Date.now() } },
        game: { dice: Array(NUM_DICE).fill(0).map(() => ({ value: '6', held: false, scoring: false })), turnScore: 0, rollScore: 0, rollCount: 0, message: 'Waiting...' }
    };

    try {
        await set(ref(db, `rooms/${code}`), room);
        enterRoom(code, name);
    } catch (e) {
        console.error('Create room error:', e);
        alert('Error: ' + e.message);
    }
}

async function joinRoom() {
    const name = $('#join-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    const pass = $('#join-pass').value.trim();
    if (!name || name.length > 20) return alert('Name 1-20 chars');
    if (!code || !pass) return alert('Code and password required');
    if (!user) return alert('Auth not ready');

    let hash;
    try {
        hash = await hashPass(code, pass);
    } catch (e) {
        console.error('Hash failed', e);
        alert('Crypto error');
        return;
    }

    try {
        const snap = await get(ref(db, `rooms/${code}`));
        if (!snap.exists()) return alert('Room not found (incorrect code)');
        const val = snap.val();
        if (val.status !== 'waiting') return alert('Game already started');
        if (val.passHash !== hash) return alert('Wrong password');

        const res = await runTransaction(ref(db, `rooms/${code}`), cur => {
            if (cur === null) return cur;
            if (cur.status !== 'waiting') return;
            if (cur.passHash !== hash) return;

            const order = cur.playerOrder || {};
            const len = Object.keys(order).length;
            if (len >= 6 && !cur.players?.[user.uid]) return;

            if (!cur.players[user.uid]) {
                cur.players[user.uid] = { name, score: 0, joinedAt: Date.now() };
                order[String(len)] = user.uid;
                cur.playerOrder = order;
            }
            return cur;
        });

        if (res.committed) {
            enterRoom(code, name);
        } else {
            // Check if user was already in (res.snapshot.val().players[user.uid])
            // If so, join is successful logic-wise.
            const p = res.snapshot.val()?.players?.[user.uid];
            if (p) enterRoom(code, name);
            else alert('Failed to join (room full or started)');
        }
    } catch (e) {
        console.error('Join error:', e);
        alert('Join error: ' + e.message);
    }
}

function enterRoom(code, name) {
    roomId = code;
    $('#chat-trigger').classList.remove('hidden');
    const roomRef = ref(db, `rooms/${code}`);
    const presRef = ref(db, `rooms/${code}/presence/${user.uid}`);
    const connRef = ref(db, '.info/connected');
    unsub.push(onValue(connRef, snap => {
        if (snap.val()) {
            onDisconnect(presRef).set({ state: 'offline', lastchanged: serverTimestamp() });
            set(presRef, { state: 'online', lastchanged: serverTimestamp(), name });
        }
    }));
    unsub.push(onValue(roomRef, snap => { roomData = snap.val(); render(); }));
    const chatRef = ref(db, `rooms/${code}/chat/messages`);
    unsub.push(onValue(chatRef, snap => { renderChat(snap.val()); }));
    const chatReadRef = ref(db, `rooms/${code}/chatReads/${user.uid}`);
    onValue(chatReadRef, snap => {
        const data = snap.val();
        lastSeenChatAt = data?.lastSeenAt || 0;
        updateUnreadBadge();
    }, { onlyOnce: true });
}

function leaveRoom() {
    unsub.forEach(fn => { if (typeof fn === 'function') fn(); });
    unsub = [];
    if (db && roomId && user) set(ref(db, `rooms/${roomId}/presence/${user.uid}`), null).catch(() => { });
    roomId = null; roomData = null;
    $('#chat-trigger').classList.add('hidden');
    $('#chat-drawer').classList.remove('open');
    showScreen('landing');
}

async function startGame() {
    if (!roomId || !user || roomData?.hostUid !== user.uid) return;
    const actionId = uuid();
    await runTransaction(ref(db, `rooms/${roomId}`), cur => {
        if (cur === null) return cur;
        if (cur.status !== 'waiting' || cur.lastActionId === actionId) return;
        cur.lastActionId = actionId;
        cur.status = 'playing';
        cur.turnIndex = 0;
        cur.turnUid = cur.playerOrder?.['0'] || user.uid;
        cur.game.message = (cur.players?.[cur.turnUid]?.name || 'Player') + "'s Turn";
        return cur;
    });
}

async function restartGame() {
    if (!roomId || !user || roomData?.hostUid !== user.uid) return;
    const actionId = uuid();
    await runTransaction(ref(db, `rooms/${roomId}`), cur => {
        if (cur === null) return cur;
        if (cur.status !== 'finished' || cur.lastActionId === actionId) return;
        cur.lastActionId = actionId;

        // Reset game state
        cur.status = 'waiting';
        cur.winnerUid = null;
        cur.turnIndex = 0;
        cur.turnUid = cur.playerOrder?.['0'] || user.uid;

        // Reset all player scores
        Object.keys(cur.players).forEach(uid => {
            cur.players[uid].score = 0;
        });

        // Reset game data
        cur.game = {
            dice: Array(NUM_DICE).fill(0).map(() => ({ value: '6', held: false, scoring: false })),
            turnScore: 0,
            rollScore: 0,
            rollCount: 0,
            message: 'Waiting...'
        };

        return cur;
    });
}

function updateLastSeenAt() {
    if (!roomId || !user) return;
    if (updateLastSeenDebounce) clearTimeout(updateLastSeenDebounce);
    updateLastSeenDebounce = setTimeout(() => {
        set(ref(db, `rooms/${roomId}/chatReads/${user.uid}`), { lastSeenAt: Date.now() }).catch(e => console.warn('chatReads write failed', e));
    }, 500);
}

async function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || !roomId || !user) return;
    input.value = '';
    const name = roomData?.players?.[user.uid]?.name || 'Anon';
    await push(ref(db, `rooms/${roomId}/chat/messages`), { text: text.slice(0, 200), senderUid: user.uid, senderName: name, createdAt: Date.now() });
}

function renderChat(msgs) {
    chatMessages = msgs;
    const box = $('#chat-msgs');
    box.innerHTML = '';
    if (!msgs) { updateUnreadBadge(); return; }
    const sorted = Object.values(msgs).sort((a, b) => a.createdAt - b.createdAt).slice(-100);
    sorted.forEach(m => {
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<b>${esc(m.senderName)}:</b> ${esc(m.text)}`;
        box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
    updateUnreadBadge();
}

function updateUnreadBadge() {
    const trigger = $('#chat-trigger');
    if (!trigger || !user) return;
    if (!chatMessages || chatOpen) { trigger.classList.remove('unread'); return; }
    const unread = Object.values(chatMessages).filter(m => m.createdAt > lastSeenChatAt && m.senderUid !== user.uid).length;
    trigger.classList.toggle('unread', unread > 0);
}

function toggleChat() {
    $('#chat-drawer').classList.toggle('open');
    chatOpen = !chatOpen;
    if (chatOpen) {
        updateLastSeenAt();
        $('#chat-trigger').classList.remove('unread');
    }
}

function showRules() { $('#modal-rules').classList.remove('hidden'); }
function hideRules() { $('#modal-rules').classList.add('hidden'); }

function buildUI() {
    $('#app').innerHTML = `
    <!-- Landing -->
    <div id="screen-landing" class="screen active">
      <div class="info-icon" id="btn-info">i</div>
      <div class="center">
        <h1 class="hand text-center" style="font-size:4.5rem;margin:0">5000</h1>
        <p class="hand text-center" style="font-size:1.5rem;color:var(--ink-light);margin-top:0">Multiplayer Dice</p>
        <div class="max-w-sm" style="margin-top:40px">
          <button class="btn btn-blue" id="btn-go-create">Create Game</button>
          <button class="btn" id="btn-go-join">Join Game</button>
        </div>
        <div style="font-size:0.8rem;color:#ccc;margin-top:20px">v17</div>
      </div>
    </div>
    <!-- Create -->
    <div id="screen-create" class="screen">
      <h2 class="hand" style="font-size:2rem">Create Room</h2>
      <div class="card max-w-sm">
        <label class="hand">Display Name</label>
        <input id="create-name" maxlength="20" placeholder="Your Name">
        <label class="hand">Room Password</label>
        <input id="create-pass" type="password" placeholder="Min 4 chars">
        <button class="btn btn-blue" id="btn-create">Create</button>
        <button class="btn" id="btn-back-create">Back</button>
      </div>
    </div>
    <!-- Join -->
    <div id="screen-join" class="screen">
      <h2 class="hand" style="font-size:2rem">Join Room</h2>
      <div class="card max-w-sm">
        <label class="hand">Display Name</label>
        <input id="join-name" maxlength="20" placeholder="Your Name">
        <label class="hand">Room Code</label>
        <input id="join-code" maxlength="10" placeholder="ABCDEF" style="text-transform:uppercase">
        <label class="hand">Room Password</label>
        <input id="join-pass" type="password" placeholder="Password">
        <button class="btn btn-blue" id="btn-join">Join</button>
        <button class="btn" id="btn-back-join">Back</button>
      </div>
    </div>
    <!-- Lobby -->
    <div id="screen-lobby" class="screen">
      <h2 class="hand" style="font-size:2rem">Lobby: <span id="lobby-code" style="color:var(--accent)"></span></h2>
      <div class="card">
        <p class="hand" style="color:var(--ink-light)">Share the code + password!</p>
        <ul class="player-list" id="lobby-players"></ul>
      </div>
      <div class="mt-auto">
        <button class="btn btn-green hidden" id="btn-start">Start Game</button>
        <button class="btn btn-red" id="btn-leave-lobby" onclick="window.leaveRoom()">Leave</button>
      </div>
    </div>
    <!-- Game -->
    <div id="screen-game" class="screen">
      <div class="game-header">
        <div><span class="hand" style="color:var(--ink-light)">Target</span><div style="font-size:1.3rem;font-weight:bold">5000</div></div>
        <div style="text-align:right"><span class="hand" id="turn-label" style="color:var(--accent)"></span><div id="turn-score" style="font-size:1.8rem;font-weight:bold">+0</div></div>
      </div>
      <div class="score-cards" id="score-cards"></div>
      <div class="dice-row" id="dice-row"></div>
      <div class="msg" id="game-msg"></div>
      <div id="game-controls" class="mt-auto"></div>
    </div>
    <!-- Chat -->
    <div id="chat-trigger" class="chat-trigger hidden">💬</div>
    <div id="chat-drawer" class="chat-drawer">
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;margin-bottom:6px"><b class="hand">Chat</b><span id="chat-close" style="cursor:pointer">✕</span></div>
      <div class="chat-msgs" id="chat-msgs"></div>
      <div class="chat-input-row"><input id="chat-input" placeholder="Say something..."><button class="btn btn-blue" id="btn-chat-send">Send</button></div>
    </div>
    <!-- Rules Modal -->
    <div id="modal-rules" class="modal-overlay hidden">
      <div class="modal">
        <div class="modal-close" id="modal-close">✕</div>
        <h2 class="hand" style="font-size:2rem;color:var(--accent);margin-top:0">How to Play</h2>
        <p class="hand" style="font-size:1.1rem">Grab some friends and test your luck! First to reach <b>exactly 5000</b> wins.</p>
        <ul class="rules-list hand" style="font-size:1rem">
          <li><b>Get on the board:</b> You need <b>600 points</b> in one turn to start scoring.</li>
          <li><b>Singles:</b> A = 100, K = 50.</li>
          <li><b>Triples:</b> Three of a kind (AAA = 1000, KKK = 500, etc).</li>
          <li><b>Hot Dice:</b> If all 5 dice score, reset and keep rolling!</li>
          <li><b>Farkle:</b> Roll 0 points = lose turn progress.</li>
          <li><b>Bump:</b> Bank the exact same total as someone else? They reset to 0!</li>
        </ul>
        <p class="hand text-center" style="margin-top:20px;font-size:1.2rem;color:var(--green)">Ready to roll? Let's go! 🎲</p>
      </div>
    </div>
  `;
    $('#btn-info').onclick = showRules;
    $('#modal-close').onclick = hideRules;
    $('#modal-rules').onclick = e => { if (e.target.id === 'modal-rules') hideRules(); };
    $('#btn-go-create').onclick = () => showScreen('create');
    $('#btn-go-join').onclick = () => showScreen('join');
    $('#btn-back-create').onclick = () => showScreen('landing');
    $('#btn-back-join').onclick = () => showScreen('landing');
    $('#btn-create').onclick = createRoom;
    $('#btn-join').onclick = joinRoom;
    $('#btn-start').onclick = startGame;
    $('#btn-leave-lobby').onclick = leaveRoom;
    $('#chat-trigger').onclick = toggleChat;
    $('#chat-close').onclick = toggleChat;
    $('#btn-chat-send').onclick = sendChat;
    $('#chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
}

function init() {
    const cfg = window.FIREBASECONFIG;
    if (!cfg || !cfg.apiKey || cfg.apiKey === 'PLACEHOLDER') {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif"><h2>⚠️ Missing Firebase Config</h2><p>Create <code>config.js</code> locally or set GitHub Secrets for deployment.</p></div>';
        return;
    }
    const app = initializeApp(cfg);
    auth = getAuth(app);
    db = getDatabase(app);
    signInAnonymously(auth).catch(e => console.error('Auth error', e));
    onAuthStateChanged(auth, u => { user = u; if (u) buildUI(); });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
init();

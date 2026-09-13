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
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function roomExpiresAt() { return Date.now() + ROOM_TTL_MS; }
const ROLL_FRAMES = Array.from({ length: 14 }, (_, i) => `assets/roll/${String(i + 1).padStart(2, '0')}.png`);
const DIE_REST = 'assets/die.png';
const ICONS = {
    leave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
};

let db, auth, user, roomId, roomData, unsub = [], rolling = false, chatOpen = false;
let lastSeenChatAt = 0, chatMessages = null, updateLastSeenDebounce = null;
let lastSeenRollCount = -1;
let prevScores = {};
let leaveArmed = false;
const dieAnims = Array.from({ length: NUM_DICE }, () => ({ interval: 0, wait: 0 }));
let landTimer = 0;
let toastTimer = 0;
let audioCtx = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.title = "5000 — Firenze";

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function haptic(ms) {
    try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ }
}

function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function sfxRoll() {
    try {
        const ctx = getAudio();
        const t = ctx.currentTime;
        for (let i = 0; i < 5; i++) {
            const n = Math.floor(ctx.sampleRate * 0.045);
            const buf = ctx.createBuffer(1, n, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let j = 0; j < n; j++) data[j] = (Math.random() * 2 - 1) * (1 - j / n);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            g.gain.value = 0.07;
            src.connect(g).connect(ctx.destination);
            src.start(t + i * 0.055);
        }
    } catch { /* ignore */ }
}

function sfxLand() {
    try {
        const ctx = getAudio();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = 180;
        g.gain.setValueAtTime(0.05, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.13);
    } catch { /* ignore */ }
}

function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const i = document.createElement('input');
        i.value = text;
        document.body.appendChild(i);
        i.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        i.remove();
        return true;
    }
}

function savedName() {
    try { return localStorage.getItem('fivek-name') || ''; } catch { return ''; }
}

function rememberName(name) {
    try { localStorage.setItem('fivek-name', name); } catch { /* ignore */ }
}

function setAppHeight() {
    document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
}

function syncKeyboardInset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
}

function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = $('#screen-' + id);
    if (el) el.classList.add('active');
}

function normalizeDice(raw) {
    const blank = () => ({ value: '6', held: false, scoring: false });
    if (!raw || typeof raw !== 'object') return Array(NUM_DICE).fill(0).map(blank);
    return Array(NUM_DICE).fill(0).map((_, i) => {
        const d = raw[i];
        if (!d || typeof d !== 'object') return blank();
        return {
            value: FACES.includes(d.value) ? d.value : '6',
            held: !!d.held,
            scoring: !!d.scoring
        };
    });
}

function dieEl(i) {
    return document.querySelector(`.die[data-i="${i}"]`);
}

function mountDice() {
    const free = $('#dice-free');
    if (!free || free.dataset.ready === '1') return;
    if ($$('.die').length === NUM_DICE) {
        free.dataset.ready = '1';
        return;
    }
    for (let i = 0; i < NUM_DICE; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'die';
        btn.dataset.i = String(i);
        btn.setAttribute('aria-label', 'Die ' + (i + 1));
        btn.innerHTML = `
      <span class="die-sprite">
        <img class="die-body" src="${DIE_REST}" alt="" draggable="false">
        <span class="die-letter">6</span>
      </span>`;
        btn.addEventListener('click', () => toggleHold(i));
        free.appendChild(btn);
    }
    free.dataset.ready = '1';
    ROLL_FRAMES.forEach(src => { const im = new Image(); im.src = src; });
}

function clearDieAnim(i) {
    const a = dieAnims[i];
    if (!a) return;
    if (a.wait) { clearTimeout(a.wait); a.wait = 0; }
    if (a.interval) { clearInterval(a.interval); a.interval = 0; }
}

function stopDieRoll(el, value) {
    if (!el) return;
    const i = Number(el.dataset.i);
    clearDieAnim(i);
    el.classList.remove('rolling');
    const img = el.querySelector('.die-body');
    const letter = el.querySelector('.die-letter');
    if (img) img.src = DIE_REST;
    if (letter) {
        letter.textContent = value || '6';
        letter.classList.toggle('royal', 'AKQJ'.includes(value));
        letter.style.opacity = '1';
    }
}

function stopAllDieRolls(values) {
    if (landTimer) { clearTimeout(landTimer); landTimer = 0; }
    $$('.die').forEach(el => {
        const i = Number(el.dataset.i);
        stopDieRoll(el, values?.[i] ?? el.querySelector('.die-letter')?.textContent ?? '6');
    });
    dieAnims.forEach((_, i) => clearDieAnim(i));
}

function startDieRoll(el, delay) {
    if (!el) return;
    const i = Number(el.dataset.i);
    const letterNow = el.querySelector('.die-letter')?.textContent;
    stopDieRoll(el, letterNow);
    if (reduceMotion) return;
    const img = el.querySelector('.die-body');
    const letter = el.querySelector('.die-letter');
    el.classList.add('rolling');
    el.classList.remove('held', 'dead', 'scoring', 'tappable', 'landing');
    if (letter) letter.style.opacity = '0';
    let f = Math.floor(Math.random() * ROLL_FRAMES.length);
    const tick = () => {
        if (!img || !el.classList.contains('rolling')) {
            clearDieAnim(i);
            return;
        }
        f = (f + 1) % ROLL_FRAMES.length;
        img.src = ROLL_FRAMES[f];
    };
    const go = () => {
        dieAnims[i].wait = 0;
        tick();
        dieAnims[i].interval = setInterval(tick, 55);
    };
    if (delay > 0) dieAnims[i].wait = setTimeout(go, delay);
    else go();
}

function tumbleUnheld(dice) {
    mountDice();
    const free = $('#dice-free');
    const allHeld = dice.every(d => d.held);
    $('#zone-scoring')?.classList.toggle('hidden', allHeld);
    $('#zone-table')?.classList.remove('hidden');
    $('#table-hint').textContent = 'Throwing…';
    dice.forEach((d, i) => {
        const el = dieEl(i);
        if (!el) return;
        if (!allHeld && d.held) {
            stopDieRoll(el, d.value);
            return;
        }
        free.appendChild(el);
        startDieRoll(el, reduceMotion ? 0 : i * 70);
    });
}

function placeDie(el, d, g, isMyTurn) {
    const canClick = isMyTurn && g.rollCount > 0 && d.scoring && !rolling && roomData.status === 'playing';
    el.classList.toggle('held', !!d.held);
    el.classList.toggle('scoring', !!d.scoring);
    el.classList.toggle('dead', g.rollCount > 0 && !d.held && !d.scoring);
    el.classList.toggle('tappable', !!canClick);
    el.disabled = !canClick;
    const host = d.held ? $('#dice-kept') : $('#dice-free');
    if (host && el.parentNode !== host) host.appendChild(el);
    const n = Number(el.dataset.i) + 1;
    let label = `Die ${n}: ${d.value}`;
    if (d.held) label += ', scoring';
    else if (g.rollCount > 0 && !d.scoring) label += ', no score';
    if (canClick) label += ', tap to throw again';
    el.setAttribute('aria-label', label);
}

function updateDice(dice, { incoming = false, land = false } = {}) {
    mountDice();
    const g = roomData?.game || {};
    const isMyTurn = user && roomData.turnUid === user.uid;
    const allHeld = dice.every(d => d.held);
    dice.forEach((d, i) => {
        const el = dieEl(i);
        if (!el) return;
        if (rolling && !land && (!d.held || allHeld)) return;
        const wasRolling = el.classList.contains('rolling') || !!dieAnims[i]?.interval;
        stopDieRoll(el, d.value);
        if ((incoming || land || wasRolling) && !reduceMotion) {
            el.classList.add('landing');
            setTimeout(() => el.classList.remove('landing'), 320);
        }
        placeDie(el, d, g, isMyTurn);
    });

    const keptN = dice.filter(d => d.held).length;
    const deadN = dice.filter(d => !d.held && !d.scoring).length;
    const scoringZone = $('#zone-scoring');
    const tableZone = $('#zone-table');
    const showKept = keptN > 0 && !rolling;
    const showTable = rolling || keptN < NUM_DICE;
    scoringZone.classList.toggle('hidden', !showKept);
    tableZone.classList.toggle('hidden', !showTable);
    tableZone.classList.toggle('miss', !rolling && g.rollCount > 0 && deadN > 0);
    const scoringHint = $('#scoring-hint');
    if (scoringHint) scoringHint.textContent = isMyTurn && dice.some(d => d.scoring) ? '· tap to throw again' : '';
    const tableHint = $('#table-hint');
    if (g.rollCount === 0) tableHint.textContent = 'On the table';
    else if (rolling) tableHint.textContent = 'Throwing…';
    else if (deadN > 0) tableHint.textContent = 'Did not score';
    else tableHint.textContent = 'On the table';
}

function render(opts) {
    if (!roomData) return;
    if (roomData.status === 'waiting') renderLobby();
    else if (roomData.status === 'playing' || roomData.status === 'finished') renderGame(opts || {});
}

function renderLobby() {
    showScreen('lobby');
    $('#win-overlay').classList.add('hidden');
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
        li.className = 'player-item';
        li.innerHTML = `<span class="presence ${pres?.state === 'online' ? 'online' : ''}"></span><span>${esc(p.name)}</span>${uid === roomData.hostUid ? '<span class="host-tag">Host</span>' : ''}`;
        list.appendChild(li);
    });
    const isHost = user && roomData.hostUid === user.uid;
    $('#btn-start').classList.toggle('hidden', !isHost);
    showChatTriggers(true);
}

function renderGame(opts = {}) {
    showScreen('game');
    const g = roomData.game || {};
    const isMyTurn = user && roomData.turnUid === user.uid;
    const turnPlayer = roomData.players?.[roomData.turnUid];
    $('#turn-label').textContent = isMyTurn ? 'Your throw' : (turnPlayer?.name || '') + "'s throw";
    $('#turn-score').textContent = '+' + ((g.turnScore || 0) + (g.rollScore || 0));

    const dice = normalizeDice(g.dice);

    const cards = $('#score-cards');
    cards.innerHTML = '';
    const order = roomData.playerOrder || {};
    Object.keys(order).sort((a, b) => +a - +b).forEach(k => {
        const uid = order[k];
        const p = roomData.players?.[uid];
        if (!p) return;
        const prev = prevScores[uid];
        const bumped = prev > 0 && p.score === 0 && uid !== user?.uid;
        const div = document.createElement('div');
        div.className = 'score-card' + (uid === roomData.turnUid ? ' active' : '') + (bumped ? ' bumped' : '');
        const pct = Math.min(100, Math.round((p.score / WIN) * 100));
        div.innerHTML = `<div class="score-name">${esc(p.name)}</div><div class="score-val">${p.score}</div><div class="score-bar"><span style="width:${pct}%"></span></div>`;
        cards.appendChild(div);
        prevScores[uid] = p.score;
    });

    const msg = g.message || '';
    const msgEl = $('#game-msg');
    msgEl.textContent = msg;
    msgEl.classList.toggle('farkle', /farkle/i.test(msg));
    msgEl.classList.toggle('hot', /hot dice/i.test(msg));

    const table = $('#dice-table');
    table.classList.toggle('hot', /hot dice/i.test(msg) && !rolling);
    table.classList.toggle('farkle', /farkle/i.test(msg) && !rolling);

    const incoming = !rolling && !opts.land && (g.rollCount || 0) > 0 && g.rollCount !== lastSeenRollCount;
    if ((rolling || (landTimer && !incoming)) && !opts.land) {
        renderControls(g, isMyTurn, turnPlayer);
        showChatTriggers(true);
        return;
    }
    lastSeenRollCount = g.rollCount || 0;
    if (incoming && !reduceMotion) {
        tumbleUnheld(dice);
        sfxRoll();
        if (landTimer) clearTimeout(landTimer);
        landTimer = setTimeout(() => {
            landTimer = 0;
            updateDice(normalizeDice(roomData?.game?.dice), { land: true });
            sfxLand();
        }, 1050);
    } else {
        if (opts.land) stopAllDieRolls(dice.map(d => d.value));
        updateDice(dice, { land: !!opts.land });
        if (opts.land) sfxLand();
    }

    renderControls(g, isMyTurn, turnPlayer);

    const win = $('#win-overlay');
    if (roomData.status === 'finished') {
        const w = roomData.players?.[roomData.winnerUid];
        $('#win-name').textContent = (w?.name || 'A player') + ' takes the palazzo.';
        const actions = $('#win-actions');
        const isHost = user && roomData.hostUid === user.uid;
        actions.innerHTML = '';
        if (isHost) actions.innerHTML += `<button class="btn btn-green" id="btn-play-again">Play again</button>`;
        actions.innerHTML += `<button class="btn btn-ghost" id="btn-leave-win">Leave</button>`;
        const again = $('#btn-play-again');
        if (again) again.onclick = restartGame;
        $('#btn-leave-win').onclick = () => confirmLeave(true);
        win.classList.remove('hidden');
    } else {
        win.classList.add('hidden');
    }

    showChatTriggers(true);
}

function showChatTriggers(on) {
    ['#chat-trigger', '#chat-trigger-lobby'].forEach(sel => {
        const el = $(sel);
        if (el) el.classList.toggle('hidden', !on);
    });
}

function renderControls(g, isMyTurn, turnPlayer) {
    const ctrls = $('#game-controls');
    const hint = $('#action-hint');
    if (roomData.status === 'finished') {
        ctrls.innerHTML = '';
        hint.textContent = '';
        return;
    }
    if (isMyTurn) {
        const pts = (g.turnScore || 0) + (g.rollScore || 0);
        const myScore = roomData.players?.[user.uid]?.score || 0;
        const canBank = (myScore === 0 ? pts >= 600 : pts > 0) && g.rollCount > 0 && g.rollScore > 0;
        const isFarkle = g.rollCount > 0 && g.rollScore === 0;
        if (isFarkle) {
            ctrls.innerHTML = `<div class="actions"><button class="btn btn-red span-2" id="btn-pass">Farkle — pass the cup</button></div>`;
            $('#btn-pass').onclick = handleBank;
            hint.textContent = 'No scoring dice. The throw is lost.';
        } else {
            ctrls.innerHTML = `<div class="actions">
        <button class="btn btn-gold" id="btn-roll" ${rolling ? 'disabled' : ''}>${g.rollCount === 0 ? 'Roll' : 'Roll remaining'}</button>
        <button class="btn btn-green" id="btn-bank" ${canBank && !rolling ? '' : 'disabled'}>Bank ${pts}</button>
      </div>`;
            $('#btn-roll').onclick = handleRoll;
            $('#btn-bank').onclick = handleBank;
            if (g.rollCount === 0) hint.textContent = myScore === 0 ? 'Bank 600 in one throw to enter the board.' : 'Throw the ivory.';
            else if (!canBank && myScore === 0) hint.textContent = `Need ${Math.max(0, 600 - pts)} more to enter.`;
            else if (diceHaveTappable(g)) hint.textContent = 'Tap a scoring die to throw it again — or bank.';
            else hint.textContent = 'Roll the rest, or bank this throw.';
        }
    } else {
        ctrls.innerHTML = `<div class="msg">Waiting on ${esc(turnPlayer?.name || 'the next player')}…</div>`;
        hint.textContent = '';
    }
}

function diceHaveTappable(g) {
    const dice = normalizeDice(g.dice);
    return dice.some(d => d.scoring);
}

window.restartGame = restartGame;
window.handleRoll = handleRoll;
window.handleBank = handleBank;
window.leaveRoom = () => confirmLeave(false);
window.toggleHold = toggleHold;

async function toggleHold(i) {
    const g = roomData?.game;
    if (!g || rolling) return;
    const dice = normalizeDice(g.dice);
    const d = dice[i];
    if (!d || !d.scoring) return;
    try {
        d.held = !d.held;
        if (Array.isArray(g.dice) || (g.dice && typeof g.dice === 'object')) {
            if (!g.dice[i]) g.dice[i] = d;
            else g.dice[i].held = d.held;
        }
        updateDice(dice);
        haptic(8);
        await runTransaction(ref(db, `rooms/${roomId}/game/dice/${i}/held`), cur => {
            return !cur;
        });
    } catch (e) {
        console.error('Hold error', e);
    }
}

async function handleRoll() {
    if (rolling) return;
    if (!roomId) { toast('No room'); return; }
    if (!user) { toast('Not signed in yet'); return; }

    rolling = true;
    document.body.classList.add('rolling');
    const unlock = setTimeout(() => {
        rolling = false;
        document.body.classList.remove('rolling');
    }, 8000);
    const g0 = roomData?.game || {};
    const started = performance.now();

    try {
        tumbleUnheld(normalizeDice(g0.dice));
        sfxRoll();
        haptic(18);
        renderControls(g0, true, roomData.players?.[user.uid]);

        const actionId = uuid();
        const res = await runTransaction(ref(db, `rooms/${roomId}`), cur => {
            if (cur === null) return cur;

            if (cur.turnUid !== user.uid) {
                return;
            }
            if (cur.lastActionId === actionId) return;

            cur.lastActionId = actionId;
            const g = cur.game || {};

            if ((g.rollCount || 0) > 0) {
                g.turnScore = (g.turnScore || 0) + (g.rollScore || 0);
            }

            let dice = normalizeDice(g.dice);

            const allHeld = dice.every(d => d.held);
            if (allHeld) dice = dice.map(d => ({ ...d, held: false }));

            dice = dice.map(d => d.held ? { value: d.value, held: true, scoring: false } : { value: FACES[Math.floor(Math.random() * 6)], held: false, scoring: false });

            const { score, scoringIdx } = calcScore(dice);
            scoringIdx.forEach(i => {
                dice[i].scoring = true;
                dice[i].held = true;
            });

            g.dice = dice;
            g.rollScore = score;
            g.rollCount = (g.rollCount || 0) + 1;
            g.turnScore = g.turnScore || 0;

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

        if (!res.committed) {
            const val = res.snapshot.val();
            if (val && val.turnUid !== user.uid) {
                toast('Not your throw');
            } else {
                toast('The throw did not take');
            }
        }

        const min = reduceMotion ? 0 : 1050;
        const wait = min - (performance.now() - started);
        if (wait > 0) await sleep(wait);

    } catch (e) {
        console.error('Roll failed exception:', e);
        toast(e?.code === 'PERMISSION_DENIED' ? 'Throw blocked by the table' : 'Roll failed');
    } finally {
        clearTimeout(unlock);
        rolling = false;
        document.body.classList.remove('rolling');
        render({ land: true });
        if (/farkle/i.test(roomData?.game?.message || '')) haptic([40, 40, 40]);
        else haptic(12);
    }
}

async function handleBank() {
    if (!roomId || !user) return;
    if (rolling) {
        rolling = false;
        document.body.classList.remove('rolling');
    }
    const actionId = uuid();
    try {
        await runTransaction(ref(db, `rooms/${roomId}`), cur => {
            if (cur === null) return cur;
            if (cur.turnUid !== user.uid || cur.lastActionId === actionId) return;
            cur.lastActionId = actionId;
            const g = cur.game || {};
            const pts = (g.turnScore || 0) + (g.rollScore || 0);
            const p = cur.players?.[user.uid];
            if (!p) return;
            if (pts === 0 || (p.score === 0 && pts < 600)) { advanceTurn(cur); return cur; }
            let newTotal = p.score + pts;
            if (newTotal > WIN) { advanceTurn(cur); return cur; }
            p.score = newTotal;
            Object.keys(cur.players).forEach(uid => { if (uid !== user.uid && cur.players[uid].score === newTotal) cur.players[uid].score = 0; });
            if (newTotal === WIN) { cur.status = 'finished'; cur.winnerUid = user.uid; }
            advanceTurn(cur);
            return cur;
        });
    } catch (e) {
        console.error('Bank failed', e);
        toast('Could not bank that throw');
    }
}

function advanceTurn(cur) {
    const order = cur.playerOrder || {};
    const len = Object.keys(order).length;
    let idx = cur.turnIndex || 0;
    let attempts = 0;
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

async function createRoom() {
    const name = $('#create-name').value.trim();
    const pass = $('#create-pass').value.trim();
    if (!name || name.length > 20) return toast('Name must be 1–20 letters');
    if (pass.length < 4) return toast('Password min 4 characters');
    if (!user) return toast('Still signing in…');
    rememberName(name);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hash = await hashPass(code, pass);

    const room = {
        hostUid: user.uid,
        passHash: hash,
        status: 'waiting',
        createdAt: Date.now(),
        expiresAt: roomExpiresAt(),
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
        toast('Could not create the room');
    }
}

async function joinRoom() {
    const name = $('#join-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    const pass = $('#join-pass').value.trim();
    if (!name || name.length > 20) return toast('Name must be 1–20 letters');
    if (!code || !pass) return toast('Code and password required');
    if (!user) return toast('Still signing in…');
    rememberName(name);

    let hash;
    try {
        hash = await hashPass(code, pass);
    } catch (e) {
        console.error('Hash failed', e);
        toast('Could not lock the seal');
        return;
    }

    try {
        const snap = await get(ref(db, `rooms/${code}`));
        if (!snap.exists()) return toast('No room with that code');
        const val = snap.val();
        if (val.expiresAt && val.expiresAt <= Date.now()) return toast('That room expired');
        if (val.status !== 'waiting') return toast('That game already started');
        if (val.passHash !== hash) return toast('Wrong password');

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
            cur.expiresAt = roomExpiresAt();
            return cur;
        });

        if (res.committed) {
            enterRoom(code, name);
        } else {
            const p = res.snapshot.val()?.players?.[user.uid];
            if (p) enterRoom(code, name);
            else toast('Room full, or already underway');
        }
    } catch (e) {
        console.error('Join error:', e);
        toast('Could not join');
    }
}

function enterRoom(code, name) {
    roomId = code;
    lastSeenRollCount = -1;
    prevScores = {};
    showChatTriggers(true);
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

function confirmLeave(force) {
    if (!force && roomData?.status === 'playing') {
        if (!leaveArmed) {
            leaveArmed = true;
            toast('Tap leave again to confirm');
            setTimeout(() => { leaveArmed = false; }, 2500);
            return;
        }
    }
    leaveArmed = false;
    leaveRoom();
}

function leaveRoom() {
    unsub.forEach(fn => { if (typeof fn === 'function') fn(); });
    unsub = [];
    if (db && roomId && user) set(ref(db, `rooms/${roomId}/presence/${user.uid}`), null).catch(() => { });
    roomId = null; roomData = null;
    lastSeenRollCount = -1;
    prevScores = {};
    stopAllDieRolls();
    showChatTriggers(false);
    $('#chat-drawer').classList.remove('open');
    $('#chat-backdrop').classList.remove('open');
    $('#win-overlay').classList.add('hidden');
    chatOpen = false;
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
        cur.expiresAt = roomExpiresAt();
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

        cur.status = 'waiting';
        cur.winnerUid = null;
        cur.turnIndex = 0;
        cur.turnUid = cur.playerOrder?.['0'] || user.uid;

        Object.keys(cur.players).forEach(uid => {
            cur.players[uid].score = 0;
        });

        cur.game = {
            dice: Array(NUM_DICE).fill(0).map(() => ({ value: '6', held: false, scoring: false })),
            turnScore: 0,
            rollScore: 0,
            rollCount: 0,
            message: 'Waiting...'
        };
        cur.expiresAt = roomExpiresAt();

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
    if (!user) return;
    const unread = chatMessages && !chatOpen
        ? Object.values(chatMessages).filter(m => m.createdAt > lastSeenChatAt && m.senderUid !== user.uid).length
        : 0;
    ['#chat-trigger', '#chat-trigger-lobby'].forEach(sel => {
        const trigger = $(sel);
        if (!trigger) return;
        if (!unread) trigger.classList.remove('unread');
        else trigger.classList.add('unread');
    });
}

function toggleChat() {
    chatOpen = !chatOpen;
    $('#chat-drawer').classList.toggle('open', chatOpen);
    $('#chat-backdrop').classList.toggle('open', chatOpen);
    if (chatOpen) {
        updateLastSeenAt();
        $('#chat-trigger').classList.remove('unread');
        setTimeout(() => $('#chat-input')?.focus(), 250);
    }
}

function showRules() { $('#modal-rules').classList.remove('hidden'); }
function hideRules() { $('#modal-rules').classList.add('hidden'); }

async function shareRoom() {
    if (!roomId) return;
    const text = `Join my 5000 Firenze game. Code: ${roomId}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: '5000 — Firenze', text });
            return;
        } catch { /* cancelled */ }
    }
    await copyText(roomId);
    toast('Code copied');
}

function fillDust() {
    const dust = $('#dust');
    if (!dust) return;
    dust.innerHTML = '';
    for (let i = 0; i < 18; i++) {
        const el = document.createElement('i');
        el.style.left = Math.random() * 100 + '%';
        el.style.animationDuration = 10 + Math.random() * 14 + 's';
        el.style.animationDelay = (-Math.random() * 16) + 's';
        el.style.width = el.style.height = (1.5 + Math.random() * 2) + 'px';
        dust.appendChild(el);
    }
}

function buildUI() {
    $('#app').innerHTML = `
    <div class="dust" id="dust" aria-hidden="true"></div>

    <div id="screen-landing" class="screen active">
      <button class="info-icon" id="btn-info" type="button" aria-label="How to play">i</button>
      <div class="hero">
        <h1>5000</h1>
        <p class="sub">Firenze</p>
        <div class="ornament"><span class="line"></span><span class="giglio-sm"></span><span class="line"></span></div>
        <p class="tag">Ivory dice · the palazzo of luck</p>
      </div>
      <div class="landing-actions">
        <button class="btn btn-gold" id="btn-go-create">Create a room</button>
        <button class="btn btn-ghost" id="btn-go-join">Join a room</button>
      </div>
    </div>

    <div id="screen-create" class="screen">
      <div class="topbar">
        <button class="icon-btn" id="btn-back-create" type="button" aria-label="Back">${ICONS.back}</button>
        <div class="brand-mini">Firenze</div>
        <span style="width:44px"></span>
      </div>
      <h2 class="screen-heading">Open a table</h2>
      <div class="card max-w-sm">
        <label for="create-name">Display name</label>
        <input id="create-name" maxlength="20" placeholder="Your name" autocomplete="nickname" enterkeyhint="next">
        <label for="create-pass">Room password</label>
        <input id="create-pass" type="password" placeholder="At least 4 characters" autocomplete="off" enterkeyhint="go">
        <button class="btn btn-gold" id="btn-create">Create</button>
      </div>
    </div>

    <div id="screen-join" class="screen">
      <div class="topbar">
        <button class="icon-btn" id="btn-back-join" type="button" aria-label="Back">${ICONS.back}</button>
        <div class="brand-mini">Firenze</div>
        <span style="width:44px"></span>
      </div>
      <h2 class="screen-heading">Take a seat</h2>
      <div class="card max-w-sm">
        <label for="join-name">Display name</label>
        <input id="join-name" maxlength="20" placeholder="Your name" autocomplete="nickname" enterkeyhint="next">
        <label for="join-code">Room code</label>
        <input id="join-code" maxlength="10" placeholder="ABCDEF" style="text-transform:uppercase" autocapitalize="characters" enterkeyhint="next">
        <label for="join-pass">Room password</label>
        <input id="join-pass" type="password" placeholder="Password" autocomplete="off" enterkeyhint="go">
        <button class="btn btn-gold" id="btn-join">Join</button>
      </div>
    </div>

    <div id="screen-lobby" class="screen">
      <div class="topbar">
        <button class="icon-btn" id="btn-leave-lobby" type="button" aria-label="Leave">${ICONS.leave}</button>
        <div class="brand-mini">Lobby</div>
        <button class="icon-btn hidden" id="chat-trigger-lobby" type="button" aria-label="Chat">${ICONS.chat}</button>
      </div>
      <button class="code-seal" id="lobby-share" type="button">
        <span class="code-label">Room code</span>
        <span id="lobby-code"></span>
        <span class="code-hint">Tap to share</span>
      </button>
      <div class="card">
        <p class="text-center" style="margin-top:0;font-style:italic;color:var(--ink-soft)">Share the code and password. The host opens the throw.</p>
        <ul class="player-list" id="lobby-players"></ul>
      </div>
      <div class="mt-auto">
        <button class="btn btn-green hidden" id="btn-start">Start the game</button>
      </div>
    </div>

    <div id="screen-game" class="screen">
      <div class="topbar">
        <button class="icon-btn" id="btn-leave-game" type="button" aria-label="Leave">${ICONS.leave}</button>
        <div class="brand-mini">5000</div>
        <button class="icon-btn hidden" id="chat-trigger" type="button" aria-label="Chat">${ICONS.chat}</button>
      </div>
      <div class="game-header">
        <div><div class="label">Target</div><div class="target">5000</div></div>
        <div style="text-align:right"><div id="turn-label"></div><div id="turn-score">+0</div></div>
      </div>
      <div class="score-cards" id="score-cards"></div>
      <div class="legend">A 100 · K 50 · AAA 1000 · KKK 500 · QQQ 400 · JJJ 300 · 777 200 · 666 100 · bank exactly 5000</div>
      <div class="dice-table" id="dice-table">
        <div class="dice-board">
          <div class="dice-zone scoring-zone hidden" id="zone-scoring">
            <div class="zone-label">Scoring <span id="scoring-hint"></span></div>
            <div class="dice-row" id="dice-kept"></div>
          </div>
          <div class="dice-zone table-zone" id="zone-table">
            <div class="zone-label" id="table-hint">On the table</div>
            <div class="dice-row" id="dice-free"></div>
          </div>
        </div>
      </div>
      <div class="msg" id="game-msg" aria-live="polite"></div>
      <div class="hint" id="action-hint"></div>
      <div id="game-controls"></div>
    </div>

    <div id="chat-backdrop" class="chat-backdrop"></div>
    <div id="chat-drawer" class="chat-drawer">
      <div class="chat-handle"></div>
      <div class="chat-head"><span>Table talk</span><span id="chat-close">✕</span></div>
      <div class="chat-msgs" id="chat-msgs"></div>
      <div class="chat-input-row"><input id="chat-input" maxlength="200" placeholder="A word across the table…" enterkeyhint="send"><button class="btn btn-gold" id="btn-chat-send">Send</button></div>
    </div>

    <div id="modal-rules" class="modal-overlay hidden">
      <div class="modal">
        <div class="modal-close" id="modal-close">✕</div>
        <div class="giglio" style="margin:0 auto 8px"></div>
        <h2>How to play</h2>
        <p>First to reach <b>exactly 5000</b> wins the palazzo. Overshoot, and the throw is wasted.</p>
        <ul class="rules-list">
          <li><b>Enter the board:</b> bank <b>600</b> in a single turn before any points count.</li>
          <li><b>Singles:</b> A = 100, K = 50.</li>
          <li><b>Triples:</b> three of a kind (AAA = 1000, KKK = 500, and so on).</li>
          <li><b>Hot Dice:</b> all five score — keep the cup and throw again.</li>
          <li><b>Farkle:</b> a throw with no points loses the turn.</li>
          <li><b>Bump:</b> bank the exact total another player holds, and they fall to 0.</li>
        </ul>
        <p class="text-center" style="margin-top:18px;font-style:italic;color:var(--gold-dim)">Scoring dice sit on the gold shelf. Tap one to throw it again. Grey dice scored nothing.</p>
      </div>
    </div>

    <div id="win-overlay" class="win-overlay hidden">
      <div class="win-plaque">
        <div class="giglio" style="margin:0 auto"></div>
        <h2>Triumph</h2>
        <p class="winner" id="win-name"></p>
        <div id="win-actions"></div>
      </div>
    </div>

    <div id="toast" class="toast" role="status"></div>
  `;

    fillDust();
    mountDice();

    const name = savedName();
    if (name) {
        $('#create-name').value = name;
        $('#join-name').value = name;
    }

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
    $('#btn-leave-lobby').onclick = () => confirmLeave(true);
    $('#btn-leave-game').onclick = () => confirmLeave(false);
    $('#lobby-share').onclick = shareRoom;
    $('#chat-trigger').onclick = toggleChat;
    $('#chat-trigger-lobby').onclick = toggleChat;
    $('#chat-close').onclick = toggleChat;
    $('#chat-backdrop').onclick = toggleChat;
    $('#btn-chat-send').onclick = sendChat;
    $('#chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
    $('#create-pass').onkeydown = e => { if (e.key === 'Enter') createRoom(); };
    $('#join-pass').onkeydown = e => { if (e.key === 'Enter') joinRoom(); };
}

function wireLobbyChatAlias() {
    const a = $('#chat-trigger');
    const b = $('#chat-trigger-lobby');
    if (!a || !b) return;
    const sync = () => {
        b.classList.toggle('hidden', a.classList.contains('hidden'));
        b.classList.toggle('unread', a.classList.contains('unread'));
    };
    const obs = new MutationObserver(sync);
    obs.observe(a, { attributes: true, attributeFilter: ['class'] });
    sync();
}

function init() {
    const cfg = window.FIREBASECONFIG;
    if (!cfg || !cfg.apiKey || cfg.apiKey === 'PLACEHOLDER') {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:Cinzel,serif;color:#f3e6c9"><h2>Missing Firebase config</h2><p>Create <code>config.js</code> locally or set GitHub Secrets for deployment.</p></div>';
        return;
    }
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncKeyboardInset);
        window.visualViewport.addEventListener('scroll', syncKeyboardInset);
    }
    const app = initializeApp(cfg);
    auth = getAuth(app);
    db = getDatabase(app);
    signInAnonymously(auth).catch(e => console.error('Auth error', e));
    onAuthStateChanged(auth, u => {
        user = u;
        if (u) {
            buildUI();
            wireLobbyChatAlias();
        }
    });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
init();

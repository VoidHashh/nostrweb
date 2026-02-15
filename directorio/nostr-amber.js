/**
 * NostrFácil - Amber Follow (NIP-55) v5
 * Usa <a> tags para lanzar nostrsigner: (compatible con Brave, Vanadium, etc.)
 * Procesa callbacks de Amber al inicio, antes de cualquier delay.
 */

(function () {
    'use strict';

    // ─── Config ──────────────────────────────────────────────
    const READ_RELAYS = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://purplepag.es',
        'wss://relay.nostr.band',
    ];
    const WRITE_RELAYS = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://purplepag.es',
        'wss://nostr.at',
        'wss://nostr.data.haus',
        'wss://nostr.vulpem.com',
        'wss://nostrelay.circum.space',
    ];
    const RELAY_TIMEOUT = 8000;
    const CALLBACK_BASE = window.location.origin + window.location.pathname;
    const SK = {
        PUBKEY: 'nostrfacil_amber_pubkey',
        PENDING: 'nostrfacil_amber_pending',
        CONTACTS: 'nostrfacil_amber_contacts',
        CONTACT_EVENT: 'nostrfacil_amber_contact_event',
    };

    let userPubkeyHex = null;
    let userContacts = new Set();
    let userContactEvent = null;
    let amberReady = false;

    // ─── Bech32 → Hex ────────────────────────────────────────
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    function bech32Decode(str) {
        str = str.toLowerCase();
        const pos = str.lastIndexOf('1');
        if (pos < 1) return null;
        const data = [];
        for (let i = pos + 1; i < str.length; i++) {
            const idx = CHARSET.indexOf(str[i]);
            if (idx === -1) return null;
            data.push(idx);
        }
        return { hrp: str.slice(0, pos), data: convertBits(data.slice(0, -6), 5, 8, false) };
    }
    function convertBits(data, from, to, pad) {
        let acc = 0, bits = 0; const r = [], maxv = (1 << to) - 1;
        for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; r.push((acc >> bits) & maxv); } }
        if (pad && bits > 0) r.push((acc << (to - bits)) & maxv);
        return r;
    }
    function npubToHex(npub) {
        try { const d = bech32Decode(npub); if (!d || d.hrp !== 'npub') return null; return d.data.map(b => b.toString(16).padStart(2, '0')).join(''); } catch { return null; }
    }

    // ─── Detection ───────────────────────────────────────────
    function isAndroid() { return /android/i.test(navigator.userAgent); }
    function hasNip07() { return typeof window.nostr !== 'undefined' && window.nostr !== null; }

    // ─── Relay communication ─────────────────────────────────
    function queryRelay(url, filter) {
        return new Promise(resolve => {
            const subId = 'ab_' + Math.random().toString(36).slice(2, 8);
            const events = []; let settled = false;
            const t = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(events); } }, RELAY_TIMEOUT);
            let ws; try { ws = new WebSocket(url); } catch { clearTimeout(t); resolve(events); return; }
            ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]));
            ws.onmessage = m => { try { const d = JSON.parse(m.data); if (d[0]==='EVENT'&&d[1]===subId) events.push(d[2]); else if (d[0]==='EOSE') { if (!settled) { settled=true; clearTimeout(t); ws.close(); resolve(events); } } } catch {} };
            ws.onerror = () => { if (!settled) { settled=true; clearTimeout(t); resolve(events); } };
        });
    }
    function publishToRelay(url, event) {
        return new Promise(resolve => {
            let ws, settled = false;
            const t = setTimeout(() => { if (!settled) { settled=true; try{ws.close();}catch{} resolve({url,ok:false,msg:'timeout'}); } }, RELAY_TIMEOUT);
            try { ws = new WebSocket(url); } catch { clearTimeout(t); resolve({url,ok:false,msg:'connect error'}); return; }
            ws.onopen = () => { console.log('[amber] → EVENT to', url); ws.send(JSON.stringify(['EVENT', event])); };
            ws.onmessage = m => { try { const d=JSON.parse(m.data); if(d[0]==='OK'&&!settled){settled=true;clearTimeout(t);ws.close();const r={url,ok:d[2]===true,msg:d[3]||''};console.log('[amber] ←',r);resolve(r);} } catch {} };
            ws.onerror = () => { if(!settled){settled=true;clearTimeout(t);resolve({url,ok:false,msg:'ws error'});} };
        });
    }
    async function publishToRelays(event) {
        console.log('[amber] Publishing to', WRITE_RELAYS.length, 'relays');
        const results = await Promise.all(WRITE_RELAYS.map(u => publishToRelay(u, event)));
        console.log('[amber] Results:', results.filter(r=>r.ok).length + '/' + results.length, 'OK');
        return results;
    }

    // ─── Contact list ────────────────────────────────────────
    async function fetchContactList(hex) {
        const results = await Promise.all(READ_RELAYS.map(u => queryRelay(u, {kinds:[3],authors:[hex],limit:1})));
        let newest = null;
        for (const evts of results) for (const ev of evts) if (!newest || ev.created_at > newest.created_at) newest = ev;
        return newest;
    }
    async function loadUserContacts() {
        if (!userPubkeyHex) return;
        const ev = await fetchContactList(userPubkeyHex);
        if (ev) {
            userContactEvent = ev;
            userContacts = new Set(ev.tags.filter(t=>t[0]==='p').map(t=>t[1]));
            try { sessionStorage.setItem(SK.CONTACTS, JSON.stringify([...userContacts])); sessionStorage.setItem(SK.CONTACT_EVENT, JSON.stringify(ev)); } catch {}
        }
    }
    function loadCachedContacts() {
        try {
            const c = sessionStorage.getItem(SK.CONTACTS), e = sessionStorage.getItem(SK.CONTACT_EVENT);
            if (c) userContacts = new Set(JSON.parse(c));
            if (e) userContactEvent = JSON.parse(e);
            return c !== null;
        } catch { return false; }
    }

    // ─── Amber launches via <a> click ────────────────────────
    function launchAmber(url) {
        const a = document.createElement('a');
        a.href = url;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
    }

    function amberGetPublicKey() {
        const cb = encodeURIComponent(CALLBACK_BASE + '?amber_pubkey=');
        launchAmber(`nostrsigner:?compressionType=none&returnType=signature&type=get_public_key&callbackUrl=${cb}`);
    }

    function amberSignEvent(eventJson, targetHex) {
        try { sessionStorage.setItem(SK.PENDING, targetHex); } catch {}
        const encoded = encodeURIComponent(eventJson);
        const cb = encodeURIComponent(CALLBACK_BASE + '?amber_event=');
        launchAmber(`nostrsigner:${encoded}?compressionType=none&returnType=event&type=sign_event&callbackUrl=${cb}`);
    }

    // ─── Follow ──────────────────────────────────────────────
    function buildFollowEvent(targetHex) {
        let tags = userContactEvent && userContactEvent.tags ? [...userContactEvent.tags] : [];
        if (tags.some(t => t[0]==='p' && t[1]===targetHex)) return null;
        tags.push(['p', targetHex]);
        return JSON.stringify({
            kind: 3,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: userContactEvent ? userContactEvent.content : '',
        });
    }

    function followWithAmber(hex, btn) {
        const json = buildFollowEvent(hex);
        if (!json) { btn.textContent='✓ Siguiendo'; btn.classList.add('following'); btn.disabled=true; return; }
        btn.textContent = '⏳';
        btn.disabled = true;
        setTimeout(() => amberSignEvent(json, hex), 100);
    }

    // ─── Handle Amber callbacks ──────────────────────────────
    async function handleAmberReturn() {
        const url = window.location.href;
        const q = url.indexOf('?');
        if (q === -1) return null;
        const qs = url.slice(q + 1);

        // ── get_public_key callback ──
        if (qs.startsWith('amber_pubkey=')) {
            const raw = qs.slice('amber_pubkey='.length);
            const pubkey = raw.replace(/[^a-f0-9]/gi, '').slice(0, 64);
            console.log('[amber] Got pubkey:', pubkey);
            if (pubkey && pubkey.length === 64) {
                userPubkeyHex = pubkey;
                try { sessionStorage.setItem(SK.PUBKEY, pubkey); } catch {}
            }
            window.history.replaceState({}, '', CALLBACK_BASE);
            return 'pubkey';
        }

        // ── sign_event callback ──
        if (qs.startsWith('amber_event=')) {
            const raw = qs.slice('amber_event='.length);
            window.history.replaceState({}, '', CALLBACK_BASE);

            let signed;
            // Try decode in order: URL-encoded JSON, raw JSON, gzip
            try { signed = JSON.parse(decodeURIComponent(raw)); } catch {
                try { signed = JSON.parse(raw); } catch {
                    if (raw.startsWith('Signer1')) {
                        try {
                            const bytes = Uint8Array.from(atob(raw.slice(7)), c => c.charCodeAt(0));
                            const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
                            signed = JSON.parse(text);
                        } catch (e) { console.error('[amber] gzip parse fail:', e); return 'error'; }
                    } else { console.error('[amber] Cannot parse event'); return 'error'; }
                }
            }

            if (!signed || !signed.sig) { console.error('[amber] No sig in event:', signed); return 'error'; }

            console.log('[amber] Publishing signed event ID:', signed.id);
            const results = await publishToRelays(signed);
            const ok = results.some(r => r.ok);

            const pendingHex = sessionStorage.getItem(SK.PENDING);
            if (ok && pendingHex) {
                userContacts.add(pendingHex);
                userContactEvent = signed;
                try {
                    sessionStorage.setItem(SK.CONTACTS, JSON.stringify([...userContacts]));
                    sessionStorage.setItem(SK.CONTACT_EVENT, JSON.stringify(signed));
                    sessionStorage.removeItem(SK.PENDING);
                } catch {}
            } else {
                try { sessionStorage.removeItem(SK.PENDING); } catch {}
            }
            return ok ? 'follow_ok' : 'follow_error';
        }

        return null;
    }

    // ─── UI ──────────────────────────────────────────────────
    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = `
            .amber-connect-bar{display:flex;align-items:center;justify-content:center;gap:.75rem;padding:.75rem 1rem;margin-bottom:1.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;font-size:.85rem;color:var(--text-secondary)}
            .amber-connect-btn{padding:.5rem 1.2rem;border:1px solid #f7931a;background:#f7931a;color:#fff;border-radius:8px;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
            .amber-connect-btn:hover{background:#e8850f}
            .amber-login-bar{display:flex;align-items:center;justify-content:center;gap:.75rem;padding:.75rem 1rem;margin-bottom:1.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;font-size:.85rem;color:var(--text-secondary)}
            .amber-login-bar .status-dot{width:8px;height:8px;border-radius:50%;background:#f7931a;flex-shrink:0}
            .amber-login-bar .user-npub{font-family:monospace;font-size:.75rem}
            .amber-disconnect-btn{padding:.3rem .6rem;border:1px solid var(--border);background:transparent;color:var(--text-secondary);border-radius:6px;font-size:.7rem;cursor:pointer}
            .follow-btn-amber{padding:.45rem .85rem;border:1px solid #f7931a;background:#f7931a;color:#fff;border-radius:8px;font-family:inherit;font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap}
            .follow-btn-amber:hover:not(:disabled){background:#e8850f}
            .follow-btn-amber:disabled{cursor:default}
            .follow-btn-amber.following{background:transparent;color:var(--success);border-color:var(--success)}
            .amber-toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:.75rem 1.5rem;background:var(--bg-tertiary);border:1px solid var(--success);border-radius:10px;color:var(--success);font-size:.85rem;font-weight:600;z-index:1000;animation:amberFadeIn .3s ease}
            .amber-toast.error{border-color:#f87171;color:#f87171}
            @keyframes amberFadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        `;
        document.head.appendChild(s);
    }

    function showToast(msg, err) {
        const t = document.createElement('div');
        t.className = 'amber-toast' + (err ? ' error' : '');
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    function showConnectBar() {
        const ref = document.querySelector('.search-box');
        if (!ref) return;
        const bar = document.createElement('div');
        bar.className = 'amber-connect-bar';
        bar.id = 'amber-bar';

        const label = document.createElement('span');
        label.textContent = '🤖 ¿Tienes Amber?';

        // Use an <a> tag — browsers allow <a href="nostrsigner:..."> even if they block window.location
        const btn = document.createElement('a');
        btn.className = 'amber-connect-btn';
        btn.textContent = '🔑 Conectar con Amber';
        const cb = encodeURIComponent(CALLBACK_BASE + '?amber_pubkey=');
        btn.href = `nostrsigner:?compressionType=none&returnType=signature&type=get_public_key&callbackUrl=${cb}`;

        bar.appendChild(label);
        bar.appendChild(btn);
        ref.parentNode.insertBefore(bar, ref);
    }

    function showLoginBar(hex) {
        const existing = document.getElementById('amber-bar');
        if (existing) existing.remove();
        const ref = document.querySelector('.search-box');
        if (!ref) return;
        const bar = document.createElement('div');
        bar.className = 'amber-login-bar';
        bar.id = 'amber-bar';
        bar.innerHTML = `
            <span class="status-dot"></span>
            <span>Conectado vía Amber</span>
            <span class="user-npub">${hex.slice(0,8)}...${hex.slice(-6)}</span>
            <button class="amber-disconnect-btn" id="amber-disconnect">✕</button>
        `;
        ref.parentNode.insertBefore(bar, ref);
        document.getElementById('amber-disconnect').addEventListener('click', () => {
            try { Object.values(SK).forEach(k => sessionStorage.removeItem(k)); } catch {}
            location.reload();
        });
    }

    function addFollowButtons() {
        document.querySelectorAll('.profile-card').forEach(card => {
            if (card.querySelector('.follow-btn-amber')) return;
            if (!userPubkeyHex) return;
            const npub = card.dataset.npub;
            if (!npub) return;
            const hex = npubToHex(npub);
            if (!hex || hex === userPubkeyHex) return;

            const isFollowing = userContacts.has(hex);
            const btn = document.createElement('button');
            btn.className = 'follow-btn-amber' + (isFollowing ? ' following' : '');
            btn.textContent = isFollowing ? '✓ Siguiendo' : 'Follow';
            btn.disabled = isFollowing;
            btn.addEventListener('click', () => followWithAmber(hex, btn));

            const lp = card.querySelector('.profile-link');
            if (lp) { lp.classList.add('profile-actions'); lp.insertBefore(btn, lp.firstChild); }
        });
    }

    function waitForDirectory(cb) {
        const dir = document.getElementById('directory');
        if (!dir) { cb(); return; }
        if (dir.querySelector('.profile-card')) { cb(); return; }
        const obs = new MutationObserver((_, o) => { if (dir.querySelector('.profile-card')) { o.disconnect(); cb(); } });
        obs.observe(dir, { childList: true });
        setTimeout(() => { obs.disconnect(); cb(); }, 5000);
    }

    // ─── Init ────────────────────────────────────────────────
    // CRITICAL: Process callbacks IMMEDIATELY, before any delays
    // Otherwise the pubkey param gets lost on page init
    async function processCallbacksEarly() {
        const url = window.location.href;
        if (url.includes('amber_pubkey=') || url.includes('amber_event=')) {
            console.log('[amber] Detected callback in URL, processing...');
            return await handleAmberReturn();
        }
        return null;
    }

    async function init() {
        // Step 1: Process any Amber callbacks IMMEDIATELY
        const callbackResult = await processCallbacksEarly();

        // Step 2: Restore session
        if (!userPubkeyHex) {
            try { userPubkeyHex = sessionStorage.getItem(SK.PUBKEY); } catch {}
        }

        // Step 3: Wait for NIP-07 detection
        await new Promise(r => setTimeout(r, 700));
        if (hasNip07()) return; // nostr-follow.js handles desktop
        if (!isAndroid()) return;

        console.log('[amber] Android detected, no NIP-07. Activating Amber support.');
        injectStyles();

        // Show toasts from callback results
        if (callbackResult === 'follow_ok') showToast('✓ Follow realizado con éxito');
        else if (callbackResult === 'follow_error') showToast('✗ Error al publicar', true);
        else if (callbackResult === 'error') showToast('✗ Error con firma de Amber', true);

        if (userPubkeyHex) {
            console.log('[amber] Session active:', userPubkeyHex.slice(0, 12) + '...');
            amberReady = true;
            showLoginBar(userPubkeyHex);
            loadCachedContacts();
            waitForDirectory(() => {
                addFollowButtons();
                loadUserContacts().then(() => {
                    document.querySelectorAll('.follow-btn-amber').forEach(b => b.remove());
                    addFollowButtons();
                });
            });
        } else {
            showConnectBar();
        }

        const dir = document.getElementById('directory');
        if (dir) new MutationObserver(() => setTimeout(addFollowButtons, 100)).observe(dir, { childList: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

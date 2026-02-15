/**
 * NostrFácil - Follow/Unfollow Button (NIP-07)
 * Detecta extensiones Nostr (nos2x, Alby, etc.), consulta la contact list
 * del usuario y permite hacer follow/unfollow a perfiles del directorio.
 *
 * Requiere: window.nostr (NIP-07)
 * No modifica nada si no hay extensión instalada.
 */

(function () {
    'use strict';

    // ─── Config ──────────────────────────────────────────────
    // Read relays: amplios para encontrar contact lists
    const READ_RELAYS = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://purplepag.es',
        'wss://relay.nostr.band',
    ];
    // Write relays: incluir los que usa Primal + los más populares
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
    const NIP07_DETECT_DELAY = 600;

    // ─── State ───────────────────────────────────────────────
    let userPubkeyHex = null;
    let userContacts = new Set();
    let userContactEvent = null;
    let nostrReady = false;

    // ─── Bech32 → Hex ────────────────────────────────────────
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

    function bech32Decode(str) {
        str = str.toLowerCase();
        const pos = str.lastIndexOf('1');
        if (pos < 1) return null;
        const dataChars = str.slice(pos + 1);
        const data = [];
        for (let i = 0; i < dataChars.length; i++) {
            const idx = CHARSET.indexOf(dataChars[i]);
            if (idx === -1) return null;
            data.push(idx);
        }
        return { hrp: str.slice(0, pos), data: convertBits(data.slice(0, -6), 5, 8, false) };
    }

    function convertBits(data, fromBits, toBits, pad) {
        let acc = 0, bits = 0;
        const result = [];
        const maxv = (1 << toBits) - 1;
        for (let i = 0; i < data.length; i++) {
            acc = (acc << fromBits) | data[i];
            bits += fromBits;
            while (bits >= toBits) {
                bits -= toBits;
                result.push((acc >> bits) & maxv);
            }
        }
        if (pad && bits > 0) result.push((acc << (toBits - bits)) & maxv);
        return result;
    }

    function npubToHex(npub) {
        try {
            const decoded = bech32Decode(npub);
            if (!decoded || decoded.hrp !== 'npub') return null;
            return decoded.data.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch { return null; }
    }

    // ─── Relay communication ─────────────────────────────────
    function queryRelay(relayUrl, filter) {
        return new Promise((resolve) => {
            let ws;
            const subId = 'nf_' + Math.random().toString(36).slice(2, 8);
            const events = [];
            let settled = false;

            const timeout = setTimeout(() => {
                if (!settled) { settled = true; try { ws.close(); } catch {} resolve(events); }
            }, RELAY_TIMEOUT);

            try { ws = new WebSocket(relayUrl); } catch {
                clearTimeout(timeout); resolve(events); return;
            }

            ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]));
            ws.onmessage = (msg) => {
                try {
                    const data = JSON.parse(msg.data);
                    if (data[0] === 'EVENT' && data[1] === subId) events.push(data[2]);
                    else if (data[0] === 'EOSE') {
                        if (!settled) { settled = true; clearTimeout(timeout); ws.close(); resolve(events); }
                    }
                } catch {}
            };
            ws.onerror = () => {
                if (!settled) { settled = true; clearTimeout(timeout); resolve(events); }
            };
        });
    }

    function publishToRelay(relayUrl, event) {
        return new Promise((resolve) => {
            let ws, settled = false;
            const timeout = setTimeout(() => {
                if (!settled) { settled = true; try { ws.close(); } catch {} resolve({ url: relayUrl, ok: false, msg: 'timeout' }); }
            }, RELAY_TIMEOUT);
            try { ws = new WebSocket(relayUrl); } catch {
                clearTimeout(timeout); resolve({ url: relayUrl, ok: false, msg: 'connect error' }); return;
            }
            ws.onopen = () => {
                console.log('[nostr-follow] Sending EVENT to', relayUrl);
                ws.send(JSON.stringify(['EVENT', event]));
            };
            ws.onmessage = (msg) => {
                try {
                    const data = JSON.parse(msg.data);
                    if (data[0] === 'OK' && !settled) {
                        settled = true; clearTimeout(timeout); ws.close();
                        const result = { url: relayUrl, ok: data[2] === true, msg: data[3] || '' };
                        console.log('[nostr-follow] Relay response:', result);
                        resolve(result);
                    } else if (data[0] === 'NOTICE') {
                        console.warn('[nostr-follow] NOTICE from', relayUrl, ':', data[1]);
                    }
                } catch {}
            };
            ws.onerror = (err) => {
                console.error('[nostr-follow] WS error', relayUrl, err);
                if (!settled) { settled = true; clearTimeout(timeout); resolve({ url: relayUrl, ok: false, msg: 'ws error' }); }
            };
        });
    }

    async function publishToRelays(event) {
        console.log('[nostr-follow] Publishing to', WRITE_RELAYS.length, 'relays...');
        console.log('[nostr-follow] Event:', JSON.stringify(event).slice(0, 200));
        const results = await Promise.all(WRITE_RELAYS.map(url => publishToRelay(url, event)));
        const successCount = results.filter(r => r.ok).length;
        console.log(`[nostr-follow] Published: ${successCount}/${results.length} relays OK`);
        results.forEach(r => {
            if (!r.ok) console.warn('[nostr-follow] FAILED:', r.url, '-', r.msg);
        });
        return results;
    }

    // ─── Contact list ────────────────────────────────────────
    async function fetchContactList(pubkeyHex) {
        const filter = { kinds: [3], authors: [pubkeyHex], limit: 1 };
        const results = await Promise.all(READ_RELAYS.map(url => queryRelay(url, filter)));
        let newest = null;
        for (const events of results) {
            for (const ev of events) {
                if (!newest || ev.created_at > newest.created_at) newest = ev;
            }
        }
        console.log('[nostr-follow] Contact list found:', newest ? `${newest.tags.filter(t=>t[0]==='p').length} follows` : 'none');
        return newest;
    }

    async function loadUserContacts() {
        if (!userPubkeyHex) return;
        const event = await fetchContactList(userPubkeyHex);
        if (event) {
            userContactEvent = event;
            userContacts = new Set(
                event.tags.filter(t => t[0] === 'p').map(t => t[1])
            );
        }
    }

    // ─── Follow / Unfollow ───────────────────────────────────
    async function followUser(targetHex, button) {
        if (!window.nostr || !userPubkeyHex) return;

        button.disabled = true;
        button.textContent = '⏳';

        try {
            let tags = [];
            if (userContactEvent && userContactEvent.tags) {
                tags = [...userContactEvent.tags];
            }

            if (tags.some(t => t[0] === 'p' && t[1] === targetHex)) {
                button.textContent = '✓ Siguiendo';
                button.classList.add('following');
                return;
            }

            tags.push(['p', targetHex]);

            const event = {
                kind: 3,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags,
                content: userContactEvent ? userContactEvent.content : '',
            };

            console.log('[nostr-follow] Signing follow event with', tags.length, 'tags');
            const signed = await window.nostr.signEvent(event);

            if (!signed || !signed.sig) {
                throw new Error('Firma rechazada o inválida');
            }
            console.log('[nostr-follow] Event signed. ID:', signed.id);

            const results = await publishToRelays(signed);
            const success = results.some(r => r.ok === true);

            if (success) {
                userContacts.add(targetHex);
                userContactEvent = signed;
                button.textContent = '✓ Siguiendo';
                button.classList.add('following');
                button.disabled = false; // allow unfollow click
            } else {
                console.error('[nostr-follow] ALL relays failed');
                button.textContent = '✗ Error';
                setTimeout(() => { button.textContent = 'Follow'; button.disabled = false; }, 2000);
            }
        } catch (err) {
            console.error('[nostr-follow] Follow error:', err);
            button.textContent = 'Follow';
            button.disabled = false;
        }
    }

    async function unfollowUser(targetHex, button) {
        if (!window.nostr || !userPubkeyHex) return;

        button.disabled = true;
        button.textContent = '⏳';

        try {
            let tags = [];
            if (userContactEvent && userContactEvent.tags) {
                tags = userContactEvent.tags.filter(t => !(t[0] === 'p' && t[1] === targetHex));
            }

            const event = {
                kind: 3,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags,
                content: userContactEvent ? userContactEvent.content : '',
            };

            console.log('[nostr-follow] Signing unfollow event with', tags.length, 'tags');
            const signed = await window.nostr.signEvent(event);

            if (!signed || !signed.sig) {
                throw new Error('Firma rechazada');
            }

            const results = await publishToRelays(signed);
            const success = results.some(r => r.ok === true);

            if (success) {
                userContacts.delete(targetHex);
                userContactEvent = signed;
                button.textContent = 'Follow';
                button.classList.remove('following');
                button.disabled = false;
            } else {
                button.textContent = '✓ Siguiendo';
                button.disabled = false;
                console.error('[nostr-follow] Unfollow failed on all relays');
            }
        } catch (err) {
            console.error('[nostr-follow] Unfollow error:', err);
            button.textContent = '✓ Siguiendo';
            button.disabled = false;
        }
    }

    function handleFollowClick(hex, button) {
        if (button.classList.contains('following')) {
            unfollowUser(hex, button);
        } else {
            followUser(hex, button);
        }
    }

    // ─── UI ──────────────────────────────────────────────────
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .follow-btn {
                padding: 0.45rem 0.85rem;
                border: 1px solid var(--accent);
                background: var(--accent);
                color: #fff;
                border-radius: 8px;
                font-family: inherit;
                font-size: 0.78rem;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s, opacity 0.2s;
                white-space: nowrap;
            }
            .follow-btn:hover:not(:disabled) { background: var(--accent-hover); }
            .follow-btn:disabled { cursor: default; opacity: 0.6; }
            .follow-btn.following {
                background: transparent;
                color: var(--success);
                border-color: var(--success);
                opacity: 1;
                cursor: pointer;
            }
            .follow-btn.following:hover {
                color: #f87171;
                border-color: #f87171;
            }
            .nostr-login-bar {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.75rem;
                padding: 0.75rem 1rem;
                margin-bottom: 1.5rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: 10px;
                font-size: 0.85rem;
                color: var(--text-secondary);
            }
            .nostr-login-bar .status-dot {
                width: 8px; height: 8px; border-radius: 50%;
                background: var(--success); flex-shrink: 0;
            }
            .nostr-login-bar .user-npub {
                font-family: monospace; font-size: 0.75rem; color: var(--text-secondary);
            }
        `;
        document.head.appendChild(style);
    }

    function showLoginBar(pubkeyHex) {
        const container = document.querySelector('.search-box');
        if (!container) return;
        const npubShort = pubkeyHex.slice(0, 8) + '...' + pubkeyHex.slice(-6);
        const bar = document.createElement('div');
        bar.className = 'nostr-login-bar';
        bar.innerHTML = `
            <span class="status-dot"></span>
            <span>Conectado vía extensión Nostr</span>
            <span class="user-npub">${npubShort}</span>
        `;
        container.parentNode.insertBefore(bar, container);
    }

    function addFollowButtons() {
        const cards = document.querySelectorAll('.profile-card');

        cards.forEach(card => {
            if (card.querySelector('.follow-btn')) return;

            const npub = card.dataset.npub;
            if (!npub) return;

            const hex = npubToHex(npub);
            if (!hex || hex === userPubkeyHex) return;

            const isFollowing = userContacts.has(hex);

            const btn = document.createElement('button');
            btn.className = 'follow-btn' + (isFollowing ? ' following' : '');
            btn.textContent = isFollowing ? '✓ Siguiendo' : 'Follow';
            btn.dataset.hex = hex;
            btn.addEventListener('click', () => handleFollowClick(hex, btn));

            const linkParent = card.querySelector('.profile-link');
            if (linkParent) {
                linkParent.classList.add('profile-actions');
                linkParent.insertBefore(btn, linkParent.firstChild);
            }
        });
    }

    // ─── Init ────────────────────────────────────────────────
    async function init() {
        await new Promise(r => setTimeout(r, NIP07_DETECT_DELAY));
        if (!window.nostr) return;

        injectStyles();

        try {
            userPubkeyHex = await window.nostr.getPublicKey();
        } catch {
            return;
        }

        if (!userPubkeyHex) return;

        nostrReady = true;
        showLoginBar(userPubkeyHex);

        await loadUserContacts();
        waitForDirectory(addFollowButtons);
        observeDirectory();
    }

    function waitForDirectory(callback) {
        const dir = document.getElementById('directory');
        if (!dir) { callback(); return; }
        if (dir.querySelector('.profile-card')) { callback(); return; }
        const obs = new MutationObserver((m, observer) => {
            if (dir.querySelector('.profile-card')) { observer.disconnect(); callback(); }
        });
        obs.observe(dir, { childList: true });
        setTimeout(() => { obs.disconnect(); callback(); }, 5000);
    }

    function observeDirectory() {
        const observer = new MutationObserver(() => setTimeout(addFollowButtons, 50));
        const directory = document.getElementById('directory');
        if (directory) observer.observe(directory, { childList: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

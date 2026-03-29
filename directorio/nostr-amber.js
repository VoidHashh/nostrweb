/**
 * NostrFacil - Amber Follow (NIP-55) v6
 * Uses nostrsigner: deep links on Android browsers and processes callbacks
 * before any delayed provider detection.
 */

(function () {
    'use strict';

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
    const STORAGE_AREAS = [];

    try { STORAGE_AREAS.push(window.sessionStorage); } catch {}
    try { STORAGE_AREAS.push(window.localStorage); } catch {}

    let userPubkeyHex = null;
    let userContacts = new Set();
    let userContactEvent = null;

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
        let acc = 0;
        let bits = 0;
        const result = [];
        const maxv = (1 << to) - 1;

        for (const value of data) {
            acc = (acc << from) | value;
            bits += from;
            while (bits >= to) {
                bits -= to;
                result.push((acc >> bits) & maxv);
            }
        }

        if (pad && bits > 0) result.push((acc << (to - bits)) & maxv);
        return result;
    }

    function npubToHex(npub) {
        try {
            const decoded = bech32Decode(npub);
            if (!decoded || decoded.hrp !== 'npub') return null;
            return decoded.data.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {
            return null;
        }
    }

    function getStoredValue(key) {
        for (const area of STORAGE_AREAS) {
            try {
                const value = area.getItem(key);
                if (value !== null && value !== undefined) return value;
            } catch {}
        }
        return null;
    }

    function setStoredValue(key, value) {
        for (const area of STORAGE_AREAS) {
            try { area.setItem(key, value); } catch {}
        }
    }

    function removeStoredValue(key) {
        for (const area of STORAGE_AREAS) {
            try { area.removeItem(key); } catch {}
        }
    }

    function clearStoredKeys(keys) {
        keys.forEach(removeStoredValue);
    }

    function safeDecode(value) {
        try { return decodeURIComponent(value); } catch { return value; }
    }

    function getDecodeCandidates(value) {
        if (typeof value !== 'string') return [];

        const candidates = [];
        let current = value;

        for (let i = 0; i < 3; i++) {
            if (!current || candidates.includes(current)) break;
            candidates.push(current);
            const decoded = safeDecode(current);
            if (decoded === current) break;
            current = decoded;
        }

        return candidates;
    }

    function safeJsonParse(value) {
        if (typeof value !== 'string') return null;
        try { return JSON.parse(value); } catch { return null; }
    }

    function normalizeHexPubkey(value) {
        if (typeof value !== 'string') return null;
        const clean = value.trim().replace(/^0x/i, '').replace(/[^a-f0-9]/gi, '');
        return clean.length === 64 ? clean.toLowerCase() : null;
    }

    function extractPubkeyHex(value) {
        if (!value) return null;

        if (typeof value === 'string') {
            for (const candidate of getDecodeCandidates(value)) {
                const trimmed = candidate.trim();

                const hex = normalizeHexPubkey(trimmed);
                if (hex) return hex;

                const npubMatch = trimmed.match(/npub1[023456789acdefghjklmnpqrstuvwxyz]+/i);
                if (npubMatch) {
                    const converted = npubToHex(npubMatch[0]);
                    if (converted) return converted;
                }

                const parsed = safeJsonParse(trimmed);
                if (parsed) {
                    const nested = extractPubkeyHex(parsed);
                    if (nested) return nested;
                }
            }

            return null;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const nested = extractPubkeyHex(item);
                if (nested) return nested;
            }
            return null;
        }

        if (typeof value === 'object') {
            const fields = ['pubkey', 'npub', 'signature', 'result', 'data', 'value'];
            for (const field of fields) {
                const nested = extractPubkeyHex(value[field]);
                if (nested) return nested;
            }
            for (const nestedValue of Object.values(value)) {
                const nested = extractPubkeyHex(nestedValue);
                if (nested) return nested;
            }
        }

        return null;
    }

    function looksLikeSignedEvent(value) {
        return !!value &&
            typeof value === 'object' &&
            typeof value.sig === 'string' &&
            typeof value.pubkey === 'string' &&
            typeof value.kind !== 'undefined';
    }

    function extractSignedEvent(value) {
        if (!value) return null;

        if (typeof value === 'string') {
            for (const candidate of getDecodeCandidates(value)) {
                const parsed = safeJsonParse(candidate.trim());
                if (parsed) {
                    const nested = extractSignedEvent(parsed);
                    if (nested) return nested;
                }
            }
            return null;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const nested = extractSignedEvent(item);
                if (nested) return nested;
            }
            return null;
        }

        if (typeof value === 'object') {
            if (looksLikeSignedEvent(value)) return value;

            const fields = ['event', 'signedEvent', 'result', 'data', 'value'];
            for (const field of fields) {
                const nested = extractSignedEvent(value[field]);
                if (nested) return nested;
            }
            for (const nestedValue of Object.values(value)) {
                const nested = extractSignedEvent(nestedValue);
                if (nested) return nested;
            }
        }

        return null;
    }

    async function extractSignedEventFromSignerPayload(raw) {
        if (typeof raw !== 'string' || !raw.startsWith('Signer1')) return null;

        try {
            const bytes = Uint8Array.from(atob(raw.slice(7)), c => c.charCodeAt(0));
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            const text = await new Response(stream).text();
            return extractSignedEvent(text);
        } catch (error) {
            console.error('[amber] gzip parse fail:', error);
            return null;
        }
    }

    function getCallbackValue(name) {
        try {
            const url = new URL(window.location.href);
            const sources = [url.searchParams];
            const hash = url.hash.startsWith('#') ? url.hash.slice(1) : '';
            if (hash.includes('=')) sources.push(new URLSearchParams(hash));

            for (const params of sources) {
                const value = params.get(name);
                if (value !== null && value !== '') return value;
            }
        } catch {}

        const match = window.location.href.match(new RegExp(`[?#&]${name}=([^&#]+)`));
        return match ? match[1] : null;
    }

    function clearCallbackUrl() {
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', CALLBACK_BASE);
        }
    }

    function isAndroid() {
        return /android/i.test(navigator.userAgent);
    }

    function hasNip07() {
        return typeof window.nostr !== 'undefined' && window.nostr !== null;
    }

    function queryRelay(url, filter) {
        return new Promise(resolve => {
            const subId = 'ab_' + Math.random().toString(36).slice(2, 8);
            const events = [];
            let settled = false;
            let ws;

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { ws.close(); } catch {}
                    resolve(events);
                }
            }, RELAY_TIMEOUT);

            try {
                ws = new WebSocket(url);
            } catch {
                clearTimeout(timeout);
                resolve(events);
                return;
            }

            ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]));
            ws.onmessage = message => {
                try {
                    const data = JSON.parse(message.data);
                    if (data[0] === 'EVENT' && data[1] === subId) {
                        events.push(data[2]);
                    } else if (data[0] === 'EOSE' && !settled) {
                        settled = true;
                        clearTimeout(timeout);
                        ws.close();
                        resolve(events);
                    }
                } catch {}
            };
            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve(events);
                }
            };
        });
    }

    function publishToRelay(url, event) {
        return new Promise(resolve => {
            let ws;
            let settled = false;

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { ws.close(); } catch {}
                    resolve({ url, ok: false, msg: 'timeout' });
                }
            }, RELAY_TIMEOUT);

            try {
                ws = new WebSocket(url);
            } catch {
                clearTimeout(timeout);
                resolve({ url, ok: false, msg: 'connect error' });
                return;
            }

            ws.onopen = () => {
                console.log('[amber] Sending EVENT to', url);
                ws.send(JSON.stringify(['EVENT', event]));
            };

            ws.onmessage = message => {
                try {
                    const data = JSON.parse(message.data);
                    if (data[0] === 'OK' && !settled) {
                        settled = true;
                        clearTimeout(timeout);
                        ws.close();
                        const result = { url, ok: data[2] === true, msg: data[3] || '' };
                        console.log('[amber] Relay response:', result);
                        resolve(result);
                    }
                } catch {}
            };

            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve({ url, ok: false, msg: 'ws error' });
                }
            };
        });
    }

    async function publishToRelays(event) {
        console.log('[amber] Publishing to', WRITE_RELAYS.length, 'relays');
        const results = await Promise.all(WRITE_RELAYS.map(url => publishToRelay(url, event)));
        console.log('[amber] Results:', results.filter(result => result.ok).length + '/' + results.length, 'OK');
        return results;
    }

    async function fetchContactList(hex) {
        const results = await Promise.all(READ_RELAYS.map(url => queryRelay(url, { kinds: [3], authors: [hex], limit: 1 })));
        let newest = null;

        for (const events of results) {
            for (const event of events) {
                if (!newest || event.created_at > newest.created_at) newest = event;
            }
        }

        return newest;
    }

    async function loadUserContacts() {
        if (!userPubkeyHex) return;

        const event = await fetchContactList(userPubkeyHex);
        if (event) {
            userContactEvent = event;
            userContacts = new Set(event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));
            setStoredValue(SK.CONTACTS, JSON.stringify([...userContacts]));
            setStoredValue(SK.CONTACT_EVENT, JSON.stringify(event));
        }
    }

    function loadCachedContacts() {
        try {
            const contacts = getStoredValue(SK.CONTACTS);
            const event = getStoredValue(SK.CONTACT_EVENT);
            if (contacts) userContacts = new Set(JSON.parse(contacts));
            if (event) userContactEvent = JSON.parse(event);
            return contacts !== null;
        } catch {
            return false;
        }
    }

    function buildPublicKeyRequestUrl() {
        const callbackUrl = encodeURIComponent(CALLBACK_BASE + '?amber_pubkey=');
        return `nostrsigner:?compressionType=none&returnType=signature&type=get_public_key&callbackUrl=${callbackUrl}`;
    }

    function buildSignEventRequestUrl(eventJson) {
        const encodedEvent = encodeURIComponent(eventJson);
        const callbackUrl = encodeURIComponent(CALLBACK_BASE + '?amber_event=');
        return `nostrsigner:${encodedEvent}?compressionType=none&returnType=event&type=sign_event&callbackUrl=${callbackUrl}`;
    }

    function launchAmber(url) {
        const link = document.createElement('a');
        link.href = url;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 100);
    }

    function requestAmberPublicKey() {
        window.__NOSTRFACIL_PREFER_AMBER__ = true;
        launchAmber(buildPublicKeyRequestUrl());
    }

    function requestAmberSignEvent(eventJson, targetHex) {
        setStoredValue(SK.PENDING, targetHex);
        window.__NOSTRFACIL_PREFER_AMBER__ = true;
        launchAmber(buildSignEventRequestUrl(eventJson));
    }

    function buildFollowEvent(targetHex) {
        const tags = userContactEvent && userContactEvent.tags ? [...userContactEvent.tags] : [];
        if (tags.some(tag => tag[0] === 'p' && tag[1] === targetHex)) return null;

        tags.push(['p', targetHex]);

        return JSON.stringify({
            kind: 3,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: userContactEvent ? userContactEvent.content : '',
        });
    }

    function followWithAmber(hex, button) {
        const eventJson = buildFollowEvent(hex);
        if (!eventJson) {
            button.textContent = 'Siguiendo';
            button.classList.add('following');
            button.disabled = true;
            return;
        }

        button.textContent = '...';
        button.disabled = true;
        setTimeout(() => requestAmberSignEvent(eventJson, hex), 100);
    }

    async function handleAmberReturn() {
        const rawPubkey = getCallbackValue('amber_pubkey');
        if (rawPubkey !== null) {
            clearCallbackUrl();
            const pubkey = extractPubkeyHex(rawPubkey);
            console.log('[amber] Pubkey payload received:', rawPubkey);

            if (!pubkey) {
                console.error('[amber] Could not parse pubkey callback:', rawPubkey);
                return 'pubkey_error';
            }

            userPubkeyHex = pubkey;
            setStoredValue(SK.PUBKEY, pubkey);
            return 'pubkey';
        }

        const rawEvent = getCallbackValue('amber_event');
        if (rawEvent !== null) {
            clearCallbackUrl();

            let signed = extractSignedEvent(rawEvent);
            if (!signed) signed = await extractSignedEventFromSignerPayload(rawEvent);

            if (!signed || !signed.sig) {
                console.error('[amber] Cannot parse signed event callback:', rawEvent);
                removeStoredValue(SK.PENDING);
                return 'error';
            }

            console.log('[amber] Publishing signed event ID:', signed.id);
            const results = await publishToRelays(signed);
            const ok = results.some(result => result.ok);

            const pendingHex = getStoredValue(SK.PENDING);
            if (ok && pendingHex) {
                userContacts.add(pendingHex);
                userContactEvent = signed;
                setStoredValue(SK.CONTACTS, JSON.stringify([...userContacts]));
                setStoredValue(SK.CONTACT_EVENT, JSON.stringify(signed));
            }

            removeStoredValue(SK.PENDING);
            return ok ? 'follow_ok' : 'follow_error';
        }

        return null;
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
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
        document.head.appendChild(style);
    }

    function showToast(message, isError) {
        const toast = document.createElement('div');
        toast.className = 'amber-toast' + (isError ? ' error' : '');
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function showConnectBar() {
        const reference = document.querySelector('.search-box');
        if (!reference || document.getElementById('amber-bar')) return;

        const bar = document.createElement('div');
        bar.className = 'amber-connect-bar';
        bar.id = 'amber-bar';

        const label = document.createElement('span');
        label.textContent = 'Tienes Amber?';

        const button = document.createElement('a');
        button.className = 'amber-connect-btn';
        button.textContent = 'Conectar con Amber';
        button.href = buildPublicKeyRequestUrl();
        button.addEventListener('click', () => {
            window.__NOSTRFACIL_PREFER_AMBER__ = true;
        });

        bar.appendChild(label);
        bar.appendChild(button);
        reference.parentNode.insertBefore(bar, reference);
    }

    function showLoginBar(hex) {
        const existing = document.getElementById('amber-bar');
        if (existing) existing.remove();

        const reference = document.querySelector('.search-box');
        if (!reference) return;

        const bar = document.createElement('div');
        bar.className = 'amber-login-bar';
        bar.id = 'amber-bar';
        bar.innerHTML = `
            <span class="status-dot"></span>
            <span>Conectado via Amber</span>
            <span class="user-npub">${hex.slice(0, 8)}...${hex.slice(-6)}</span>
            <button class="amber-disconnect-btn" id="amber-disconnect">x</button>
        `;
        reference.parentNode.insertBefore(bar, reference);

        document.getElementById('amber-disconnect').addEventListener('click', () => {
            clearStoredKeys(Object.values(SK));
            window.__NOSTRFACIL_PREFER_AMBER__ = false;
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
            const button = document.createElement('button');
            button.className = 'follow-btn-amber' + (isFollowing ? ' following' : '');
            button.textContent = isFollowing ? 'Siguiendo' : 'Follow';
            button.disabled = isFollowing;
            button.addEventListener('click', () => followWithAmber(hex, button));

            const linkParent = card.querySelector('.profile-link');
            if (linkParent) {
                linkParent.classList.add('profile-actions');
                linkParent.insertBefore(button, linkParent.firstChild);
            }
        });
    }

    function waitForDirectory(callback) {
        const directory = document.getElementById('directory');
        if (!directory) {
            callback();
            return;
        }

        if (directory.querySelector('.profile-card')) {
            callback();
            return;
        }

        const observer = new MutationObserver((_, currentObserver) => {
            if (directory.querySelector('.profile-card')) {
                currentObserver.disconnect();
                callback();
            }
        });
        observer.observe(directory, { childList: true });
        setTimeout(() => {
            observer.disconnect();
            callback();
        }, 5000);
    }

    async function processCallbacksEarly() {
        if (getCallbackValue('amber_pubkey') !== null || getCallbackValue('amber_event') !== null) {
            console.log('[amber] Detected callback in URL, processing...');
            window.__NOSTRFACIL_PREFER_AMBER__ = true;
            return await handleAmberReturn();
        }
        return null;
    }

    async function init() {
        const callbackResult = await processCallbacksEarly();

        if (!userPubkeyHex) {
            userPubkeyHex = getStoredValue(SK.PUBKEY);
        }

        const hasAmberSession = !!userPubkeyHex;
        if (callbackResult !== null || (hasAmberSession && isAndroid())) {
            window.__NOSTRFACIL_PREFER_AMBER__ = true;
        }

        await new Promise(resolve => setTimeout(resolve, 700));

        if (callbackResult === null && !hasAmberSession) {
            if (hasNip07()) return;
            if (!isAndroid()) return;
        }

        injectStyles();

        if (callbackResult === 'follow_ok') showToast('Follow realizado con exito');
        else if (callbackResult === 'follow_error') showToast('No se pudo publicar el follow', true);
        else if (callbackResult === 'pubkey_error') showToast('Amber volvio pero no pudimos leer la autorizacion', true);
        else if (callbackResult === 'error') showToast('No se pudo leer el evento firmado de Amber', true);

        if (userPubkeyHex) {
            window.__NOSTRFACIL_PREFER_AMBER__ = true;
            showLoginBar(userPubkeyHex);
            loadCachedContacts();
            waitForDirectory(() => {
                addFollowButtons();
                loadUserContacts().then(() => {
                    document.querySelectorAll('.follow-btn-amber').forEach(button => button.remove());
                    addFollowButtons();
                });
            });
        } else {
            showConnectBar();
        }

        const directory = document.getElementById('directory');
        if (directory) {
            new MutationObserver(() => setTimeout(addFollowButtons, 100)).observe(directory, { childList: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

/**
 * Anti-cheat client + helper per validazione e audit.
 * Nota: la protezione reale richiede anche firestore.rules (campi protetti).
 */
(function (global) {
    const SESSION_KEY = 'unoAntiCheatSession';
    const RATE_KEY = 'unoAntiCheatRates';

    const RATE_LIMITS = {
        'auth.login': { max: 12, windowMs: 60_000 },
        'lobby.create': { max: 6, windowMs: 60_000 },
        'lobby.join': { max: 10, windowMs: 60_000 },
        'lobby.leave': { max: 12, windowMs: 60_000 },
        'profile.nickname': { max: 5, windowMs: 300_000 },
        'profile.avatar': { max: 8, windowMs: 300_000 },
        'lobby.heartbeat': { max: 120, windowMs: 60_000 }
    };

    const PROTECTED_USER_FIELDS = new Set([
        'xp', 'livello', 'carteSbloccate', 'partiteGiocate', 'vittorie', 'uid', 'email'
    ]);

    const SEVERITY = {
        low: 'low',
        medium: 'medium',
        high: 'high'
    };

    function getSessionId() {
        try {
            let id = sessionStorage.getItem(SESSION_KEY);
            if (!id) {
                id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
                sessionStorage.setItem(SESSION_KEY, id);
            }
            return id;
        } catch {
            return `sess_${Date.now()}`;
        }
    }

    function readRateBuckets() {
        try {
            return JSON.parse(sessionStorage.getItem(RATE_KEY) || '{}');
        } catch {
            return {};
        }
    }

    function writeRateBuckets(buckets) {
        try {
            sessionStorage.setItem(RATE_KEY, JSON.stringify(buckets));
        } catch {
            /* ignore */
        }
    }

    function checkRateLimit(actionKey) {
        const rule = RATE_LIMITS[actionKey];
        if (!rule) return { allowed: true };

        const now = Date.now();
        const buckets = readRateBuckets();
        const bucket = buckets[actionKey] || { count: 0, resetAt: now + rule.windowMs };

        if (now > bucket.resetAt) {
            bucket.count = 0;
            bucket.resetAt = now + rule.windowMs;
        }

        bucket.count += 1;
        buckets[actionKey] = bucket;
        writeRateBuckets(buckets);

        if (bucket.count > rule.max) {
            return {
                allowed: false,
                reason: `rate_limit:${actionKey}`,
                retryAfterMs: bucket.resetAt - now
            };
        }

        return { allowed: true, remaining: rule.max - bucket.count };
    }

    function normalizzaNick(nickname) {
        return String(nickname || '').trim().toLowerCase();
    }

    function validateProtectedUserPatch(patch) {
        const keys = Object.keys(patch || {});
        const illegal = keys.filter(k => PROTECTED_USER_FIELDS.has(k));
        if (illegal.length) {
            return { valid: false, reason: `campi_protetti:${illegal.join(',')}` };
        }
        return { valid: true };
    }

    function validateLobbyJoin({ lobby, uid, nickname, forceAdmin }) {
        if (!lobby || !uid || !nickname) {
            return { valid: false, reason: 'dati_lobby_mancanti' };
        }

        const players = Array.isArray(lobby.players) ? lobby.players : [];
        const nickNorm = normalizzaNick(nickname);
        const maxPlayers = parseInt(lobby.maxPlayers, 10) || 15;

        if (!forceAdmin && players.length >= maxPlayers) {
            return { valid: false, reason: 'lobby_piena' };
        }

        const duplicato = players.some(p =>
            (p.uid && p.uid === uid) || normalizzaNick(p.nickname) === nickNorm
        );
        if (duplicato) {
            return { valid: true, alreadyIn: true };
        }

        if (String(lobby.status || 'waiting').toLowerCase() !== 'waiting') {
            return { valid: false, reason: 'lobby_non_disponibile' };
        }

        return { valid: true };
    }

    function validateLobbyLeave({ lobby, uid, nickname }) {
        const players = Array.isArray(lobby?.players) ? lobby.players : [];
        const index = players.findIndex(p =>
            (p.uid && p.uid === uid) || normalizzaNick(p.nickname) === normalizzaNick(nickname)
        );
        if (index === -1) {
            return { valid: false, reason: 'giocatore_non_in_lobby' };
        }
        return { valid: true, playerIndex: index, wasHost: players[index]?.role === 'host' };
    }

    function detectLobbySnapshotAnomaly({ prevLobby, nextLobby, selfUid, selfNick }) {
        if (!prevLobby || !nextLobby) return null;

        const prevPlayers = prevLobby.players || [];
        const nextPlayers = nextLobby.players || [];
        const nickNorm = normalizzaNick(selfNick);

        const selfBefore = prevPlayers.find(p =>
            (p.uid && p.uid === selfUid) || normalizzaNick(p.nickname) === nickNorm
        );
        const selfAfter = nextPlayers.find(p =>
            (p.uid && p.uid === selfUid) || normalizzaNick(p.nickname) === nickNorm
        );

        if (selfBefore && !selfAfter && nextPlayers.length > 0) {
            return { type: 'kicked_without_consent', severity: SEVERITY.medium };
        }

        if (selfAfter?.role === 'host' && selfBefore?.role !== 'host' && prevLobby.owner !== selfNick) {
            const forcedHost = nextLobby.owner === selfAfter.nickname;
            if (forcedHost) return null;
            return { type: 'host_promotion_unexpected', severity: SEVERITY.low };
        }

        const countJump = Math.abs(nextPlayers.length - prevPlayers.length);
        if (countJump > 2) {
            return { type: 'player_count_spike', severity: SEVERITY.high, delta: countJump };
        }

        return null;
    }

    async function logSecurityEvent(firebase, payload) {
        const { db, collection, addDoc } = firebase || {};
        if (!db || !collection || !addDoc) return;

        const uid = payload.uid || firebase.currentUid;
        if (!uid) return;

        try {
            await addDoc(collection(db, 'security_events'), {
                uid,
                nickname: payload.nickname || 'Giocatore',
                type: payload.type || 'unknown',
                severity: payload.severity || SEVERITY.low,
                message: payload.message || '',
                metadata: payload.metadata || {},
                sessionId: getSessionId(),
                page: payload.page || global.location?.pathname || '',
                userAgent: navigator.userAgent?.slice(0, 200) || '',
                createdAt: new Date().toISOString()
            });
        } catch (error) {
            console.warn('[AntiCheat] Log evento fallito:', error);
        }
    }

    async function guardAction(actionKey, firebase, meta, callback) {
        const rate = checkRateLimit(actionKey);
        if (!rate.allowed) {
            await logSecurityEvent(firebase, {
                uid: firebase?.currentUid,
                nickname: meta?.nickname,
                type: 'rate_limit',
                severity: SEVERITY.medium,
                message: `Rate limit superato: ${actionKey}`,
                metadata: { actionKey, ...meta },
                page: meta?.page
            });
            throw new Error('Troppe azioni in poco tempo. Riprova tra qualche secondo.');
        }

        return callback();
    }

    let heartbeatTimer = null;
    let lastLobbySnapshot = null;

    function trackLobbySnapshot(lobby, context) {
        const anomaly = detectLobbySnapshotAnomaly({
            prevLobby: lastLobbySnapshot,
            nextLobby: lobby,
            selfUid: context?.uid,
            selfNick: context?.nickname
        });
        lastLobbySnapshot = lobby ? JSON.parse(JSON.stringify(lobby)) : null;

        if (anomaly && context?.firebase) {
            logSecurityEvent(context.firebase, {
                uid: context.uid,
                nickname: context.nickname,
                type: anomaly.type,
                severity: anomaly.severity,
                message: `Anomalia lobby rilevata: ${anomaly.type}`,
                metadata: { lobbyId: lobby?.id, ...anomaly },
                page: context.page
            });
        }
    }

    function startLobbyHeartbeat({ db, doc, setDoc, lobbyId, uid, nickname }) {
        stopLobbyHeartbeat();
        if (!db || !doc || !setDoc || !lobbyId || !uid) return;

        const tick = async () => {
            const rate = checkRateLimit('lobby.heartbeat');
            if (!rate.allowed) return;

            try {
                await setDoc(doc(db, 'lobbies', lobbyId, 'presence', uid), {
                    uid,
                    nickname: nickname || 'Giocatore',
                    sessionId: getSessionId(),
                    lastSeen: new Date().toISOString()
                }, { merge: true });
            } catch (error) {
                console.warn('[AntiCheat] Heartbeat fallito:', error);
            }
        };

        tick();
        heartbeatTimer = setInterval(tick, 25_000);
    }

    function stopLobbyHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        lastLobbySnapshot = null;
    }

    function buildFirebaseContext() {
        return {
            db: global.db,
            doc: global.doc,
            collection: global.collection,
            addDoc: global.addDoc,
            setDoc: global.setDoc,
            currentUid: global.currentUserUid
        };
    }

    global.AntiCheat = {
        getSessionId,
        checkRateLimit,
        validateProtectedUserPatch,
        validateLobbyJoin,
        validateLobbyLeave,
        detectLobbySnapshotAnomaly,
        logSecurityEvent,
        guardAction,
        trackLobbySnapshot,
        startLobbyHeartbeat,
        stopLobbyHeartbeat,
        buildFirebaseContext,
        PROTECTED_USER_FIELDS,
        SEVERITY
    };
})(window);

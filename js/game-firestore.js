(function (global) {
    const Engine = global.GameEngine;

    const writeQueues = new Map();
    const MAX_LOG_ENTRIES = 80;
    const MAX_RETRIES = 4;

    class SaveConflictError extends Error {
        constructor(serverState) {
            super('CONFLICT');
            this.name = 'SaveConflictError';
            this.serverState = serverState;
        }
    }

    async function waitForFirebase(maxMs = 12000) {
        const start = Date.now();
        while (Date.now() - start < maxMs) {
            if (global.db && global.doc && global.setDoc && global.getDoc && global.updateDoc && global.runTransaction) {
                return true;
            }
            await new Promise(r => setTimeout(r, 80));
        }
        return false;
    }

    function gameRef(lobbyId) {
        return global.doc(global.db, 'games', lobbyId);
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function isRetryableFirestoreError(err) {
        const code = String(err?.code || '');
        return code === 'unavailable'
            || code === 'deadline-exceeded'
            || code === 'resource-exhausted'
            || code === 'aborted'
            || code === 'internal';
    }

    function sanitizeValue(value) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) {
            return value
                .map(sanitizeValue)
                .filter(v => v !== undefined);
        }
        if (typeof value === 'object') {
            const out = {};
            Object.keys(value).forEach(key => {
                const v = sanitizeValue(value[key]);
                if (v !== undefined) out[key] = v;
            });
            return out;
        }
        return value;
    }

    function prepareGamePayload(state) {
        const copy = Engine.stripForFirestore(state);
        if (Array.isArray(copy.log) && copy.log.length > MAX_LOG_ENTRIES) {
            copy.log = copy.log.slice(-MAX_LOG_ENTRIES);
        }
        const payload = sanitizeValue(copy);
        payload.updatedAt = new Date().toISOString();
        return payload;
    }

    function enqueueWrite(lobbyId, task) {
        const prev = writeQueues.get(lobbyId) || Promise.resolve();
        const run = prev
            .catch(() => {})
            .then(task);
        writeQueues.set(lobbyId, run);
        return run.finally(() => {
            if (writeQueues.get(lobbyId) === run) {
                writeQueues.delete(lobbyId);
            }
        });
    }

    async function persistStateOnce(lobbyId, state, expectedVersion) {
        const ref = gameRef(lobbyId);
        const payload = prepareGamePayload(state);

        await global.runTransaction(global.db, async transaction => {
            const snap = await transaction.get(ref);
            const serverVersion = snap.exists() ? (snap.data().version || 0) : 0;

            if (expectedVersion != null && serverVersion !== expectedVersion) {
                throw new SaveConflictError(snap.exists() ? snap.data() : null);
            }

            payload.version = serverVersion + 1;
            transaction.set(ref, payload);
        });

        return payload.version;
    }

    async function persistState(lobbyId, state, expectedVersion) {
        return enqueueWrite(lobbyId, async () => {
            let lastErr = null;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
                try {
                    return await persistStateOnce(lobbyId, state, expectedVersion);
                } catch (err) {
                    lastErr = err;
                    if (err instanceof SaveConflictError) throw err;
                    if (!isRetryableFirestoreError(err) || attempt >= MAX_RETRIES - 1) throw err;
                    await sleep(200 * (attempt + 1));
                }
            }
            throw lastErr;
        });
    }

    async function fetchGameState(lobbyId) {
        const snap = await global.getDoc(gameRef(lobbyId));
        return snap.exists() ? snap.data() : null;
    }

    function mapPersistError(err) {
        if (err instanceof SaveConflictError) {
            return 'La partita si è aggiornata da un altro giocatore. Riprova.';
        }
        const code = String(err?.code || '');
        if (code === 'permission-denied') {
            return 'Permesso negato. Ricarica la pagina o rientra in lobby.';
        }
        if (code === 'unauthenticated') {
            return 'Sessione scaduta. Ricarica la pagina.';
        }
        if (code === 'unavailable' || code === 'deadline-exceeded') {
            return 'Connessione instabile. Riprova.';
        }
        if (code === 'resource-exhausted') {
            return 'Dati partita troppo grandi. Avvisa l\'host.';
        }
        return 'Salvataggio non riuscito. Riprova.';
    }

    async function createGameFromLobby(lobby) {
        const state = Engine.createInitialState(lobby);
        const payload = prepareGamePayload(state);
        payload.version = 1;
        await global.setDoc(gameRef(lobby.id), payload);

        await global.updateDoc(global.doc(global.db, 'lobbies', lobby.id), {
            status: 'playing',
            gameStartedAt: new Date().toISOString()
        });

        return { ...state, version: 1 };
    }

    async function returnLobbyToWaiting(lobbyId) {
        await global.updateDoc(global.doc(global.db, 'lobbies', lobbyId), {
            status: 'waiting',
            gameEndedAt: new Date().toISOString()
        });
    }

    function subscribeGame(lobbyId, onChange, onError) {
        return global.onSnapshot(gameRef(lobbyId), snap => {
            onChange(snap.exists() ? snap.data() : null);
        }, onError || console.error);
    }

    async function leaveGameParticipant(lobbyId, playerId) {
        const snap = await global.getDoc(gameRef(lobbyId));
        if (!snap.exists()) return null;
        const data = snap.data();
        const result = Engine.leaveGame(data, playerId);
        if (!result.ok) return null;
        await persistState(lobbyId, result.state, data.version);
        return result.state;
    }

    global.GameFirestore = {
        waitForFirebase,
        createGameFromLobby,
        persistState,
        fetchGameState,
        mapPersistError,
        SaveConflictError,
        returnLobbyToWaiting,
        leaveGameParticipant,
        subscribeGame
    };
})(window);

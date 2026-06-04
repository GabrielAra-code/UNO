# Sistema Anti-Cheat — UNO? Revolution

## Livelli di protezione

### 1. Firestore Rules (server)
- **XP, livello, carte, statistiche**: modificabili solo dall'admin (`firestore.rules`).
- **Profilo utente**: il client può aggiornare solo `nickname` e `avatar`.
- **Lobby**: numero giocatori non può superare `maxPlayers`.
- **security_events**: ogni utente può creare solo eventi col proprio UID.

### 2. Client (`js/anti-cheat.js`)
- Rate limit su login, join/leave lobby, creazione lobby, profilo.
- Validazione join/leave lobby prima delle scritture Firestore.
- Rilevamento anomalie snapshot (spike giocatori, kick sospetto).
- Heartbeat in sala d'attesa (`lobbies/{id}/presence/{uid}`).
- Log eventi in `security_events`.

### 3. Admin Panel → tab **Sicurezza**
- Lista realtime degli eventi sospetti.
- Ricerca per UID, nickname, tipo evento.

## Deploy regole (obbligatorio)

```bash
firebase deploy --only firestore:rules
```

Senza deploy, la protezione lato database non è attiva.

## Limiti attuali

Il tavolo di gioco (`gioco.html`) è ancora UI statica. Quando aggiungerai le mosse:
- usa **Cloud Functions** per validare ogni mossa (server-authoritative);
- non fidarti mai del solo client per mani, turni e pesca carte.

## Collezioni

| Collezione | Scopo |
|------------|--------|
| `security_events` | Audit trail anti-cheat |
| `security_flags` | Flag manuali admin (futuro) |
| `lobbies/{id}/presence/{uid}` | Heartbeat giocatori in sala |

# Admin Panel — Firebase

## Avvio del gioco (importante)

Apri i file con **doppio click** (`file://`) funziona ora per login e menu.

Per sviluppo consigliato usa un server locale:

```bat
avvia-server.bat
```

Poi apri: `http://localhost:3000/index.html`

## Accesso

Solo l'UID `e8pMV4UWA6dJrYMfYYUIc3scTZJ2` vede e usa il pannello (verifica lato client + regole Firestore).

## Collezioni

| Collezione | Uso |
|------------|-----|
| `utenti` | Profili giocatori (XP, livello, carte sbloccate) |
| `lobbies` | Stanze multiplayer |
| `bans` | Ban attivi (`bans/{uid}`) |
| `rewards` | Log assegnazioni XP/carte |
| `admin` | Log azioni amministrative |
| `carte` | Catalogo carte Index |

## Anti-cheat

Vedi `ANTICHEAT.md` per rate limit, eventi `security_events` e tab **Sicurezza** nel pannello admin.

## Deploy regole di sicurezza

```bash
firebase deploy --only firestore:rules
```

Assicurati che `firebase.json` punti a `firestore.rules`.

## Note

- Dopo il deploy delle regole, le operazioni admin richiedono login con l'account amministratore.
- I giocatori in sala d'attesa vengono espulsi se la lobby viene eliminata o marcata `closed_by_admin`.

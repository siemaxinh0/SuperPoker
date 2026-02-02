# SuperPoker - Copilot Instructions

## Architecture Overview

This is a **real-time multiplayer Texas Hold'em poker game** built with:
- **Backend**: Node.js + Express + Socket.IO ([server.js](../server.js))
- **Frontend**: Vanilla JavaScript + CSS (no frameworks) in `public/`

### Core Data Flow
```
Client (script.js) <--Socket.IO--> Server (server.js)
     └── Emits: playerAction, createLobby, joinLobby, requestRabbitHunt, etc.
     └── Receives: gameState, lobbyState, roundEnd, error, etc.
```

### Key State Objects
- **Lobby**: `lobbies` Map - holds config, players[], spectators[], gameState
- **GameState**: deck, communityCards, players[], pot, phase, currentPlayerIndex
- **Client State**: myPlayerId, currentLobbyCode, currentGameState, isSpectator

## Server-Side Patterns (server.js)

### Game Flow Functions
- `startNewRound(lobby)` → `resetRound()` → `dealHoleCards()` → `postBlinds()` → `startTurnTimer()`
- `findNextPlayer(lobby)` handles turn progression and phase transitions
- `determineWinner(lobby)` calculates side pots and winner(s)
- `playerFold/Check/Call/Bet(lobby, playerId)` - action handlers

### Broadcasting Pattern
Always use these functions to sync state:
```javascript
broadcastLobbyState(lobby)  // For lobby config/players changes
broadcastGameState(lobby)   // For in-game updates (calls getPlayerView/getSpectatorView)
```

### Socket Event Naming
- Client → Server: camelCase verbs (`playerAction`, `createLobby`, `requestRabbitHunt`)
- Server → Client: camelCase events (`gameState`, `roundEnd`, `rabbitHuntCards`)

## Client-Side Patterns (script.js)

### DOM Elements
All DOM elements are cached at file top with descriptive names:
```javascript
const communityCardsEl = document.getElementById('community-cards');
const btnFold = document.getElementById('btn-fold');
```

### Rendering Functions
- `renderCommunityCards(cards, highlightCards)` - handles normal cards, placeholders, rabbit hunt
- `renderPlayers(players)` - updates all player seats with chips, cards, badges
- `updateGameState(state)` - main state sync function

### Feature Flags in State
- `state.wonByFold` - enables rabbit hunt feature
- `state.isBombPot` - special bomb pot round
- `state.allInShowdown` - all-in showdown mode

## CSS Conventions (style.css)

### CSS Variables (`:root`)
```css
--table-green, --gold, --red, --blue
--table-scale, --card-size (for responsive scaling)
--sb-color, --bb-color (blind badges)
```

### Component Classes
- `.card`, `.card-placeholder`, `.card-back`, `.rabbit-hunt-card`
- `.player-box`, `.player-seat[data-seat="N"]`
- `.feature-toggle`, `.skin-option`

### Animation Patterns
Use `@keyframes` for card dealing, winner highlights, rabbit hunt reveal.

## Special Features Implementation

### Turn Timer
- Server: `startTurnTimer(lobby)` → auto-fold on timeout
- Client: `startClientTurnTimer(playerId, expiresAt)` → visual countdown

### Rabbit Hunt (fold-end card reveal)
- Client clicks placeholder → `socket.emit('requestRabbitHunt')`
- Server sends remaining deck cards → `rabbitHuntCards` event
- Cards render with `.rabbit-hunt-card` class (dimmed visual)

### Side Pots
`calculateSidePots(gameState, playersInHand)` tracks contributions per player level.

## Development Notes

- Run server: `npm start` (port 3000)
- Polish UI text throughout (pl locale)
- Socket.IO configured for ngrok/proxy compatibility
- No database - all state is in-memory Maps

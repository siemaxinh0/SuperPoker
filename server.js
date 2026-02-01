const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Konfiguracja CORS dla Ngrok i innych źródeł
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    // Obsługa WebSocket przez proxy (Ngrok)
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Middleware CORS dla Express (API)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ============== DOMYŚLNA KONFIGURACJA ==============
const DEFAULT_CONFIG = {
    smallBlind: 10,
    bigBlind: 20,
    startingChips: 1000,
    minPlayers: 2,
    maxPlayers: 8,
    maxSpectators: 10,
    bbAnteEnabled: false,
    bbAnteAmount: 20,  // Domyślnie równe Big Blindowi
    bombPotEnabled: true,  // Zezwalaj na głosowania Bomb Pot
    runItTwiceEnabled: true, // Zezwalaj na Run It Twice
    cardSkin: 'classic' // Skin kart: classic, colorful, dark
};

// ============== RUN IT TWICE VOTING ==============
const RUN_IT_TWICE_VOTE_TIMEOUT = 10000; // 10 sekund na decyzję
const runItTwiceVotes = new Map(); // lobbyCode -> { players: Set<playerId>, votes: Map<playerId, boolean>, timer, expiresAt }

function startRunItTwiceVote(lobby) {
    const lobbyCode = lobby.code;
    const gameState = lobby.gameState;
    
    // Wyczyść poprzednie głosowanie jeśli istnieje
    clearRunItTwiceVote(lobbyCode);
    
    // Pobierz wszystkich graczy w rozdaniu (wszyscy mogą głosować w RIT)
    const playersInHand = getPlayersInHand(gameState);
    
    // Muszą być minimum 2 gracze w rozdaniu
    if (playersInHand.length < 2) {
        console.log(`[RIT] Za mało graczy w rozdaniu (${playersInHand.length})`);
        return false;
    }
    
    const expiresAt = Date.now() + RUN_IT_TWICE_VOTE_TIMEOUT;
    
    const voteData = {
        players: new Set(playersInHand.map(p => p.id)),
        votes: new Map(),
        expiresAt,
        timer: setTimeout(() => {
            endRunItTwiceVote(lobby, false); // Timeout = nie ma zgody
        }, RUN_IT_TWICE_VOTE_TIMEOUT)
    };
    
    runItTwiceVotes.set(lobbyCode, voteData);
    
    // Powiadom wszystkich o rozpoczęciu głosowania RIT
    io.to(lobbyCode).emit('runItTwiceVoteStarted', {
        players: playersInHand.map(p => ({ id: p.id, name: p.name })),
        expiresAt: expiresAt
    });
    
    console.log(`[RIT] Głosowanie rozpoczęte dla ${playersInHand.length} graczy`);
    return true;
}

function castRunItTwiceVote(lobby, playerId, vote) {
    const voteData = runItTwiceVotes.get(lobby.code);
    if (!voteData) return false;
    
    // Sprawdź czy gracz jest uczestnikiem głosowania
    if (!voteData.players.has(playerId)) return false;
    
    voteData.votes.set(playerId, vote);
    
    const player = lobby.gameState.players.find(p => p.id === playerId);
    console.log(`[RIT] ${player?.name || playerId} zagłosował: ${vote ? 'TAK' : 'NIE'}`);
    
    // Broadcast aktualizacji głosów
    io.to(lobby.code).emit('runItTwiceVoteUpdate', {
        playerId,
        vote,
        votedCount: voteData.votes.size,
        totalVoters: voteData.players.size
    });
    
    // Jeśli ktoś powiedział NIE - koniec głosowania
    if (vote === false) {
        endRunItTwiceVote(lobby, false);
        return true;
    }
    
    // Sprawdź czy wszyscy zagłosowali TAK
    if (voteData.votes.size >= voteData.players.size) {
        const allYes = Array.from(voteData.votes.values()).every(v => v === true);
        endRunItTwiceVote(lobby, allYes);
    }
    
    return true;
}

function endRunItTwiceVote(lobby, approved) {
    const voteData = runItTwiceVotes.get(lobby.code);
    if (!voteData) return;
    
    clearTimeout(voteData.timer);
    runItTwiceVotes.delete(lobby.code);
    
    const gameState = lobby.gameState;
    
    // Powiadom wszystkich o wyniku
    io.to(lobby.code).emit('runItTwiceVoteResult', {
        approved,
        message: approved 
            ? '🔄 Run It Twice! Karty zostaną wyłożone dwukrotnie!'
            : '❌ Run It Twice odrzucone - karty wykładane raz.'
    });
    
    console.log(`[RIT] Wynik głosowania: ${approved ? 'ZATWIERDZONY' : 'ODRZUCONY'}`);
    
    if (approved) {
        // Uruchom Run It Twice
        gameState.runItTwice = true;
        runItTwiceDeal(lobby);
    } else {
        // Normalne wykładanie kart
        runAllInCommunityCards(lobby);
    }
}

function clearRunItTwiceVote(lobbyCode) {
    const voteData = runItTwiceVotes.get(lobbyCode);
    if (voteData) {
        clearTimeout(voteData.timer);
        runItTwiceVotes.delete(lobbyCode);
    }
}

// ============== RUN IT TWICE DEAL ==============
function runItTwiceDeal(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    // Ile kart brakuje do pełnego boardu?
    const currentCommunityCount = gameState.communityCards.length;
    const cardsNeededPerRun = 5 - currentCommunityCount;
    
    if (cardsNeededPerRun <= 0) {
        // Już pełny board - normalne rozstrzygnięcie
        determineWinner(lobby);
        return;
    }
    
    console.log(`[RIT] Potrzeba ${cardsNeededPerRun} kart na run (obecnie: ${currentCommunityCount})`);
    
    // Wylosuj karty dla Run 1
    const run1Cards = [];
    for (let i = 0; i < cardsNeededPerRun; i++) {
        if (gameState.deck.length > 0) {
            run1Cards.push(dealCard(gameState));
        }
    }
    
    // Wylosuj karty dla Run 2 (z tej samej talii - karty z Run 1 już usunięte!)
    const run2Cards = [];
    for (let i = 0; i < cardsNeededPerRun; i++) {
        if (gameState.deck.length > 0) {
            run2Cards.push(dealCard(gameState));
        }
    }
    
    // Zapisz oba boardy w stanie gry
    gameState.ritBoard1 = [...gameState.communityCards, ...run1Cards];
    gameState.ritBoard2 = [...gameState.communityCards, ...run2Cards];
    
    console.log(`[RIT] Board 1: ${gameState.ritBoard1.map(c => c.value + c.suit).join(', ')}`);
    console.log(`[RIT] Board 2: ${gameState.ritBoard2.map(c => c.value + c.suit).join(', ')}`);
    
    // Orientacyjny podział puli (tylko do wyświetlenia, rzeczywisty podział w resolveRunItTwice)
    const estimatedPotA = Math.ceil(gameState.pot / 2);
    const estimatedPotB = Math.floor(gameState.pot / 2);
    
    // Animacja wykładania kart - Run 1
    const CARD_DELAY = 800;
    let delay = 0;
    
    // Wyślij event rozpoczęcia RIT
    io.to(lobby.code).emit('runItTwiceStarted', {
        currentBoard: gameState.communityCards,
        cardsPerRun: cardsNeededPerRun,
        potA: estimatedPotA,
        potB: estimatedPotB
    });
    
    delay += 1000;
    
    // Animacja Run 1
    run1Cards.forEach((card, idx) => {
        setTimeout(() => {
            io.to(lobby.code).emit('runItTwiceCard', {
                run: 1,
                cardIndex: currentCommunityCount + idx,
                card: card,
                board: [...gameState.communityCards, ...run1Cards.slice(0, idx + 1)]
            });
        }, delay + idx * CARD_DELAY);
    });
    
    delay += run1Cards.length * CARD_DELAY + 500;
    
    // Animacja Run 2
    run2Cards.forEach((card, idx) => {
        setTimeout(() => {
            io.to(lobby.code).emit('runItTwiceCard', {
                run: 2,
                cardIndex: currentCommunityCount + idx,
                card: card,
                board: [...gameState.communityCards, ...run2Cards.slice(0, idx + 1)]
            });
        }, delay + idx * CARD_DELAY);
    });
    
    delay += run2Cards.length * CARD_DELAY + 1000;
    
    // Po wykładaniu wszystkich kart - rozstrzygnięcie
    setTimeout(() => {
        resolveRunItTwice(lobby);
    }, delay);
}

function resolveRunItTwice(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    // === Użyj tej samej logiki side pots co w determineWinner ===
    const sidePots = calculateSidePots(gameState, playersInHand);
    
    console.log(`[RIT] Obliczono ${sidePots.length} pul(ę):`);
    sidePots.forEach((pot, i) => {
        console.log(`  Pula ${i+1}: ${pot.amount} żetonów, uprawnieni: ${pot.eligiblePlayers.map(p => p.name).join(', ')}`);
    });
    
    const allWinners1Info = [];
    const allWinners2Info = [];
    let totalPotA = 0;
    let totalPotB = 0;
    
    // Dla każdej puli:
    sidePots.forEach((pot, potIndex) => {
        // Podziel pulę na dwie części
        const potA = Math.ceil(pot.amount / 2);
        const potB = Math.floor(pot.amount / 2);
        totalPotA += potA;
        totalPotB += potB;
        
        // === Board 1 ===
        const board1Results = pot.eligiblePlayers.map(player => ({
            player,
            hand: getBestHand(player.cards, gameState.ritBoard1)
        }));
        board1Results.sort((a, b) => compareHands(b.hand, a.hand));
        
        // Znajdź zwycięzców Board 1 dla tej puli
        const winners1 = [board1Results[0]];
        for (let i = 1; i < board1Results.length; i++) {
            if (compareHands(board1Results[i].hand, board1Results[0].hand) === 0) {
                winners1.push(board1Results[i]);
            }
        }
        
        // Przyznaj żetony za Board 1
        const win1Amount = Math.floor(potA / winners1.length);
        winners1.forEach(w => {
            w.player.chips += win1Amount;
            
            // Dodaj do listy zwycięzców (lub zaktualizuj istniejący wpis)
            const existingWinner = allWinners1Info.find(wi => wi.id === w.player.id);
            if (existingWinner) {
                existingWinner.amount += win1Amount;
            } else {
                allWinners1Info.push({
                    id: w.player.id,
                    name: w.player.name,
                    amount: win1Amount,
                    hand: w.hand.name,
                    cards: w.player.cards
                });
            }
        });
        
        // === Board 2 ===
        const board2Results = pot.eligiblePlayers.map(player => ({
            player,
            hand: getBestHand(player.cards, gameState.ritBoard2)
        }));
        board2Results.sort((a, b) => compareHands(b.hand, a.hand));
        
        // Znajdź zwycięzców Board 2 dla tej puli
        const winners2 = [board2Results[0]];
        for (let i = 1; i < board2Results.length; i++) {
            if (compareHands(board2Results[i].hand, board2Results[0].hand) === 0) {
                winners2.push(board2Results[i]);
            }
        }
        
        // Przyznaj żetony za Board 2
        const win2Amount = Math.floor(potB / winners2.length);
        winners2.forEach(w => {
            w.player.chips += win2Amount;
            
            // Dodaj do listy zwycięzców (lub zaktualizuj istniejący wpis)
            const existingWinner = allWinners2Info.find(wi => wi.id === w.player.id);
            if (existingWinner) {
                existingWinner.amount += win2Amount;
            } else {
                allWinners2Info.push({
                    id: w.player.id,
                    name: w.player.name,
                    amount: win2Amount,
                    hand: w.hand.name,
                    cards: w.player.cards
                });
            }
        });
        
        console.log(`[RIT] Pula ${potIndex + 1}: Board1 -> ${winners1.map(w => w.player.name).join(', ')} (${win1Amount}), Board2 -> ${winners2.map(w => w.player.name).join(', ')} (${win2Amount})`);
    });
    
    // Wyślij wyniki RIT
    io.to(lobby.code).emit('runItTwiceResult', {
        board1: gameState.ritBoard1,
        board2: gameState.ritBoard2,
        winners1: allWinners1Info,
        winners2: allWinners2Info,
        potA: totalPotA,
        potB: totalPotB,
        message: formatRITMessage(allWinners1Info, allWinners2Info, totalPotA, totalPotB)
    });
    
    console.log(`[RIT] Board 1 zwycięzca(y): ${allWinners1Info.map(w => `${w.name}(${w.amount})`).join(', ')}`);
    console.log(`[RIT] Board 2 zwycięzca(y): ${allWinners2Info.map(w => `${w.name}(${w.amount})`).join(', ')}`);
    
    gameState.phase = 'showdown';
    gameState.pot = 0;
    broadcastGameState(lobby);
    
    setTimeout(() => {
        startNewRound(lobby);
    }, 6000);
}

function formatRITMessage(winners1, winners2, potA, potB) {
    const w1Names = winners1.map(w => w.name).join(' i ');
    const w2Names = winners2.map(w => w.name).join(' i ');
    
    if (w1Names === w2Names) {
        return `🏆 ${w1Names} wygrywa oba boardy! (${potA + potB} żetonów)`;
    }
    
    return `🎲 Board 1: ${w1Names} (${potA}) | Board 2: ${w2Names} (${potB})`;
}

// ============== BOMB POT VOTING ==============
const BOMB_POT_VOTE_TIMEOUT = 30000; // 30 sekund
const bombPotVotes = new Map(); // lobbyCode -> { initiator, stake, votes: Map<playerId, boolean>, timer, expiresAt }

function startBombPotVote(lobby, initiatorId, stake) {
    const lobbyCode = lobby.code;
    
    // Wyczyść poprzednie głosowanie jeśli istnieje
    clearBombPotVote(lobbyCode);
    
    const initiator = lobby.gameState?.players.find(p => p.id === initiatorId) || 
                       lobby.players.find(p => p.id === initiatorId);
    
    const expiresAt = Date.now() + BOMB_POT_VOTE_TIMEOUT;
    
    const voteData = {
        initiatorId,
        initiatorName: initiator?.name || 'Gracz',
        stake: parseInt(stake),
        votes: new Map(),
        expiresAt,
        timer: setTimeout(() => {
            endBombPotVote(lobby);
        }, BOMB_POT_VOTE_TIMEOUT)
    };
    
    bombPotVotes.set(lobbyCode, voteData);
    
    // Automatycznie zagłosuj TAK dla inicjatora
    voteData.votes.set(initiatorId, true);
    console.log(`[BOMB-POT] ${voteData.initiatorName} automatycznie głosuje TAK (inicjator)`);
    
    // Powiadom wszystkich o rozpoczęciu głosowania
    io.to(lobbyCode).emit('bombPotVoteStarted', {
        initiatorName: voteData.initiatorName,
        stake: voteData.stake,
        expiresAt: voteData.expiresAt,
        initiatorId: initiatorId  // Dodaj ID inicjatora aby klient wiedział kto już zagłosował
    });
    
    // Wyślij aktualizację głosów (inicjator już zagłosował)
    // Wszyscy gracze przy stole liczą się w głosowaniu (niezależnie od fold)
    const allPlayers = lobby.gameState.players;
    io.to(lobbyCode).emit('bombPotVoteUpdate', {
        yesVotes: 1,
        totalVoters: allPlayers.length,
        votedCount: 1,
        votes: Object.fromEntries(voteData.votes)
    });
    
    console.log(`[BOMB-POT] Głosowanie rozpoczęte przez ${voteData.initiatorName}, stawka: ${stake}`);
    
    // Sprawdź czy wszyscy już zagłosowali (np. gdy jest tylko 1 gracz)
    if (allPlayers.length <= 1) {
        endBombPotVote(lobby);
    }
}

function castBombPotVote(lobby, playerId, vote) {
    const voteData = bombPotVotes.get(lobby.code);
    if (!voteData) return false;
    
    const gameState = lobby.gameState;
    const player = gameState?.players.find(p => p.id === playerId);
    
    if (!player) return false;
    
    // Walidacja środków - nie można głosować TAK bez wystarczających żetonów
    if (vote === true && player.chips < voteData.stake) {
        return { error: 'Za mało żetonów aby zagłosować na TAK!' };
    }
    
    voteData.votes.set(playerId, vote);
    
    // Broadcast aktualizacji głosów
    // Wszyscy gracze przy stole liczą się w głosowaniu (niezależnie od fold)
    const allPlayers = gameState.players;
    const yesVotes = Array.from(voteData.votes.values()).filter(v => v === true).length;
    const totalVoters = allPlayers.length;
    const votedCount = voteData.votes.size;
    
    io.to(lobby.code).emit('bombPotVoteUpdate', {
        yesVotes,
        totalVoters,
        votedCount,
        votes: Object.fromEntries(voteData.votes)
    });
    
    console.log(`[BOMB-POT] ${player.name} zagłosował: ${vote ? 'TAK' : 'NIE'} (${yesVotes}/${totalVoters})`);
    
    // Sprawdź czy wszyscy zagłosowali
    if (votedCount >= totalVoters) {
        endBombPotVote(lobby);
    }
    
    return true;
}

function endBombPotVote(lobby) {
    const voteData = bombPotVotes.get(lobby.code);
    if (!voteData) return;
    
    clearTimeout(voteData.timer);
    
    const gameState = lobby.gameState;
    // Wszyscy gracze przy stole liczą się w głosowaniu (niezależnie od fold)
    const allPlayers = gameState.players;
    const yesVotes = Array.from(voteData.votes.values()).filter(v => v === true).length;
    const totalVoters = allPlayers.length;
    const requiredVotes = Math.floor(totalVoters / 2) + 1; // >50%
    
    const success = yesVotes >= requiredVotes;
    
    if (success) {
        // Zapisz informacje o Bomb Pot do wykonania po bieżącym rozdaniu
        lobby.pendingBombPot = {
            stake: voteData.stake,
            participants: Array.from(voteData.votes.entries())
                .filter(([id, vote]) => vote === true)
                .map(([id]) => id)
        };
        
        io.to(lobby.code).emit('bombPotVoteResult', {
            success: true,
            yesVotes,
            totalVoters,
            stake: voteData.stake,
            message: `Głosowanie przyjęte! Bomb Pot (${voteData.stake}) rozpocznie się po tym rozdaniu.`
        });
        
        console.log(`[BOMB-POT] Głosowanie PRZYJĘTE: ${yesVotes}/${totalVoters}`);
    } else {
        io.to(lobby.code).emit('bombPotVoteResult', {
            success: false,
            yesVotes,
            totalVoters,
            message: `Głosowanie odrzucone (${yesVotes}/${totalVoters}).`
        });
        
        console.log(`[BOMB-POT] Głosowanie ODRZUCONE: ${yesVotes}/${totalVoters}`);
    }
    
    bombPotVotes.delete(lobby.code);
}

function clearBombPotVote(lobbyCode) {
    const voteData = bombPotVotes.get(lobbyCode);
    if (voteData) {
        clearTimeout(voteData.timer);
        bombPotVotes.delete(lobbyCode);
    }
}

// ============== TURN TIMER ==============
const TURN_TIMEOUT = 15000; // 15 sekund
const turnTimers = new Map(); // lobbyCode -> { timerId, playerId, expiresAt }

function startTurnTimer(lobby) {
    const lobbyCode = lobby.code;
    const gameState = lobby.gameState;
    
    // Wyczyść poprzedni timer jeśli istnieje
    clearTurnTimer(lobbyCode);
    
    // Nie startuj timera w fazach bez akcji
    if (!gameState || gameState.phase === 'waiting' || gameState.phase === 'showdown') {
        return;
    }
    
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.folded || currentPlayer.isAllIn) {
        return;
    }
    
    const expiresAt = Date.now() + TURN_TIMEOUT;
    
    const timerId = setTimeout(() => {
        console.log(`[TURN-TIMER] Czas minął dla gracza ${currentPlayer.name}`);
        
        // Sprawdź czy gracz wciąż ma turę
        if (gameState.players[gameState.currentPlayerIndex]?.id !== currentPlayer.id) {
            console.log(`[TURN-TIMER] Gracz już nie ma tury, anulowanie auto-akcji`);
            return;
        }
        
        // Auto-akcja: check jeśli możliwy, w przeciwnym razie fold
        const canCheck = currentPlayer.currentBet >= gameState.currentBet;
        
        if (canCheck) {
            console.log(`[TURN-TIMER] Auto-CHECK dla ${currentPlayer.name}`);
            io.to(lobbyCode).emit('autoAction', { 
                playerId: currentPlayer.id, 
                playerName: currentPlayer.name, 
                action: 'check',
                reason: 'timeout'
            });
            playerCheck(lobby, currentPlayer.id);
        } else {
            console.log(`[TURN-TIMER] Auto-FOLD dla ${currentPlayer.name}`);
            io.to(lobbyCode).emit('autoAction', { 
                playerId: currentPlayer.id, 
                playerName: currentPlayer.name, 
                action: 'fold',
                reason: 'timeout'
            });
            playerFold(lobby, currentPlayer.id);
        }
        
        turnTimers.delete(lobbyCode);
    }, TURN_TIMEOUT);
    
    turnTimers.set(lobbyCode, {
        timerId,
        playerId: currentPlayer.id,
        expiresAt
    });
    
    // Emituj zdarzenie do wszystkich graczy
    io.to(lobbyCode).emit('turnTimerStarted', {
        playerId: currentPlayer.id,
        expiresAt,
        duration: TURN_TIMEOUT
    });
    
    console.log(`[TURN-TIMER] Timer uruchomiony dla ${currentPlayer.name}, wygasa o ${new Date(expiresAt).toLocaleTimeString()}`);
}

function clearTurnTimer(lobbyCode) {
    const timerData = turnTimers.get(lobbyCode);
    if (timerData) {
        clearTimeout(timerData.timerId);
        turnTimers.delete(lobbyCode);
        io.to(lobbyCode).emit('turnTimerCleared');
        console.log(`[TURN-TIMER] Timer wyczyszczony dla lobby ${lobbyCode}`);
    }
}

// ============== ZARZĄDZANIE LOBBY ==============
const lobbies = new Map();

function generateLobbyCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (lobbies.has(code));
    return code;
}

function createLobby(hostId, hostName) {
    const code = generateLobbyCode();
    const lobby = {
        code,
        hostId,
        config: { ...DEFAULT_CONFIG },
        players: [{
            id: hostId,
            name: hostName,
            isHost: true,
            isSpectator: false,
            isReady: false
        }],
        spectators: [],
        gameState: null,
        isGameStarted: false
    };
    lobbies.set(code, lobby);
    return lobby;
}

function getLobby(code) {
    return lobbies.get(code?.toUpperCase());
}

function getLobbyByPlayerId(playerId) {
    for (const [code, lobby] of lobbies) {
        if (lobby.players.some(p => p.id === playerId) || 
            lobby.spectators.some(s => s.id === playerId)) {
            return lobby;
        }
    }
    return null;
}

function removeLobby(code) {
    lobbies.delete(code);
}

// ============== FUNKCJE POMOCNICZE - TALIA ==============
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function dealCard(gameState) {
    return gameState.deck.pop();
}

// ============== LOGIKA OCENY UKŁADÓW ==============
function getCardNumericValue(value) {
    const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    return values[value];
}

function evaluateHand(cards) {
    const allCards = [...cards];
    const values = allCards.map(c => getCardNumericValue(c.value)).sort((a, b) => b - a);
    const suits = allCards.map(c => c.suit);
    
    const valueCounts = {};
    values.forEach(v => {
        valueCounts[v] = (valueCounts[v] || 0) + 1;
    });
    
    const suitCounts = {};
    suits.forEach(s => {
        suitCounts[s] = (suitCounts[s] || 0) + 1;
    });
    
    const counts = Object.values(valueCounts).sort((a, b) => b - a);
    const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
    
    const flushSuit = Object.keys(suitCounts).find(s => suitCounts[s] >= 5);
    const isFlush = !!flushSuit;
    
    let flushCards = [];
    if (isFlush) {
        flushCards = allCards.filter(c => c.suit === flushSuit)
            .map(c => getCardNumericValue(c.value))
            .sort((a, b) => b - a)
            .slice(0, 5);
    }
    
    function findStraight(vals) {
        const unique = [...new Set(vals)].sort((a, b) => b - a);
        if (unique.includes(14)) {
            unique.push(1);
        }
        for (let i = 0; i <= unique.length - 5; i++) {
            let isStraight = true;
            for (let j = 0; j < 4; j++) {
                if (unique[i + j] - unique[i + j + 1] !== 1) {
                    isStraight = false;
                    break;
                }
            }
            if (isStraight) {
                return unique[i];
            }
        }
        return 0;
    }
    
    const straightHigh = findStraight(values);
    const isStraight = straightHigh > 0;
    
    let straightFlushHigh = 0;
    if (isFlush) {
        const flushVals = allCards.filter(c => c.suit === flushSuit)
            .map(c => getCardNumericValue(c.value));
        straightFlushHigh = findStraight(flushVals);
    }
    
    if (straightFlushHigh === 14) {
        return { rank: 10, highCards: [14], name: 'Poker Królewski' };
    }
    
    if (straightFlushHigh > 0) {
        return { rank: 9, highCards: [straightFlushHigh], name: 'Poker' };
    }
    
    if (counts[0] === 4) {
        const quadValue = parseInt(Object.keys(valueCounts).find(k => valueCounts[k] === 4));
        const kicker = uniqueValues.find(v => v !== quadValue);
        return { rank: 8, highCards: [quadValue, kicker], name: 'Kareta' };
    }
    
    if (counts[0] === 3 && counts[1] >= 2) {
        const tripValue = parseInt(Object.keys(valueCounts).find(k => valueCounts[k] === 3));
        const pairValue = parseInt(Object.keys(valueCounts).find(k => valueCounts[k] >= 2 && parseInt(k) !== tripValue));
        return { rank: 7, highCards: [tripValue, pairValue], name: 'Full' };
    }
    
    if (isFlush) {
        return { rank: 6, highCards: flushCards, name: 'Kolor' };
    }
    
    if (isStraight) {
        return { rank: 5, highCards: [straightHigh], name: 'Strit' };
    }
    
    if (counts[0] === 3) {
        const tripValue = parseInt(Object.keys(valueCounts).find(k => valueCounts[k] === 3));
        const kickers = uniqueValues.filter(v => v !== tripValue).slice(0, 2);
        return { rank: 4, highCards: [tripValue, ...kickers], name: 'Trójka' };
    }
    
    if (counts[0] === 2 && counts[1] === 2) {
        const pairs = Object.keys(valueCounts)
            .filter(k => valueCounts[k] === 2)
            .map(k => parseInt(k))
            .sort((a, b) => b - a);
        const kicker = uniqueValues.find(v => !pairs.includes(v));
        return { rank: 3, highCards: [...pairs, kicker], name: 'Dwie Pary' };
    }
    
    if (counts[0] === 2) {
        const pairValue = parseInt(Object.keys(valueCounts).find(k => valueCounts[k] === 2));
        const kickers = uniqueValues.filter(v => v !== pairValue).slice(0, 3);
        return { rank: 2, highCards: [pairValue, ...kickers], name: 'Para' };
    }
    
    return { rank: 1, highCards: uniqueValues.slice(0, 5), name: 'Wysoka Karta' };
}

function getBestHand(playerCards, communityCards) {
    const allCards = [...playerCards, ...communityCards];
    
    // Dodaj unikalny identyfikator do każdej karty
    const cardsWithIds = allCards.map((card, idx) => ({
        ...card,
        cardId: `${card.value}-${card.suit}`,
        source: idx < playerCards.length ? 'hand' : 'community',
        originalIndex: idx < playerCards.length ? idx : idx - playerCards.length,
        numericValue: getCardNumericValue(card.value)
    }));
    
    function combinations(arr, k) {
        if (k === 0) return [[]];
        if (arr.length === 0) return [];
        const [first, ...rest] = arr;
        const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
        const withoutFirst = combinations(rest, k);
        return [...withFirst, ...withoutFirst];
    }
    
    const allCombinations = combinations(cardsWithIds, 5);
    let bestHand = null;
    let bestCards = null;
    
    for (const combo of allCombinations) {
        const hand = evaluateHand(combo);
        if (!bestHand || compareHands(hand, bestHand) > 0) {
            bestHand = hand;
            bestCards = combo;
        }
    }
    
    // Wybierz tylko karty tworzące sam układ (bez kickerów)
    if (bestHand && bestCards) {
        const handFormingCards = getHandFormingCards(bestHand, bestCards);
        bestHand.cards = handFormingCards.map(c => ({
            cardId: c.cardId,
            value: c.value,
            suit: c.suit,
            source: c.source,
            originalIndex: c.originalIndex
        }));
    }
    
    return bestHand;
}

// Funkcja zwracająca tylko karty tworzące układ (bez kickerów)
function getHandFormingCards(hand, cards) {
    const valueCounts = {};
    cards.forEach(c => {
        const val = getCardNumericValue(c.value);
        if (!valueCounts[val]) valueCounts[val] = [];
        valueCounts[val].push(c);
    });
    
    switch (hand.rank) {
        case 10: // Poker Królewski - wszystkie 5 kart
        case 9:  // Poker - wszystkie 5 kart
        case 6:  // Kolor - wszystkie 5 kart
        case 5:  // Strit - wszystkie 5 kart
            return cards;
            
        case 8: { // Kareta - 4 karty o tej samej wartości
            const quadValue = Object.keys(valueCounts).find(v => valueCounts[v].length === 4);
            return valueCounts[quadValue];
        }
        
        case 7: { // Full - trójka + para (5 kart)
            const tripValue = Object.keys(valueCounts).find(v => valueCounts[v].length === 3);
            const pairValue = Object.keys(valueCounts).find(v => valueCounts[v].length === 2);
            return [...valueCounts[tripValue], ...valueCounts[pairValue]];
        }
        
        case 4: { // Trójka - 3 karty o tej samej wartości
            const tripValue = Object.keys(valueCounts).find(v => valueCounts[v].length === 3);
            return valueCounts[tripValue];
        }
        
        case 3: { // Dwie pary - 4 karty (2 pary)
            const pairs = Object.keys(valueCounts).filter(v => valueCounts[v].length === 2);
            return [...valueCounts[pairs[0]], ...valueCounts[pairs[1]]];
        }
        
        case 2: { // Para - 2 karty o tej samej wartości
            const pairValue = Object.keys(valueCounts).find(v => valueCounts[v].length === 2);
            return valueCounts[pairValue];
        }
        
        case 1: { // Wysoka karta - tylko 1 najwyższa karta
            const highestCard = cards.reduce((highest, card) => {
                const cardVal = getCardNumericValue(card.value);
                const highestVal = getCardNumericValue(highest.value);
                return cardVal > highestVal ? card : highest;
            });
            return [highestCard];
        }
        
        default:
            return cards;
    }
}

function compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
        return hand1.rank - hand2.rank;
    }
    for (let i = 0; i < Math.min(hand1.highCards.length, hand2.highCards.length); i++) {
        if (hand1.highCards[i] !== hand2.highCards[i]) {
            return hand1.highCards[i] - hand2.highCards[i];
        }
    }
    return 0;
}

// ============== LOGIKA GRY ==============
function getActivePlayers(gameState) {
    return gameState.players.filter(p => !p.folded && p.chips > 0);
}

function getPlayersInHand(gameState) {
    return gameState.players.filter(p => !p.folded);
}

function createGameState(lobby) {
    return {
        players: lobby.players.filter(p => !p.isSpectator).map(p => ({
            id: p.id,
            name: p.name,
            chips: lobby.config.startingChips,
            cards: [],
            folded: false,
            currentBet: 0,
            hasActed: false,
            isAllIn: false
        })),
        deck: [],
        communityCards: [],
        pot: 0,
        currentBet: 0,
        currentPlayerIndex: 0,
        dealerIndex: 0,
        phase: 'waiting',
        roundBets: {},
        isGameStarted: false,
        minRaise: lobby.config.bigBlind,
        config: { ...lobby.config }
    };
}

function resetRound(gameState) {
    gameState.deck = shuffleDeck(createDeck());
    gameState.communityCards = [];
    gameState.pot = 0;
    gameState.currentBet = 0;
    gameState.phase = 'preflop';
    gameState.roundBets = {};
    gameState.minRaise = gameState.config.bigBlind;
    gameState.allInShowdown = false; // Reset flagi all-in showdown
    gameState.wonByFold = false; // Reset flagi wygranej przez fold
    gameState.foldWinnerId = null;
    gameState.foldWinnerCards = null;
    
    // Reset Run It Twice
    gameState.runItTwice = false;
    gameState.ritBoard1 = null;
    gameState.ritBoard2 = null;
    
    gameState.players.forEach(p => {
        p.cards = [];
        p.folded = false;
        p.currentBet = 0;
        p.hasActed = false;
        p.isAllIn = false;
        p.totalContribution = 0; // Suma wpłacona w całym rozdaniu (do side pots)
    });
}

function dealHoleCards(gameState) {
    gameState.players.forEach(player => {
        if (player.chips > 0) {
            player.cards = [dealCard(gameState), dealCard(gameState)];
        }
    });
}

function postBlinds(gameState, lobby) {
    const activePlayers = getActivePlayers(gameState);
    if (activePlayers.length < 2) return;
    
    const sbIndex = (gameState.dealerIndex + 1) % activePlayers.length;
    const bbIndex = (gameState.dealerIndex + 2) % activePlayers.length;
    
    const sbPlayer = activePlayers[sbIndex];
    const bbPlayer = activePlayers[bbIndex];
    
    // === BIG BLIND ANTE ===
    if (gameState.config.bbAnteEnabled && gameState.config.bbAnteAmount > 0) {
        const anteAmount = Math.min(gameState.config.bbAnteAmount, bbPlayer.chips);
        bbPlayer.chips -= anteAmount;
        bbPlayer.totalContribution = (bbPlayer.totalContribution || 0) + anteAmount; // Śledź wpłatę
        gameState.pot += anteAmount;
        
        // Oznacz że zapłacono ante (do wyświetlenia w UI)
        gameState.bbAntePaid = anteAmount;
        
        // Emituj informację o ante
        if (lobby) {
            io.to(lobby.code).emit('antePaid', {
                playerId: bbPlayer.id,
                playerName: bbPlayer.name,
                amount: anteAmount
            });
        }
        
        console.log(`[BB-ANTE] ${bbPlayer.name} wpłaca ante: ${anteAmount}`);
        
        // Jeśli gracz jest all-in po ante, oznacz to
        if (bbPlayer.chips === 0) {
            bbPlayer.isAllIn = true;
        }
    }
    
    // Small Blind
    const sbAmount = Math.min(gameState.config.smallBlind, sbPlayer.chips);
    sbPlayer.chips -= sbAmount;
    sbPlayer.currentBet = sbAmount;
    sbPlayer.totalContribution = (sbPlayer.totalContribution || 0) + sbAmount; // Śledź wpłatę
    gameState.pot += sbAmount;
    
    if (sbPlayer.chips === 0) {
        sbPlayer.isAllIn = true;
    }
    
    // Big Blind
    const bbAmount = Math.min(gameState.config.bigBlind, bbPlayer.chips);
    bbPlayer.chips -= bbAmount;
    bbPlayer.currentBet = bbAmount;
    bbPlayer.totalContribution = (bbPlayer.totalContribution || 0) + bbAmount; // Śledź wpłatę
    gameState.pot += bbAmount;
    
    if (bbPlayer.chips === 0) {
        bbPlayer.isAllIn = true;
    }
    
    gameState.currentBet = gameState.config.bigBlind;
    gameState.currentPlayerIndex = (bbIndex + 1) % activePlayers.length;
    
    const currentPlayer = activePlayers[gameState.currentPlayerIndex];
    gameState.currentPlayerIndex = gameState.players.findIndex(p => p.id === currentPlayer.id);
    
    // Uruchom timer dla pierwszego gracza po blindach
    if (lobby) {
        startTurnTimer(lobby);
    }
}

function dealCommunityCards(gameState, count) {
    for (let i = 0; i < count; i++) {
        gameState.communityCards.push(dealCard(gameState));
    }
}

// ============== ALL-IN SHOWDOWN ==============
function checkAllInShowdown(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    // Potrzeba minimum 2 graczy
    if (playersInHand.length < 2) return false;
    
    // Sprawdź czy jest przynajmniej jeden gracz all-in
    const allInPlayers = playersInHand.filter(p => p.isAllIn || p.chips === 0);
    if (allInPlayers.length === 0) return false;
    
    // Gracze którzy mogą jeszcze licytować (mają żetony i nie są all-in)
    const playersWhoCanAct = playersInHand.filter(p => !p.isAllIn && p.chips > 0);
    
    // Maksymalny zakład w grze
    const maxBet = Math.max(...playersInHand.map(p => p.currentBet));
    
    // All-in showdown jeśli:
    // 1. Wszyscy gracze są all-in LUB
    // 2. Pozostał jeden gracz który może działać, ale wyrównał już zakład
    
    if (playersWhoCanAct.length === 0) {
        // Wszyscy są all-in
        return true;
    }
    
    if (playersWhoCanAct.length === 1) {
        const lastPlayer = playersWhoCanAct[0];
        // Jeśli ostatni gracz wyrównał zakład (lub ma więcej niż max bet all-in gracza)
        if (lastPlayer.currentBet >= maxBet && lastPlayer.hasActed) {
            return true;
        }
    }
    
    return false;
}

function runAllInShowdown(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    clearTurnTimer(lobby.code);
    
    // Oznacz że jesteśmy w trybie all-in showdown
    gameState.allInShowdown = true;
    
    console.log(`[ALL-IN SHOWDOWN] Rozpoczęcie showdown z ${playersInHand.length} graczami`);
    
    // Zbierz karty wszystkich graczy do odsłonięcia
    const revealedCards = playersInHand.map(p => ({
        id: p.id,
        name: p.name,
        cards: p.cards,
        chips: p.chips,
        isAllIn: p.isAllIn
    }));
    
    // Wyślij event o all-in showdown (karty od razu widoczne)
    io.to(lobby.code).emit('allInShowdown', {
        players: revealedCards,
        pot: gameState.pot,
        phase: gameState.phase,
        communityCards: gameState.communityCards
    });
    
    // Broadcast gameState żeby UI się zaktualizował (żetony, itp.)
    broadcastGameState(lobby);
    
    // Sprawdź czy Run It Twice jest włączony i możliwy
    const config = gameState.config || lobby.config;
    const missingCards = 5 - gameState.communityCards.length;
    
    // RIT możliwy gdy: włączony, brakuje kart do wyłożenia, wystarczająco kart w talii
    if (config.runItTwiceEnabled && missingCards > 0 && gameState.deck.length >= missingCards * 2) {
        // Opóźnij głosowanie RIT o 2 sekundy, żeby gracze zobaczyli karty
        setTimeout(() => {
            if (startRunItTwiceVote(lobby)) {
                console.log(`[ALL-IN SHOWDOWN] Rozpoczęto głosowanie Run It Twice`);
            } else {
                // Jeśli głosowanie nie powiodło się, kontynuuj normalnie
                runAllInCommunityCards(lobby);
            }
        }, 2000);
        return; // Czekamy na timeout
    }
    
    // RIT wyłączony lub niemożliwy - od razu wykładaj karty bez czekania
    runAllInCommunityCards(lobby);
}

function runAllInCommunityCards(lobby) {
    const gameState = lobby.gameState;
    
    const phases = ['preflop', 'flop', 'turn', 'river'];
    const currentPhaseIndex = phases.indexOf(gameState.phase);
    
    if (currentPhaseIndex === -1 || gameState.phase === 'river') {
        // Już na riverze lub showdown - przejdź do wyników
        setTimeout(() => {
            gameState.phase = 'showdown';
            determineWinner(lobby);
        }, 1500);
        return;
    }
    
    // Harmonogram wykładania kart
    let delay = 0;
    const CARD_DELAY = 1500; // 1.5 sekundy między kartami
    
    // Flop (jeśli jeszcze nie wykładany)
    if (currentPhaseIndex < 1) {
        delay += CARD_DELAY;
        setTimeout(() => {
            gameState.phase = 'flop';
            dealCommunityCards(gameState, 3);
            io.to(lobby.code).emit('allInCardDealt', {
                phase: 'flop',
                communityCards: gameState.communityCards
            });
            broadcastGameState(lobby);
            console.log(`[ALL-IN SHOWDOWN] Wykładanie Flop`);
        }, delay);
    }
    
    // Turn
    if (currentPhaseIndex < 2) {
        delay += CARD_DELAY;
        setTimeout(() => {
            gameState.phase = 'turn';
            dealCommunityCards(gameState, 1);
            io.to(lobby.code).emit('allInCardDealt', {
                phase: 'turn',
                communityCards: gameState.communityCards
            });
            broadcastGameState(lobby);
            console.log(`[ALL-IN SHOWDOWN] Wykładanie Turn`);
        }, delay);
    }
    
    // River
    if (currentPhaseIndex < 3) {
        delay += CARD_DELAY;
        setTimeout(() => {
            gameState.phase = 'river';
            dealCommunityCards(gameState, 1);
            io.to(lobby.code).emit('allInCardDealt', {
                phase: 'river',
                communityCards: gameState.communityCards
            });
            broadcastGameState(lobby);
            console.log(`[ALL-IN SHOWDOWN] Wykładanie River`);
        }, delay);
    }
    
    // Końcowe rozstrzygnięcie
    delay += CARD_DELAY;
    setTimeout(() => {
        gameState.phase = 'showdown';
        determineWinner(lobby);
    }, delay);
}

function nextPhase(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    if (playersInHand.length <= 1) {
        endRound(lobby);
        return;
    }
    
    // Sprawdź czy to All-in Showdown
    if (checkAllInShowdown(lobby)) {
        runAllInShowdown(lobby);
        return;
    }
    
    gameState.players.forEach(p => {
        p.currentBet = 0;
        p.hasActed = false;
    });
    gameState.currentBet = 0;
    
    switch (gameState.phase) {
        case 'preflop':
            gameState.phase = 'flop';
            dealCommunityCards(gameState, 3);
            break;
        case 'flop':
            gameState.phase = 'turn';
            dealCommunityCards(gameState, 1);
            break;
        case 'turn':
            gameState.phase = 'river';
            dealCommunityCards(gameState, 1);
            break;
        case 'river':
            gameState.phase = 'showdown';
            determineWinner(lobby);
            return;
    }
    
    const playersWhoCanAct = playersInHand.filter(p => !p.isAllIn && p.chips > 0);
    
    if (playersWhoCanAct.length === 0) {
        broadcastGameState(lobby);
        setTimeout(() => {
            nextPhase(lobby);
        }, 1000);
        return;
    }
    
    let nextIndex = (gameState.dealerIndex + 1) % gameState.players.length;
    let attempts = 0;
    while (attempts < gameState.players.length) {
        const player = gameState.players[nextIndex];
        if (!player.folded && !player.isAllIn && player.chips > 0) {
            break;
        }
        nextIndex = (nextIndex + 1) % gameState.players.length;
        attempts++;
    }
    gameState.currentPlayerIndex = nextIndex;
    
    broadcastGameState(lobby);
    startTurnTimer(lobby); // Uruchom timer dla gracza na nowej fazie
}

function findNextPlayer(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    const playersWhoCanAct = playersInHand.filter(p => !p.isAllIn && p.chips > 0);
    
    if (playersInHand.length <= 1) {
        clearTurnTimer(lobby.code);
        endRound(lobby);
        return;
    }
    
    // Sprawdź czy to All-in Showdown
    if (checkAllInShowdown(lobby)) {
        runAllInShowdown(lobby);
        return;
    }
    
    if (playersWhoCanAct.length === 0) {
        clearTurnTimer(lobby.code);
        nextPhase(lobby);
        return;
    }
    
    if (playersWhoCanAct.length === 1) {
        const lastPlayer = playersWhoCanAct[0];
        if (lastPlayer.currentBet >= gameState.currentBet && lastPlayer.hasActed) {
            clearTurnTimer(lobby.code);
            nextPhase(lobby);
            return;
        }
    }
    
    const allActed = playersWhoCanAct.every(p => p.hasActed);
    const allBetsEqual = playersWhoCanAct.every(p => p.currentBet === gameState.currentBet);
    
    if (allActed && allBetsEqual) {
        clearTurnTimer(lobby.code);
        nextPhase(lobby);
        return;
    }
    
    let nextIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    let attempts = 0;
    
    while (attempts < gameState.players.length) {
        const player = gameState.players[nextIndex];
        if (!player.folded && !player.isAllIn && player.chips > 0) {
            gameState.currentPlayerIndex = nextIndex;
            broadcastGameState(lobby);
            startTurnTimer(lobby); // Uruchom timer dla następnego gracza
            return;
        }
        nextIndex = (nextIndex + 1) % gameState.players.length;
        attempts++;
    }
    
    clearTurnTimer(lobby.code);
    nextPhase(lobby);
}

function determineWinner(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    if (playersInHand.length === 1) {
        const winner = playersInHand[0];
        winner.chips += gameState.pot;
        
        // Zapisz dane do funkcjonalności Show Cards (karty NIE są wysyłane automatycznie!)
        gameState.wonByFold = true;
        gameState.foldWinnerId = winner.id;
        gameState.foldWinnerCards = [...winner.cards]; // Kopia kart
        
        // Ustaw fazę na showdown
        gameState.phase = 'showdown';
        
        io.to(lobby.code).emit('roundEnd', {
            winners: [{ id: winner.id, name: winner.name, amount: gameState.pot, hand: null }],
            message: `${winner.name} wygrywa ${gameState.pot} żetonów!`,
            wonByFold: true  // Informacja dla frontendu
        });
        
        broadcastGameState(lobby);
        
        setTimeout(() => {
            startNewRound(lobby);
        }, 5000);
        
        return; // Ważne - nie kontynuuj do normalnego showdown
    } else {
        // === SIDE POTS LOGIC ===
        const sidePots = calculateSidePots(gameState, playersInHand);
        const allWinnersInfo = [];
        const winnersByPot = [];
        
        console.log(`[SIDE-POTS] Obliczono ${sidePots.length} pul(ę):`);
        sidePots.forEach((pot, i) => {
            console.log(`  Pula ${i+1}: ${pot.amount} żetonów, uprawnieni: ${pot.eligiblePlayers.map(p => p.name).join(', ')}`);
        });
        
        // Dla każdej puli znajdź zwycięzcę
        sidePots.forEach((pot, potIndex) => {
            const eligibleHands = pot.eligiblePlayers.map(player => ({
                player,
                hand: getBestHand(player.cards, gameState.communityCards)
            }));
            
            eligibleHands.sort((a, b) => compareHands(b.hand, a.hand));
            
            // Znajdź wszystkich zwycięzców tej puli (mogą być remisy)
            const potWinners = [eligibleHands[0]];
            for (let i = 1; i < eligibleHands.length; i++) {
                if (compareHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
                    potWinners.push(eligibleHands[i]);
                }
            }
            
            const winAmountPerPlayer = Math.floor(pot.amount / potWinners.length);
            
            potWinners.forEach(w => {
                w.player.chips += winAmountPerPlayer;
                
                // Dodaj do listy zwycięzców (lub zaktualizuj istniejący wpis)
                const existingWinner = allWinnersInfo.find(wi => wi.id === w.player.id);
                if (existingWinner) {
                    existingWinner.amount += winAmountPerPlayer;
                    // Aktualizuj playersInPot tylko jeśli jest większy
                    if (pot.eligiblePlayers.length > existingWinner.playersInPot) {
                        existingWinner.playersInPot = pot.eligiblePlayers.length;
                    }
                } else {
                    allWinnersInfo.push({
                        id: w.player.id,
                        name: w.player.name,
                        amount: winAmountPerPlayer,
                        hand: w.hand.name,
                        cards: w.player.cards,
                        playersInPot: pot.eligiblePlayers.length  // Liczba graczy w tej puli
                    });
                }
            });
            
            winnersByPot.push({
                potName: sidePots.length > 1 ? (potIndex === 0 ? 'Main Pot' : `Side Pot ${potIndex}`) : 'Pot',
                amount: pot.amount,
                winners: potWinners.map(w => ({
                    name: w.player.name,
                    hand: w.hand.name
                }))
            });
            
            console.log(`[SIDE-POTS] Pula ${potIndex + 1}: ${potWinners.map(w => w.player.name).join(', ')} wygrywa ${winAmountPerPlayer} żetonów każdy`);
        });
        
        const allPlayersCards = playersInHand.map(p => ({
            id: p.id,
            name: p.name,
            cards: p.cards,
            hand: getBestHand(p.cards, gameState.communityCards).name
        }));
        
        // Buduj wiadomość o wygranej
        let message;
        if (sidePots.length === 1) {
            const winners = winnersByPot[0].winners;
            message = winners.length > 1 
                ? `Remis! ${winners.map(w => w.name).join(' i ')} dzielą pulę!`
                : `${winners[0].name} wygrywa ${gameState.pot} żetonów z ${winners[0].hand}!`;
        } else {
            // Wiele pul - szczegółowy komunikat
            message = winnersByPot.map(p => {
                const winnerNames = p.winners.map(w => w.name).join(' i ');
                return `${p.potName} (${p.amount}): ${winnerNames}`;
            }).join(' | ');
        }
        
        io.to(lobby.code).emit('roundEnd', {
            winners: allWinnersInfo,
            allPlayersCards,
            sidePots: sidePots.length > 1 ? winnersByPot : null,
            message
        });
    }
    
    gameState.phase = 'showdown';
    broadcastGameState(lobby);
    
    setTimeout(() => {
        startNewRound(lobby);
    }, 5000);
}

// === OBLICZ SIDE POTY ===
function calculateSidePots(gameState, playersInHand) {
    // Pobierz wszystkich graczy którzy wnieśli coś do puli (włącznie ze złożonymi)
    const allContributors = gameState.players.filter(p => (p.totalContribution || 0) > 0);
    
    // Sortuj po wpłacie rosnąco
    const sortedByContribution = [...allContributors].sort((a, b) => 
        (a.totalContribution || 0) - (b.totalContribution || 0)
    );
    
    const sidePots = [];
    let processedAmount = 0;
    
    // Dla każdego unikalnego poziomu wpłaty utwórz pulę
    const uniqueContributions = [...new Set(sortedByContribution.map(p => p.totalContribution || 0))];
    
    for (let i = 0; i < uniqueContributions.length; i++) {
        const currentLevel = uniqueContributions[i];
        const prevLevel = i > 0 ? uniqueContributions[i - 1] : 0;
        const levelDiff = currentLevel - prevLevel;
        
        if (levelDiff <= 0) continue;
        
        // Gracze uprawnieni do tej puli = ci którzy wnieśli co najmniej currentLevel I nie złożyli się
        const eligiblePlayers = playersInHand.filter(p => (p.totalContribution || 0) >= currentLevel);
        
        // Gracze którzy wnieśli do tej puli = ci którzy wnieśli co najmniej prevLevel
        const contributorsToThisPot = allContributors.filter(p => (p.totalContribution || 0) > prevLevel);
        
        // Każdy z tych graczy wnosi levelDiff (lub mniej jeśli jego wkład jest mniejszy)
        let potAmount = 0;
        contributorsToThisPot.forEach(p => {
            const contribution = Math.min(levelDiff, (p.totalContribution || 0) - prevLevel);
            potAmount += contribution;
        });
        
        if (potAmount > 0 && eligiblePlayers.length > 0) {
            sidePots.push({
                amount: potAmount,
                eligiblePlayers: eligiblePlayers
            });
        }
    }
    
    // Sprawdź czy suma pul zgadza się z całkowitą pulą
    const totalSidePots = sidePots.reduce((sum, p) => sum + p.amount, 0);
    console.log(`[SIDE-POTS] Suma pul: ${totalSidePots}, gameState.pot: ${gameState.pot}`);
    
    // Jeśli coś zostało (z powodu zaokrągleń), dodaj do ostatniej puli
    if (totalSidePots < gameState.pot && sidePots.length > 0) {
        sidePots[sidePots.length - 1].amount += (gameState.pot - totalSidePots);
    }
    
    return sidePots;
}

// === OBLICZ SIDE POTY NA ŻYWO (dla UI) ===
function calculateLiveSidePots(gameState) {
    // Sprawdź czy są gracze all-in
    const hasAllIn = gameState.players.some(p => p.isAllIn && !p.folded);
    if (!hasAllIn) return null;
    
    const playersInHand = gameState.players.filter(p => !p.folded);
    if (playersInHand.length < 2) return null;
    
    // Pobierz wszystkich graczy którzy wnieśli coś do puli
    const allContributors = gameState.players.filter(p => (p.totalContribution || 0) > 0);
    if (allContributors.length === 0) return null;
    
    // Sortuj po wpłacie rosnąco
    const sortedByContribution = [...allContributors].sort((a, b) => 
        (a.totalContribution || 0) - (b.totalContribution || 0)
    );
    
    const sidePots = [];
    
    // Dla każdego unikalnego poziomu wpłaty utwórz pulę
    const uniqueContributions = [...new Set(sortedByContribution.map(p => p.totalContribution || 0))];
    
    for (let i = 0; i < uniqueContributions.length; i++) {
        const currentLevel = uniqueContributions[i];
        const prevLevel = i > 0 ? uniqueContributions[i - 1] : 0;
        const levelDiff = currentLevel - prevLevel;
        
        if (levelDiff <= 0) continue;
        
        // Gracze którzy mogą wygrać tę pulę = ci którzy wnieśli co najmniej currentLevel I nie złożyli się
        const eligiblePlayers = playersInHand.filter(p => (p.totalContribution || 0) >= currentLevel);
        
        // Gracze którzy wnieśli do tej puli
        const contributorsToThisPot = allContributors.filter(p => (p.totalContribution || 0) > prevLevel);
        
        let potAmount = 0;
        contributorsToThisPot.forEach(p => {
            const contribution = Math.min(levelDiff, (p.totalContribution || 0) - prevLevel);
            potAmount += contribution;
        });
        
        if (potAmount > 0) {
            sidePots.push({
                name: i === 0 ? 'Main Pot' : `Side Pot ${i}`,
                amount: potAmount,
                eligibleCount: eligiblePlayers.length
            });
        }
    }
    
    // Jeśli jest tylko jeden pot, nie pokazuj go jako side pot
    if (sidePots.length <= 1) return null;
    
    return sidePots;
}

function endRound(lobby) {
    clearTurnTimer(lobby.code);
    determineWinner(lobby);
}

// ============== AUTOMATYCZNE PRZENOSZENIE DO OBSERWATORÓW ==============
function movePlayerToSpectators(lobby, playerId, playerName) {
    console.log(`[AUTO-SPECTATOR] Przenoszenie gracza ${playerName} (${playerId}) do obserwatorów - brak żetonów`);
    
    // Usuń z lobby.players
    const lobbyPlayerIndex = lobby.players.findIndex(p => p.id === playerId);
    if (lobbyPlayerIndex !== -1) {
        lobby.players.splice(lobbyPlayerIndex, 1);
    }
    
    // Dodaj do spectatorów
    lobby.spectators.push({
        id: playerId,
        name: playerName
    });
    
    // Wyślij event do wyeliminowanego gracza
    const socket = io.sockets.sockets.get(playerId);
    if (socket) {
        socket.emit('movedToSpectators', {
            message: 'Brak żetonów. Przechodzisz w tryb obserwatora.'
        });
    }
    
    // Broadcast do wszystkich w lobby
    io.to(lobby.code).emit('playerOutOfChips', {
        playerId,
        playerName
    });
    
    console.log(`[AUTO-SPECTATOR] Gracz ${playerName} przeniesiony do obserwatorów`);
}

// ============== BOMB POT ROUND ==============
function startBombPotRound(lobby) {
    const gameState = lobby.gameState;
    const bombPot = lobby.pendingBombPot;
    
    if (!bombPot) return;
    
    // Wyczyść pending bomb pot
    lobby.pendingBombPot = null;
    
    // Filtruj uczestników - tylko ci co zagłosowali TAK i mają wystarczająco żetonów
    const participants = gameState.players.filter(p => 
        bombPot.participants.includes(p.id) && p.chips >= bombPot.stake
    );
    
    if (participants.length < 2) {
        io.to(lobby.code).emit('bombPotCancelled', {
            message: 'Bomb Pot anulowany - za mało uczestników z wystarczającymi środkami!'
        });
        // Przejdź do normalnej rundy
        startNormalRound(lobby);
        return;
    }
    
    console.log(`[BOMB-POT] Start z ${participants.length} uczestnikami, stawka: ${bombPot.stake}`);
    
    // Oznacz runę jako Bomb Pot
    gameState.isBombPot = true;
    gameState.bombPotStake = bombPot.stake;
    gameState.bombPotParticipants = participants.map(p => p.id);
    
    // Przesuń dealera
    if (gameState.dealerIndex >= gameState.players.length) {
        gameState.dealerIndex = 0;
    }
    gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
    
    // Reset stanu rundy
    gameState.pot = 0;
    gameState.communityCards = [];
    gameState.currentBet = 0;
    gameState.winners = [];
    gameState.showdownResults = null;
    gameState.wonByFold = false;
    gameState.foldWinnerId = null;
    gameState.foldWinnerCards = null;
    
    // Ustaw graczy
    gameState.players.forEach(player => {
        player.cards = [];
        player.currentBet = 0;
        player.hasActed = false;
        player.isAllIn = false;
        player.totalContribution = 0; // Reset wpłaty
        
        // Tylko uczestnicy Bomb Pot uczestniczą
        if (bombPot.participants.includes(player.id)) {
            player.folded = false;
            // Pobierz stawkę Bomb Pot
            player.chips -= bombPot.stake;
            player.currentBet = bombPot.stake;
            player.totalContribution = bombPot.stake; // Śledź wpłatę
            gameState.pot += bombPot.stake;
            
            console.log(`[BOMB-POT] ${player.name} wpłaca ${bombPot.stake}, zostaje ${player.chips}`);
        } else {
            // Nie-uczestnicy są automatycznie złożeni
            player.folded = true;
        }
    });
    
    // Rozdaj karty - otwarte (widoczne dla wszystkich)
    // Stwórz i potasuj talię (shuffleDeck zwraca nową potasowaną talię)
    gameState.deck = shuffleDeck(createDeck());
    
    // Rozdaj 2 karty każdemu uczestnikowi
    participants.forEach(player => {
        player.cards = [gameState.deck.pop(), gameState.deck.pop()];
    });
    
    // Zacznij od preflop - karty wspólne będą wykładane sekwencyjnie
    gameState.phase = 'preflop';
    gameState.communityCards = [];
    
    // Powiadom o rozpoczęciu Bomb Pot
    io.to(lobby.code).emit('bombPotStarted', {
        stake: bombPot.stake,
        pot: gameState.pot,
        participants: participants.map(p => ({ id: p.id, name: p.name }))
    });
    
    broadcastGameState(lobby);
    
    // Sekwencja wykładania kart z opóźnieniami
    // Flop po 2 sekundach
    setTimeout(() => {
        if (!lobby.gameState || !lobby.gameState.isBombPot) return;
        gameState.deck.pop(); // Burn
        gameState.communityCards.push(gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop());
        gameState.phase = 'flop';
        io.to(lobby.code).emit('bombPotPhase', { phase: 'flop', communityCards: gameState.communityCards });
        broadcastGameState(lobby);
        
        // Turn po kolejnych 2 sekundach
        setTimeout(() => {
            if (!lobby.gameState || !lobby.gameState.isBombPot) return;
            gameState.deck.pop(); // Burn
            gameState.communityCards.push(gameState.deck.pop());
            gameState.phase = 'turn';
            io.to(lobby.code).emit('bombPotPhase', { phase: 'turn', communityCards: gameState.communityCards });
            broadcastGameState(lobby);
            
            // River po kolejnych 2 sekundach
            setTimeout(() => {
                if (!lobby.gameState || !lobby.gameState.isBombPot) return;
                gameState.deck.pop(); // Burn
                gameState.communityCards.push(gameState.deck.pop());
                gameState.phase = 'river';
                io.to(lobby.code).emit('bombPotPhase', { phase: 'river', communityCards: gameState.communityCards });
                broadcastGameState(lobby);
                
                // Showdown po kolejnych 2 sekundach
                setTimeout(() => {
                    if (!lobby.gameState || !lobby.gameState.isBombPot) return;
                    gameState.phase = 'showdown';
                    broadcastGameState(lobby);
                    evaluateShowdownBombPot(lobby);
                }, 2000);
            }, 2000);
        }, 2000);
    }, 2000);
}

function evaluateShowdownBombPot(lobby) {
    const gameState = lobby.gameState;
    
    // Pobierz aktywnych uczestników Bomb Pot (nie-foldowanych)
    const activePlayers = gameState.players.filter(p => 
        !p.folded && gameState.bombPotParticipants?.includes(p.id)
    );
    
    if (activePlayers.length === 0) {
        console.error('[BOMB-POT] Brak aktywnych graczy w showdown!');
        gameState.isBombPot = false;
        startNormalRound(lobby);
        return;
    }
    
    // Oceń ręce - używamy getBestHand jak w normalnym showdown
    const playerHands = activePlayers.map(player => {
        const bestHand = getBestHand(player.cards, gameState.communityCards);
        return {
            player,
            hand: bestHand,
            handName: bestHand.name,
            handRank: bestHand.rank
        };
    });
    
    // Posortuj od najlepszej do najgorszej ręki (b przed a = malejąco)
    playerHands.sort((a, b) => compareHands(b.hand, a.hand));
    
    // Znajdź zwycięzców (może być remis)
    const winners = [playerHands[0]];
    for (let i = 1; i < playerHands.length; i++) {
        if (compareHands(playerHands[i].hand, playerHands[0].hand) === 0) {
            winners.push(playerHands[i]);
        }
    }
    
    // Podziel pulę
    const winAmount = Math.floor(gameState.pot / winners.length);
    winners.forEach(w => {
        w.player.chips += winAmount;
    });
    
    gameState.currentWinners = winners.map(w => w.player.id);
    
    // Zapisz wyniki
    const showdownResults = playerHands.map(ph => ({
        playerId: ph.player.id,
        playerName: ph.player.name,
        cards: ph.player.cards,
        handName: ph.handName,
        isWinner: winners.some(w => w.player.id === ph.player.id),
        winAmount: winners.some(w => w.player.id === ph.player.id) ? winAmount : 0
    }));
    
    gameState.showdownResults = showdownResults;
    
    // Komunikat o zwycięstwie
    const winnerNames = winners.map(w => w.player.name).join(', ');
    const winnerHand = winners[0].handName;
    
    io.to(lobby.code).emit('bombPotShowdown', {
        results: showdownResults,
        pot: gameState.pot,
        winnerNames,
        winnerHand,
        message: `🎰 BOMB POT! ${winnerNames} wygrywa ${winAmount} z ${winnerHand}!`
    });
    
    // Wyślij roundEnd dla podświetlenia zwycięzców (tak jak w normalnym rozdaniu)
    const winnersInfo = winners.map(w => ({
        id: w.player.id,
        name: w.player.name,
        amount: winAmount,
        hand: w.handName,
        cards: w.player.cards
    }));
    
    io.to(lobby.code).emit('roundEnd', {
        winners: winnersInfo,
        message: `🎰 BOMB POT! ${winnerNames} wygrywa ${winAmount} z ${winnerHand}!`,
        isBombPot: true
    });
    
    console.log(`[BOMB-POT] Zwycięzca: ${winnerNames} z ${winnerHand}, wygrana: ${winAmount}`);
    
    broadcastGameState(lobby);
    
    // Reset flagi Bomb Pot i przejście do następnej rundy po opóźnieniu
    setTimeout(() => {
        gameState.isBombPot = false;
        gameState.bombPotStake = null;
        gameState.bombPotParticipants = null;
        gameState.currentWinners = [];
        startNormalRound(lobby);
    }, 5000);
}

// Normalna runda (wydzielona z startNewRound)
function startNormalRound(lobby) {
    const gameState = lobby.gameState;
    
    // === AUTOMATYCZNE PRZENOSZENIE GRACZY BEZ ŻETONÓW DO OBSERWATORÓW ===
    const playersToRemove = gameState.players.filter(p => p.chips <= 0);
    
    playersToRemove.forEach(player => {
        console.log(`[AUTO-SPECTATOR] Wykryto gracza bez żetonów: ${player.name} (${player.chips} chips)`);
        movePlayerToSpectators(lobby, player.id, player.name);
    });
    
    // Filtruj graczy w gameState (zostaw tylko tych z żetonami)
    gameState.players = gameState.players.filter(p => p.chips > 0);
    
    // === OBSŁUGA KOLEJKI PENDING JOIN ===
    const pendingSpectators = lobby.spectators.filter(s => s.pendingJoin);
    const availableSeats = lobby.config.maxPlayers - gameState.players.length;
    
    if (pendingSpectators.length > 0 && availableSeats > 0) {
        const toJoin = pendingSpectators.slice(0, availableSeats);
        
        toJoin.forEach(spectator => {
            console.log(`[PENDING-JOIN] Dodawanie gracza ${spectator.name} do gry`);
            
            // Usuń z spectatorów
            const specIndex = lobby.spectators.findIndex(s => s.id === spectator.id);
            if (specIndex !== -1) {
                lobby.spectators.splice(specIndex, 1);
            }
            
            // Dodaj do lobby.players
            lobby.players.push({
                id: spectator.id,
                name: spectator.name,
                isHost: false,
                isSpectator: false,
                isReady: true
            });
            
            // Dodaj do gameState.players
            gameState.players.push({
                id: spectator.id,
                name: spectator.name,
                chips: lobby.config.startingChips,
                cards: [],
                folded: false,
                currentBet: 0,
                hasActed: false,
                isAllIn: false
            });
            
            // Powiadom gracza
            const socket = io.sockets.sockets.get(spectator.id);
            if (socket) {
                socket.emit('joinedGame', {
                    chips: lobby.config.startingChips,
                    message: 'Dołączyłeś do gry!'
                });
            }
            
            // Broadcast
            io.to(lobby.code).emit('playerJoinedGame', {
                playerId: spectator.id,
                playerName: spectator.name,
                chips: lobby.config.startingChips
            });
            
            console.log(`[PENDING-JOIN] Gracz ${spectator.name} dołączył do gry z ${lobby.config.startingChips} żetonami`);
        });
    }
    
    // Sprawdź czy wystarczy graczy do kontynuacji
    if (gameState.players.length < lobby.config.minPlayers) {
        gameState.phase = 'waiting';
        gameState.isGameStarted = false;
        lobby.isGameStarted = false;
        
        if (gameState.players.length === 1) {
            const winner = gameState.players[0];
            io.to(lobby.code).emit('gameStatus', { 
                message: `🏆 ${winner.name} wygrywa całą grę! Pozostali gracze stracili wszystkie żetony.` 
            });
        } else {
            io.to(lobby.code).emit('gameStatus', { message: 'Za mało graczy. Gra zakończona.' });
        }
        
        broadcastGameState(lobby);
        broadcastLobbyState(lobby);
        return;
    }
    
    // Dostosuj indeks dealera (może być poza zakresem po usunięciu graczy)
    if (gameState.dealerIndex >= gameState.players.length) {
        gameState.dealerIndex = 0;
    }
    gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
    
    resetRound(gameState);
    dealHoleCards(gameState);
    postBlinds(gameState, lobby);
    
    broadcastGameState(lobby);
    broadcastLobbyState(lobby);
}

function startNewRound(lobby) {
    const gameState = lobby.gameState;
    
    // === SPRAWDŹ CZY JEST PENDING BOMB POT ===
    if (lobby.pendingBombPot) {
        console.log(`[BOMB-POT] Rozpoczynanie Bomb Pot ze stawką ${lobby.pendingBombPot.stake}`);
        startBombPotRound(lobby);
        return;
    }
    
    // Deleguj do normalnej rundy
    startNormalRound(lobby);
}

function startGame(lobby) {
    const activePlayers = lobby.players.filter(p => !p.isSpectator);
    
    if (activePlayers.length < lobby.config.minPlayers) {
        return { success: false, message: `Potrzeba minimum ${lobby.config.minPlayers} graczy do rozpoczęcia gry.` };
    }
    
    lobby.gameState = createGameState(lobby);
    lobby.isGameStarted = true;
    lobby.gameState.isGameStarted = true;
    lobby.gameState.dealerIndex = 0;
    
    resetRound(lobby.gameState);
    dealHoleCards(lobby.gameState);
    postBlinds(lobby.gameState, lobby);
    
    io.to(lobby.code).emit('gameStatus', { message: 'Gra rozpoczęta!' });
    io.to(lobby.code).emit('gameStarted');
    broadcastGameState(lobby);
    broadcastLobbyState(lobby);
    
    return { success: true };
}

// ============== AKCJE GRACZY ==============
function playerFold(lobby, playerId) {
    const gameState = lobby.gameState;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player || player.folded) return false;
    
    player.folded = true;
    player.hasActed = true;
    
    io.to(lobby.code).emit('playerAction', { playerId, playerName: player.name, action: 'fold' });
    
    if (getPlayersInHand(gameState).length === 1) {
        endRound(lobby);
        return true;
    }
    
    findNextPlayer(lobby);
    return true;
}

function playerCheck(lobby, playerId) {
    const gameState = lobby.gameState;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player || player.folded) return false;
    
    if (player.currentBet < gameState.currentBet) {
        return false;
    }
    
    player.hasActed = true;
    
    io.to(lobby.code).emit('playerAction', { playerId, playerName: player.name, action: 'check' });
    
    findNextPlayer(lobby);
    return true;
}

function playerCall(lobby, playerId) {
    const gameState = lobby.gameState;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player || player.folded) return false;
    
    const callAmount = gameState.currentBet - player.currentBet;
    
    if (callAmount <= 0) return false;
    
    const actualCall = Math.min(callAmount, player.chips);
    player.chips -= actualCall;
    player.currentBet += actualCall;
    player.totalContribution = (player.totalContribution || 0) + actualCall; // Śledź całkowitą wpłatę
    gameState.pot += actualCall;
    player.hasActed = true;
    
    if (player.chips === 0) {
        player.isAllIn = true;
    }
    
    io.to(lobby.code).emit('playerAction', { playerId, playerName: player.name, action: 'call', amount: actualCall });
    
    // Broadcast natychmiastowy update żetonów (przed sprawdzeniem all-in showdown)
    broadcastGameState(lobby);
    
    findNextPlayer(lobby);
    return true;
}

function playerBet(lobby, playerId, amount) {
    const gameState = lobby.gameState;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player || player.folded) return false;
    
    amount = parseInt(amount);
    
    if (gameState.currentBet > 0) {
        const minRaise = gameState.currentBet + gameState.minRaise;
        if (amount < minRaise && amount < player.chips + player.currentBet) {
            return false;
        }
    } else {
        if (amount < gameState.config.bigBlind && amount < player.chips) {
            return false;
        }
    }
    
    const toAdd = amount - player.currentBet;
    const actualBet = Math.min(toAdd, player.chips);
    
    player.chips -= actualBet;
    const previousBet = gameState.currentBet;
    player.currentBet += actualBet;
    player.totalContribution = (player.totalContribution || 0) + actualBet; // Śledź całkowitą wpłatę
    gameState.pot += actualBet;
    gameState.currentBet = player.currentBet;
    gameState.minRaise = player.currentBet - previousBet;
    player.hasActed = true;
    
    if (player.chips === 0) {
        player.isAllIn = true;
    }
    
    gameState.players.forEach(p => {
        if (p.id !== playerId && !p.folded && !p.isAllIn) {
            p.hasActed = false;
        }
    });
    
    const actionType = previousBet > 0 ? 'raise' : 'bet';
    io.to(lobby.code).emit('playerAction', { playerId, playerName: player.name, action: actionType, amount: player.currentBet });
    
    findNextPlayer(lobby);
    return true;
}

// ============== BROADCAST ==============
function broadcastLobbyState(lobby) {
    // Oblicz liczbę graczy + oczekujących
    const activePlayersCount = lobby.gameState ? lobby.gameState.players.length : lobby.players.filter(p => !p.isSpectator).length;
    const pendingCount = lobby.spectators.filter(s => s.pendingJoin).length;
    const canJoinGame = (activePlayersCount + pendingCount) < lobby.config.maxPlayers;
    
    console.log(`[LOBBY-STATE] code=${lobby.code} activePlayersCount=${activePlayersCount} pendingCount=${pendingCount} maxPlayers=${lobby.config.maxPlayers} canJoinGame=${canJoinGame} isGameStarted=${lobby.isGameStarted}`);
    
    const lobbyInfo = {
        code: lobby.code,
        hostId: lobby.hostId,
        config: lobby.config,
        isGameStarted: lobby.isGameStarted,
        players: lobby.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            isSpectator: p.isSpectator,
            isReady: p.isReady
        })),
        spectators: lobby.spectators.map(s => ({
            id: s.id,
            name: s.name,
            pendingJoin: s.pendingJoin || false
        })),
        canStart: lobby.players.filter(p => !p.isSpectator).length >= lobby.config.minPlayers,
        canJoinGame: canJoinGame,
        activePlayersCount: activePlayersCount,
        pendingJoinCount: pendingCount
    };
    
    io.to(lobby.code).emit('lobbyState', lobbyInfo);
}

function broadcastGameState(lobby) {
    if (!lobby.gameState) return;
    
    const gameState = lobby.gameState;
    
    gameState.players.forEach(player => {
        const socket = io.sockets.sockets.get(player.id);
        if (socket) {
            socket.emit('gameState', getPlayerView(lobby, player.id));
        }
    });
    
    lobby.spectators.forEach(spectator => {
        const socket = io.sockets.sockets.get(spectator.id);
        if (socket) {
            socket.emit('gameState', getSpectatorView(lobby));
        }
    });
}

function getPlayerView(lobby, playerId) {
    const gameState = lobby.gameState;
    const player = gameState.players.find(p => p.id === playerId);
    const timerData = turnTimers.get(lobby.code);
    const voteData = bombPotVotes.get(lobby.code);
    
    // Oblicz indeksy SB i BB
    const numPlayers = gameState.players.length;
    const sbIndex = (gameState.dealerIndex + 1) % numPlayers;
    const bbIndex = (gameState.dealerIndex + 2) % numPlayers;
    
    // Sprawdź czy to Bomb Pot - wszystkie karty widoczne
    const isBombPot = gameState.isBombPot || false;
    
    // Lista widzów z informacją o oczekujących
    const spectatorsList = lobby.spectators.map(s => ({
        name: s.name,
        pendingJoin: s.pendingJoin || false
    }));
    
    return {
        phase: gameState.phase,
        pot: gameState.pot,
        currentBet: gameState.currentBet,
        communityCards: gameState.communityCards,
        allInShowdown: gameState.allInShowdown || false,
        isBombPot: isBombPot,
        bombPotStake: gameState.bombPotStake || null,
        runItTwice: gameState.runItTwice || false,
        spectators: spectatorsList,
        players: gameState.players.map((p, idx) => {
            const showCards = p.id === playerId ? true : 
                   (isBombPot && gameState.bombPotParticipants?.includes(p.id) && !p.folded) ||
                   (((gameState.phase === 'showdown' && !gameState.wonByFold) || gameState.allInShowdown || gameState.runItTwice) && !p.folded);
            
            // W showdown lub all-in showdown - oblicz karty do podświetlenia dla każdego gracza
            let playerHighlightCards = [];
            if (showCards && p.cards && p.cards.length === 2 && gameState.communityCards.length >= 3 && !p.folded) {
                const hand = getBestHand(p.cards, gameState.communityCards);
                playerHighlightCards = hand?.cards || [];
            }
            
            return {
                id: p.id,
                name: p.name,
                chips: p.chips,
                currentBet: p.currentBet,
                folded: p.folded,
                isAllIn: p.isAllIn,
                isDealer: idx === gameState.dealerIndex,
                isSB: idx === sbIndex,
                isBB: idx === bbIndex,
                isCurrentPlayer: idx === gameState.currentPlayerIndex,
                cards: showCards ? p.cards : null,
                // Karty do podświetlenia dla tego gracza (widoczne w showdown dla wszystkich)
                highlightCards: (gameState.phase === 'showdown' || gameState.allInShowdown || isBombPot) ? playerHighlightCards : []
            };
        }),
        yourCards: player ? player.cards : [],
        yourHand: player && player.cards.length === 2 && gameState.communityCards.length >= 3 
            ? getBestHand(player.cards, gameState.communityCards) 
            : null,
        // Karty do podświetlenia tylko dla własnego układu (podczas gry, przed showdown)
        highlightCards: (() => {
            if (player && player.cards.length === 2 && gameState.communityCards.length >= 3 && !player.folded) {
                const bestHand = getBestHand(player.cards, gameState.communityCards);
                return bestHand?.cards || [];
            }
            return [];
        })(),
        isYourTurn: player && gameState.players.indexOf(player) === gameState.currentPlayerIndex && !player.folded,
        canCheck: player && player.currentBet >= gameState.currentBet,
        callAmount: player ? gameState.currentBet - player.currentBet : 0,
        minBet: gameState.currentBet > 0 ? gameState.currentBet + gameState.minRaise : gameState.config.bigBlind,
        isGameStarted: gameState.isGameStarted,
        config: gameState.config,
        isSpectator: false,
        // Oblicz side poty na żywo (jeśli są gracze all-in)
        sidePots: calculateLiveSidePots(gameState),
        turnTimer: timerData ? {
            playerId: timerData.playerId,
            expiresAt: timerData.expiresAt,
            duration: TURN_TIMEOUT
        } : null,
        bombPotVote: voteData ? {
            initiatorName: voteData.initiatorName,
            stake: voteData.stake,
            expiresAt: voteData.expiresAt,
            hasVoted: voteData.votes.has(playerId),
            myVote: voteData.votes.get(playerId)
        } : null
    };
}

function getSpectatorView(lobby) {
    const gameState = lobby.gameState;
    const timerData = turnTimers.get(lobby.code);
    const voteData = bombPotVotes.get(lobby.code);
    
    // Oblicz indeksy SB i BB
    const numPlayers = gameState.players.length;
    const sbIndex = (gameState.dealerIndex + 1) % numPlayers;
    const bbIndex = (gameState.dealerIndex + 2) % numPlayers;
    
    // Sprawdź czy to Bomb Pot - wszystkie karty widoczne
    const isBombPot = gameState.isBombPot || false;
    
    // Lista widzów z informacją o oczekujących
    const spectatorsList = lobby.spectators.map(s => ({
        name: s.name,
        pendingJoin: s.pendingJoin || false
    }));
    
    return {
        phase: gameState.phase,
        pot: gameState.pot,
        currentBet: gameState.currentBet,
        communityCards: gameState.communityCards,
        allInShowdown: gameState.allInShowdown || false,
        isBombPot: isBombPot,
        bombPotStake: gameState.bombPotStake || null,
        spectators: spectatorsList,
        players: gameState.players.map((p, idx) => {
            const showCards = (isBombPot && gameState.bombPotParticipants?.includes(p.id) && !p.folded) ||
                   (((gameState.phase === 'showdown' && !gameState.wonByFold) || gameState.allInShowdown) && !p.folded);
            
            // W showdown - oblicz karty do podświetlenia dla każdego gracza
            let playerHighlightCards = [];
            if (showCards && p.cards && p.cards.length === 2 && gameState.communityCards.length >= 3) {
                const hand = getBestHand(p.cards, gameState.communityCards);
                playerHighlightCards = hand?.cards || [];
            }
            
            return {
                id: p.id,
                name: p.name,
                chips: p.chips,
                currentBet: p.currentBet,
                folded: p.folded,
                isAllIn: p.isAllIn,
                isDealer: idx === gameState.dealerIndex,
                isSB: idx === sbIndex,
                isBB: idx === bbIndex,
                isCurrentPlayer: idx === gameState.currentPlayerIndex,
                cards: showCards ? p.cards : null,
                highlightCards: playerHighlightCards
            };
        }),
        yourCards: [],
        yourHand: null,
        isYourTurn: false,
        canCheck: false,
        callAmount: 0,
        minBet: gameState.config.bigBlind,
        isGameStarted: gameState.isGameStarted,
        config: gameState.config,
        isSpectator: true,
        sidePots: calculateLiveSidePots(gameState),
        turnTimer: timerData ? {
            playerId: timerData.playerId,
            expiresAt: timerData.expiresAt,
            duration: TURN_TIMEOUT
        } : null,
        bombPotVote: voteData ? {
            initiatorName: voteData.initiatorName,
            stake: voteData.stake,
            expiresAt: voteData.expiresAt
        } : null
    };
}

// ============== SOCKET.IO ==============
io.on('connection', (socket) => {
    console.log(`Połączono: ${socket.id}`);
    
    socket.on('createLobby', (playerName) => {
        const name = playerName?.trim() || `Host`;
        const lobby = createLobby(socket.id, name);
        
        socket.join(lobby.code);
        socket.emit('lobbyCreated', { code: lobby.code });
        broadcastLobbyState(lobby);
        
        console.log(`Lobby ${lobby.code} utworzone przez ${name}`);
    });
    
    socket.on('joinLobby', ({ code, playerName }) => {
        const lobby = getLobby(code);
        
        if (!lobby) {
            socket.emit('error', { message: 'Lobby nie istnieje!' });
            return;
        }
        
        const name = playerName?.trim() || `Gracz ${lobby.players.length + 1}`;
        let assignedAsSpectator = false;
        let joinMessage = '';
        
        // PRZYPADEK B: Gra jest w toku - automatycznie jako spectator
        if (lobby.isGameStarted) {
            if (lobby.spectators.length >= lobby.config.maxSpectators) {
                socket.emit('error', { message: 'Limit obserwatorów osiągnięty!' });
                return;
            }
            
            lobby.spectators.push({
                id: socket.id,
                name
            });
            
            assignedAsSpectator = true;
            joinMessage = 'Trwa rozgrywka. Dołączyłeś jako obserwator.';
            console.log(`[JOIN] ${name} dołączył do lobby ${lobby.code} jako OBSERWATOR (gra w toku)`);
        }
        // PRZYPADEK A: Gra się jeszcze nie zaczęła
        else {
            const activePlayers = lobby.players.filter(p => !p.isSpectator);
            
            // Sprawdz czy jest miejsce dla gracza
            if (activePlayers.length < lobby.config.maxPlayers) {
                lobby.players.push({
                    id: socket.id,
                    name,
                    isHost: false,
                    isSpectator: false,
                    isReady: false
                });
                
                assignedAsSpectator = false;
                joinMessage = 'Dołączyłeś jako gracz.';
                console.log(`[JOIN] ${name} dołączył do lobby ${lobby.code} jako GRACZ`);
            }
            // Stół pełny - dodaj jako spectatora
            else {
                if (lobby.spectators.length >= lobby.config.maxSpectators) {
                    socket.emit('error', { message: 'Lobby jest pełne!' });
                    return;
                }
                
                lobby.spectators.push({
                    id: socket.id,
                    name
                });
                
                assignedAsSpectator = true;
                joinMessage = 'Stół pełny. Dołączyłeś jako obserwator.';
                console.log(`[JOIN] ${name} dołączył do lobby ${lobby.code} jako OBSERWATOR (stół pełny)`);
            }
        }
        
        socket.join(lobby.code);
        socket.emit('joinedLobby', { 
            code: lobby.code, 
            isSpectator: assignedAsSpectator,
            message: joinMessage,
            isGameStarted: lobby.isGameStarted  // Dodaj informację czy gra trwa
        });
        
        io.to(lobby.code).emit('playerJoined', { id: socket.id, name, isSpectator: assignedAsSpectator });
        broadcastLobbyState(lobby);
        
        if (lobby.isGameStarted) {
            broadcastGameState(lobby);
        }
    });
    
    socket.on('becomeSpectator', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) return;
        
        const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;
        
        const player = lobby.players[playerIndex];
        if (player.isHost) {
            socket.emit('error', { message: 'Host nie może być obserwatorem!' });
            return;
        }
        
        // Jeśli gra trwa, wykonaj auto-fold
        if (lobby.isGameStarted && lobby.gameState) {
            const gamePlayer = lobby.gameState.players.find(p => p.id === socket.id);
            if (gamePlayer) {
                // Auto-fold jeśli gracz jest w rozdaniu
                if (!gamePlayer.folded) {
                    gamePlayer.folded = true;
                    io.to(lobby.code).emit('playerAction', { 
                        playerId: socket.id, 
                        playerName: gamePlayer.name, 
                        action: 'fold' 
                    });
                    console.log(`[BECOME-SPECTATOR] Gracz ${gamePlayer.name} auto-fold podczas przejścia na obserwatora`);
                }
                
                // Usuń z gameState.players
                const gamePlayerIndex = lobby.gameState.players.findIndex(p => p.id === socket.id);
                if (gamePlayerIndex !== -1) {
                    const wasCurrentPlayer = gamePlayerIndex === lobby.gameState.currentPlayerIndex;
                    lobby.gameState.players.splice(gamePlayerIndex, 1);
                    
                    // Dostosuj indeksy
                    if (lobby.gameState.currentPlayerIndex >= lobby.gameState.players.length) {
                        lobby.gameState.currentPlayerIndex = 0;
                    }
                    if (lobby.gameState.dealerIndex >= lobby.gameState.players.length) {
                        lobby.gameState.dealerIndex = 0;
                    }
                    
                    // Sprawdź czy gra może kontynuować
                    if (lobby.gameState.players.length < lobby.config.minPlayers) {
                        lobby.gameState.phase = 'waiting';
                        lobby.gameState.isGameStarted = false;
                        lobby.isGameStarted = false;
                        io.to(lobby.code).emit('gameStatus', { message: 'Za mało graczy. Gra zakończona.' });
                    } else if (wasCurrentPlayer) {
                        findNextPlayer(lobby);
                    } else if (getPlayersInHand(lobby.gameState).length <= 1) {
                        endRound(lobby);
                    }
                }
            }
        }
        
        // Usuń z lobby.players
        lobby.players.splice(playerIndex, 1);
        
        // Dodaj do spectatorów
        lobby.spectators.push({
            id: socket.id,
            name: player.name
        });
        
        socket.emit('becameSpectator', { message: 'Jesteś teraz obserwatorem.' });
        
        broadcastLobbyState(lobby);
        if (lobby.isGameStarted && lobby.gameState) {
            broadcastGameState(lobby);
        }
    });
    
    socket.on('becomePlayer', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || lobby.isGameStarted) return;
        
        const spectatorIndex = lobby.spectators.findIndex(s => s.id === socket.id);
        if (spectatorIndex === -1) return;
        
        if (lobby.players.filter(p => !p.isSpectator).length >= lobby.config.maxPlayers) {
            socket.emit('error', { message: 'Stół jest pełny!' });
            return;
        }
        
        const spectator = lobby.spectators[spectatorIndex];
        lobby.spectators.splice(spectatorIndex, 1);
        lobby.players.push({
            id: socket.id,
            name: spectator.name,
            isHost: false,
            isSpectator: false,
            isReady: false
        });
        
        broadcastLobbyState(lobby);
    });
    
    // === DOŁĄCZANIE DO GRY W TRAKCIE ROZGRYWKI ===
    socket.on('requestJoinGame', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) {
            socket.emit('error', { message: 'Nie jesteś w żadnym lobby!' });
            return;
        }
        
        // Sprawdź czy gracz jest spectatorem
        const spectator = lobby.spectators.find(s => s.id === socket.id);
        if (!spectator) {
            socket.emit('error', { message: 'Nie jesteś obserwatorem!' });
            return;
        }
        
        // Sprawdź czy już nie oczekuje
        if (spectator.pendingJoin) {
            socket.emit('error', { message: 'Już oczekujesz na dołączenie!' });
            return;
        }
        
        // Oblicz dostępne miejsca
        const activePlayersCount = lobby.gameState ? lobby.gameState.players.length : lobby.players.filter(p => !p.isSpectator).length;
        const pendingCount = lobby.spectators.filter(s => s.pendingJoin).length;
        
        if ((activePlayersCount + pendingCount) >= lobby.config.maxPlayers) {
            socket.emit('error', { message: 'Brak wolnych miejsc przy stole!' });
            return;
        }
        
        // Jeśli gra nie trwa, od razu dodaj do graczy
        if (!lobby.isGameStarted) {
            lobby.spectators.splice(lobby.spectators.indexOf(spectator), 1);
            lobby.players.push({
                id: socket.id,
                name: spectator.name,
                isHost: false,
                isSpectator: false,
                isReady: true
            });
            
            // Dodaj też do gameState.players jeśli gameState istnieje (gra była wcześniej)
            if (lobby.gameState && lobby.gameState.players) {
                // Sprawdź czy gracz już nie jest w gameState
                const alreadyInGameState = lobby.gameState.players.some(p => p.id === socket.id);
                if (!alreadyInGameState) {
                    lobby.gameState.players.push({
                        id: socket.id,
                        name: spectator.name,
                        chips: lobby.config.startingChips,
                        cards: [],
                        folded: false,
                        currentBet: 0,
                        hasActed: false,
                        isAllIn: false
                    });
                }
            }
            
            socket.emit('joinedGame', {
                chips: lobby.config.startingChips,
                message: 'Dołączyłeś do gry!'
            });
            
            console.log(`[JOIN-GAME] Gracz ${spectator.name} dołączył do gry (gra nie trwa)`);
            
            // Sprawdź czy jest wystarczająco graczy do automatycznego wznowienia gry
            const activePlayersCount = lobby.gameState ? lobby.gameState.players.length : lobby.players.filter(p => !p.isSpectator).length;
            
            if (activePlayersCount >= lobby.config.minPlayers && !lobby.isGameStarted) {
                console.log(`[AUTO-RESUME] Wystarczająco graczy (${activePlayersCount}), wznawianie gry...`);
                
                // Wznów grę
                lobby.isGameStarted = true;
                lobby.gameState.isGameStarted = true;
                
                // Rozpocznij nową rundę
                startNewRound(lobby);
                
                io.to(lobby.code).emit('gameStatus', { message: 'Gra wznowiona!' });
                io.to(lobby.code).emit('gameStarted');
            }
            
            broadcastLobbyState(lobby);
            if (lobby.gameState) {
                broadcastGameState(lobby);
            }
            return;
        }
        
        // Gra trwa - dodaj do kolejki pending
        spectator.pendingJoin = true;
        
        socket.emit('pendingJoinConfirmed', {
            message: 'Zostałeś dodany do kolejki. Dołączysz do stołu w następnym rozdaniu.',
            startingChips: lobby.config.startingChips
        });
        
        io.to(lobby.code).emit('playerPendingJoin', {
            playerId: socket.id,
            playerName: spectator.name
        });
        
        broadcastLobbyState(lobby);
        console.log(`[PENDING-JOIN] Gracz ${spectator.name} dodany do kolejki oczekujących`);
    });
    
    // === ANULOWANIE OCZEKIWANIA NA DOŁĄCZENIE ===
    socket.on('cancelPendingJoin', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) return;
        
        const spectator = lobby.spectators.find(s => s.id === socket.id);
        if (!spectator || !spectator.pendingJoin) return;
        
        spectator.pendingJoin = false;
        
        socket.emit('pendingJoinCancelled', { message: 'Anulowano oczekiwanie na dołączenie.' });
        broadcastLobbyState(lobby);
        console.log(`[PENDING-JOIN] Gracz ${spectator.name} anulował oczekiwanie`);
    });
    
    // === OPUSZCZANIE LOBBY ===
    socket.on('leaveLobby', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) return;
        
        const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
        const spectatorIndex = lobby.spectators.findIndex(s => s.id === socket.id);
        
        let leftName = '';
        let wasHost = false;
        
        if (playerIndex !== -1) {
            const player = lobby.players[playerIndex];
            leftName = player.name;
            wasHost = player.isHost;
            
            // Sprawdź czy gracz jest aktywny w grze (nie może opuścić)
            if (lobby.isGameStarted && lobby.gameState) {
                const gamePlayer = lobby.gameState.players.find(p => p.id === socket.id);
                if (gamePlayer && !gamePlayer.folded) {
                    socket.emit('error', { message: 'Nie możesz opuścić lobby w trakcie gry! Zostań najpierw obserwatorem.' });
                    return;
                }
            }
            
            lobby.players.splice(playerIndex, 1);
            
            // Przekaż rolę hosta następnemu graczowi
            if (wasHost && lobby.players.length > 0) {
                lobby.players[0].isHost = true;
                lobby.hostId = lobby.players[0].id;
                io.to(lobby.code).emit('newHost', { id: lobby.players[0].id, name: lobby.players[0].name });
                console.log(`[LEAVE-LOBBY] Nowy host: ${lobby.players[0].name}`);
            }
        } else if (spectatorIndex !== -1) {
            leftName = lobby.spectators[spectatorIndex].name;
            lobby.spectators.splice(spectatorIndex, 1);
        } else {
            return; // Nie znaleziono gracza
        }
        
        // Opuść pokój socket.io
        socket.leave(lobby.code);
        
        // Wyślij potwierdzenie do gracza który opuścił
        socket.emit('leftLobby', { success: true, message: `Opuściłeś lobby` });
        
        // Sprawdź czy lobby jest puste
        if (lobby.players.length === 0 && lobby.spectators.length === 0) {
            clearTurnTimer(lobby.code);
            removeLobby(lobby.code);
            console.log(`[LEAVE-LOBBY] Lobby ${lobby.code} usunięte (puste)`);
            return;
        }
        
        // Powiadom pozostałych
        io.to(lobby.code).emit('playerLeft', { id: socket.id, name: leftName });
        
        // Aktualizuj stan gry jeśli trwa
        if (lobby.isGameStarted && lobby.gameState) {
            const gamePlayerIndex = lobby.gameState.players.findIndex(p => p.id === socket.id);
            if (gamePlayerIndex !== -1) {
                const wasCurrentPlayer = gamePlayerIndex === lobby.gameState.currentPlayerIndex;
                lobby.gameState.players.splice(gamePlayerIndex, 1);
                
                if (lobby.gameState.currentPlayerIndex >= lobby.gameState.players.length) {
                    lobby.gameState.currentPlayerIndex = 0;
                }
                if (lobby.gameState.dealerIndex >= lobby.gameState.players.length) {
                    lobby.gameState.dealerIndex = 0;
                }
                
                if (lobby.gameState.players.length < lobby.config.minPlayers) {
                    clearTurnTimer(lobby.code);
                    lobby.gameState.phase = 'waiting';
                    lobby.gameState.isGameStarted = false;
                    lobby.isGameStarted = false;
                    io.to(lobby.code).emit('gameStatus', { message: 'Za mało graczy. Gra zakończona.' });
                } else if (wasCurrentPlayer) {
                    clearTurnTimer(lobby.code);
                    findNextPlayer(lobby);
                } else if (getPlayersInHand(lobby.gameState).length <= 1) {
                    endRound(lobby);
                }
            }
            broadcastGameState(lobby);
        }
        
        broadcastLobbyState(lobby);
        console.log(`[LEAVE-LOBBY] ${leftName} opuścił lobby ${lobby.code}`);
    });
    
    socket.on('updateConfig', (newConfig) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || lobby.hostId !== socket.id || lobby.isGameStarted) return;
        
        if (newConfig.smallBlind !== undefined) {
            lobby.config.smallBlind = Math.max(1, parseInt(newConfig.smallBlind) || 10);
        }
        if (newConfig.bigBlind !== undefined) {
            lobby.config.bigBlind = Math.max(lobby.config.smallBlind, parseInt(newConfig.bigBlind) || 20);
            // Domyślnie ustaw BB Ante na wartość Big Blinda
            if (lobby.config.bbAnteAmount === undefined || newConfig.bbAnteAmount === undefined) {
                lobby.config.bbAnteAmount = lobby.config.bigBlind;
            }
        }
        if (newConfig.startingChips !== undefined) {
            lobby.config.startingChips = Math.max(100, parseInt(newConfig.startingChips) || 1000);
        }
        if (newConfig.bbAnteEnabled !== undefined) {
            lobby.config.bbAnteEnabled = !!newConfig.bbAnteEnabled;
        }
        if (newConfig.bbAnteAmount !== undefined) {
            lobby.config.bbAnteAmount = Math.max(1, parseInt(newConfig.bbAnteAmount) || lobby.config.bigBlind);
        }
        if (newConfig.bombPotEnabled !== undefined) {
            lobby.config.bombPotEnabled = !!newConfig.bombPotEnabled;
        }
        if (newConfig.runItTwiceEnabled !== undefined) {
            lobby.config.runItTwiceEnabled = !!newConfig.runItTwiceEnabled;
        }
        if (newConfig.cardSkin !== undefined) {
            const validSkins = ['classic', 'colorful', 'dark'];
            if (validSkins.includes(newConfig.cardSkin)) {
                lobby.config.cardSkin = newConfig.cardSkin;
            }
        }
        
        broadcastLobbyState(lobby);
    });
    
    socket.on('startGame', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) {
            socket.emit('error', { message: 'Nie jesteś w żadnym lobby!' });
            return;
        }
        
        if (lobby.hostId !== socket.id) {
            socket.emit('error', { message: 'Tylko host może rozpocząć grę!' });
            return;
        }
        
        const result = startGame(lobby);
        if (!result.success) {
            socket.emit('error', { message: result.message });
        }
    });
    
    socket.on('playerAction', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const gameState = lobby.gameState;
        const player = gameState.players.find(p => p.id === socket.id);
        
        if (!player) {
            socket.emit('error', { message: 'Nie jesteś graczem!' });
            return;
        }
        
        if (gameState.players.indexOf(player) !== gameState.currentPlayerIndex) {
            socket.emit('error', { message: 'Nie twoja kolej!' });
            return;
        }
        
        if (gameState.phase === 'waiting' || gameState.phase === 'showdown') {
            socket.emit('error', { message: 'Nie można teraz wykonać akcji!' });
            return;
        }
        
        let success = false;
        
        // Wyczyść timer przed wykonaniem akcji
        clearTurnTimer(lobby.code);
        
        switch (data.action) {
            case 'fold':
                success = playerFold(lobby, socket.id);
                break;
            case 'check':
                success = playerCheck(lobby, socket.id);
                break;
            case 'call':
                success = playerCall(lobby, socket.id);
                break;
            case 'bet':
            case 'raise':
                success = playerBet(lobby, socket.id, data.amount);
                break;
        }
        
        if (!success) {
            socket.emit('error', { message: 'Nieprawidłowa akcja!' });
            // Jeśli akcja nieudana, uruchom timer ponownie
            startTurnTimer(lobby);
        }
    });
    
    // ============== REVEAL HAND (Show Cards after fold win) ==============
    socket.on('revealHand', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) return;
        
        const gameState = lobby.gameState;
        
        // Przypadek 1: Zwycięzca przez fold pokazuje karty
        if (gameState.wonByFold && gameState.foldWinnerId === socket.id) {
            const cards = gameState.foldWinnerCards;
            if (!cards || cards.length === 0) {
                socket.emit('error', { message: 'Brak kart do pokazania!' });
                return;
            }
            
            const player = lobby.players.find(p => p.id === socket.id);
            const playerName = player ? player.name : 'Gracz';
            
            // Wyślij karty wszystkim w lobby
            io.to(lobby.code).emit('cardsRevealed', {
                playerId: socket.id,
                playerName: playerName,
                cards: cards
            });
            
            console.log(`[SHOW CARDS] ${playerName} pokazał karty: ${cards.join(', ')}`);
            
            // Wyczyść flagi aby nie można było pokazać ponownie
            gameState.wonByFold = false;
            gameState.foldWinnerId = null;
            gameState.foldWinnerCards = null;
            return;
        }
        
        // Przypadek 2: Gracz który sfoldował pokazuje karty (przekazane z klienta)
        if (data && data.foldedCards && Array.isArray(data.foldedCards) && data.foldedCards.length === 2) {
            const player = lobby.players.find(p => p.id === socket.id);
            const playerName = player ? player.name : 'Gracz';
            
            // Wyślij karty wszystkim w lobby
            io.to(lobby.code).emit('cardsRevealed', {
                playerId: socket.id,
                playerName: playerName,
                cards: data.foldedCards
            });
            
            console.log(`[SHOW FOLDED CARDS] ${playerName} pokazał sfoldowane karty: ${data.foldedCards.join(', ')}`);
            return;
        }
        
        socket.emit('error', { message: 'Nie możesz teraz pokazać kart!' });
    });
    
    // ============== BOMB POT SOCKET HANDLERS ==============
    socket.on('startBombPotVote', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        if (!lobby.config.bombPotEnabled) {
            socket.emit('error', { message: 'Głosowania Bomb Pot są wyłączone!' });
            return;
        }
        
        const gameState = lobby.gameState;
        const player = gameState.players.find(p => p.id === socket.id);
        
        if (!player) {
            socket.emit('error', { message: 'Nie jesteś graczem!' });
            return;
        }
        
        // Sprawdź czy trwa już głosowanie
        if (bombPotVotes.has(lobby.code)) {
            socket.emit('error', { message: 'Głosowanie już trwa!' });
            return;
        }
        
        const stake = parseInt(data?.stake) || lobby.config.bigBlind * 5;
        
        if (stake < lobby.config.bigBlind) {
            socket.emit('error', { message: `Stawka musi wynosić minimum ${lobby.config.bigBlind}!` });
            return;
        }
        
        if (player.chips < stake) {
            socket.emit('error', { message: 'Nie masz wystarczająco żetonów!' });
            return;
        }
        
        startBombPotVote(lobby, socket.id, stake);
    });
    
    socket.on('castBombPotVote', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const result = castBombPotVote(lobby, socket.id, data?.vote === true);
        if (result && result.error) {
            socket.emit('error', { message: result.error });
        }
    });
    
    // ============== RUN IT TWICE SOCKET HANDLER ==============
    socket.on('castRunItTwiceVote', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const voteData = runItTwiceVotes.get(lobby.code);
        if (!voteData) {
            socket.emit('error', { message: 'Brak aktywnego głosowania Run It Twice!' });
            return;
        }
        
        // Sprawdź czy gracz jest uczestnikiem głosowania
        if (!voteData.players.has(socket.id)) {
            socket.emit('error', { message: 'Nie uczestniczysz w tym głosowaniu!' });
            return;
        }
        
        castRunItTwiceVote(lobby, socket.id, data?.vote === true);
    });
    
    socket.on('disconnect', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) return;
        
        const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
        const spectatorIndex = lobby.spectators.findIndex(s => s.id === socket.id);
        
        let leftName = '';
        let wasPendingJoin = false;
        
        if (playerIndex !== -1) {
            leftName = lobby.players[playerIndex].name;
            const wasHost = lobby.players[playerIndex].isHost;
            lobby.players.splice(playerIndex, 1);
            
            if (wasHost && lobby.players.length > 0) {
                lobby.players[0].isHost = true;
                lobby.hostId = lobby.players[0].id;
                io.to(lobby.code).emit('newHost', { id: lobby.players[0].id, name: lobby.players[0].name });
            }
        } else if (spectatorIndex !== -1) {
            leftName = lobby.spectators[spectatorIndex].name;
            wasPendingJoin = lobby.spectators[spectatorIndex].pendingJoin || false;
            lobby.spectators.splice(spectatorIndex, 1);
            
            if (wasPendingJoin) {
                console.log(`[PENDING-JOIN] Gracz ${leftName} opuścił lobby - usunięto z kolejki oczekujących`);
            }
        }
        
        if (lobby.players.length === 0 && lobby.spectators.length === 0) {
            removeLobby(lobby.code);
            console.log(`Lobby ${lobby.code} usunięte (puste)`);
            return;
        }
        
        io.to(lobby.code).emit('playerLeft', { id: socket.id, name: leftName });
        
        if (lobby.isGameStarted && lobby.gameState) {
            const gamePlayerIndex = lobby.gameState.players.findIndex(p => p.id === socket.id);
            if (gamePlayerIndex !== -1) {
                const wasCurrentPlayer = gamePlayerIndex === lobby.gameState.currentPlayerIndex;
                lobby.gameState.players.splice(gamePlayerIndex, 1);
                
                if (lobby.gameState.currentPlayerIndex >= lobby.gameState.players.length) {
                    lobby.gameState.currentPlayerIndex = 0;
                }
                if (lobby.gameState.dealerIndex >= lobby.gameState.players.length) {
                    lobby.gameState.dealerIndex = 0;
                }
                
                if (lobby.gameState.players.length < lobby.config.minPlayers) {
                    lobby.gameState.phase = 'waiting';
                    lobby.gameState.isGameStarted = false;
                    lobby.isGameStarted = false;
                    io.to(lobby.code).emit('gameStatus', { message: 'Za mało graczy. Gra zakończona.' });
                } else if (wasCurrentPlayer) {
                    findNextPlayer(lobby);
                } else if (getPlayersInHand(lobby.gameState).length <= 1) {
                    endRound(lobby);
                }
            }
            broadcastGameState(lobby);
        }
        
        broadcastLobbyState(lobby);
        console.log(`${leftName} opuścił lobby ${lobby.code}`);
    });
    
    socket.on('getState', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (lobby) {
            broadcastLobbyState(lobby);
            if (lobby.gameState) {
                const isSpectator = lobby.spectators.some(s => s.id === socket.id);
                if (isSpectator) {
                    socket.emit('gameState', getSpectatorView(lobby));
                } else {
                    socket.emit('gameState', getPlayerView(lobby, socket.id));
                }
            }
        }
    });
});

// ============== START SERWERA ==============
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    🃏 SUPER POKER 🃏                        ║
╠════════════════════════════════════════════════════════════╣
║  Serwer nasłuchuje na porcie ${PORT}                          ║
║                                                            ║
║  Aby zagrać lokalnie:                                      ║
║  → http://localhost:${PORT}                                   ║
║                                                            ║
║  Aby zagrać z innego urządzenia w sieci:                   ║
║  → http://<TWÓJ_ADRES_IP>:${PORT}                             ║
║                                                            ║
║  System Lobby - twórz pokoje z unikalnymi kodami!          ║
╚════════════════════════════════════════════════════════════╝
    `);
});

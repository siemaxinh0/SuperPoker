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
    bbAnteAmount: 20,
    bombPotEnabled: true,
    runItTwiceEnabled: true,
    straddleEnabled: false, // Straddle feature
    cardSkin: 'classic',
    turnTimeout: 15 // Czas na ruch w sekundach
};

// ============== STRADDLE SYSTEM ==============
// pendingStraddles przechowywane w lobby: { playerId, playerName, amount, position, timestamp }

// Oblicza AKTUALNĄ pozycję gracza w bieżącym rozdaniu
function getPlayerCurrentPosition(gameState, playerId) {
    if (!gameState) return null;
    
    const activePlayers = gameState.players.filter(p => p.chips > 0);
    if (activePlayers.length < 2) return null;
    
    const playerIndex = activePlayers.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;
    
    const dealerIndex = gameState.dealerIndex % activePlayers.length;
    const numPlayers = activePlayers.length;
    
    // Pozycje względem OBECNEGO dealera
    const sbIndex = (dealerIndex + 1) % numPlayers;
    const bbIndex = (dealerIndex + 2) % numPlayers;
    const utgIndex = (dealerIndex + 3) % numPlayers;
    const utg1Index = (dealerIndex + 4) % numPlayers;
    const utg2Index = (dealerIndex + 5) % numPlayers;
    
    if (playerIndex === dealerIndex) return 'BTN';
    if (playerIndex === sbIndex) return 'SB';
    if (playerIndex === bbIndex) return 'BB';
    if (playerIndex === utgIndex) return 'UTG';
    if (playerIndex === utg1Index && numPlayers > 4) return 'UTG+1';
    if (playerIndex === utg2Index && numPlayers > 5) return 'UTG+2';
    
    return 'OTHER';
}

// Oblicza pozycję gracza w NASTĘPNYM rozdaniu (dla deklaracji straddle)
function getPlayerPositionInNextRound(lobby, playerId) {
    const gameState = lobby.gameState;
    if (!gameState) return null;
    
    const activePlayers = gameState.players.filter(p => p.chips > 0);
    if (activePlayers.length < 2) return null;
    
    const playerIndex = activePlayers.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;
    
    // Oblicz następny dealer index
    const nextDealerIndex = (gameState.dealerIndex + 1) % activePlayers.length;
    
    // Pozycje względem NASTĘPNEGO dealera
    const numPlayers = activePlayers.length;
    const sbIndex = (nextDealerIndex + 1) % numPlayers;
    const bbIndex = (nextDealerIndex + 2) % numPlayers;
    const utgIndex = (nextDealerIndex + 3) % numPlayers;
    const utg1Index = (nextDealerIndex + 4) % numPlayers;
    const utg2Index = (nextDealerIndex + 5) % numPlayers;
    
    if (playerIndex === nextDealerIndex) return 'BTN';
    if (playerIndex === sbIndex) return 'SB';
    if (playerIndex === bbIndex) return 'BB';
    if (playerIndex === utgIndex) return 'UTG';
    if (playerIndex === utg1Index && numPlayers > 4) return 'UTG+1';
    if (playerIndex === utg2Index && numPlayers > 5) return 'UTG+2';
    
    return 'OTHER';
}

function canDeclareStraddle(lobby, playerId) {
    if (!lobby.config.straddleEnabled) return { allowed: false, reason: 'Straddle wyłączone' };
    if (!lobby.gameState) return { allowed: false, reason: 'Gra nie rozpoczęta' };
    
    // Używamy pozycji w NASTĘPNYM rozdaniu (bo deklarujemy podczas bieżącego)
    const position = getPlayerPositionInNextRound(lobby, playerId);
    if (!position) return { allowed: false, reason: 'Nieprawidłowy gracz' };
    
    const player = lobby.gameState.players.find(p => p.id === playerId);
    if (!player) return { allowed: false, reason: 'Gracz nie znaleziony' };
    
    const pendingStraddles = lobby.pendingStraddles || [];
    
    // Znajdź istniejące straddle
    const existingUTG = pendingStraddles.find(s => s.position === 'UTG');
    const existingUTG1 = pendingStraddles.find(s => s.position === 'UTG+1');
    const existingUTG2 = pendingStraddles.find(s => s.position === 'UTG+2');
    const existingBTN = pendingStraddles.find(s => s.position === 'BTN');
    
    // Sprawdź czy gracz już ma zadeklarowany straddle
    const myExistingStraddle = pendingStraddles.find(s => s.playerId === playerId);
    if (myExistingStraddle) {
        return { allowed: false, reason: 'Już zadeklarowałeś Straddle' };
    }
    
    // Znajdź najwyższy istniejący straddle
    const allStraddles = [existingUTG, existingUTG1, existingUTG2, existingBTN].filter(Boolean);
    const highestExisting = allStraddles.length > 0 
        ? Math.max(...allStraddles.map(s => s.amount)) 
        : 0;
    
    // Oblicz wymaganą kwotę
    let requiredAmount = lobby.config.bigBlind * 2; // Bazowy straddle = 2x BB
    let isReStraddle = false;
    
    // ZASADA: Tylko jeden gracz może dać straddle za daną kwotę
    // Jeśli ktoś już dał straddle, następny musi dać 2x więcej
    
    if (position === 'UTG') {
        if (existingUTG) {
            return { allowed: false, reason: 'UTG już zadeklarował Straddle' };
        }
        // Jeśli BTN już dał straddle, UTG musi dać re-straddle (2x BTN)
        if (existingBTN) {
            requiredAmount = existingBTN.amount * 2;
            isReStraddle = true;
        } else {
            requiredAmount = lobby.config.bigBlind * 2;
        }
    } else if (position === 'UTG+1') {
        // UTG+1 może Re-Straddle tylko jeśli UTG lub BTN zadeklarował
        if (!existingUTG && !existingBTN) {
            return { allowed: false, reason: 'Czekaj aż UTG lub BTN zadeklaruje Straddle' };
        }
        if (existingUTG1) {
            return { allowed: false, reason: 'UTG+1 już zadeklarował Re-Straddle' };
        }
        // Re-Straddle = 2x najwyższego istniejącego
        requiredAmount = highestExisting * 2;
        isReStraddle = true;
    } else if (position === 'UTG+2') {
        // UTG+2 może Re-Re-Straddle tylko jeśli UTG+1 zadeklarował
        if (!existingUTG1) {
            return { allowed: false, reason: 'Czekaj aż UTG+1 zadeklaruje Re-Straddle' };
        }
        if (existingUTG2) {
            return { allowed: false, reason: 'UTG+2 już zadeklarował Re-Straddle' };
        }
        requiredAmount = highestExisting * 2;
        isReStraddle = true;
    } else if (position === 'BTN') {
        if (existingBTN) {
            return { allowed: false, reason: 'BTN już zadeklarował Straddle' };
        }
        // Jeśli UTG już dał straddle, BTN musi dać re-straddle (2x UTG)
        if (existingUTG) {
            requiredAmount = existingUTG.amount * 2;
            isReStraddle = true;
        } else {
            requiredAmount = lobby.config.bigBlind * 2;
        }
    } else {
        return { allowed: false, reason: `Pozycja ${position} nie może Straddle'ować` };
    }
    
    // Sprawdź środki
    if (player.chips < requiredAmount) {
        return { allowed: false, reason: `Za mało żetonów (potrzeba ${requiredAmount})` };
    }
    
    return { 
        allowed: true, 
        position, 
        amount: requiredAmount,
        isReStraddle
    };
}

function declareStraddle(lobby, playerId, customAmount = null) {
    const validation = canDeclareStraddle(lobby, playerId);
    if (!validation.allowed) {
        return { success: false, message: validation.reason };
    }
    
    const player = lobby.gameState.players.find(p => p.id === playerId);
    
    // Użyj customAmount jeśli podano i jest >= minimum
    let finalAmount = validation.amount;
    if (customAmount && customAmount >= validation.amount) {
        // Sprawdź czy gracz ma wystarczająco żetonów na większą kwotę
        if (player.chips >= customAmount) {
            finalAmount = customAmount;
        } else {
            return { success: false, message: `Za mało żetonów (masz ${player.chips})` };
        }
    }
    
    if (!lobby.pendingStraddles) {
        lobby.pendingStraddles = [];
    }
    
    const straddle = {
        playerId,
        playerName: player.name,
        amount: finalAmount,
        position: validation.position,
        isReStraddle: validation.isReStraddle,
        timestamp: Date.now()
    };
    
    lobby.pendingStraddles.push(straddle);
    
    console.log(`[STRADDLE] ${player.name} zadeklarował ${validation.isReStraddle ? 'Re-Straddle' : 'Straddle'} na pozycji ${validation.position}: ${finalAmount}`);
    
    return { 
        success: true, 
        straddle,
        message: `${validation.isReStraddle ? 'Re-Straddle' : 'Straddle'} zadeklarowany: ${finalAmount}`
    };
}

function cancelStraddle(lobby, playerId) {
    if (!lobby.pendingStraddles) return { success: false, message: 'Brak deklaracji' };
    
    const index = lobby.pendingStraddles.findIndex(s => s.playerId === playerId);
    if (index === -1) return { success: false, message: 'Nie masz aktywnej deklaracji' };
    
    const removed = lobby.pendingStraddles.splice(index, 1)[0];
    
    // Jeśli usunięto UTG straddle, usuń wszystkie zależne re-straddle
    if (removed.position === 'UTG') {
        const dependentPositions = ['UTG+1', 'UTG+2'];
        for (const pos of dependentPositions) {
            const depIndex = lobby.pendingStraddles.findIndex(s => s.position === pos);
            if (depIndex !== -1) {
                const depRemoved = lobby.pendingStraddles.splice(depIndex, 1)[0];
                const depSocket = io.sockets.sockets.get(depRemoved.playerId);
                if (depSocket) {
                    depSocket.emit('straddleCancelled', {
                        reason: 'UTG anulował Straddle'
                    });
                }
            }
        }
    }
    
    // Jeśli usunięto UTG+1 straddle, usuń UTG+2
    if (removed.position === 'UTG+1') {
        const utg2Index = lobby.pendingStraddles.findIndex(s => s.position === 'UTG+2');
        if (utg2Index !== -1) {
            const utg2Removed = lobby.pendingStraddles.splice(utg2Index, 1)[0];
            const utg2Socket = io.sockets.sockets.get(utg2Removed.playerId);
            if (utg2Socket) {
                utg2Socket.emit('straddleCancelled', {
                    reason: 'UTG+1 anulował Re-Straddle'
                });
            }
        }
    }
    
    console.log(`[STRADDLE] ${removed.playerName} anulował ${removed.isReStraddle ? 'Re-Straddle' : 'Straddle'}`);
    
    return { success: true, message: 'Straddle anulowany' };
}

// Walidacja straddle na początku nowego rozdania (używa AKTUALNEJ pozycji)
function validatePendingStraddlesForNewRound(lobby) {
    if (!lobby.pendingStraddles || lobby.pendingStraddles.length === 0) return;
    
    const gameState = lobby.gameState;
    const toRemove = [];
    
    for (const straddle of lobby.pendingStraddles) {
        // Sprawdź AKTUALNĄ pozycję gracza (po przesunięciu dealera)
        const currentPosition = getPlayerCurrentPosition(gameState, straddle.playerId);
        const player = gameState.players.find(p => p.id === straddle.playerId);
        
        console.log(`[STRADDLE-VALIDATE] ${straddle.playerName}: deklarowana=${straddle.position}, aktualna=${currentPosition}`);
        
        // Sprawdź czy gracz nadal ma tę samą pozycję
        if (currentPosition !== straddle.position) {
            toRemove.push(straddle);
            const socket = io.sockets.sockets.get(straddle.playerId);
            if (socket) {
                socket.emit('straddleCancelled', {
                    reason: `Zmiana pozycji: jesteś teraz ${currentPosition}, nie ${straddle.position}`
                });
            }
            console.log(`[STRADDLE] Anulowano straddle ${straddle.playerName} - zmiana pozycji z ${straddle.position} na ${currentPosition}`);
            continue;
        }
        
        // Sprawdź czy gracz ma wystarczająco żetonów
        if (!player || player.chips < straddle.amount) {
            toRemove.push(straddle);
            const socket = io.sockets.sockets.get(straddle.playerId);
            if (socket) {
                socket.emit('straddleCancelled', {
                    reason: 'Za mało żetonów na pokrycie Straddle'
                });
            }
            console.log(`[STRADDLE] Anulowano straddle ${straddle.playerName} - brak żetonów`);
        }
    }
    
    // Usuń nieprawidłowe deklaracje
    lobby.pendingStraddles = lobby.pendingStraddles.filter(s => !toRemove.includes(s));
    
    // Jeśli usunęliśmy UTG, musimy usunąć też UTG+1 i UTG+2
    const hasUTG = lobby.pendingStraddles.some(s => s.position === 'UTG');
    if (!hasUTG) {
        const dependentToRemove = lobby.pendingStraddles.filter(s => s.position === 'UTG+1' || s.position === 'UTG+2');
        for (const dep of dependentToRemove) {
            const socket = io.sockets.sockets.get(dep.playerId);
            if (socket) {
                socket.emit('straddleCancelled', {
                    reason: 'UTG nie ma Straddle'
                });
            }
        }
        lobby.pendingStraddles = lobby.pendingStraddles.filter(s => s.position !== 'UTG+1' && s.position !== 'UTG+2');
    }
    
    // Jeśli usunęliśmy UTG+1, musimy usunąć UTG+2
    const hasUTG1 = lobby.pendingStraddles.some(s => s.position === 'UTG+1');
    if (!hasUTG1) {
        const utg2ToRemove = lobby.pendingStraddles.filter(s => s.position === 'UTG+2');
        for (const dep of utg2ToRemove) {
            const socket = io.sockets.sockets.get(dep.playerId);
            if (socket) {
                socket.emit('straddleCancelled', {
                    reason: 'UTG+1 nie ma Re-Straddle'
                });
            }
        }
        lobby.pendingStraddles = lobby.pendingStraddles.filter(s => s.position !== 'UTG+2');
    }
}

function getStraddleInfo(lobby, playerId) {
    if (!lobby.config.straddleEnabled || !lobby.gameState) {
        return { canStraddle: false, pendingStraddles: [], currentPosition: null, nextPosition: null };
    }
    
    const validation = canDeclareStraddle(lobby, playerId);
    const myStraddle = (lobby.pendingStraddles || []).find(s => s.playerId === playerId);
    
    // Pobierz obie pozycje dla UI
    const currentPosition = getPlayerCurrentPosition(lobby.gameState, playerId);
    const nextPosition = getPlayerPositionInNextRound(lobby, playerId);
    
    return {
        canStraddle: validation.allowed,
        reason: validation.reason,
        amount: validation.amount,
        position: nextPosition, // Pozycja w następnym rozdaniu (dla deklaracji)
        currentPosition: currentPosition, // Aktualna pozycja (do wyświetlenia)
        nextPosition: nextPosition,
        isReStraddle: validation.isReStraddle,
        hasStraddle: !!myStraddle,
        myStraddle: myStraddle,
        pendingStraddles: (lobby.pendingStraddles || []).map(s => ({
            playerName: s.playerName,
            playerId: s.playerId,
            amount: s.amount,
            position: s.position,
            isReStraddle: s.isReStraddle
        }))
    };
}

// ============== TURN TIMER SYSTEM ==============
const turnTimers = new Map(); // lobbyCode -> { timer, playerId, expiresAt }

function startTurnTimer(lobby) {
    const gameState = lobby.gameState;
    if (!gameState || gameState.phase === 'waiting' || gameState.phase === 'showdown') return;
    
    // Wyczyść poprzedni timer
    clearTurnTimer(lobby.code);
    
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.isAllIn) return;
    
    const timeout = (lobby.config.turnTimeout || 15) * 1000;
    const expiresAt = Date.now() + timeout;
    
    const timer = setTimeout(() => {
        // Auto-fold gdy czas minie
        console.log(`[TURN-TIMER] Czas minął dla ${currentPlayer.name} - auto-fold`);
        
        // Sprawdź czy gracz wciąż jest aktualnym graczem
        if (gameState.players[gameState.currentPlayerIndex]?.id === currentPlayer.id) {
            playerFold(lobby, currentPlayer.id);
            
            io.to(lobby.code).emit('autoAction', {
                playerId: currentPlayer.id,
                playerName: currentPlayer.name,
                action: 'fold',
                reason: 'timeout'
            });
        }
        
        turnTimers.delete(lobby.code);
    }, timeout);
    
    turnTimers.set(lobby.code, {
        timer,
        playerId: currentPlayer.id,
        expiresAt
    });
    
    // Powiadom klientów o starcie timera
    io.to(lobby.code).emit('turnTimerStarted', {
        playerId: currentPlayer.id,
        expiresAt,
        duration: lobby.config.turnTimeout || 15
    });
}

function clearTurnTimer(lobbyCode) {
    const timerData = turnTimers.get(lobbyCode);
    if (timerData) {
        clearTimeout(timerData.timer);
        turnTimers.delete(lobbyCode);
        
        // Powiadom klientów
        io.to(lobbyCode).emit('turnTimerCleared');
    }
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

// ============== RUN IT TWICE VOTING ==============
const RUN_IT_TWICE_VOTE_TIMEOUT = 15000; // 15 sekund na głosowanie
const runItTwiceVotes = new Map(); // lobbyCode -> { votes: Map<playerId, boolean>, timer, expiresAt, playersInHand }

function startRunItTwiceVote(lobby) {
    const lobbyCode = lobby.code;
    const gameState = lobby.gameState;
    
    // Wyczyść poprzednie głosowanie jeśli istnieje
    clearRunItTwiceVote(lobbyCode);
    
    const playersInHand = gameState.players.filter(p => !p.folded);
    
    if (playersInHand.length < 2) {
        // Za mało graczy - kontynuuj normalnie
        runAllInCommunityCards(lobby);
        return;
    }
    
    const expiresAt = Date.now() + RUN_IT_TWICE_VOTE_TIMEOUT;
    
    const voteData = {
        votes: new Map(),
        expiresAt,
        playersInHand: playersInHand.map(p => p.id),
        timer: setTimeout(() => {
            endRunItTwiceVote(lobby, false); // Timeout = odrzucone
        }, RUN_IT_TWICE_VOTE_TIMEOUT)
    };
    
    runItTwiceVotes.set(lobbyCode, voteData);
    
    // Powiadom wszystkich o głosowaniu
    io.to(lobbyCode).emit('runItTwiceVoteStarted', {
        expiresAt: voteData.expiresAt,
        players: playersInHand.map(p => ({ id: p.id, name: p.name }))
    });
    
    console.log(`[RUN-IT-TWICE] Głosowanie rozpoczęte z ${playersInHand.length} graczami`);
}

function castRunItTwiceVote(lobby, playerId, vote) {
    const voteData = runItTwiceVotes.get(lobby.code);
    if (!voteData) return false;
    
    // Sprawdź czy gracz jest uprawniony do głosowania
    if (!voteData.playersInHand.includes(playerId)) {
        return { error: 'Nie uczestniczysz w tym rozdaniu!' };
    }
    
    voteData.votes.set(playerId, vote);
    
    const yesVotes = Array.from(voteData.votes.values()).filter(v => v === true).length;
    const noVotes = Array.from(voteData.votes.values()).filter(v => v === false).length;
    const totalVoters = voteData.playersInHand.length;
    const votedCount = voteData.votes.size;
    
    // Broadcast aktualizacji głosów
    io.to(lobby.code).emit('runItTwiceVoteUpdate', {
        yesVotes,
        noVotes,
        totalVoters,
        votedCount,
        votes: Object.fromEntries(voteData.votes)
    });
    
    const player = lobby.gameState.players.find(p => p.id === playerId);
    console.log(`[RUN-IT-TWICE] ${player?.name || playerId} zagłosował: ${vote ? 'TAK' : 'NIE'} (${yesVotes}/${totalVoters})`);
    
    // Jeśli ktoś głosuje NIE, od razu kończymy - wszyscy muszą się zgodzić
    if (vote === false) {
        endRunItTwiceVote(lobby, false);
        return true;
    }
    
    // Sprawdź czy wszyscy zagłosowali TAK
    if (yesVotes === totalVoters) {
        endRunItTwiceVote(lobby, true);
    }
    
    return true;
}

function endRunItTwiceVote(lobby, approved) {
    const voteData = runItTwiceVotes.get(lobby.code);
    if (!voteData) return;
    
    clearTimeout(voteData.timer);
    runItTwiceVotes.delete(lobby.code);
    
    if (approved) {
        // Wszyscy się zgodzili - uruchom Run It Twice
        io.to(lobby.code).emit('runItTwiceVoteResult', {
            success: true,
            message: 'Wszyscy zgodzili się! Karty zostaną rozdane dwukrotnie.'
        });
        
        console.log(`[RUN-IT-TWICE] Głosowanie PRZYJĘTE - uruchamianie Run It Twice`);
        
        // Uruchom Run It Twice z opóźnieniem
        setTimeout(() => {
            runAllInCommunityCardsRunItTwice(lobby);
        }, 1500);
    } else {
        // Ktoś się nie zgodził lub timeout
        io.to(lobby.code).emit('runItTwiceVoteResult', {
            success: false,
            message: 'Run It Twice odrzucone. Karty zostaną rozdane normalnie.'
        });
        
        console.log(`[RUN-IT-TWICE] Głosowanie ODRZUCONE - normalne rozdanie`);
        
        // Kontynuuj normalnie
        setTimeout(() => {
            runAllInCommunityCards(lobby);
        }, 1000);
    }
}

function clearRunItTwiceVote(lobbyCode) {
    const voteData = runItTwiceVotes.get(lobbyCode);
    if (voteData) {
        clearTimeout(voteData.timer);
        runItTwiceVotes.delete(lobbyCode);
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
    // Wyczyść głosowanie Bomb Pot przed usunięciem lobby
    clearBombPotVote(code);
    
    lobbies.delete(code);
    console.log(`[CLEANUP] Lobby ${code} usunięte`);
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
    gameState.allInShowdown = false;
    gameState.wonByFold = false;
    gameState.activeStraddles = [];
    
    gameState.players.forEach(p => {
        p.cards = [];
        p.folded = false;
        p.currentBet = 0;
        p.hasActed = false;
        p.isAllIn = false;
        p.totalContribution = 0;
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
    
    // === STRADDLE PROCESSING ===
    let lastStraddlerIndex = bbIndex;
    let highestStraddle = gameState.config.bigBlind;
    
    if (lobby && lobby.pendingStraddles && lobby.pendingStraddles.length > 0 && !gameState.isBombPot) {
        // Waliduj straddle (sprawdź pozycje w BIEŻĄCYM rozdaniu i środki)
        validatePendingStraddlesForNewRound(lobby);
        
        console.log(`[STRADDLE] Po walidacji: ${lobby.pendingStraddles.length} straddle do wykonania`);
        
        // Sortuj straddle: UTG najpierw, potem UTG+1, UTG+2, potem BTN
        const straddleOrder = ['UTG', 'UTG+1', 'UTG+2', 'BTN'];
        const sortedStraddles = [...lobby.pendingStraddles].sort((a, b) => {
            return straddleOrder.indexOf(a.position) - straddleOrder.indexOf(b.position);
        });
        
        gameState.activeStraddles = [];
        
        for (const straddle of sortedStraddles) {
            const straddlePlayer = activePlayers.find(p => p.id === straddle.playerId);
            if (!straddlePlayer) continue;
            
            const straddleAmount = Math.min(straddle.amount, straddlePlayer.chips);
            if (straddleAmount <= 0) continue;
            
            straddlePlayer.chips -= straddleAmount;
            straddlePlayer.currentBet = straddleAmount;
            straddlePlayer.totalContribution = (straddlePlayer.totalContribution || 0) + straddleAmount;
            gameState.pot += straddleAmount;
            
            if (straddlePlayer.chips === 0) {
                straddlePlayer.isAllIn = true;
            }
            
            // Aktualizuj najwyższy straddle
            if (straddleAmount > highestStraddle) {
                highestStraddle = straddleAmount;
                lastStraddlerIndex = activePlayers.findIndex(p => p.id === straddlePlayer.id);
            }
            
            gameState.activeStraddles.push({
                playerId: straddlePlayer.id,
                playerName: straddlePlayer.name,
                amount: straddleAmount,
                position: straddle.position
            });
            
            // Emituj informację o straddle
            if (lobby) {
                io.to(lobby.code).emit('straddlePosted', {
                    playerId: straddlePlayer.id,
                    playerName: straddlePlayer.name,
                    amount: straddleAmount,
                    position: straddle.position,
                    isReStraddle: straddle.isReStraddle
                });
            }
            
            console.log(`[STRADDLE] ${straddlePlayer.name} wpłaca ${straddle.isReStraddle ? 'Re-Straddle' : 'Straddle'}: ${straddleAmount}`);
        }
        
        // Wyczyść pending straddles po użyciu
        lobby.pendingStraddles = [];
        
        // Ustaw current bet na najwyższy straddle
        gameState.currentBet = highestStraddle;
        gameState.minRaise = highestStraddle; // Min raise = highest straddle
    }
    
    // Ustaw pierwszego gracza do akcji = gracz po ostatnim straddlerze (lub po BB jeśli brak straddle)
    gameState.currentPlayerIndex = (lastStraddlerIndex + 1) % activePlayers.length;
    
    const currentPlayer = activePlayers[gameState.currentPlayerIndex];
    gameState.currentPlayerIndex = gameState.players.findIndex(p => p.id === currentPlayer.id);
    
    // Zapisz kto ma "option" (ostatni straddler lub BB)
    if (gameState.activeStraddles && gameState.activeStraddles.length > 0) {
        const lastStraddle = gameState.activeStraddles[gameState.activeStraddles.length - 1];
        gameState.optionPlayerId = lastStraddle.playerId;
    } else {
        gameState.optionPlayerId = bbPlayer.id;
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
    
    // Wyczyść timer
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
    
    // Broadcast gameState żeby UI się zaktualizował
    broadcastGameState(lobby);
    
    // Sprawdź czy Run It Twice jest włączone i są karty do rozdania
    const cardsRemaining = 5 - gameState.communityCards.length;
    if (lobby.config.runItTwiceEnabled && cardsRemaining > 0 && playersInHand.length >= 2) {
        // Rozpocznij głosowanie Run It Twice
        startRunItTwiceVote(lobby);
    } else {
        // Od razu wykładaj karty normalnie
        runAllInCommunityCards(lobby);
    }
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

// ============== RUN IT TWICE COMMUNITY CARDS ==============
function runAllInCommunityCardsRunItTwice(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    // Oznacz że to Run It Twice
    gameState.runItTwice = true;
    
    // Zapisz aktualną talię i community cards
    const originalDeck = [...gameState.deck];
    const originalCommunityCards = [...gameState.communityCards];
    
    const phases = ['preflop', 'flop', 'turn', 'river'];
    const currentPhaseIndex = phases.indexOf(gameState.phase);
    
    // Oblicz ile kart potrzebujemy dla każdego runu
    const cardsNeededForFlop = currentPhaseIndex < 1 ? 3 : 0;
    const cardsNeededForTurn = currentPhaseIndex < 2 ? 1 : 0;
    const cardsNeededForRiver = currentPhaseIndex < 3 ? 1 : 0;
    const totalCardsNeeded = cardsNeededForFlop + cardsNeededForTurn + cardsNeededForRiver;
    
    // Weź karty dla pierwszego i drugiego runu
    const run1Cards = [];
    const run2Cards = [];
    
    for (let i = 0; i < totalCardsNeeded; i++) {
        run1Cards.push(originalDeck.pop());
    }
    for (let i = 0; i < totalCardsNeeded; i++) {
        run2Cards.push(originalDeck.pop());
    }
    
    // Przygotuj tablice dla każdego runu - zaczynamy od oryginalnych kart
    const run1CommunityCards = [...originalCommunityCards];
    const run2CommunityCards = [...originalCommunityCards];
    
    // Przygotuj pełne tablice do obliczeń (do użycia przy rozstrzygnięciu)
    const run1FinalCards = [...originalCommunityCards];
    const run2FinalCards = [...originalCommunityCards];
    
    let cardIndex = 0;
    if (cardsNeededForFlop > 0) {
        run1FinalCards.push(run1Cards[cardIndex], run1Cards[cardIndex + 1], run1Cards[cardIndex + 2]);
        run2FinalCards.push(run2Cards[cardIndex], run2Cards[cardIndex + 1], run2Cards[cardIndex + 2]);
        cardIndex += 3;
    }
    if (cardsNeededForTurn > 0) {
        run1FinalCards.push(run1Cards[cardIndex]);
        run2FinalCards.push(run2Cards[cardIndex]);
        cardIndex += 1;
    }
    if (cardsNeededForRiver > 0) {
        run1FinalCards.push(run1Cards[cardIndex]);
        run2FinalCards.push(run2Cards[cardIndex]);
    }
    
    // Zapisz obie tablice w gameState
    gameState.run1CommunityCards = run1FinalCards;
    gameState.run2CommunityCards = run2FinalCards;
    
    console.log(`[RUN-IT-TWICE] Run 1 community: ${run1FinalCards.map(c => c.value + c.suit).join(', ')}`);
    console.log(`[RUN-IT-TWICE] Run 2 community: ${run2FinalCards.map(c => c.value + c.suit).join(', ')}`);
    
    // Wyślij event o rozpoczęciu Run It Twice
    io.to(lobby.code).emit('runItTwiceStarted', {
        originalCommunityCards,
        phase: gameState.phase
    });
    
    // Animacja wykładania kart - karta po karcie
    let delay = 500;
    const CARD_DELAY = 800; // Opóźnienie między kartami
    const RUN_DELAY = 1500; // Opóźnienie między runami
    
    // Resetuj indeksy kart
    let run1CardIndex = 0;
    let run2CardIndex = 0;
    
    // ============ RUN 1 - karta po karcie ============
    
    // Flop (jeśli potrzebny)
    if (cardsNeededForFlop > 0) {
        for (let i = 0; i < 3; i++) {
            const cardToAdd = run1Cards[run1CardIndex++];
            setTimeout(() => {
                run1CommunityCards.push(cardToAdd);
                io.to(lobby.code).emit('runItTwiceCardDealt', {
                    runNumber: 1,
                    card: cardToAdd,
                    communityCards: [...run1CommunityCards],
                    phase: 'flop'
                });
                console.log(`[RUN-IT-TWICE] Run 1 - Flop karta ${i + 1}: ${cardToAdd.value}${cardToAdd.suit}`);
            }, delay);
            delay += CARD_DELAY;
        }
    }
    
    // Turn (jeśli potrzebny)
    if (cardsNeededForTurn > 0) {
        const cardToAdd = run1Cards[run1CardIndex++];
        setTimeout(() => {
            run1CommunityCards.push(cardToAdd);
            io.to(lobby.code).emit('runItTwiceCardDealt', {
                runNumber: 1,
                card: cardToAdd,
                communityCards: [...run1CommunityCards],
                phase: 'turn'
            });
            console.log(`[RUN-IT-TWICE] Run 1 - Turn: ${cardToAdd.value}${cardToAdd.suit}`);
        }, delay);
        delay += CARD_DELAY;
    }
    
    // River (jeśli potrzebny)
    if (cardsNeededForRiver > 0) {
        const cardToAdd = run1Cards[run1CardIndex++];
        setTimeout(() => {
            run1CommunityCards.push(cardToAdd);
            io.to(lobby.code).emit('runItTwiceCardDealt', {
                runNumber: 1,
                card: cardToAdd,
                communityCards: [...run1CommunityCards],
                phase: 'river'
            });
            console.log(`[RUN-IT-TWICE] Run 1 - River: ${cardToAdd.value}${cardToAdd.suit}`);
        }, delay);
        delay += CARD_DELAY;
    }
    
    // Przerwa między runami
    delay += RUN_DELAY;
    
    // ============ RUN 2 - karta po karcie ============
    
    // Flop (jeśli potrzebny)
    if (cardsNeededForFlop > 0) {
        for (let i = 0; i < 3; i++) {
            const cardToAdd = run2Cards[run2CardIndex++];
            setTimeout(() => {
                run2CommunityCards.push(cardToAdd);
                io.to(lobby.code).emit('runItTwiceCardDealt', {
                    runNumber: 2,
                    card: cardToAdd,
                    communityCards: [...run2CommunityCards],
                    phase: 'flop'
                });
                console.log(`[RUN-IT-TWICE] Run 2 - Flop karta ${i + 1}: ${cardToAdd.value}${cardToAdd.suit}`);
            }, delay);
            delay += CARD_DELAY;
        }
    }
    
    // Turn (jeśli potrzebny)
    if (cardsNeededForTurn > 0) {
        const cardToAdd = run2Cards[run2CardIndex++];
        setTimeout(() => {
            run2CommunityCards.push(cardToAdd);
            io.to(lobby.code).emit('runItTwiceCardDealt', {
                runNumber: 2,
                card: cardToAdd,
                communityCards: [...run2CommunityCards],
                phase: 'turn'
            });
            console.log(`[RUN-IT-TWICE] Run 2 - Turn: ${cardToAdd.value}${cardToAdd.suit}`);
        }, delay);
        delay += CARD_DELAY;
    }
    
    // River (jeśli potrzebny)
    if (cardsNeededForRiver > 0) {
        const cardToAdd = run2Cards[run2CardIndex++];
        setTimeout(() => {
            run2CommunityCards.push(cardToAdd);
            io.to(lobby.code).emit('runItTwiceCardDealt', {
                runNumber: 2,
                card: cardToAdd,
                communityCards: [...run2CommunityCards],
                phase: 'river'
            });
            console.log(`[RUN-IT-TWICE] Run 2 - River: ${cardToAdd.value}${cardToAdd.suit}`);
        }, delay);
        delay += CARD_DELAY;
    }
    
    // Rozstrzygnięcie po wszystkich kartach
    delay += RUN_DELAY;
    setTimeout(() => {
        gameState.phase = 'showdown';
        determineWinnerRunItTwice(lobby, run1FinalCards, run2FinalCards);
    }, delay);
}

function determineWinnerRunItTwice(lobby, run1Cards, run2Cards) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    // Oblicz zwycięzcę dla Run 1
    const run1Hands = playersInHand.map(player => ({
        player,
        hand: getBestHand(player.cards, run1Cards)
    }));
    run1Hands.sort((a, b) => compareHands(b.hand, a.hand));
    
    // Oblicz zwycięzcę dla Run 2
    const run2Hands = playersInHand.map(player => ({
        player,
        hand: getBestHand(player.cards, run2Cards)
    }));
    run2Hands.sort((a, b) => compareHands(b.hand, a.hand));
    
    // Znajdź zwycięzców Run 1
    const run1Winners = [run1Hands[0]];
    for (let i = 1; i < run1Hands.length; i++) {
        if (compareHands(run1Hands[i].hand, run1Hands[0].hand) === 0) {
            run1Winners.push(run1Hands[i]);
        }
    }
    
    // Znajdź zwycięzców Run 2
    const run2Winners = [run2Hands[0]];
    for (let i = 1; i < run2Hands.length; i++) {
        if (compareHands(run2Hands[i].hand, run2Hands[0].hand) === 0) {
            run2Winners.push(run2Hands[i]);
        }
    }
    
    // Podziel pulę na pół
    const halfPot = Math.floor(gameState.pot / 2);
    const remainder = gameState.pot % 2;
    
    // Wypłać Run 1
    const run1WinAmount = Math.floor((halfPot + remainder) / run1Winners.length);
    run1Winners.forEach(w => {
        w.player.chips += run1WinAmount;
    });
    
    // Wypłać Run 2
    const run2WinAmount = Math.floor(halfPot / run2Winners.length);
    run2Winners.forEach(w => {
        w.player.chips += run2WinAmount;
    });
    
    // Zbierz informacje o wszystkich graczach (w grze)
    const allPlayersCards = playersInHand.map(p => ({
        id: p.id,
        name: p.name,
        cards: p.cards,
        run1Hand: getBestHand(p.cards, run1Cards).name,
        run2Hand: getBestHand(p.cards, run2Cards).name,
        folded: false
    }));
    
    // Zbierz informacje o spasowanych graczach (hipotetyczne układy)
    const foldedPlayers = gameState.players.filter(p => p.folded && p.cards && p.cards.length === 2);
    const foldedPlayersCards = foldedPlayers.map(p => ({
        id: p.id,
        name: p.name,
        cards: p.cards,
        run1Hand: getBestHand(p.cards, run1Cards).name,
        run2Hand: getBestHand(p.cards, run2Cards).name,
        folded: true
    }));
    
    // Zbierz zwycięzców do jednej listy
    const allWinnersInfo = [];
    
    run1Winners.forEach(w => {
        const existing = allWinnersInfo.find(wi => wi.id === w.player.id);
        if (existing) {
            existing.amount += run1WinAmount;
            existing.runs.push({ run: 1, hand: w.hand.name, amount: run1WinAmount });
        } else {
            allWinnersInfo.push({
                id: w.player.id,
                name: w.player.name,
                amount: run1WinAmount,
                cards: w.player.cards,
                runs: [{ run: 1, hand: w.hand.name, amount: run1WinAmount }]
            });
        }
    });
    
    run2Winners.forEach(w => {
        const existing = allWinnersInfo.find(wi => wi.id === w.player.id);
        if (existing) {
            existing.amount += run2WinAmount;
            existing.runs.push({ run: 2, hand: w.hand.name, amount: run2WinAmount });
        } else {
            allWinnersInfo.push({
                id: w.player.id,
                name: w.player.name,
                amount: run2WinAmount,
                cards: w.player.cards,
                runs: [{ run: 2, hand: w.hand.name, amount: run2WinAmount }]
            });
        }
    });
    
    // Buduj komunikat
    const run1WinnerNames = run1Winners.map(w => w.player.name).join(', ');
    const run2WinnerNames = run2Winners.map(w => w.player.name).join(', ');
    
    const message = `🎲 RUN IT TWICE! Run 1: ${run1WinnerNames} (${run1Winners[0].hand.name}) | Run 2: ${run2WinnerNames} (${run2Winners[0].hand.name})`;
    
    console.log(`[RUN-IT-TWICE] Run 1: ${run1WinnerNames} wygrywa ${run1WinAmount}`);
    console.log(`[RUN-IT-TWICE] Run 2: ${run2WinnerNames} wygrywa ${run2WinAmount}`);
    
    io.to(lobby.code).emit('roundEnd', {
        winners: allWinnersInfo,
        allPlayersCards,
        foldedPlayersCards,
        runItTwice: true,
        run1: {
            communityCards: run1Cards,
            winners: run1Winners.map(w => ({ name: w.player.name, hand: w.hand.name })),
            winAmount: run1WinAmount
        },
        run2: {
            communityCards: run2Cards,
            winners: run2Winners.map(w => ({ name: w.player.name, hand: w.hand.name })),
            winAmount: run2WinAmount
        },
        message
    });
    
    // Reset run it twice flag
    gameState.runItTwice = false;
    gameState.run1CommunityCards = null;
    gameState.run2CommunityCards = null;
    
    broadcastGameState(lobby);
    
    setTimeout(() => {
        startNewRound(lobby);
    }, 6000);
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
            // Wyczyść straddle badges po flopie
            gameState.activeStraddles = [];
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
    
    // Start turn timer dla następnego gracza
    startTurnTimer(lobby);
}

function findNextPlayer(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    const playersWhoCanAct = playersInHand.filter(p => !p.isAllIn && p.chips > 0);
    
    if (playersInHand.length <= 1) {
        endRound(lobby);
        return;
    }
    
    // Sprawdź czy to All-in Showdown
    if (checkAllInShowdown(lobby)) {
        runAllInShowdown(lobby);
        return;
    }
    
    if (playersWhoCanAct.length === 0) {
        nextPhase(lobby);
        return;
    }
    
    if (playersWhoCanAct.length === 1) {
        const lastPlayer = playersWhoCanAct[0];
        if (lastPlayer.currentBet >= gameState.currentBet && lastPlayer.hasActed) {
            nextPhase(lobby);
            return;
        }
    }
    
    const allActed = playersWhoCanAct.every(p => p.hasActed);
    const allBetsEqual = playersWhoCanAct.every(p => p.currentBet === gameState.currentBet);
    
    if (allActed && allBetsEqual) {
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
            // Start turn timer dla następnego gracza
            startTurnTimer(lobby);
            return;
        }
        nextIndex = (nextIndex + 1) % gameState.players.length;
        attempts++;
    }
    
    nextPhase(lobby);
}

function determineWinner(lobby) {
    const gameState = lobby.gameState;
    const playersInHand = getPlayersInHand(gameState);
    
    if (playersInHand.length === 1) {
        const winner = playersInHand[0];
        winner.chips += gameState.pot;
        
        // Wygrana przez fold
        gameState.wonByFold = true;
        
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
    
    // Start turn timer dla pierwszego gracza
    startTurnTimer(lobby);
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
    
    // Start turn timer dla pierwszego gracza PRZED broadcastem
    // żeby dane timera były zawarte w gameState
    startTurnTimer(lobby);
    
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
        wonByFold: gameState.wonByFold || false,
        isBombPot: isBombPot,
        bombPotStake: gameState.bombPotStake || null,
        spectators: spectatorsList,
        players: gameState.players.map((p, idx) => {
            const showCards = p.id === playerId ? true : 
                   (isBombPot && gameState.bombPotParticipants?.includes(p.id) && !p.folded) ||
                   (((gameState.phase === 'showdown' && !gameState.wonByFold) || gameState.allInShowdown) && !p.folded);
            
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
                highlightCards: (gameState.phase === 'showdown' || gameState.allInShowdown || isBombPot) ? playerHighlightCards : []
            };
        }),
        yourCards: player ? player.cards : [],
        yourHand: player && player.cards.length === 2 && gameState.communityCards.length >= 3 
            ? getBestHand(player.cards, gameState.communityCards) 
            : null,
        highlightCards: (() => {
            if (player && player.cards.length === 2 && gameState.communityCards.length >= 3 && !player.folded) {
                const bestHand = getBestHand(player.cards, gameState.communityCards);
                return bestHand?.cards || [];
            }
            return [];
        })(),
        isYourTurn: player && gameState.players.indexOf(player) === gameState.currentPlayerIndex && !player.folded && !player.isAllIn,
        canCheck: player && player.currentBet >= gameState.currentBet,
        callAmount: player ? gameState.currentBet - player.currentBet : 0,
        minBet: gameState.currentBet > 0 ? gameState.currentBet + gameState.minRaise : gameState.config.bigBlind,
        isGameStarted: gameState.isGameStarted,
        config: gameState.config,
        isSpectator: false,
        sidePots: calculateLiveSidePots(gameState),
        bombPotVote: voteData ? {
            initiatorName: voteData.initiatorName,
            stake: voteData.stake,
            expiresAt: voteData.expiresAt,
            hasVoted: voteData.votes.has(playerId),
            myVote: voteData.votes.get(playerId)
        } : null,
        turnTimer: (() => {
            const timerData = turnTimers.get(lobby.code);
            if (timerData) {
                return {
                    playerId: timerData.playerId,
                    expiresAt: timerData.expiresAt
                };
            }
            return null;
        })(),
        straddleInfo: lobby.config.straddleEnabled ? getStraddleInfo(lobby, playerId) : null,
        activeStraddles: gameState.activeStraddles || []
    };
}

function getSpectatorView(lobby) {
    const gameState = lobby.gameState;
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
        wonByFold: gameState.wonByFold || false,
        isBombPot: isBombPot,
        bombPotStake: gameState.bombPotStake || null,
        spectators: spectatorsList,
        players: gameState.players.map((p, idx) => {
            const showCards = (isBombPot && gameState.bombPotParticipants?.includes(p.id) && !p.folded) ||
                   (((gameState.phase === 'showdown' && !gameState.wonByFold) || gameState.allInShowdown) && !p.folded);
            
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
        bombPotVote: voteData ? {
            initiatorName: voteData.initiatorName,
            stake: voteData.stake,
            expiresAt: voteData.expiresAt
        } : null,
        turnTimer: (() => {
            const timerData = turnTimers.get(lobby.code);
            if (timerData) {
                return {
                    playerId: timerData.playerId,
                    expiresAt: timerData.expiresAt
                };
            }
            return null;
        })(),
        activeStraddles: gameState.activeStraddles || []
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
                        clearBombPotVote(lobby.code);
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
        
        // Automatycznie wyłącz straddle jeśli liczba graczy < 4
        const activePlayersAfterSpectator = lobby.players.filter(p => !p.isSpectator);
        if (activePlayersAfterSpectator.length < 4 && lobby.config.straddleEnabled) {
            lobby.config.straddleEnabled = false;
            console.log(`[AUTO-CONFIG] Straddle wyłączony - za mało graczy (${activePlayersAfterSpectator.length}/4)`);
        }
        
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
            removeLobby(lobby.code);
            console.log(`[LEAVE-LOBBY] Lobby ${lobby.code} usunięte (puste)`);
            return;
        }
        
        // Powiadom pozostałych
        io.to(lobby.code).emit('playerLeft', { id: socket.id, name: leftName });
        
        // Automatycznie wyłącz straddle jeśli liczba graczy < 4
        const activePlayers = lobby.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 4 && lobby.config.straddleEnabled) {
            lobby.config.straddleEnabled = false;
            console.log(`[AUTO-CONFIG] Straddle wyłączony - za mało graczy (${activePlayers.length}/4)`);
        }
        
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
                    clearBombPotVote(lobby.code);
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
        if (newConfig.straddleEnabled !== undefined) {
            // Straddle wymaga minimum 4 graczy
            const activePlayers = lobby.players.filter(p => !p.isSpectator);
            if (newConfig.straddleEnabled && activePlayers.length < 4) {
                socket.emit('error', { message: 'Straddle wymaga minimum 4 graczy w lobby!' });
            } else {
                lobby.config.straddleEnabled = !!newConfig.straddleEnabled;
            }
        }
        if (newConfig.cardSkin !== undefined) {
            const validSkins = ['classic', 'colorful', 'dark'];
            if (validSkins.includes(newConfig.cardSkin)) {
                lobby.config.cardSkin = newConfig.cardSkin;
            }
        }
        if (newConfig.turnTimeout !== undefined) {
            lobby.config.turnTimeout = Math.max(5, Math.min(120, parseInt(newConfig.turnTimeout) || 15));
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
        
        // Wyczyść timer przed akcją
        clearTurnTimer(lobby.code);
        
        let success = false;
        
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
        }
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
    
    // ============== STRADDLE SOCKET HANDLERS ==============
    socket.on('declareStraddle', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const customAmount = data?.amount ? parseInt(data.amount) : null;
        const result = declareStraddle(lobby, socket.id, customAmount);
        if (!result.success) {
            socket.emit('error', { message: result.message });
            return;
        }
        
        // Wyślij potwierdzenie do gracza
        socket.emit('straddleDeclared', {
            amount: result.straddle.amount,
            position: result.straddle.position,
            isReStraddle: result.straddle.isReStraddle,
            message: result.message
        });
        
        // Broadcast do wszystkich o nowej deklaracji straddle
        io.to(lobby.code).emit('straddleStateUpdate', {
            pendingStraddles: (lobby.pendingStraddles || []).map(s => ({
                playerName: s.playerName,
                amount: s.amount,
                position: s.position,
                isReStraddle: s.isReStraddle
            }))
        });
        
        // WAŻNE: Broadcast gameState aby zaktualizować straddleInfo u wszystkich graczy
        // (żeby wiedzieli czy mogą dać re-straddle)
        broadcastGameState(lobby);
        broadcastLobbyState(lobby);
    });
    
    socket.on('cancelStraddle', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const result = cancelStraddle(lobby, socket.id);
        if (!result.success) {
            socket.emit('error', { message: result.message });
            return;
        }
        
        socket.emit('straddleCancelled', { message: result.message });
        
        // Broadcast do wszystkich o zmianie stanu straddle
        io.to(lobby.code).emit('straddleStateUpdate', {
            pendingStraddles: (lobby.pendingStraddles || []).map(s => ({
                playerName: s.playerName,
                amount: s.amount,
                position: s.position,
                isReStraddle: s.isReStraddle
            }))
        });
        
        // WAŻNE: Broadcast gameState aby zaktualizować straddleInfo u wszystkich graczy
        broadcastGameState(lobby);
        broadcastLobbyState(lobby);
    });
    
    socket.on('getStraddleInfo', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('straddleInfo', { canStraddle: false, pendingStraddles: [] });
            return;
        }
        
        const info = getStraddleInfo(lobby, socket.id);
        socket.emit('straddleInfo', info);
    });
    
    // ============== RUN IT TWICE VOTE SOCKET HANDLER ==============
    socket.on('castRunItTwiceVote', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const result = castRunItTwiceVote(lobby, socket.id, data?.vote === true);
        if (result && result.error) {
            socket.emit('error', { message: result.error });
        }
    });
    
    // ============== RABBIT HUNT SOCKET HANDLER ==============
    socket.on('requestRabbitHunt', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const gameState = lobby.gameState;
        
        // Sprawdź czy rozdanie zakończyło się foldem
        if (!gameState.wonByFold || gameState.phase !== 'showdown') {
            socket.emit('error', { message: 'Rabbit Hunt niedostępny!' });
            return;
        }
        
        // Sprawdź czy są karty do odkrycia
        const cardsNeeded = 5 - gameState.communityCards.length;
        if (cardsNeeded <= 0) {
            socket.emit('error', { message: 'Wszystkie karty są już odkryte!' });
            return;
        }
        
        // Pobierz karty z talii (nie zmieniaj stanu gry)
        const rabbitCards = [];
        const deckCopy = [...gameState.deck];
        
        // Uzupełnij karty community do 5
        for (let i = 0; i < 5; i++) {
            if (i < gameState.communityCards.length) {
                rabbitCards.push(gameState.communityCards[i]);
            } else if (deckCopy.length > 0) {
                rabbitCards.push(deckCopy.pop());
            }
        }
        
        console.log(`[RABBIT-HUNT] ${socket.id} odkrył brakujące karty:`, rabbitCards.slice(gameState.communityCards.length));
        
        // Wyślij karty do WSZYSTKICH w lobby (żeby wszyscy widzieli rabbit hunt)
        io.to(lobby.code).emit('rabbitHuntCards', { 
            cards: rabbitCards,
            revealedCount: cardsNeeded
        });
    });
    
    // ============== SHOW CARDS SOCKET HANDLER ==============
    socket.on('showCards', () => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby || !lobby.gameState) {
            socket.emit('error', { message: 'Nie jesteś w grze!' });
            return;
        }
        
        const gameState = lobby.gameState;
        
        // Sprawdź czy to showdown
        if (gameState.phase !== 'showdown') {
            socket.emit('error', { message: 'Możesz pokazać karty tylko po zakończeniu rozdania!' });
            return;
        }
        
        // Znajdź gracza
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) {
            socket.emit('error', { message: 'Nie jesteś graczem!' });
            return;
        }
        
        // Sprawdź czy gracz ma karty
        if (!player.cards || player.cards.length !== 2) {
            socket.emit('error', { message: 'Nie masz kart do pokazania!' });
            return;
        }
        
        console.log(`[SHOW-CARDS] ${player.name} pokazuje karty:`, player.cards);
        
        // Wyślij informację o pokazanych kartach do wszystkich
        io.to(lobby.code).emit('playerShowedCards', {
            playerId: player.id,
            playerName: player.name,
            cards: player.cards
        });
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
                    clearBombPotVote(lobby.code);
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
    
    // ============== KICK PLAYER (HOST ONLY) ==============
    socket.on('kickPlayer', (data) => {
        const lobby = getLobbyByPlayerId(socket.id);
        if (!lobby) {
            socket.emit('error', { message: 'Nie jesteś w żadnym lobby!' });
            return;
        }
        
        // Sprawdź czy to host
        if (lobby.hostId !== socket.id) {
            socket.emit('error', { message: 'Tylko host może wyrzucać graczy!' });
            return;
        }
        
        const targetId = data?.playerId;
        if (!targetId || targetId === socket.id) {
            socket.emit('error', { message: 'Nieprawidłowy gracz!' });
            return;
        }
        
        // Znajdź gracza
        const playerIndex = lobby.players.findIndex(p => p.id === targetId);
        const spectatorIndex = lobby.spectators.findIndex(s => s.id === targetId);
        
        let kickedName = '';
        
        if (playerIndex !== -1) {
            kickedName = lobby.players[playerIndex].name;
            
            // Jeśli gra trwa, wykonaj auto-fold
            if (lobby.isGameStarted && lobby.gameState) {
                const gamePlayer = lobby.gameState.players.find(p => p.id === targetId);
                if (gamePlayer && !gamePlayer.folded) {
                    gamePlayer.folded = true;
                    io.to(lobby.code).emit('playerAction', { 
                        playerId: targetId, 
                        playerName: gamePlayer.name, 
                        action: 'fold' 
                    });
                }
                
                // Usuń z gameState.players
                const gamePlayerIndex = lobby.gameState.players.findIndex(p => p.id === targetId);
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
                        clearBombPotVote(lobby.code);
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
            }
            
            lobby.players.splice(playerIndex, 1);
        } else if (spectatorIndex !== -1) {
            kickedName = lobby.spectators[spectatorIndex].name;
            lobby.spectators.splice(spectatorIndex, 1);
        } else {
            socket.emit('error', { message: 'Gracz nie znaleziony!' });
            return;
        }
        
        // Wyślij informację do wyrzuconego gracza
        const kickedSocket = io.sockets.sockets.get(targetId);
        if (kickedSocket) {
            kickedSocket.emit('kicked', { message: 'Zostałeś wyrzucony z lobby przez hosta.' });
            kickedSocket.leave(lobby.code);
        }
        
        // Powiadom pozostałych
        io.to(lobby.code).emit('playerKicked', { id: targetId, name: kickedName });
        
        broadcastLobbyState(lobby);
        if (lobby.isGameStarted && lobby.gameState) {
            broadcastGameState(lobby);
        }
        
        console.log(`[KICK] Host wyrzucił gracza ${kickedName} z lobby ${lobby.code}`);
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

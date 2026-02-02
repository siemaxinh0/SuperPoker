// ============== POŁĄCZENIE Z SERWEREM ==============
// Dynamiczne połączenie - działa zarówno lokalnie jak i przez Ngrok
const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true
});

// ============== ELEMENTY DOM - MENU ==============
const mainMenu = document.getElementById('main-menu');
const btnCreateLobby = document.getElementById('btn-create-lobby');
const btnJoinLobby = document.getElementById('btn-join-lobby');

// ============== ELEMENTY DOM - JOIN SCREEN ==============
const lobbyJoinScreen = document.getElementById('lobby-join-screen');
const btnBackToMenu = document.getElementById('btn-back-to-menu');
const lobbyActionTitle = document.getElementById('lobby-action-title');
const playerNameInput = document.getElementById('player-name');
const joinCodeSection = document.getElementById('join-code-section');
const lobbyCodeInput = document.getElementById('lobby-code-input');
const btnConfirmLobby = document.getElementById('btn-confirm-lobby');

// ============== ELEMENTY DOM - LOBBY SCREEN ==============
const lobbyScreen = document.getElementById('lobby-screen');
const lobbyCodeDisplay = document.getElementById('lobby-code');
const lobbyCodeBox = document.getElementById('lobby-code-box');
const lobbySettingsSection = document.querySelector('.lobby-settings');
const hostConfigPanel = document.getElementById('host-config-panel');
const playerConfigView = document.getElementById('player-config-view');
const configSmallBlind = document.getElementById('config-small-blind');
const configBigBlind = document.getElementById('config-big-blind');
const configStartingChips = document.getElementById('config-starting-chips');
const configBbAnteEnabled = document.getElementById('config-bb-ante-enabled');
const configBbAnteAmount = document.getElementById('config-bb-ante-amount');
const bbAnteAmountGroup = document.getElementById('bb-ante-amount-group');
const viewSmallBlind = document.getElementById('view-small-blind');
const viewBigBlind = document.getElementById('view-big-blind');
const viewStartingChips = document.getElementById('view-starting-chips');
const viewBbAnteItem = document.getElementById('view-bb-ante-item');
const viewBbAnte = document.getElementById('view-bb-ante');
const playersCountEl = document.getElementById('players-count');
const maxPlayersEl = document.getElementById('max-players');
const spectatorsCountEl = document.getElementById('spectators-count');
const lobbyPlayersList = document.getElementById('lobby-players-list');
const lobbySpectatorsList = document.getElementById('lobby-spectators-list');
const btnBecomeSpectator = document.getElementById('btn-become-spectator');
const btnBecomePlayer = document.getElementById('btn-become-player');
const lobbyStatus = document.getElementById('lobby-status');
const btnStartGame = document.getElementById('btn-start-game');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');

// ============== ELEMENTY DOM - GAME SCREEN ==============
const gameScreen = document.getElementById('game-screen');
const spectatorBanner = document.getElementById('spectator-banner');
const spectatorText = document.getElementById('spectator-text');
const btnJoinGame = document.getElementById('btn-join-game');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnLeaveGame = document.getElementById('btn-leave-game');
const gameCodeDisplay = document.getElementById('game-code-display');
const gameCodeValue = document.getElementById('game-code-value');
const communityCardsEl = document.getElementById('community-cards');
const potAmount = document.getElementById('pot-amount');
const phaseIndicator = document.getElementById('phase-indicator');
const playerPanel = document.getElementById('player-panel');
const yourCardsEl = document.getElementById('your-cards');
const yourHandEl = document.getElementById('your-hand');
const yourName = document.getElementById('your-name');
const yourChips = document.getElementById('your-chips');
const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const btnBet = document.getElementById('btn-bet');
const showdownActions = document.getElementById('showdown-actions');
const btnShowCards = document.getElementById('btn-show-cards');
const betAmountInput = document.getElementById('bet-amount');
const betLabel = document.getElementById('bet-label');
const callAmount = document.getElementById('call-amount');
const actionLog = document.getElementById('log-content');
const toastContainer = document.getElementById('toast-container');

// ============== ELEMENTY DOM - RAISE PANEL ==============
const raisePanel = document.getElementById('raise-panel');
const raiseTitle = document.getElementById('raise-title');
const raiseClose = document.getElementById('raise-close');
const betSlider = document.getElementById('bet-slider');
const sliderMin = document.getElementById('slider-min');
const sliderMax = document.getElementById('slider-max');
const btnConfirmRaise = document.getElementById('btn-confirm-raise');
const confirmRaiseLabel = document.getElementById('confirm-raise-label');

// ============== STAN KLIENTA ==============
let myPlayerId = null;
let currentLobbyCode = null;
let currentLobbyState = null;
let currentGameState = null;
let isHost = false;
let isSpectator = false;
let isCreatingLobby = false;
let isPendingJoin = false;
let raiseMinAmount = 20;
let raiseMaxAmount = 1000;
let currentWinners = []; // Lista zwycięzców do podświetlenia na stole
let playerLastActions = {}; // Ostatnie akcje graczy {playerId: {action, amount, timestamp}}
let runItTwiceFoldedPlayers = []; // Spasowani gracze z hipotetycznymi układami dla Run It Twice

// ============== RABBIT HUNT STATE ==============
let rabbitHuntCards = null; // Karty do rabbit hunt (od serwera)
let rabbitHuntRevealed = false; // Czy rabbit hunt został aktywowany
let canRabbitHunt = false; // Czy można aktywować rabbit hunt (wonByFold)

// ============== SHOW CARDS STATE ==============
let revealedPlayerCards = new Map(); // playerId -> cards (karty pokazane przez graczy)
let hasShownCards = false; // Czy gracz już pokazał swoje karty w tym rozdaniu

// ============== AUDIO SYSTEM ==============
let soundEnabled = localStorage.getItem('pokerSoundEnabled') !== 'false'; // Domyślnie włączone
let musicEnabled = localStorage.getItem('pokerMusicEnabled') !== 'false'; // Domyślnie włączone
const audioCache = new Map(); // Cache dla obiektów Audio
let backgroundMusic = null; // Obiekt Audio dla muzyki w tle

const SOUNDS = {
    fold: 'sounds/fold.mp3',
    check: 'sounds/check.mp3',
    call: 'sounds/call.mp3',
    bet: 'sounds/bet.mp3',
    raise: 'sounds/raise.mp3',
    allIn: 'sounds/allin.mp3',
    win: 'sounds/win.mp3',
    lose: 'sounds/lose.mp3',
    bust: 'sounds/bust.mp3',
    cardDeal: 'sounds/card-deal.mp3',
    cardFlip: 'sounds/card-flip.mp3',
    chips: 'sounds/chips.mp3',
    timer: 'sounds/timer.mp3',
    turnStart: 'sounds/turn-start.mp3',
    buttonHover: 'sounds/button-hover.mp3',
    buttonClick: 'sounds/button-click.mp3',
    notification: 'sounds/notification.mp3',
    bombPot: 'sounds/bomb-pot.mp3'
};

const MUSIC = {
    background: 'sounds/background-music.mp3'
};

function playSound(soundName, volume = 0.5) {
    if (!soundEnabled) return;
    
    const soundPath = SOUNDS[soundName];
    if (!soundPath) return;
    
    try {
        let audio = audioCache.get(soundName);
        if (!audio) {
            audio = new Audio(soundPath);
            audioCache.set(soundName, audio);
        }
        
        // Reset i odtwórz
        audio.currentTime = 0;
        audio.volume = Math.min(1, Math.max(0, volume));
        audio.play().catch(e => {
            // Ignoruj błędy gdy plik nie istnieje lub autoplay zablokowany
            console.log(`[AUDIO] Nie można odtworzyć: ${soundName}`);
        });
    } catch (e) {
        console.log(`[AUDIO] Błąd: ${e.message}`);
    }
}

function startBackgroundMusic() {
    if (!musicEnabled) return;
    
    try {
        if (!backgroundMusic) {
            backgroundMusic = new Audio(MUSIC.background);
            backgroundMusic.loop = true;
            backgroundMusic.volume = 0.3;
        }
        
        backgroundMusic.play().catch(e => {
            console.log('[AUDIO] Nie można odtworzyć muzyki w tle (wymaga interakcji użytkownika)');
        });
    } catch (e) {
        console.log(`[AUDIO] Błąd muzyki: ${e.message}`);
    }
}

function stopBackgroundMusic() {
    if (backgroundMusic) {
        backgroundMusic.pause();
        backgroundMusic.currentTime = 0;
    }
}

function toggleSoundEffects() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('pokerSoundEnabled', soundEnabled);
    updateSettingsUI();
}

function toggleBackgroundMusic() {
    musicEnabled = !musicEnabled;
    localStorage.setItem('pokerMusicEnabled', musicEnabled);
    
    if (musicEnabled) {
        startBackgroundMusic();
    } else {
        stopBackgroundMusic();
    }
    updateSettingsUI();
}

function updateSettingsUI() {
    const soundCheckbox = document.getElementById('toggle-sound-effects');
    const musicCheckbox = document.getElementById('toggle-background-music');
    
    if (soundCheckbox) soundCheckbox.checked = soundEnabled;
    if (musicCheckbox) musicCheckbox.checked = musicEnabled;
}

// ============== BOMB POT DOM ==============
const bombPotPanel = document.getElementById('bomb-pot-panel');
const bombPotStart = document.getElementById('bomb-pot-start');
const bombPotVoting = document.getElementById('bomb-pot-voting');
const bombPotStakeInput = document.getElementById('bomb-pot-stake');
const btnStartBombPotVote = document.getElementById('btn-start-bomb-pot-vote');
const bombPotVoteStake = document.getElementById('bomb-pot-vote-stake');
const bombPotTimerDisplay = document.getElementById('bomb-pot-timer-display');
const bombPotYesVotes = document.getElementById('bomb-pot-yes-votes');
const bombPotTotalVoters = document.getElementById('bomb-pot-total-voters');
const btnBombPotYes = document.getElementById('btn-bomb-pot-yes');
const btnBombPotNo = document.getElementById('btn-bomb-pot-no');
const bombPotVoteButtons = document.getElementById('bomb-pot-vote-buttons');
const bombPotVotedStatus = document.getElementById('bomb-pot-voted-status');
const bombPotMyVote = document.getElementById('bomb-pot-my-vote');
const configBombPotEnabled = document.getElementById('config-bomb-pot-enabled');
const viewBombPotItem = document.getElementById('view-bomb-pot-item');
const viewBombPot = document.getElementById('view-bomb-pot');
const configCardSkin = document.getElementById('config-card-skin');
const viewCardSkin = document.getElementById('view-card-skin');

// ============== RUN IT TWICE DOM ==============
const runItTwicePanel = document.getElementById('run-it-twice-panel');
const runItTwiceTimerDisplay = document.getElementById('run-it-twice-timer-display');
const runItTwiceYesVotes = document.getElementById('run-it-twice-yes-votes');
const runItTwiceTotalVoters = document.getElementById('run-it-twice-total-voters');
const btnRunItTwiceYes = document.getElementById('btn-run-it-twice-yes');
const btnRunItTwiceNo = document.getElementById('btn-run-it-twice-no');
const runItTwiceVoteButtons = document.getElementById('run-it-twice-vote-buttons');
const runItTwiceVotedStatus = document.getElementById('run-it-twice-voted-status');
const runItTwiceMyVote = document.getElementById('run-it-twice-my-vote');

// Current card skin
let currentCardSkin = 'classic';

// Funkcja aplikująca skin kart
function applyCardSkin(skin) {
    currentCardSkin = skin;
    
    // Usuń wszystkie klasy skinów z body
    document.body.classList.remove('card-skin-classic', 'card-skin-colorful', 'card-skin-dark');
    
    // Dodaj odpowiednią klasę
    document.body.classList.add(`card-skin-${skin}`);
    
    console.log(`[CARD-SKIN] Zastosowano skin: ${skin}`);
}

// ============== BOMB POT STATE ==============
let bombPotVoteTimerInterval = null;
let bombPotVoteExpiresAt = null;
let isBombPotActive = false;

// ============== RUN IT TWICE STATE ==============
let runItTwiceVoteTimerInterval = null;
let runItTwiceVoteExpiresAt = null;
let hasVotedRunItTwice = false;
let isRunItTwiceActive = false;
let run1CommunityCards = null;
let run2CommunityCards = null;
let runItTwiceOriginalCards = null;
let prevRun1CardsCount = 0;
let prevRun2CardsCount = 0;

// ============== TURN TIMER STATE ==============
let turnTimerInterval = null;
let turnTimerExpiresAt = null;
let turnTimerPlayerId = null;

// ============== FUNKCJE POMOCNICZE ==============
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showScreen(screen) {
    mainMenu.classList.add('hidden');
    lobbyJoinScreen.classList.add('hidden');
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    
    screen.classList.remove('hidden');
}

function formatPhase(phase) {
    const phases = {
        'waiting': 'Oczekiwanie',
        'preflop': 'Pre-Flop',
        'flop': 'Flop',
        'turn': 'Turn',
        'river': 'River',
        'showdown': 'Showdown'
    };
    return phases[phase] || phase;
}

function createCardElement(card, size = 'normal', highlight = false) {
    const cardEl = document.createElement('div');
    
    if (!card) {
        cardEl.className = `card card-placeholder${size === 'small' ? ' card-small' : ''}`;
        return cardEl;
    }
    
    // Określ klasę koloru w zależności od skinu
    let colorClass = '';
    if (currentCardSkin === 'colorful') {
        // Skin kolorowy - każdy kolor ma swoją klasę
        const suitClasses = {
            '♥': 'suit-hearts',
            '♦': 'suit-diamonds',
            '♣': 'suit-clubs',
            '♠': 'suit-spades'
        };
        colorClass = suitClasses[card.suit] || '';
    } else {
        // Klasyczny i ciemny - czerwone/czarne
        const isRed = card.suit === '♥' || card.suit === '♦';
        colorClass = isRed ? 'red' : 'black';
    }
    
    const sizeClass = size === 'small' ? ' card-small' : '';
    cardEl.className = `card ${colorClass}${sizeClass}${highlight ? ' card-in-hand-highlight' : ''}`;
    
    cardEl.innerHTML = `
        <span class="card-corner top">${card.value}${card.suit}</span>
        <span class="card-value">${card.value}</span>
        <span class="card-suit">${card.suit}</span>
        <span class="card-corner bottom">${card.value}${card.suit}</span>
    `;
    
    return cardEl;
}

function createCardBackElement() {
    const cardEl = document.createElement('div');
    cardEl.className = 'card card-back';
    return cardEl;
}

function addLogEntry(message, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    actionLog.insertBefore(entry, actionLog.firstChild);
    
    while (actionLog.children.length > 20) {
        actionLog.removeChild(actionLog.lastChild);
    }
}

// ============== MENU HANDLERS ==============
btnCreateLobby.addEventListener('click', () => {
    isCreatingLobby = true;
    lobbyActionTitle.textContent = 'Utwórz Lobby';
    joinCodeSection.classList.add('hidden');
    btnConfirmLobby.textContent = 'Utwórz Lobby';
    showScreen(lobbyJoinScreen);
    playerNameInput.focus();
});

btnJoinLobby.addEventListener('click', () => {
    isCreatingLobby = false;
    lobbyActionTitle.textContent = 'Dołącz do Lobby';
    joinCodeSection.classList.remove('hidden');
    btnConfirmLobby.textContent = 'Dołącz';
    showScreen(lobbyJoinScreen);
    playerNameInput.focus();
});

btnBackToMenu.addEventListener('click', () => {
    // Wyczyść inputy przy powrocie
    playerNameInput.value = '';
    lobbyCodeInput.value = '';
    showScreen(mainMenu);
});

btnConfirmLobby.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) {
        showToast('Wpisz swój nick!', 'error');
        return;
    }
    
    if (isCreatingLobby) {
        socket.emit('createLobby', name);
    } else {
        const code = lobbyCodeInput.value.trim().toUpperCase();
        if (code.length !== 6) {
            showToast('Kod lobby musi mieć 6 znaków!', 'error');
            return;
        }
        
        // Brak wyboru roli - serwer automatycznie przypisze
        socket.emit('joinLobby', {
            code,
            playerName: name
        });
    }
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnConfirmLobby.click();
});

lobbyCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnConfirmLobby.click();
});

// ============== LOBBY HANDLERS ==============
// Kopiowanie kodu kliknięciem na box z kodem
if (lobbyCodeBox) {
    lobbyCodeBox.addEventListener('click', () => {
        navigator.clipboard.writeText(currentLobbyCode).then(() => {
            lobbyCodeBox.classList.add('copied');
            const hint = lobbyCodeBox.querySelector('.code-copy-hint');
            if (hint) hint.textContent = '✓ skopiowano!';
            
            setTimeout(() => {
                lobbyCodeBox.classList.remove('copied');
                if (hint) hint.textContent = '📋 kliknij aby skopiować';
            }, 2000);
            
            showToast('Kod skopiowany!', 'success');
        });
    });
}

// Kopiowanie kodu z ekranu gry
if (gameCodeDisplay) {
    gameCodeDisplay.addEventListener('click', () => {
        if (!currentLobbyCode) return;
        navigator.clipboard.writeText(currentLobbyCode).then(() => {
            gameCodeDisplay.classList.add('copied');
            
            setTimeout(() => {
                gameCodeDisplay.classList.remove('copied');
            }, 2000);
            
            showToast('Kod skopiowany!', 'success');
        });
    });
}

// Feature toggle handlers (BB Ante i Bomb Pot)
document.querySelectorAll('.feature-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
        if (toggle.classList.contains('disabled')) return;
        
        const checkbox = toggle.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            toggle.classList.toggle('active', checkbox.checked);
            const status = toggle.querySelector('.toggle-status');
            if (status) {
                status.textContent = checkbox.checked ? 'włączono' : 'wyłączono';
            }
            
            // Emit change to server
            if (checkbox.id === 'config-bb-ante-enabled') {
                socket.emit('updateConfig', { bbAnteEnabled: checkbox.checked });
                const anteGroup = document.getElementById('bb-ante-amount-group');
                if (anteGroup) {
                    anteGroup.style.display = checkbox.checked ? 'flex' : 'none';
                }
            } else if (checkbox.id === 'config-bomb-pot-enabled') {
                socket.emit('updateConfig', { bombPotEnabled: checkbox.checked });
            } else if (checkbox.id === 'config-run-it-twice-enabled') {
                socket.emit('updateConfig', { runItTwiceEnabled: checkbox.checked });
            }
        }
    });
});

// Card skin selector
document.querySelectorAll('.skin-option').forEach(option => {
    option.addEventListener('click', () => {
        if (option.classList.contains('disabled')) return;
        
        document.querySelectorAll('.skin-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        
        const skin = option.dataset.skin;
        const hiddenInput = document.getElementById('config-card-skin');
        if (hiddenInput) hiddenInput.value = skin;
        
        socket.emit('updateConfig', { cardSkin: skin });
        applyCardSkin(skin);
    });
});

// Opuszczanie lobby
if (btnLeaveLobby) {
    btnLeaveLobby.addEventListener('click', () => {
        if (confirm('Czy na pewno chcesz opuścić lobby?')) {
            socket.emit('leaveLobby');
        }
    });
}

// Opuszczanie gry (dla spectatorów)
if (btnLeaveGame) {
    btnLeaveGame.addEventListener('click', () => {
        if (confirm('Czy na pewno chcesz opuścić grę?')) {
            socket.emit('leaveLobby');
        }
    });
}

// Opuszczanie gry - przycisk w rogu z modalem potwierdzenia
const btnLeaveGameCorner = document.getElementById('btn-leave-game-corner');
const leaveConfirmModal = document.getElementById('leave-confirm-modal');
const btnConfirmLeave = document.getElementById('btn-confirm-leave');
const btnCancelLeave = document.getElementById('btn-cancel-leave');

if (btnLeaveGameCorner) {
    btnLeaveGameCorner.addEventListener('click', () => {
        if (leaveConfirmModal) leaveConfirmModal.classList.remove('hidden');
    });
}

if (btnConfirmLeave) {
    btnConfirmLeave.addEventListener('click', () => {
        if (leaveConfirmModal) leaveConfirmModal.classList.add('hidden');
        socket.emit('leaveLobby');
    });
}

if (btnCancelLeave) {
    btnCancelLeave.addEventListener('click', () => {
        if (leaveConfirmModal) leaveConfirmModal.classList.add('hidden');
    });
}

// Zamknij modal klikając poza nim
if (leaveConfirmModal) {
    leaveConfirmModal.addEventListener('click', (e) => {
        if (e.target === leaveConfirmModal) {
            leaveConfirmModal.classList.add('hidden');
        }
    });
}

// Funkcja czyszcząca stan klienta
function resetClientState() {
    currentLobbyCode = null;
    currentLobbyState = null;
    currentGameState = null;
    isHost = false;
    isSpectator = false;
    isPendingJoin = false;
    stopClientTurnTimer();
}

// Config change handlers (host only)
configSmallBlind.addEventListener('change', () => {
    const sb = parseInt(configSmallBlind.value) || 10;
    socket.emit('updateConfig', { smallBlind: sb, bigBlind: sb * 2 });
    configBigBlind.value = sb * 2;
});

configBigBlind.addEventListener('change', () => {
    socket.emit('updateConfig', { bigBlind: parseInt(configBigBlind.value) || 20 });
});

configStartingChips.addEventListener('change', () => {
    socket.emit('updateConfig', { startingChips: parseInt(configStartingChips.value) || 1000 });
});

// BB Ante handlers - input wartości
configBbAnteAmount.addEventListener('change', () => {
    socket.emit('updateConfig', { bbAnteAmount: parseInt(configBbAnteAmount.value) || 20 });
});

// Turn Timeout handler (slider)
const configTurnTimeout = document.getElementById('config-turn-timeout');
const turnTimeoutValue = document.getElementById('turn-timeout-value');
if (configTurnTimeout) {
    configTurnTimeout.addEventListener('input', () => {
        const value = parseInt(configTurnTimeout.value) || 15;
        if (turnTimeoutValue) turnTimeoutValue.textContent = value;
    });
    configTurnTimeout.addEventListener('change', () => {
        socket.emit('updateConfig', { turnTimeout: parseInt(configTurnTimeout.value) || 15 });
    });
}

// ============== BOMB POT HANDLERS ==============
btnStartBombPotVote.addEventListener('click', () => {
    const stake = parseInt(bombPotStakeInput.value) || 100;
    socket.emit('startBombPotVote', { stake });
});

btnBombPotYes.addEventListener('click', () => {
    socket.emit('castBombPotVote', { vote: true });
    // Natychmiast pokaż status głosowania
    showBombPotVoted(true);
});

btnBombPotNo.addEventListener('click', () => {
    socket.emit('castBombPotVote', { vote: false });
    // Natychmiast pokaż status głosowania
    showBombPotVoted(false);
});

// ============== RUN IT TWICE VOTE BUTTONS ==============
if (btnRunItTwiceYes) {
    btnRunItTwiceYes.addEventListener('click', () => {
        socket.emit('castRunItTwiceVote', { vote: true });
        showRunItTwiceVoted(true);
    });
}

if (btnRunItTwiceNo) {
    btnRunItTwiceNo.addEventListener('click', () => {
        socket.emit('castRunItTwiceVote', { vote: false });
        showRunItTwiceVoted(false);
    });
}

function showBombPotVoted(vote) {
    bombPotVoteButtons.classList.add('hidden');
    bombPotVotedStatus.classList.remove('hidden');
    bombPotMyVote.textContent = vote ? '✓ TAK' : '✗ NIE';
    bombPotMyVote.style.color = vote ? '#2ecc71' : '#e74c3c';
}

function startBombPotVoteTimer(expiresAt) {
    stopBombPotVoteTimer();
    bombPotVoteExpiresAt = expiresAt;
    
    bombPotVoteTimerInterval = setInterval(() => {
        updateBombPotTimerDisplay();
    }, 100);
    
    updateBombPotTimerDisplay();
}

function stopBombPotVoteTimer() {
    if (bombPotVoteTimerInterval) {
        clearInterval(bombPotVoteTimerInterval);
        bombPotVoteTimerInterval = null;
    }
    bombPotVoteExpiresAt = null;
}

function updateBombPotTimerDisplay() {
    if (!bombPotVoteExpiresAt) return;
    
    const now = Date.now();
    const remaining = Math.max(0, bombPotVoteExpiresAt - now);
    const seconds = Math.ceil(remaining / 1000);
    
    bombPotTimerDisplay.textContent = seconds;
    
    if (remaining <= 0) {
        stopBombPotVoteTimer();
    }
}

// ============== RUN IT TWICE TIMER FUNCTIONS ==============
function startRunItTwiceVoteTimer(expiresAt) {
    stopRunItTwiceVoteTimer();
    runItTwiceVoteExpiresAt = expiresAt;
    
    runItTwiceVoteTimerInterval = setInterval(() => {
        updateRunItTwiceTimerDisplay();
    }, 100);
    
    updateRunItTwiceTimerDisplay();
}

function stopRunItTwiceVoteTimer() {
    if (runItTwiceVoteTimerInterval) {
        clearInterval(runItTwiceVoteTimerInterval);
        runItTwiceVoteTimerInterval = null;
    }
    runItTwiceVoteExpiresAt = null;
}

function updateRunItTwiceTimerDisplay() {
    if (!runItTwiceVoteExpiresAt) return;
    
    const now = Date.now();
    const remaining = Math.max(0, runItTwiceVoteExpiresAt - now);
    const seconds = Math.ceil(remaining / 1000);
    
    if (runItTwiceTimerDisplay) {
        runItTwiceTimerDisplay.textContent = seconds;
    }
    
    if (remaining <= 0) {
        stopRunItTwiceVoteTimer();
    }
}

function showRunItTwiceVoted(vote) {
    if (runItTwiceVoteButtons) runItTwiceVoteButtons.classList.add('hidden');
    if (runItTwiceVotedStatus) runItTwiceVotedStatus.classList.remove('hidden');
    if (runItTwiceMyVote) {
        runItTwiceMyVote.textContent = vote ? '✓ TAK' : '✗ NIE';
        runItTwiceMyVote.style.color = vote ? '#2ecc71' : '#e74c3c';
    }
    hasVotedRunItTwice = true;
}

function updateBombPotPanel(gameState) {
    if (!gameState || !gameState.isGameStarted || !currentLobbyState?.config?.bombPotEnabled) {
        bombPotPanel.classList.add('hidden');
        return;
    }
    
    // Obserwatorzy widzą tylko głosowanie (bez przycisków)
    if (isSpectator) {
        if (gameState.bombPotVote) {
            bombPotPanel.classList.remove('hidden');
            bombPotStart.classList.add('hidden');
            bombPotVoting.classList.remove('hidden');
            
            bombPotVoteStake.textContent = gameState.bombPotVote.stake;
            bombPotVoteButtons.classList.add('hidden');
            bombPotVotedStatus.classList.add('hidden');
            
            if (!bombPotVoteTimerInterval) {
                startBombPotVoteTimer(gameState.bombPotVote.expiresAt);
            }
        } else {
            bombPotPanel.classList.add('hidden');
        }
        return;
    }
    
    // Jeśli jest aktywne głosowanie
    if (gameState.bombPotVote) {
        bombPotPanel.classList.remove('hidden');
        bombPotStart.classList.add('hidden');
        bombPotVoting.classList.remove('hidden');
        
        bombPotVoteStake.textContent = gameState.bombPotVote.stake;
        
        // Uruchom timer jeśli jeszcze nie działa
        if (!bombPotVoteTimerInterval) {
            startBombPotVoteTimer(gameState.bombPotVote.expiresAt);
        }
        
        // Pokaż przyciski lub status zagłosowania
        if (gameState.bombPotVote.hasVoted) {
            bombPotVoteButtons.classList.add('hidden');
            bombPotVotedStatus.classList.remove('hidden');
            bombPotMyVote.textContent = gameState.bombPotVote.myVote ? 'TAK' : 'NIE';
            bombPotMyVote.style.color = gameState.bombPotVote.myVote ? '#2ecc71' : '#e74c3c';
        } else {
            bombPotVoteButtons.classList.remove('hidden');
            bombPotVotedStatus.classList.add('hidden');
        }
    } else if (gameState.isBombPot) {
        // Bomb Pot jest aktywny - ukryj panel głosowania
        bombPotPanel.classList.add('hidden');
    } else {
        // Pokaż panel startu głosowania
        bombPotPanel.classList.remove('hidden');
        bombPotStart.classList.remove('hidden');
        bombPotVoting.classList.add('hidden');
        stopBombPotVoteTimer();
        
        // Ustaw domyślną stawkę na 5x BB
        if (currentLobbyState?.config?.bigBlind) {
            bombPotStakeInput.value = currentLobbyState.config.bigBlind * 5;
        }
    }
}

btnBecomeSpectator.addEventListener('click', () => {
    socket.emit('becomeSpectator');
});

btnBecomePlayer.addEventListener('click', () => {
    socket.emit('becomePlayer');
});

// Dołączanie do gry z pozycji obserwatora
btnJoinGame.addEventListener('click', () => {
    socket.emit('requestJoinGame');
});

// Anulowanie oczekiwania na dołączenie
btnCancelJoin.addEventListener('click', () => {
    socket.emit('cancelPendingJoin');
});

btnStartGame.addEventListener('click', () => {
    socket.emit('startGame');
});

// ============== LOBBY STATE RENDERING ==============
function updateLobbyState(lobby) {
    currentLobbyState = lobby;
    currentLobbyCode = lobby.code;
    
    lobbyCodeDisplay.textContent = lobby.code;
    
    // Determine if I'm host or spectator
    const myPlayer = lobby.players.find(p => p.id === myPlayerId);
    const mySpectator = lobby.spectators.find(s => s.id === myPlayerId);
    
    isHost = myPlayer?.isHost || false;
    isSpectator = !!mySpectator;
    
    // Sprawdź czy jesteś w kolejce pending
    isPendingJoin = mySpectator?.pendingJoin || false;
    
    // Zaktualizuj UI spectatora z przyciskami dołączenia
    updateSpectatorBannerButtons(lobby);
    
    // === NOWE LOBBY - obsługa ustawień ===
    const settingsSection = document.querySelector('.lobby-settings');
    if (settingsSection) {
        // Wyłącz edycję dla nie-hostów
        if (!isHost || lobby.isGameStarted) {
            settingsSection.classList.add('readonly');
            document.querySelectorAll('.setting-item input').forEach(input => input.disabled = true);
            document.querySelectorAll('.feature-toggle').forEach(toggle => toggle.classList.add('disabled'));
            document.querySelectorAll('.skin-option').forEach(opt => opt.classList.add('disabled'));
        } else {
            settingsSection.classList.remove('readonly');
            document.querySelectorAll('.setting-item input').forEach(input => input.disabled = false);
            document.querySelectorAll('.feature-toggle').forEach(toggle => toggle.classList.remove('disabled'));
            document.querySelectorAll('.skin-option').forEach(opt => opt.classList.remove('disabled'));
        }
        
        // Zaktualizuj wartości
        configSmallBlind.value = lobby.config.smallBlind;
        configBigBlind.value = lobby.config.bigBlind;
        configStartingChips.value = lobby.config.startingChips;
        
        // BB Ante toggle
        const bbAnteToggle = document.getElementById('toggle-bb-ante');
        if (bbAnteToggle) {
            const isEnabled = lobby.config.bbAnteEnabled || false;
            bbAnteToggle.classList.toggle('active', isEnabled);
            const status = bbAnteToggle.querySelector('.toggle-status');
            if (status) status.textContent = isEnabled ? 'włączono' : 'wyłączono';
            configBbAnteEnabled.checked = isEnabled;
            
            const anteGroup = document.getElementById('bb-ante-amount-group');
            if (anteGroup) anteGroup.style.display = isEnabled ? 'flex' : 'none';
        }
        if (configBbAnteAmount) configBbAnteAmount.value = lobby.config.bbAnteAmount || lobby.config.bigBlind;
        
        // Bomb Pot toggle
        const bombPotToggle = document.getElementById('toggle-bomb-pot');
        if (bombPotToggle) {
            const isEnabled = lobby.config.bombPotEnabled !== false;
            bombPotToggle.classList.toggle('active', isEnabled);
            const status = bombPotToggle.querySelector('.toggle-status');
            if (status) status.textContent = isEnabled ? 'włączono' : 'wyłączono';
            configBombPotEnabled.checked = isEnabled;
        }
        
        // Run It Twice toggle
        const runItTwiceToggle = document.getElementById('toggle-run-it-twice');
        const configRunItTwiceEnabled = document.getElementById('config-run-it-twice-enabled');
        if (runItTwiceToggle && configRunItTwiceEnabled) {
            const isEnabled = lobby.config.runItTwiceEnabled !== false;
            runItTwiceToggle.classList.toggle('active', isEnabled);
            const status = runItTwiceToggle.querySelector('.toggle-status');
            if (status) status.textContent = isEnabled ? 'włączono' : 'wyłączono';
            configRunItTwiceEnabled.checked = isEnabled;
        }
        
        // Card skin selection
        const currentSkin = lobby.config.cardSkin || 'classic';
        document.querySelectorAll('.skin-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.skin === currentSkin);
        });
        const hiddenSkinInput = document.getElementById('config-card-skin');
        if (hiddenSkinInput) hiddenSkinInput.value = currentSkin;
        
        // Turn timeout (slider)
        const turnTimeoutInput = document.getElementById('config-turn-timeout');
        const turnTimeoutValueEl = document.getElementById('turn-timeout-value');
        if (turnTimeoutInput) {
            const timeout = lobby.config.turnTimeout || 15;
            turnTimeoutInput.value = timeout;
            if (turnTimeoutValueEl) turnTimeoutValueEl.textContent = timeout;
        }
    }
    
    // Zaktualizuj skin kart
    applyCardSkin(lobby.config.cardSkin || 'classic');
    
    // Update player counts
    const activePlayers = lobby.players.filter(p => !p.isSpectator);
    const pendingCount = lobby.spectators.filter(s => s.pendingJoin).length;
    playersCountEl.textContent = activePlayers.length;
    maxPlayersEl.textContent = lobby.config.maxPlayers;
    spectatorsCountEl.textContent = `${lobby.spectators.length}${pendingCount > 0 ? ` (${pendingCount} w kolejce)` : ''}`;
    
    // Render players list (nowy styl)
    lobbyPlayersList.innerHTML = '';
    lobby.players.forEach(player => {
        const li = document.createElement('li');
        const isMe = player.id === myPlayerId;
        
        if (player.isHost) li.classList.add('host');
        if (isMe) li.classList.add('is-you');
        
        li.innerHTML = `
            <span>${player.name}${isMe ? ' (Ty)' : ''}</span>
            ${player.isHost ? '<span class="host-badge">HOST</span>' : ''}
        `;
        lobbyPlayersList.appendChild(li);
    });
    
    // Render spectators list
    lobbySpectatorsList.innerHTML = '';
    lobby.spectators.forEach(spectator => {
        const li = document.createElement('li');
        const isMe = spectator.id === myPlayerId;
        if (isMe) li.classList.add('is-you');
        
        const pendingBadge = spectator.pendingJoin ? '<span class="pending-badge">⏳</span>' : '';
        li.innerHTML = `<span>👁️ ${spectator.name}${isMe ? ' (Ty)' : ''} ${pendingBadge}</span>`;
        lobbySpectatorsList.appendChild(li);
    });
    
    // Role switch buttons
    if (!lobby.isGameStarted) {
        if (myPlayer && !myPlayer.isHost) {
            btnBecomeSpectator.classList.remove('hidden');
            btnBecomePlayer.classList.add('hidden');
        } else if (mySpectator) {
            btnBecomeSpectator.classList.add('hidden');
            btnBecomePlayer.classList.remove('hidden');
        } else {
            btnBecomeSpectator.classList.add('hidden');
            btnBecomePlayer.classList.add('hidden');
        }
    } else {
        // Gra trwa - pokaż przycisk "Zostań obserwatorem" dla aktywnych graczy (nie-hostów)
        if (myPlayer && !myPlayer.isHost) {
            btnBecomeSpectator.classList.remove('hidden');
        } else {
            btnBecomeSpectator.classList.add('hidden');
        }
        btnBecomePlayer.classList.add('hidden');
    }
    
    // Start button (host only)
    if (isHost && !lobby.isGameStarted) {
        btnStartGame.classList.remove('hidden');
        btnStartGame.disabled = !lobby.canStart;
    } else {
        btnStartGame.classList.add('hidden');
    }
    
    // Status
    if (lobby.isGameStarted) {
        lobbyStatus.textContent = 'Gra w toku...';
    } else if (lobby.canStart) {
        lobbyStatus.textContent = 'Gotowe do rozpoczęcia gry!';
    } else {
        lobbyStatus.textContent = `Oczekiwanie na graczy... (min. ${lobby.config.minPlayers})`;
    }
}

// ============== GAME RENDERING ==============
// ============== SIDE POTS DISPLAY ==============
function renderSidePots(sidePots) {
    const container = document.getElementById('side-pots-container');
    if (!container) return;
    
    if (!sidePots || sidePots.length === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = sidePots.map(pot => `
        <div class="side-pot">
            <span class="side-pot-label">${pot.name}:</span>
            <span class="side-pot-amount">${pot.amount}</span>
        </div>
    `).join('');
}

// Zmienna do śledzenia poprzedniej liczby kart community (dla animacji)
let previousCommunityCardsCount = 0;

function renderCommunityCards(cards, highlightCards = []) {
    const currentCount = cards ? cards.length : 0;
    const isNewCards = currentCount > previousCommunityCardsCount;
    const newCardsStartIndex = previousCommunityCardsCount;
    
    communityCardsEl.innerHTML = '';
    
    // Zabezpieczenie - upewnij się że highlightCards to tablica
    const safeHighlightCards = Array.isArray(highlightCards) ? highlightCards : [];
    const actualCardsCount = cards ? cards.length : 0;
    
    for (let i = 0; i < 5; i++) {
        if (cards && cards[i]) {
            const card = cards[i];
            const cardId = `${card.value}-${card.suit}`;
            // Znajdź kartę w highlightCards z tym samym cardId i source === 'community'
            const isHighlighted = safeHighlightCards.some(hc => hc.cardId === cardId && hc.source === 'community');
            const cardEl = createCardElement(card, 'normal', isHighlighted);
            
            // Dodaj animację dla nowych kart (flop: 3 karty, turn/river: 1 karta)
            if (isNewCards && i >= newCardsStartIndex) {
                cardEl.classList.add('card-dealing');
                // Dla flopa - każda karta z opóźnieniem
                if (newCardsStartIndex === 0 && currentCount === 3) {
                    if (i === 1) cardEl.classList.add('card-delay-1');
                    if (i === 2) cardEl.classList.add('card-delay-2');
                }
            }
            
            communityCardsEl.appendChild(cardEl);
        } else if (rabbitHuntRevealed && rabbitHuntCards && rabbitHuntCards[i]) {
            // Rabbit hunt - pokaż odkryte karty z przygaszeniem
            const card = rabbitHuntCards[i];
            const cardEl = createCardElement(card, 'normal', false);
            cardEl.classList.add('rabbit-hunt-card');
            communityCardsEl.appendChild(cardEl);
        } else {
            // Placeholder - sprawdź czy można aktywować rabbit hunt
            const placeholder = document.createElement('div');
            placeholder.className = 'card card-placeholder';
            
            // Jeśli można rabbit hunt - dodaj interaktywność
            if (canRabbitHunt && !rabbitHuntRevealed) {
                console.log('[RABBIT HUNT] Dodaję interaktywny placeholder dla pozycji', i);
                placeholder.classList.add('rabbit-hunt-available');
                placeholder.title = '🐰 Kliknij aby zobaczyć brakujące karty (Rabbit Hunt)';
                placeholder.addEventListener('click', activateRabbitHunt);
            }
            
            communityCardsEl.appendChild(placeholder);
        }
    }
    
    // Zaktualizuj poprzednią liczbę kart
    previousCommunityCardsCount = currentCount;
}

// ============== RUN IT TWICE DUAL BOARD RENDERING ==============
function renderDualCommunityCards(run1Highlight = [], run2Highlight = []) {
    if (!isRunItTwiceActive) return;
    
    communityCardsEl.innerHTML = '';
    communityCardsEl.classList.add('dual-board-mode');
    
    // Kontener dla obu boardów
    const dualContainer = document.createElement('div');
    dualContainer.className = 'dual-board-container';
    
    // === RUN 1 ===
    const run1Row = document.createElement('div');
    run1Row.className = 'board-row board-row-1';
    
    const run1Label = document.createElement('span');
    run1Label.className = 'board-label';
    run1Label.textContent = 'RUN 1';
    run1Row.appendChild(run1Label);
    
    const run1Cards = document.createElement('div');
    run1Cards.className = 'board-cards';
    
    const currentRun1Count = run1CommunityCards ? run1CommunityCards.length : 0;
    
    for (let i = 0; i < 5; i++) {
        if (run1CommunityCards && run1CommunityCards[i]) {
            const card = run1CommunityCards[i];
            const cardId = `${card.value}-${card.suit}`;
            const isHighlighted = run1Highlight.some(hc => hc.cardId === cardId);
            const cardEl = createCardElement(card, 'small', isHighlighted);
            
            // Animacja tylko dla ostatniej dodanej karty
            if (i === currentRun1Count - 1 && currentRun1Count > prevRun1CardsCount) {
                cardEl.classList.add('card-dealing');
            }
            
            run1Cards.appendChild(cardEl);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'card card-small card-placeholder';
            run1Cards.appendChild(placeholder);
        }
    }
    
    prevRun1CardsCount = currentRun1Count;
    
    run1Row.appendChild(run1Cards);
    dualContainer.appendChild(run1Row);
    
    // === RUN 2 ===
    const run2Row = document.createElement('div');
    run2Row.className = 'board-row board-row-2';
    
    const run2Label = document.createElement('span');
    run2Label.className = 'board-label';
    run2Label.textContent = 'RUN 2';
    run2Row.appendChild(run2Label);
    
    const run2Cards = document.createElement('div');
    run2Cards.className = 'board-cards';
    
    const currentRun2Count = run2CommunityCards ? run2CommunityCards.length : 0;
    
    for (let i = 0; i < 5; i++) {
        if (run2CommunityCards && run2CommunityCards[i]) {
            const card = run2CommunityCards[i];
            const cardId = `${card.value}-${card.suit}`;
            const isHighlighted = run2Highlight.some(hc => hc.cardId === cardId);
            const cardEl = createCardElement(card, 'small', isHighlighted);
            
            // Animacja tylko dla ostatniej dodanej karty
            if (i === currentRun2Count - 1 && currentRun2Count > prevRun2CardsCount) {
                cardEl.classList.add('card-dealing');
            }
            
            run2Cards.appendChild(cardEl);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'card card-small card-placeholder';
            run2Cards.appendChild(placeholder);
        }
    }
    
    prevRun2CardsCount = currentRun2Count;
    
    run2Row.appendChild(run2Cards);
    dualContainer.appendChild(run2Row);
    
    communityCardsEl.appendChild(dualContainer);
}

// Renderuj dual board z informacją o zwycięzcach
function renderDualCommunityCardsWithWinners(run1Data, run2Data) {
    if (!isRunItTwiceActive) return;
    
    communityCardsEl.innerHTML = '';
    communityCardsEl.classList.add('dual-board-mode');
    
    const dualContainer = document.createElement('div');
    dualContainer.className = 'dual-board-container';
    
    // === RUN 1 ===
    const run1Row = document.createElement('div');
    run1Row.className = 'board-row board-row-1';
    
    const run1Label = document.createElement('span');
    run1Label.className = 'board-label';
    run1Label.textContent = 'RUN 1';
    run1Row.appendChild(run1Label);
    
    const run1CardsEl = document.createElement('div');
    run1CardsEl.className = 'board-cards';
    
    for (let i = 0; i < 5; i++) {
        if (run1Data.communityCards && run1Data.communityCards[i]) {
            const card = run1Data.communityCards[i];
            const cardEl = createCardElement(card, 'small', false);
            run1CardsEl.appendChild(cardEl);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'card card-small card-placeholder';
            run1CardsEl.appendChild(placeholder);
        }
    }
    run1Row.appendChild(run1CardsEl);
    
    // Dodaj info o zwycięzcy Run 1
    if (run1Data.winners && run1Data.winners.length > 0) {
        const winnerInfo = document.createElement('div');
        winnerInfo.className = 'board-winner';
        const winnerNames = run1Data.winners.map(w => w.name).join(', ');
        winnerInfo.innerHTML = `🏆 ${winnerNames}`;
        winnerInfo.title = `${run1Data.winners[0].hand} - ${run1Data.winAmount} żetonów`;
        run1Row.appendChild(winnerInfo);
    }
    
    dualContainer.appendChild(run1Row);
    
    // === RUN 2 ===
    const run2Row = document.createElement('div');
    run2Row.className = 'board-row board-row-2';
    
    const run2Label = document.createElement('span');
    run2Label.className = 'board-label';
    run2Label.textContent = 'RUN 2';
    run2Row.appendChild(run2Label);
    
    const run2CardsEl = document.createElement('div');
    run2CardsEl.className = 'board-cards';
    
    for (let i = 0; i < 5; i++) {
        if (run2Data.communityCards && run2Data.communityCards[i]) {
            const card = run2Data.communityCards[i];
            const cardEl = createCardElement(card, 'small', false);
            run2CardsEl.appendChild(cardEl);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'card card-small card-placeholder';
            run2CardsEl.appendChild(placeholder);
        }
    }
    run2Row.appendChild(run2CardsEl);
    
    // Dodaj info o zwycięzcy Run 2
    if (run2Data.winners && run2Data.winners.length > 0) {
        const winnerInfo = document.createElement('div');
        winnerInfo.className = 'board-winner';
        const winnerNames = run2Data.winners.map(w => w.name).join(', ');
        winnerInfo.innerHTML = `🏆 ${winnerNames}`;
        winnerInfo.title = `${run2Data.winners[0].hand} - ${run2Data.winAmount} żetonów`;
        run2Row.appendChild(winnerInfo);
    }
    
    dualContainer.appendChild(run2Row);
    
    communityCardsEl.appendChild(dualContainer);
}

function resetRunItTwice() {
    isRunItTwiceActive = false;
    run1CommunityCards = null;
    run2CommunityCards = null;
    runItTwiceOriginalCards = null;
    prevRun1CardsCount = 0;
    prevRun2CardsCount = 0;
    communityCardsEl.classList.remove('dual-board-mode');
}

// ============== RABBIT HUNT FUNCTIONS ==============
function activateRabbitHunt() {
    console.log('[RABBIT HUNT] activateRabbitHunt() wywołana! canRabbitHunt:', canRabbitHunt, 'rabbitHuntRevealed:', rabbitHuntRevealed);
    if (!canRabbitHunt || rabbitHuntRevealed) return;
    
    // Wyślij request do serwera o karty rabbit hunt
    socket.emit('requestRabbitHunt');
}

function resetRabbitHunt() {
    rabbitHuntCards = null;
    rabbitHuntRevealed = false;
    canRabbitHunt = false;
}

// ============== SHOW CARDS FUNCTIONS ==============
function showMyCards() {
    if (hasShownCards) return;
    
    // Wyślij request do serwera
    socket.emit('showCards');
    hasShownCards = true;
    
    // Ukryj przycisk
    if (btnShowCards) {
        btnShowCards.disabled = true;
        btnShowCards.innerHTML = '<span class="btn-icon">✓</span><span>Karty pokazane</span>';
    }
}

function resetShowCards() {
    revealedPlayerCards.clear();
    hasShownCards = false;
    
    // Resetuj przycisk
    if (btnShowCards) {
        btnShowCards.disabled = false;
        btnShowCards.innerHTML = '<span class="btn-icon">👁️</span><span>Pokaż karty</span>';
    }
}

function updateShowdownActionsVisibility(state) {
    if (!showdownActions) return;
    
    // Pokaż przycisk gdy:
    // 1. Faza to showdown
    // 2. Gracz ma karty (yourCards - swoje prywatne karty)
    // 3. Nie jest spectatorem
    // 4. Jeszcze nie pokazał kart w tym rozdaniu
    // 5. ORAZ: sfoldował LUB wygrano przez fold (wonByFold) - bo wtedy karty nie są automatycznie widoczne
    
    const isShowdownPhase = state.phase === 'showdown';
    const hasCards = state.yourCards && state.yourCards.length === 2;
    const isPlayer = !state.isSpectator;
    
    // Znajdź siebie w liście graczy
    const myPlayer = state.players?.find(p => p.id === myPlayerId);
    const isFolded = myPlayer?.folded || false;
    
    // Karty są automatycznie widoczne gdy: normalny showdown (nie wonByFold) I gracz nie sfoldował
    const cardsAutoVisible = !state.wonByFold && !isFolded;
    
    // Pokaż przycisk jeśli: showdown, mam karty, jestem graczem, karty NIE są auto-widoczne, nie pokazałem jeszcze
    if (isShowdownPhase && hasCards && isPlayer && !cardsAutoVisible && !hasShownCards) {
        showdownActions.classList.remove('hidden');
    } else {
        showdownActions.classList.add('hidden');
    }
}

// ============== DUAL BOARD FUNCTIONS ==============
function resetDualBoard() {
    // Reset licznika kart community (dla animacji)
    previousCommunityCardsCount = 0;
}

function renderYourCards(cards, highlightCards = []) {
    yourCardsEl.innerHTML = '';
    
    // Zabezpieczenie - upewnij się że highlightCards to tablica
    const safeHighlightCards = Array.isArray(highlightCards) ? highlightCards : [];
    
    if (cards && cards.length === 2) {
        cards.forEach((card, index) => {
            const cardId = `${card.value}-${card.suit}`;
            // Znajdź kartę w highlightCards z tym samym cardId i source === 'hand'
            const isHighlighted = safeHighlightCards.some(hc => hc.cardId === cardId && hc.source === 'hand');
            yourCardsEl.appendChild(createCardElement(card, 'normal', isHighlighted));
        });
    } else {
        yourCardsEl.appendChild(createCardBackElement());
        yourCardsEl.appendChild(createCardBackElement());
    }
}

// ============== TURN TIMER FUNCTIONS ==============
function startClientTurnTimer(playerId, expiresAt) {
    stopClientTurnTimer();
    
    turnTimerPlayerId = playerId;
    turnTimerExpiresAt = expiresAt;
    
    // Dźwięk gdy to nasza tura
    if (playerId === myPlayerId) {
        playSound('turnStart', 0.4);
    }
    
    turnTimerInterval = setInterval(() => {
        updateTurnTimerDisplay();
    }, 100);
    
    updateTurnTimerDisplay();
}

function stopClientTurnTimer() {
    if (turnTimerInterval) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
    }
    turnTimerPlayerId = null;
    turnTimerExpiresAt = null;
    
    // Usuń wszystkie paski timera i teksty
    document.querySelectorAll('.turn-timer-bar').forEach(el => el.remove());
    document.querySelectorAll('.turn-timer-text').forEach(el => el.remove());
    
    // Usuń efekt pulsowania
    const pokerTable = document.getElementById('poker-table');
    if (pokerTable) {
        pokerTable.classList.remove('timer-critical');
    }
    
    // Usuń klasy timer-critical z graczy
    document.querySelectorAll('.player-box.timer-critical').forEach(el => {
        el.classList.remove('timer-critical');
    });
}

function updateTurnTimerDisplay() {
    if (!turnTimerExpiresAt || !turnTimerPlayerId) return;
    
    const timeLeft = Math.max(0, turnTimerExpiresAt - Date.now());
    const totalTime = currentGameState?.config?.turnTimeout * 1000 || 15000;
    const secondsLeft = Math.ceil(timeLeft / 1000);
    
    // Znajdź element gracza z timerem
    const playerBoxes = document.querySelectorAll('.player-box');
    playerBoxes.forEach(box => {
        const seat = box.closest('.player-seat');
        if (!seat) return;
        
        const seatIndex = parseInt(seat.dataset.seat);
        const player = currentGameState?.players?.[seatIndex];
        
        if (player?.id === turnTimerPlayerId) {
            // Dodaj lub zaktualizuj tekst z sekundami
            let timerText = box.querySelector('.turn-timer-text');
            if (!timerText) {
                timerText = document.createElement('div');
                timerText.className = 'turn-timer-text';
                box.appendChild(timerText);
            }
            timerText.textContent = `${secondsLeft}s`;
            
            // Dodaj klasę critical dla ostatnich 5 sekund
            if (secondsLeft <= 5) {
                timerText.classList.add('critical');
                box.classList.add('timer-critical');
            } else {
                timerText.classList.remove('critical');
                box.classList.remove('timer-critical');
            }
        } else {
            // Usuń tekst z innych graczy
            const existingText = box.querySelector('.turn-timer-text');
            if (existingText) existingText.remove();
            box.classList.remove('timer-critical');
        }
    });
    
    // Efekt pulsowania stołu na ostatnie 5 sekund
    const pokerTable = document.getElementById('poker-table');
    if (pokerTable) {
        if (secondsLeft <= 5 && secondsLeft > 0) {
            pokerTable.classList.add('timer-critical');
        } else {
            pokerTable.classList.remove('timer-critical');
        }
    }
}

function renderPlayers(players) {
    document.querySelectorAll('.player-seat').forEach(seat => {
        seat.innerHTML = '';
    });
    
    players.forEach((player, index) => {
        const seat = document.querySelector(`.player-seat[data-seat="${index}"]`);
        if (!seat) return;
        
        const isMe = player.id === myPlayerId;
        const winnerData = currentWinners.find(w => w.id === player.id);
        const isWinner = !!winnerData;
        
        const classes = ['player-box'];
        if (player.isCurrentPlayer && !isWinner) classes.push('current-player');
        if (player.folded) classes.push('folded');
        if (isMe) classes.push('is-you');
        if (isWinner) classes.push('winner-highlight');
        
        // Pobierz highlightCards dla tego gracza (showdown)
        const playerHighlightCards = player.highlightCards || [];
        
        // Sprawdź czy gracz pokazał karty (reveal)
        const revealedCards = revealedPlayerCards.get(player.id);
        const cardsToShow = player.cards || revealedCards;
        const isRevealed = !player.cards && revealedCards; // Karty zostały ręcznie pokazane
        
        let cardsHtml = '';
        if (cardsToShow && cardsToShow.length === 2) {
            const revealedClass = isRevealed ? ' revealed-cards' : '';
            cardsHtml = `
                <div class="player-cards${revealedClass}">
                    ${cardsToShow.map((card, cardIndex) => {
                        const cardId = `${card.value}-${card.suit}`;
                        const isHighlighted = playerHighlightCards.some(hc => hc.cardId === cardId && hc.source === 'hand');
                        const highlightClass = isHighlighted ? ' card-in-hand-highlight' : '';
                        
                        // Określ klasę koloru w zależności od skinu
                        let colorClass = '';
                        if (currentCardSkin === 'colorful') {
                            const suitClasses = { '♥': 'suit-hearts', '♦': 'suit-diamonds', '♣': 'suit-clubs', '♠': 'suit-spades' };
                            colorClass = suitClasses[card.suit] || '';
                        } else {
                            const isRed = card.suit === '♥' || card.suit === '♦';
                            colorClass = isRed ? 'red' : 'black';
                        }
                        
                        return `<div class="card ${colorClass}${highlightClass}">${card.value}${card.suit}</div>`;
                    }).join('')}
                </div>
            `;
        } else if (!player.folded && currentGameState && currentGameState.phase !== 'waiting') {
            cardsHtml = `
                <div class="player-cards">
                    <div class="card card-back"></div>
                    <div class="card card-back"></div>
                </div>
            `;
        }
        
        // Etykieta WINNER i kwota wygranej
        // Pokaż tylko gdy więcej niż 1 gracz w pot (nie pokazuj gdy wygrał sam z siebie w side pot)
        const showWinnerLabel = isWinner && winnerData.playersInPot > 1;
        const winnerLabelHtml = showWinnerLabel ? `
            <div class="winner-label">
                <span class="winner-text">WINNER</span>
                ${winnerData.hand ? `<span class="winner-hand">${winnerData.hand}</span>` : ''}
                <span class="winner-amount">+${winnerData.amount}</span>
            </div>
        ` : '';
        
        // Znaczniki blindów (SB/BB)
        let blindBadgeHtml = '';
        if (player.isSB && currentGameState && currentGameState.phase !== 'waiting') {
            blindBadgeHtml = '<div class="blind-badge sb">SB</div>';
        } else if (player.isBB && currentGameState && currentGameState.phase !== 'waiting') {
            blindBadgeHtml = '<div class="blind-badge bb">BB</div>';
        }
        
        // Etykieta ostatniej akcji
        let actionLabelHtml = '';
        const lastAction = playerLastActions[player.id];
        if (lastAction && Date.now() - lastAction.timestamp < 8000) { // Pokaż przez 8 sekund
            let actionText = '';
            let actionClass = '';
            switch (lastAction.action) {
                case 'fold':
                    actionText = 'FOLD';
                    actionClass = 'action-fold';
                    break;
                case 'check':
                    actionText = 'CHECK';
                    actionClass = 'action-check';
                    break;
                case 'call':
                    actionText = `CALL ${lastAction.amount}`;
                    actionClass = 'action-call';
                    break;
                case 'bet':
                    actionText = `BET ${lastAction.amount}`;
                    actionClass = 'action-bet';
                    break;
                case 'raise':
                    actionText = `RAISE ${lastAction.amount}`;
                    actionClass = 'action-raise';
                    break;
            }
            if (actionText) {
                actionLabelHtml = `<div class="player-action-label ${actionClass}">${actionText}</div>`;
            }
        }
        
        // Hipotetyczny układ dla spasowanych graczy w Run It Twice
        let foldedHandHtml = '';
        if (isRunItTwiceActive && player.folded && runItTwiceFoldedPlayers.length > 0) {
            const foldedData = runItTwiceFoldedPlayers.find(fp => fp.id === player.id);
            if (foldedData) {
                foldedHandHtml = `
                    <div class="folded-hand-info">
                        <div class="folded-hand-label">Miałbyś:</div>
                        <div class="folded-hand-runs">
                            <span class="folded-run run-1">R1: ${foldedData.run1Hand}</span>
                            <span class="folded-run run-2">R2: ${foldedData.run2Hand}</span>
                        </div>
                    </div>
                `;
            }
        }
        
        seat.innerHTML = `
            <div class="${classes.join(' ')}">
                ${player.isDealer ? '<div class="dealer-chip">D</div>' : ''}
                ${blindBadgeHtml}
                <div class="player-name">${player.name}${isMe ? ' (Ty)' : ''}</div>
                <div class="player-chips">🪙 ${player.chips}</div>
                ${player.currentBet > 0 ? `<div class="player-bet">Stawka: ${player.currentBet}</div>` : ''}
                ${player.isAllIn ? '<div class="player-bet" style="color: #ffd700;">ALL-IN!</div>' : ''}
                ${cardsHtml}
                ${foldedHandHtml}
            </div>
            ${winnerLabelHtml}
            ${actionLabelHtml}
        `;
    });
}

function updateActionButtons(state) {
    // Jeśli gracz jest obserwatorem (z serwera lub lokalnie)
    if (state.isSpectator || isSpectator) {
        btnFold.disabled = true;
        btnCheck.disabled = true;
        btnCall.disabled = true;
        btnBet.disabled = true;
        betAmountInput.disabled = true;
        closeRaisePanel();
        return;
    }
    
    const isYourTurn = state.isYourTurn;
    const canCheck = state.canCheck;
    const callAmt = state.callAmount;
    const minBet = state.minBet;
    
    btnFold.disabled = !isYourTurn;
    btnCheck.disabled = !isYourTurn || !canCheck;
    btnCall.disabled = !isYourTurn || callAmt <= 0;
    btnBet.disabled = !isYourTurn;
    betAmountInput.disabled = !isYourTurn;
    
    callAmount.textContent = callAmt > 0 ? `(${callAmt})` : '';
    betLabel.textContent = state.currentBet > 0 ? 'Raise' : 'Bet';
    
    betAmountInput.min = minBet;
    if (parseInt(betAmountInput.value) < minBet) {
        betAmountInput.value = minBet;
    }
    
    // Zamknij panel raise jeśli nie nasza tura
    if (!isYourTurn) {
        closeRaisePanel();
    }
}

function updateGameState(state) {
    currentGameState = state;
    
    // Spectator mode - sprawdź czy jestem obserwatorem
    if (state.isSpectator || isSpectator) {
        spectatorBanner.classList.remove('hidden');
        playerPanel.style.opacity = '0.5';
        playerPanel.style.pointerEvents = 'none';
    } else {
        spectatorBanner.classList.add('hidden');
        playerPanel.style.opacity = '1';
        playerPanel.style.pointerEvents = 'auto';
    }
    
    phaseIndicator.textContent = formatPhase(state.phase);
    potAmount.textContent = state.pot;
    
    // Wyświetl side poty jeśli istnieją
    renderSidePots(state.sidePots);
    
    // Pobierz highlightCards dla tego gracza (jeśli istnieją)
    const myHighlightCards = state.highlightCards || [];
    
    // Renderuj community cards tylko jeśli Run It Twice nie jest aktywne
    if (!isRunItTwiceActive) {
        renderCommunityCards(state.communityCards, myHighlightCards);
    }
    renderYourCards(state.yourCards, myHighlightCards);
    
    if (state.yourHand && state.yourHand.name) {
        yourHandEl.textContent = `🎴 ${state.yourHand.name}`;
    } else {
        yourHandEl.textContent = '';
    }
    
    renderPlayers(state.players);
    
    // Aktualizuj listę spectatorów podczas gry
    updateGameSpectatorsList(state.spectators || []);
    
    // Find my data
    const myPlayer = state.players.find(p => p.id === myPlayerId);
    if (myPlayer) {
        yourName.textContent = myPlayer.name;
        yourChips.textContent = myPlayer.chips;
        
        // Automatyczna aktualizacja flagi isSpectator gdy żetony = 0
        if (myPlayer.chips <= 0 && !state.isSpectator) {
            // Gracz jest jeszcze w grze ale ma 0 żetonów - niedługo zostanie spectorem
            yourChips.style.color = '#dc3545';
        } else {
            yourChips.style.color = '';
        }
    } else if (state.isSpectator || isSpectator) {
        yourName.textContent = 'Obserwator';
        yourChips.textContent = '-';
    }
    
    // Podświetlenie stołu gdy to moja tura (ale nie podczas bomb pot)
    const pokerTable = document.querySelector('.poker-table');
    if (pokerTable) {
        if (state.isYourTurn && !state.isSpectator && !state.isBombPot) {
            pokerTable.classList.add('my-turn');
        } else {
            pokerTable.classList.remove('my-turn');
        }
    }
    
    updateActionButtons(state);
}

// Aktualizuj listę spectatorów podczas gry
function updateGameSpectatorsList(spectators) {
    const panel = document.getElementById('game-spectators-panel');
    const list = document.getElementById('game-spectators-list');
    const count = document.getElementById('game-spectators-count');
    
    if (!panel || !list || !count) return;
    
    if (!spectators || spectators.length === 0) {
        panel.classList.add('hidden');
        return;
    }
    
    panel.classList.remove('hidden');
    count.textContent = spectators.length;
    
    list.innerHTML = spectators.map(s => {
        const pendingClass = s.pendingJoin ? 'pending-join' : '';
        const pendingIcon = s.pendingJoin ? '⏳ ' : '';
        return `<li class="${pendingClass}">${pendingIcon}${s.name}</li>`;
    }).join('');
}

// ============== GAME ACTIONS ==============
btnFold.addEventListener('click', () => {
    socket.emit('playerAction', { action: 'fold' });
    closeRaisePanel();
});

btnCheck.addEventListener('click', () => {
    socket.emit('playerAction', { action: 'check' });
    closeRaisePanel();
});

btnCall.addEventListener('click', () => {
    socket.emit('playerAction', { action: 'call' });
    closeRaisePanel();
});

// Otwórz panel raise po kliknięciu Bet/Raise
btnBet.addEventListener('click', () => {
    openRaisePanel();
});

// Pokaż karty po zakończeniu rozdania
if (btnShowCards) {
    btnShowCards.addEventListener('click', () => {
        showMyCards();
    });
}

// ============== RAISE PANEL LOGIC ==============
function openRaisePanel() {
    if (!currentGameState) return;
    
    const myPlayer = currentGameState.players.find(p => p.id === myPlayerId);
    if (!myPlayer) return;
    
    const isBet = currentGameState.currentBet === 0;
    raiseTitle.textContent = isBet ? 'BET' : 'RAISE';
    confirmRaiseLabel.textContent = isBet ? 'Potwierdź Bet' : 'Potwierdź Raise';
    
    // Oblicz min i max
    raiseMinAmount = currentGameState.minBet || currentGameState.config.bigBlind;
    raiseMaxAmount = myPlayer.chips + myPlayer.currentBet;
    
    // Ustaw slider
    betSlider.min = raiseMinAmount;
    betSlider.max = raiseMaxAmount;
    betSlider.value = raiseMinAmount;
    
    // Ustaw etykiety
    sliderMin.textContent = raiseMinAmount;
    sliderMax.textContent = raiseMaxAmount;
    
    // Ustaw input
    betAmountInput.min = raiseMinAmount;
    betAmountInput.max = raiseMaxAmount;
    betAmountInput.value = raiseMinAmount;
    
    raisePanel.classList.remove('hidden');
}

function closeRaisePanel() {
    raisePanel.classList.add('hidden');
}

// Zamknij panel
raiseClose.addEventListener('click', closeRaisePanel);

// Synchronizacja slidera z inputem
betSlider.addEventListener('input', () => {
    betAmountInput.value = betSlider.value;
});

betAmountInput.addEventListener('input', () => {
    let value = parseInt(betAmountInput.value) || raiseMinAmount;
    value = Math.max(raiseMinAmount, Math.min(raiseMaxAmount, value));
    betSlider.value = value;
});

// Presety
document.querySelectorAll('.raise-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!currentGameState) return;
        
        const myPlayer = currentGameState.players.find(p => p.id === myPlayerId);
        if (!myPlayer) return;
        
        const preset = btn.dataset.preset;
        let amount;
        
        switch (preset) {
            case 'min':
                amount = raiseMinAmount;
                break;
            case '1/3':
                amount = Math.max(raiseMinAmount, Math.floor(currentGameState.pot / 3));
                break;
            case '1/2':
                amount = Math.max(raiseMinAmount, Math.floor(currentGameState.pot / 2));
                break;
            case '3/4':
                amount = Math.max(raiseMinAmount, Math.floor(currentGameState.pot * 3 / 4));
                break;
            case 'pot':
                amount = Math.max(raiseMinAmount, currentGameState.pot);
                break;
            case 'allin':
                amount = raiseMaxAmount;
                break;
            default:
                amount = raiseMinAmount;
        }
        
        // Ogranicz do maksimum
        amount = Math.min(amount, raiseMaxAmount);
        
        betAmountInput.value = amount;
        betSlider.value = amount;
    });
});

// Potwierdź raise
btnConfirmRaise.addEventListener('click', () => {
    const amount = parseInt(betAmountInput.value);
    socket.emit('playerAction', { action: 'bet', amount });
    closeRaisePanel();
});

// Enter w inpucie
betAmountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const amount = parseInt(betAmountInput.value);
        socket.emit('playerAction', { action: 'bet', amount });
        closeRaisePanel();
    }
});

// Zamknij panel gdy klikniemy poza nim
document.addEventListener('click', (e) => {
    if (!raisePanel.classList.contains('hidden') && 
        !raisePanel.contains(e.target) && 
        e.target !== btnBet && 
        !btnBet.contains(e.target)) {
        closeRaisePanel();
    }
});

// ============== SOCKET EVENTS ==============
socket.on('connect', () => {
    myPlayerId = socket.id;
    console.log('Połączono z serwerem:', myPlayerId);
});

socket.on('disconnect', () => {
    showToast('Rozłączono z serwerem!', 'error');
    resetClientState();
    showScreen(mainMenu);
});

socket.on('lobbyCreated', (data) => {
    currentLobbyCode = data.code;
    isHost = true;
    isSpectator = false; // Host nigdy nie jest spectatorem
    isPendingJoin = false;
    gameCodeValue.textContent = data.code;
    showScreen(lobbyScreen);
    showToast(`Lobby utworzone! Kod: ${data.code}`, 'success');
});

socket.on('joinedLobby', (data) => {
    currentLobbyCode = data.code;
    isSpectator = data.isSpectator;
    isHost = false; // Dołączający nie jest hostem
    isPendingJoin = false; // Resetuj stan oczekiwania
    gameCodeValue.textContent = data.code;
    
    // Jeśli gra już trwa, od razu przejdź do ekranu gry
    if (data.isGameStarted) {
        showScreen(gameScreen);
        console.log('[JOIN] Dołączono do trwającej gry jako obserwator');
    } else {
        showScreen(lobbyScreen);
    }
    
    // Wyświetl odpowiedni komunikat
    if (data.message) {
        showToast(data.message, data.isSpectator ? 'info' : 'success');
    } else {
        showToast('Dołączono do lobby!', 'success');
    }
});

socket.on('lobbyState', (lobby) => {
    // Zapisz stan lobby dla funkcji kick
    window.currentLobbyState = lobby;
    updateLobbyState(lobby);
});

socket.on('gameStarted', () => {
    showScreen(gameScreen);
    showToast('Gra rozpoczęta!', 'success');
});

socket.on('gameState', (state) => {
    // Reset przy nowej fazie (preflop = nowe rozdanie)
    if (state.phase === 'preflop' && currentGameState?.phase !== 'preflop') {
        // Czyść zwycięzców z poprzedniego rozdania
        currentWinners = [];
        // Czyść ostatnie akcje graczy
        playerLastActions = {};
        // Reset rabbit hunt
        resetRabbitHunt();
        // Reset pokazanych kart
        resetShowCards();
        // Reset Run It Twice
        resetRunItTwice();
    }
    
    // Aktualizuj flagę canRabbitHunt na podstawie stanu gry
    if (state.wonByFold && state.phase === 'showdown') {
        canRabbitHunt = true;
    } else if (state.phase !== 'showdown') {
        canRabbitHunt = false;
    }
    
    // Jeśli gra jest w toku a jesteśmy na innym ekranie niż gameScreen - przełącz
    if (state.isGameStarted && gameScreen.classList.contains('hidden')) {
        showScreen(gameScreen);
    }
    
    updateGameState(state);
    
    // Obsługa Bomb Pot UI
    updateBombPotPanel(state);
    
    // Aktualizuj listę widzów podczas gry
    if (state.spectators) {
        updateGameSpectatorsList(state.spectators);
    }
    
    // Obsługa Turn Timer z gameState (synchronizacja przy reconnect)
    if (state.turnTimer && state.turnTimer.playerId && state.turnTimer.expiresAt > Date.now()) {
        if (turnTimerPlayerId !== state.turnTimer.playerId) {
            startClientTurnTimer(state.turnTimer.playerId, state.turnTimer.expiresAt);
        }
    } else if (!state.turnTimer && turnTimerInterval) {
        stopClientTurnTimer();
    }
    
    // Oznacz stół jako Bomb Pot
    const pokerTable = document.querySelector('.poker-table');
    if (state.isBombPot) {
        pokerTable.classList.add('bomb-pot-active');
    } else {
        pokerTable.classList.remove('bomb-pot-active');
    }
    
    // Obsługa przycisku "Pokaż karty" w showdown
    updateShowdownActionsVisibility(state);
});

// Obsługa ważnych komunikatów gry (tylko jako toast, bez żółtego okna)
socket.on('gameStatus', (data) => {
    // Pokaż tylko jako toast - bez osobnego elementu UI
    if (data.message.includes('Za mało graczy') || data.message.includes('zakończona')) {
        showToast(data.message, 'warning');
    }
});

// Obsługa Big Blind Ante
socket.on('antePaid', (data) => {
    showToast(`💰 ${data.playerName} wpłaca BB Ante: ${data.amount}`, 'info');
    addLogEntry(`💰 ${data.playerName} wpłaca BB Ante: ${data.amount}`);
});

socket.on('playerJoined', (data) => {
    if (data.id !== myPlayerId) {
        showToast(`${data.name} dołączył${data.isSpectator ? ' jako obserwator' : ''}`, 'info');
        addLogEntry(`${data.name} dołączył do gry`);
    }
});

socket.on('playerLeft', (data) => {
    showToast(`${data.name} opuścił grę`, 'info');
    addLogEntry(`${data.name} opuścił grę`);
});

socket.on('newHost', (data) => {
    if (data.id === myPlayerId) {
        isHost = true;
        showToast('Zostałeś hostem!', 'success');
    } else {
        showToast(`${data.name} jest nowym hostem`, 'info');
    }
});

// ============== BOMB POT EVENTS ==============
socket.on('bombPotVoteStarted', (data) => {
    showToast(`💣 ${data.initiatorName} rozpoczyna głosowanie Bomb Pot (stawka: ${data.stake})`, 'warning');
    addLogEntry(`💣 ${data.initiatorName} rozpoczyna głosowanie Bomb Pot (stawka: ${data.stake})`, 'bombpot');
    
    // Aktualizuj panel
    bombPotPanel.classList.remove('hidden');
    bombPotStart.classList.add('hidden');
    bombPotVoting.classList.remove('hidden');
    bombPotVoteStake.textContent = data.stake;
    bombPotYesVotes.textContent = '1'; // Inicjator już zagłosował
    bombPotTotalVoters.textContent = '?';
    
    // Jeśli ja jestem inicjatorem - od razu pokaż że już zagłosowałem TAK
    if (data.initiatorId === myPlayerId) {
        bombPotVoteButtons.classList.add('hidden');
        bombPotVotedStatus.classList.remove('hidden');
        bombPotMyVote.textContent = '✓ TAK';
        bombPotMyVote.style.color = '#2ecc71';
    } else {
        bombPotVoteButtons.classList.remove('hidden');
        bombPotVotedStatus.classList.add('hidden');
    }
    
    startBombPotVoteTimer(data.expiresAt);
});

socket.on('bombPotVoteUpdate', (data) => {
    bombPotYesVotes.textContent = data.yesVotes;
    bombPotTotalVoters.textContent = data.totalVoters;
});

socket.on('bombPotVoteResult', (data) => {
    stopBombPotVoteTimer();
    
    if (data.success) {
        showToast(`🎰 ${data.message}`, 'success');
    } else {
        showToast(`🎰 ${data.message}`, 'info');
    }
    addLogEntry(`🎰 ${data.message}`, 'bombpot');
    
    // Resetuj panel
    bombPotStart.classList.remove('hidden');
    bombPotVoting.classList.add('hidden');
});

socket.on('bombPotStarted', (data) => {
    playSound('bombPot', 0.7);
    showToast(`💣💥 BOMB POT! Pula: ${data.pot}`, 'warning');
    addLogEntry(`💣💥 BOMB POT rozpoczęty! Pula: ${data.pot}`, 'bombpot');
    
    // Pokaż spektakularne powiadomienie
    const indicator = document.createElement('div');
    indicator.className = 'bomb-pot-indicator';
    indicator.innerHTML = '💣💥 BOMB POT! 💥💣';
    document.body.appendChild(indicator);
    
    setTimeout(() => {
        indicator.remove();
    }, 3000);
});

socket.on('bombPotShowdown', (data) => {
    showToast(data.message, 'success');
    addLogEntry(data.message, 'win');
});

socket.on('bombPotCancelled', (data) => {
    showToast(`🎰 ${data.message}`, 'warning');
    addLogEntry(`🎰 ${data.message}`, 'bombpot');
});

// ============== RUN IT TWICE SOCKET HANDLERS ==============
socket.on('runItTwiceVoteStarted', (data) => {
    showToast(`🎲 Głosowanie Run It Twice rozpoczęte!`, 'info');
    addLogEntry(`🎲 Głosowanie Run It Twice - ${data.players.length} graczy`, 'info');
    
    // Pokaż panel głosowania
    if (runItTwicePanel) {
        runItTwicePanel.classList.remove('hidden');
    }
    
    // Reset stanu
    hasVotedRunItTwice = false;
    
    if (runItTwiceYesVotes) runItTwiceYesVotes.textContent = '0';
    if (runItTwiceTotalVoters) runItTwiceTotalVoters.textContent = data.players.length;
    
    // Sprawdź czy jestem uczestnikiem głosowania
    const isParticipant = data.players.some(p => p.id === myPlayerId);
    
    if (isParticipant) {
        if (runItTwiceVoteButtons) runItTwiceVoteButtons.classList.remove('hidden');
        if (runItTwiceVotedStatus) runItTwiceVotedStatus.classList.add('hidden');
    } else {
        // Obserwator lub nie-uczestnik
        if (runItTwiceVoteButtons) runItTwiceVoteButtons.classList.add('hidden');
        if (runItTwiceVotedStatus) {
            runItTwiceVotedStatus.classList.remove('hidden');
            if (runItTwiceMyVote) {
                runItTwiceMyVote.textContent = 'Obserwujesz';
                runItTwiceMyVote.style.color = '#bbb';
            }
        }
    }
    
    startRunItTwiceVoteTimer(data.expiresAt);
});

socket.on('runItTwiceVoteUpdate', (data) => {
    if (runItTwiceYesVotes) runItTwiceYesVotes.textContent = data.yesVotes;
    if (runItTwiceTotalVoters) runItTwiceTotalVoters.textContent = data.totalVoters;
});

socket.on('runItTwiceVoteResult', (data) => {
    stopRunItTwiceVoteTimer();
    
    // Ukryj panel głosowania
    if (runItTwicePanel) {
        runItTwicePanel.classList.add('hidden');
    }
    
    if (data.success) {
        showToast(`🎲 ${data.message}`, 'success');
        playSound('cardDeal', 0.5);
    } else {
        showToast(`🎲 ${data.message}`, 'info');
    }
    addLogEntry(`🎲 ${data.message}`, 'info');
    
    hasVotedRunItTwice = false;
});

socket.on('runItTwiceStarted', (data) => {
    showToast(`🎲🎲 RUN IT TWICE! Karty zostaną rozdane dwukrotnie.`, 'success');
    addLogEntry(`🎲🎲 RUN IT TWICE rozpoczęty!`, 'info');
    playSound('cardDeal', 0.5);
    
    // Ustaw stan Run It Twice
    isRunItTwiceActive = true;
    runItTwiceOriginalCards = data.originalCommunityCards || [];
    run1CommunityCards = [...runItTwiceOriginalCards];
    run2CommunityCards = [...runItTwiceOriginalCards];
    
    // Reset liczników kart dla animacji
    prevRun1CardsCount = run1CommunityCards.length;
    prevRun2CardsCount = run2CommunityCards.length;
    
    // Przełącz na widok dual board
    renderDualCommunityCards();
});

socket.on('runItTwiceCardDealt', (data) => {
    const runNum = data.runNumber;
    const card = data.card;
    const cards = data.communityCards;
    
    playSound('cardFlip', 0.4);
    
    // Aktualizuj odpowiedni board
    if (runNum === 1) {
        run1CommunityCards = cards;
    } else if (runNum === 2) {
        run2CommunityCards = cards;
    }
    
    // Wyrenderuj zaktualizowany dual board
    renderDualCommunityCards();
    
    // Log tylko przy pełnej fazie
    const phaseNames = { 'flop': 'Flop', 'turn': 'Turn', 'river': 'River' };
    if (data.phase === 'river' || (data.phase === 'flop' && cards.length === runItTwiceOriginalCards.length + 3)) {
        addLogEntry(`🎲 Run ${runNum} ${phaseNames[data.phase]}: ${card.value}${card.suit}`, 'info');
    }
});

socket.on('playerAction', (data) => {
    // Zapisz ostatnią akcję gracza
    playerLastActions[data.playerId] = {
        action: data.action,
        amount: data.amount || 0,
        timestamp: Date.now()
    };
    
    // Odśwież wyświetlanie graczy z nową akcją
    if (currentGameState && currentGameState.players) {
        renderPlayers(currentGameState.players);
    }
    
    // Odtwórz dźwięk akcji
    switch (data.action) {
        case 'fold':
            playSound('fold', 0.4);
            break;
        case 'check':
            playSound('check', 0.5);
            break;
        case 'call':
            playSound('call', 0.5);
            break;
        case 'bet':
            playSound('bet', 0.5);
            break;
        case 'raise':
            playSound('raise', 0.6);
            break;
    }
    
    let message = '';
    switch (data.action) {
        case 'fold':
            message = `${data.playerName} spasował`;
            break;
        case 'check':
            message = `${data.playerName} sprawdził`;
            break;
        case 'call':
            message = `${data.playerName} sprawdził ${data.amount}`;
            break;
        case 'bet':
            message = `${data.playerName} postawił ${data.amount}`;
            break;
        case 'raise':
            message = `${data.playerName} podbił do ${data.amount}`;
            break;
    }
    addLogEntry(message, data.action);
});

// ============== TURN TIMER EVENTS ==============
socket.on('turnTimerStarted', (data) => {
    console.log('[TURN-TIMER] Timer started for', data.playerId, 'expires at', data.expiresAt);
    startClientTurnTimer(data.playerId, data.expiresAt);
});

socket.on('turnTimerCleared', () => {
    console.log('[TURN-TIMER] Timer cleared');
    stopClientTurnTimer();
});

socket.on('autoAction', (data) => {
    let message = '';
    if (data.action === 'fold') {
        message = `⏱️ ${data.playerName} automatycznie spasował (timeout)`;
    } else if (data.action === 'check') {
        message = `⏱️ ${data.playerName} automatycznie sprawdził (timeout)`;
    }
    addLogEntry(message, 'timeout');
    
    if (data.playerId === myPlayerId) {
        showToast('Czas minął! Wykonano automatyczną akcję.', 'warning');
    }
});

socket.on('roundEnd', (data) => {
    console.log('[ROUND END] Zwycięzcy:', data.winners);
    
    // Sprawdź czy to Run It Twice
    if (data.runItTwice) {
        console.log('[RUN IT TWICE] Wyniki:', data.run1, data.run2);
        
        // Zaktualizuj dual board z wynikami
        if (data.run1 && data.run2) {
            run1CommunityCards = data.run1.communityCards;
            run2CommunityCards = data.run2.communityCards;
            
            // Wyrenderuj z informacją o zwycięzcach
            renderDualCommunityCardsWithWinners(data.run1, data.run2);
        }
        
        // Zapisz hipotetyczne układy spasowanych graczy
        runItTwiceFoldedPlayers = data.foldedPlayersCards || [];
        
        // Zaloguj i pokaż hipotetyczne układy spasowanych
        if (runItTwiceFoldedPlayers.length > 0) {
            console.log('[RUN IT TWICE] Spasowani gracze:', runItTwiceFoldedPlayers);
            runItTwiceFoldedPlayers.forEach(p => {
                addLogEntry(`📋 ${p.name} miałby: Run1: ${p.run1Hand} | Run2: ${p.run2Hand}`, 'info');
            });
        }
        
        // Pokaż komunikat o wynikach Run It Twice
        const run1Winners = data.run1.winners.map(w => w.name).join(', ');
        const run2Winners = data.run2.winners.map(w => w.name).join(', ');
        
        showToast(`🎲 RUN IT TWICE! Run 1: ${run1Winners} | Run 2: ${run2Winners}`, 'success');
        addLogEntry(data.message, 'success');
        
        // Dźwięk wygranej
        const isMyWin = data.winners.some(w => w.id === myPlayerId);
        if (isMyWin) {
            playSound('win', 0.6);
        } else if (!isSpectator) {
            playSound('chips', 0.4);
        }
        
        // Re-renderuj graczy z hipotetycznymi układami
        if (currentGameState && currentGameState.players) {
            renderPlayers(currentGameState.players);
        }
        
        // Reset Run It Twice po 6 sekundach
        setTimeout(() => {
            resetRunItTwice();
            runItTwiceFoldedPlayers = [];
            currentWinners = [];
            if (currentGameState && currentGameState.players) {
                renderPlayers(currentGameState.players);
            }
        }, 6000);
        
        return;
    }
    
    // Sprawdź czy to wygrana przez fold - włącz rabbit hunt
    if (data.wonByFold) {
        canRabbitHunt = true;
        console.log('[RABBIT HUNT] Rozdanie zakończone foldem - rabbit hunt dostępny');
    }
    
    // Zapisz informacje o zwycięzcach do podświetlenia
    // Dodaj informację o liczbie graczy w pot (do ukrycia labela gdy sam)
    currentWinners = data.winners.map(w => ({
        id: w.id,
        name: w.name,
        amount: w.amount,
        hand: w.hand || null,
        playersInPot: w.playersInPot || 2  // Domyślnie 2 jeśli nie podano
    }));
    
    // Odśwież wyświetlanie graczy z podświetleniem zwycięzców
    if (currentGameState && currentGameState.players) {
        renderPlayers(currentGameState.players);
    }
    
    // Dźwięk wygranej/przegranej
    const isMyWin = data.winners.some(w => w.id === myPlayerId);
    if (isMyWin) {
        playSound('win', 0.6);
    } else if (!isSpectator) {
        // Tylko dźwięk chips dla innych
        playSound('chips', 0.4);
    }
    
    // Pokaż toast z informacją o zwycięzcy
    if (data.winners.length > 1) {
        showToast(`🤝 Remis! ${data.winners.map(w => w.name).join(' i ')} dzielą pulę!`, 'success');
    } else {
        const winner = data.winners[0];
        const handInfo = winner.hand ? ` (${winner.hand})` : '';
        showToast(`🏆 ${winner.name} wygrywa ${winner.amount}${handInfo}!`, 'success');
    }
    
    addLogEntry(data.message, 'success');
    
    // Automatyczne wyczyszczenie podświetlenia po 5 sekundach
    setTimeout(() => {
        currentWinners = [];
        if (currentGameState && currentGameState.players) {
            renderPlayers(currentGameState.players);
        }
    }, 5000);
});

// Helper function dla symboli kolorów
function getSuitSymbol(suit) {
    const symbols = {
        '♠': '♠', '♥': '♥', '♦': '♦', '♣': '♣',
        'spades': '♠', 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣'
    };
    return symbols[suit] || suit;
}

// ============== ALL-IN SHOWDOWN ==============
socket.on('allInShowdown', (data) => {
    console.log('[ALL-IN SHOWDOWN] Rozpoczęcie showdown!', data);
    
    showToast('🔥 ALL-IN SHOWDOWN! Karty odkryte!', 'success');
    addLogEntry('🔥 ALL-IN SHOWDOWN - Karty zostały odkryte!', 'success');
    
    // Karty graczy zostaną automatycznie pokazane przez gameState update
});

socket.on('allInCardDealt', (data) => {
    console.log(`[ALL-IN SHOWDOWN] Wykładanie: ${data.phase}`);
    
    // Dźwięk karty
    playSound('cardFlip', 0.5);
    
    const phaseNames = {
        'flop': 'FLOP',
        'turn': 'TURN', 
        'river': 'RIVER'
    };
    
    addLogEntry(`📤 ${phaseNames[data.phase] || data.phase} wykładany...`, 'info');
});

// ============== RABBIT HUNT EVENTS ==============
socket.on('rabbitHuntCards', (data) => {
    console.log('[RABBIT HUNT] Otrzymano karty:', data.cards);
    
    if (data.cards && data.cards.length > 0) {
        rabbitHuntCards = data.cards;
        rabbitHuntRevealed = true;
        
        // Odśwież wyświetlanie kart community z rabbit hunt
        if (currentGameState) {
            renderCommunityCards(currentGameState.communityCards, currentGameState.highlightCards || []);
        }
        
        showToast('🐰 Rabbit Hunt! Odkryto brakujące karty.', 'info');
        addLogEntry('🐰 Rabbit Hunt - odkryto brakujące karty', 'info');
    }
});

// ============== SHOW CARDS EVENTS ==============
socket.on('playerShowedCards', (data) => {
    console.log('[SHOW CARDS] Gracz pokazał karty:', data);
    
    // Zapisz pokazane karty
    revealedPlayerCards.set(data.playerId, data.cards);
    
    // Odśwież wyświetlanie graczy
    if (currentGameState && currentGameState.players) {
        renderPlayers(currentGameState.players);
    }
    
    // Pokaż toast (nie dla siebie)
    if (data.playerId !== myPlayerId) {
        showToast(`👁️ ${data.playerName} pokazał swoje karty!`, 'info');
    }
    addLogEntry(`👁️ ${data.playerName} pokazał karty`, 'info');
});

socket.on('error', (data) => {
    console.log('[ERROR] Błąd z serwera:', data.message);
    showToast(data.message, 'error');
});

// Obsługa wyrzucenia z lobby przez hosta
socket.on('kicked', (data) => {
    console.log('[KICKED] Zostałeś wyrzucony z lobby');
    resetClientState();
    showScreen(mainMenu);
    showToast(data.message || 'Zostałeś wyrzucony z lobby', 'error');
});

// Obsługa informacji o wyrzuceniu innego gracza
socket.on('playerKicked', (data) => {
    console.log('[PLAYER-KICKED]', data.name, 'został wyrzucony z lobby');
    showToast(`🚪 ${data.name} został wyrzucony z lobby`, 'warning');
    addLogEntry(`🚪 ${data.name} wyrzucony z lobby`, 'warning');
});

// Obsługa sukcesu opuszczenia lobby
socket.on('leftLobby', (data) => {
    console.log('[LEFT-LOBBY] Opuszczono lobby pomyślnie');
    resetClientState();
    showScreen(mainMenu);
    showToast(data.message || 'Opuściłeś lobby', 'info');
});

// ============== AUTOMATYCZNE PRZENIESIENIE DO OBSERWATORÓW ==============

// Funkcja aktualizująca przyciski w bannerze spectatora
function updateSpectatorBannerButtons(lobby) {
    if (!isSpectator) {
        if (spectatorBanner) spectatorBanner.classList.add('hidden');
        return;
    }
    
    spectatorBanner.classList.remove('hidden');
    
    console.log('[SPECTATOR-UI] canJoinGame:', lobby.canJoinGame, 'isPendingJoin:', isPendingJoin, 'isGameStarted:', lobby.isGameStarted);
    
    if (isPendingJoin) {
        // Oczekuje na dołączenie
        spectatorText.innerHTML = '⏳ Oczekujesz w kolejce do gry...';
        btnJoinGame.classList.add('hidden');
        btnCancelJoin.classList.remove('hidden');
    } else if (lobby.canJoinGame) {
        // Może dołączyć
        if (lobby.isGameStarted) {
            spectatorText.innerHTML = '👁️ Obserwujesz grę - kliknij aby dołączyć';
        } else {
            spectatorText.innerHTML = '👁️ Oczekiwanie na grę - kliknij aby dołączyć';
        }
        btnJoinGame.classList.remove('hidden');
        btnCancelJoin.classList.add('hidden');
    } else {
        // Brak wolnych miejsc
        spectatorText.innerHTML = '👁️ Obserwujesz grę (brak wolnych miejsc)';
        btnJoinGame.classList.add('hidden');
        btnCancelJoin.classList.add('hidden');
    }
}

// Gracz został przeniesiony do obserwatorów (dla tego gracza)
socket.on('movedToSpectators', (data) => {
    isSpectator = true;
    isPendingJoin = false;
    
    // Wyświetl komunikat
    showToast(data.message, 'error');
    addLogEntry(data.message, 'error');
    
    // Zablokuj wszystkie kontrolki gry
    disableAllGameControls();
    
    // Pokaż banner obserwatora - tekst zostanie zaktualizowany przy następnym lobbyState
    if (spectatorBanner) {
        spectatorBanner.classList.remove('hidden');
        spectatorText.innerHTML = '💀 Brak żetonów - Tryb obserwatora';
        // NIE ukrywaj przycisku - lobbyState zaktualizuje go poprawnie
    }
    
    console.log('[CLIENT] Przeniesiony do obserwatorów - brak żetonów');
});

// Gracz sam zdecydował zostać obserwatorem
socket.on('becameSpectator', (data) => {
    isSpectator = true;
    isPendingJoin = false;
    
    showToast(data.message, 'info');
    addLogEntry('Jesteś teraz obserwatorem', 'info');
    
    disableAllGameControls();
    
    if (spectatorBanner) {
        spectatorBanner.classList.remove('hidden');
        spectatorText.innerHTML = '👁️ Obserwujesz grę';
    }
    
    console.log('[CLIENT] Przeszedłeś na obserwatora');
});

// Inny gracz stracił wszystkie żetony (broadcast)
socket.on('playerOutOfChips', (data) => {
    playSound('bust', 0.5);
    if (data.playerId !== myPlayerId) {
        addLogEntry(`💀 ${data.playerName} stracił wszystkie żetony i został obserwatorem`, 'error');
        showToast(`${data.playerName} stracił wszystkie żetony`, 'info');
    }
});

// ============== DOŁĄCZANIE DO GRY ==============

// Potwierdzenie dodania do kolejki
socket.on('pendingJoinConfirmed', (data) => {
    isPendingJoin = true;
    showToast(data.message, 'success');
    addLogEntry(`Dodano do kolejki. Dołączysz z ${data.startingChips} żetonami.`, 'info');
    
    if (spectatorBanner) {
        spectatorText.innerHTML = '⏳ Oczekujesz w kolejce do gry...';
        btnJoinGame.classList.add('hidden');
        btnCancelJoin.classList.remove('hidden');
    }
    
    console.log('[CLIENT] Dodano do kolejki oczekujących');
});

// Anulowanie oczekiwania
socket.on('pendingJoinCancelled', (data) => {
    isPendingJoin = false;
    showToast(data.message, 'info');
    
    if (spectatorBanner) {
        spectatorText.innerHTML = '👁️ Obserwujesz grę';
        btnJoinGame.classList.remove('hidden');
        btnCancelJoin.classList.add('hidden');
    }
    
    console.log('[CLIENT] Anulowano oczekiwanie na dołączenie');
});

// Dołączenie do gry (z kolejki lub natychmiast)
socket.on('joinedGame', (data) => {
    isSpectator = false;
    isPendingJoin = false;
    
    showToast(data.message, 'success');
    addLogEntry(`Dołączyłeś do gry z ${data.chips} żetonami!`, 'success');
    
    // Ukryj banner obserwatora
    if (spectatorBanner) {
        spectatorBanner.classList.add('hidden');
    }
    
    // Odblokuj panel gracza
    if (playerPanel) {
        playerPanel.style.opacity = '1';
        playerPanel.style.pointerEvents = 'auto';
    }
    
    console.log('[CLIENT] Dołączyłeś do gry z', data.chips, 'żetonami');
});

// Broadcast: ktoś inny został dodany do kolejki
socket.on('playerPendingJoin', (data) => {
    if (data.playerId !== myPlayerId) {
        addLogEntry(`⏳ ${data.playerName} czeka na dołączenie do gry`, 'info');
    }
});

// Broadcast: ktoś inny dołączył do gry
socket.on('playerJoinedGame', (data) => {
    if (data.playerId !== myPlayerId) {
        addLogEntry(`🎮 ${data.playerName} dołączył do gry z ${data.chips} żetonami!`, 'success');
        showToast(`${data.playerName} dołączył do gry!`, 'info');
    }
});

// Funkcja blokująca wszystkie kontrolki gry
function disableAllGameControls() {
    btnFold.disabled = true;
    btnCheck.disabled = true;
    btnCall.disabled = true;
    btnBet.disabled = true;
    betAmountInput.disabled = true;
    closeRaisePanel();
    
    // Wyszarz panel gracza
    if (playerPanel) {
        playerPanel.style.opacity = '0.5';
        playerPanel.style.pointerEvents = 'none';
    }
}

// ============== INICJALIZACJA ==============
// Ustaw początkowy stan feature toggles
document.querySelectorAll('.feature-toggle').forEach(toggle => {
    const checkbox = toggle.querySelector('input[type="checkbox"]');
    if (checkbox && checkbox.checked) {
        toggle.classList.add('active');
        const status = toggle.querySelector('.toggle-status');
        if (status) status.textContent = 'włączono';
    }
});

// ============== INICJALIZACJA USTAWIEŃ ==============
// Przycisk ustawień
const settingsToggleBtn = document.getElementById('settings-toggle');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const soundEffectsCheckbox = document.getElementById('toggle-sound-effects');
const backgroundMusicCheckbox = document.getElementById('toggle-background-music');

if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
        updateSettingsUI();
        updateLeaveLobbyVisibility();
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
}

if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });
}

if (soundEffectsCheckbox) {
    soundEffectsCheckbox.addEventListener('change', () => {
        soundEnabled = soundEffectsCheckbox.checked;
        localStorage.setItem('pokerSoundEnabled', soundEnabled);
        if (soundEnabled) {
            playSound('buttonClick', 0.3);
        }
    });
}

if (backgroundMusicCheckbox) {
    backgroundMusicCheckbox.addEventListener('change', () => {
        musicEnabled = backgroundMusicCheckbox.checked;
        localStorage.setItem('pokerMusicEnabled', musicEnabled);
        if (musicEnabled) {
            startBackgroundMusic();
        } else {
            stopBackgroundMusic();
        }
    });
}

// Przycisk "Opuść lobby" w ustawieniach
const btnSettingsLeaveLobby = document.getElementById('btn-settings-leave-lobby');
const leaveLobbySection = document.getElementById('leave-lobby-section');

if (btnSettingsLeaveLobby) {
    btnSettingsLeaveLobby.addEventListener('click', () => {
        if (confirm('Czy na pewno chcesz opuścić lobby?')) {
            socket.emit('leaveLobby');
            settingsModal.style.display = 'none';
        }
    });
}

// Aktualizuj widoczność sekcji "Opuść lobby" w zależności od stanu
function updateLeaveLobbyVisibility() {
    if (leaveLobbySection) {
        // Pokaż tylko gdy jesteśmy w lobby lub grze
        const inLobbyOrGame = currentLobbyCode !== null;
        leaveLobbySection.style.display = inLobbyOrGame ? 'block' : 'none';
    }
}

// Inicjalizacja UI ustawień
updateSettingsUI();

// Dźwięki hover dla przycisków akcji
const actionButtons = [btnFold, btnCheck, btnCall, btnBet, btnShowCards];
actionButtons.forEach(btn => {
    if (btn) {
        btn.addEventListener('mouseenter', () => {
            if (!btn.disabled) {
                playSound('buttonHover', 0.15);
            }
        });
    }
});

// Dźwięki kliknięcia dla głównych przycisków menu
document.querySelectorAll('.btn-menu-tile, .btn-primary, .btn-success, .btn-danger').forEach(btn => {
    btn.addEventListener('click', () => {
        playSound('buttonClick', 0.3);
    });
});

// Uruchom muzykę po pierwszej interakcji użytkownika
document.addEventListener('click', function initMusic() {
    if (musicEnabled) {
        startBackgroundMusic();
    }
    document.removeEventListener('click', initMusic);
}, { once: true });

showScreen(mainMenu);

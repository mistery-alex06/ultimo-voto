/**
 * Engine for "Guerra all’Ultimo Voto" - 2V2 SPECIALIZED MODE
 */

let game2v2 = null;
let selected2v2CardIndex = null;
let targeting2v2Mode = false;
let targeting2v2Attack = false;
let valid2v2TargetIds = [];

function isCardPositive(card) {
    if (!card.effect) return false;
    const e = card.effect;
    // Se ha effetti che aiutano (vita, atk, def, immunità, regen)
    return !!(e.life || e.atk || e.def || e.immunity || e.regen || e.atkMultiplier || e.nextAtkMultiplier || e.directDamageImmunity || e.cancelLastAttack || e.avoidNegativeEffect);
}

function isCardGlobal(card) {
    if (!card.effect) return false;
    const e = card.effect;
    return !!(e.bothStun || e.resetEffects || e.bothDamage || e.bothDef || e.randomizeEffects);
}

class Game2v2 {
    constructor(cards, personalities = {}) {
        this.allCards = cards;
        this.reset(personalities);
    }

    reset(personalities = {}) {
        this.gameMode = '2v2';
        this.sharedDeck = this.shuffle([...this.allCards]);
        this.sharedDiscard = [];
        this.cardsDrawn = 0;
        this.gameRound = 1;
        this.activeEvents = [];
        this.eventCooldown = 3;
        this.maxHp = 3000;

        const createPlayer = (id, name, isAI, team, personalityId) => ({
            id, name, isAI, team,
            personality: personalityId || null,
            hp: this.maxHp, atk: 0, def: 0, hand: [],
            potions: [], potionsUsedThisTurn: 0,
            status: {
                stunned: 0, immunity: 0, nextAtkMultiplier: 1, damageReduction: 1,
                directDamageImmunity: 0, ignoreDefense: false,
                reflectDamage: false, regen: 0, debuffImmunity: false, extraPlays: 0
            },
            lastPlayedCard: null,
            state: 'alive'
        });

        // 2v2: Player 1 & 2 are Humans (Team A), Player 3 & 4 are AI (Team B)
        this.players = {
            player1: createPlayer('player1', sessionStorage.getItem('username') || 'Giocatore 1', false, 'A', personalities['player1']),
            player2: createPlayer('player2', 'Giocatore 2 (Alleato)', false, 'A', personalities['player2']),
            player3: createPlayer('player3', 'AI Prof 1', true, 'B', personalities['player3']),
            player4: createPlayer('player4', 'AI Prof 2', true, 'B', personalities['player4'])
        };

        this.teams = {
            'A': ['player1', 'player2'],
            'B': ['player3', 'player4']
        };

        this.turnOrder = ['player1', 'player2', 'player3', 'player4'];
        this.turnIndex = 0;
        this.turn = this.turnOrder[this.turnIndex];

        this.log = ["Benvenuti nella Sfida 2v2!"];
        this.gameOver = false;
        this.lastCardPlayedInTurn = {};

        this.turnOrder.forEach(pid => {
            for (let i = 0; i < 5; i++) {
                this.drawCard(pid);
            }
        });

        if (typeof AudioManager !== 'undefined') AudioManager.startBGM();
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    drawCard(playerId) {
        if (this.sharedDeck.length === 0) {
            if (this.sharedDiscard.length === 0) return;
            this.sharedDeck = this.shuffle([...this.sharedDiscard]);
            this.sharedDiscard = [];
        }
        const player = this.players[playerId];
        const card = this.sharedDeck.pop();
        if (card) {
            player.hand.push(card);
            this.cardsDrawn++;
            if (this.onCardDraw) this.onCardDraw(playerId, card);
        }
    }

    getDefaultTarget(player, card) {
        // Logica di targeting automatico per facilitare il gioco
        if (card.targetType === 'ally' || card.targetType === 'self' || (card.effect && (card.effect.life || card.effect.atk || card.effect.def))) {
            let allies = this.teams[player.team].map(id => this.players[id]).filter(p => p.state === 'alive');
            allies.sort((a, b) => a.hp - b.hp);
            return allies.length > 0 ? allies[0] : player;
        } else {
            let enemyTeam = player.team === 'A' ? 'B' : 'A';
            let enemies = this.teams[enemyTeam].map(id => this.players[id]).filter(p => p.state === 'alive');
            enemies.sort((a, b) => a.hp - b.hp);
            return enemies.length > 0 ? enemies[0] : null;
        }
    }

    playCard(playerId, cardIndex, targetId) {
        if (this.gameOver) return;
        const player = this.players[playerId];
        if (player.status.stunned > 0) {
            this.addToLog(`${player.name} è bloccato e salta il turno!`);
            player.status.stunned--;
            this.endTurn();
            return;
        }

        const card = player.hand.splice(cardIndex, 1)[0];
        if (typeof AudioManager !== 'undefined') AudioManager.playSFX('Card_Play');
        
        const isGlobal = isCardGlobal(card);
        let synergyMult = 1;
        const allyId = this.teams[player.team].find(id => id !== playerId);
        if (allyId && this.players[allyId].state === 'alive') {
            const allyLastCard = this.lastCardPlayedInTurn[allyId];
            if (allyLastCard && allyLastCard.round === this.gameRound && allyLastCard.card.type === card.type) {
                this.addToLog(`Sinergia di Squadra! +20% efficacia`);
                synergyMult += 0.2;
            }
        }
        this.lastCardPlayedInTurn[playerId] = { card: card, round: this.gameRound };

        if (isGlobal) {
            this.addToLog(`${player.name} attiva effetto globale: ${card.name}`);
            let targets = [];
            if (card.targetType === 'enemy') targets = this.teams[player.team === 'A' ? 'B' : 'A'];
            else if (card.targetType === 'ally') targets = this.teams[player.team];
            else targets = Object.keys(this.players);
            
            targets.forEach(tid => {
                const t = this.players[tid];
                if (t.state === 'alive') this.applyEffect(player, t, card, synergyMult);
            });
        } else {
            let target = targetId ? this.players[targetId] : this.getDefaultTarget(player, card);
            this.addToLog(`${player.name} gioca: ${card.name} su ${target ? target.name : "Nessuno"}`);
            if (target) this.applyEffect(player, target, card, synergyMult);
        }

        player.lastPlayedCard = card;
        this.sharedDiscard.push(card);

        this.checkState();
        this.checkVictory();

        if (!this.gameOver) {
            if (player.hand.length === 0) {
                for (let i = 0; i < 5; i++) this.drawCard(playerId);
            }
            this.endTurn();
        }
    }

    applyEffect(player, target, card, synergyMult = 1) {
        const effect = card.effect;
        let buffTarget = (card.targetType === 'ally' || card.targetType === 'self' || effect.atk || effect.life || effect.def) ? target : player;
        
        if (effect.atk) buffTarget.atk += Math.floor(effect.atk * synergyMult);
        if (effect.def) {
            buffTarget.def += Math.floor(effect.def * synergyMult);
            if (this.onAnimation) this.onAnimation('shield', player.id, buffTarget.id);
        }
        if (effect.life) buffTarget.hp = Math.min(this.maxHp, buffTarget.hp + Math.floor(effect.life * synergyMult));
        if (effect.directDamage) {
            if (target.status.immunity === 0) {
                let dmg = Math.floor(effect.directDamage * synergyMult);
                target.hp -= dmg;
                this.addToLog(`${target.name} subisce ${dmg} danni diretti!`);
                if (this.onAnimation) this.onAnimation('sword', player.id, target.id);
            }
        }
        if (effect.stun && !target.status.debuffImmunity) target.status.stunned += effect.stun;
        
        // Cap delle statistiche
        buffTarget.atk = Math.min(600, Math.max(0, buffTarget.atk));
        buffTarget.def = Math.min(600, Math.max(0, buffTarget.def));
        target.hp = Math.max(0, target.hp);
        player.hp = Math.max(0, player.hp);
    }

    executeAttack(playerId, targetId) {
        if (this.gameOver) return;
        const attacker = this.players[playerId];
        const defender = this.players[targetId];
        
        if (attacker.atk <= 0) return;
        if (this.onAnimation) this.onAnimation('sword', attacker.id, defender.id);
        if (typeof AudioManager !== 'undefined') AudioManager.playSFX('Attack_Hit');

        let damage = Math.max(0, attacker.atk - defender.def);
        if (defender.def > 0) defender.def = Math.max(0, defender.def - attacker.atk);
        
        if (damage > 0) {
            defender.hp -= damage;
            this.addToLog(`${defender.name} subisce ${Math.floor(damage)} danni!`);
            if (this.onParticle) this.onParticle(defender.id);
        } else {
            this.addToLog(`Attacco parato da ${defender.name}!`);
        }

        attacker.atk = 0;
        this.checkState();
        this.checkVictory();
        this.endTurn();
    }

    usePotion(playerId, potionIndex) {
        const player = this.players[playerId];
        if (player.state === 'defeated' || player.potionsUsedThisTurn >= 2) return;
        const potion = player.potions.splice(potionIndex, 1)[0];
        if (!potion) return;
        player.potionsUsedThisTurn++;
        if (typeof AudioManager !== 'undefined') AudioManager.playSFX('Potion_Drink');
        this.addToLog(`${player.name} beve ${potion.name}!`);
        potion.effect(player, this);
        if (this.onUpdate) this.onUpdate();
    }

    endTurn() {
        if (this.gameOver) return;
        
        do {
            this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
            this.turn = this.turnOrder[this.turnIndex];
            if (this.turnIndex === 0) this.gameRound++;
        } while (this.players[this.turn].state === 'defeated' && !this.gameOver);

        const nextPlayer = this.players[this.turn];
        nextPlayer.potionsUsedThisTurn = 0;
        
        // Rigenerazione passiva o altro...
        if (nextPlayer.status.regen > 0) {
            nextPlayer.hp = Math.min(this.maxHp, nextPlayer.hp + 100);
            nextPlayer.status.regen--;
        }

        this.addToLog(`--- Turno di ${nextPlayer.name} ---`);
        
        if (nextPlayer.isAI && !this.gameOver) {
            setTimeout(() => this.aiPlay(this.turn), 1500);
        } else if (this.onUpdate) {
            this.onUpdate();
        }
    }

    aiPlay(playerId) {
        if (this.gameOver) return;
        const ai = this.players[playerId];
        
        // Semplice logica AI
        let targets = this.teams[ai.team === 'A' ? 'B' : 'A'].map(id => this.players[id]).filter(p => p.state === 'alive');
        if (targets.length > 0) {
            let t = targets.sort((a, b) => a.hp - b.hp)[0];
            if (ai.atk >= 150) {
                this.executeAttack(ai.id, t.id);
                return;
            }
        }

        if (ai.hand.length > 0) {
            const bestIdx = 0; // Gioca la prima carta per semplicità in questa versione
            this.playCard(playerId, bestIdx, this.getDefaultTarget(ai, ai.hand[bestIdx])?.id);
        } else {
            this.endTurn();
        }
    }

    checkState() {
        Object.values(this.players).forEach(p => {
            if (p.hp <= 0 && p.state === 'alive') {
                p.state = 'defeated';
                this.addToLog(`${p.name} è stato eliminato!`);
            }
        });
    }

    checkVictory() {
        const teamAAlive = this.teams['A'].some(id => this.players[id].state === 'alive');
        const teamBAlive = this.teams['B'].some(id => this.players[id].state === 'alive');
        
        if (!teamAAlive || !teamBAlive) {
            this.gameOver = true;
            this.addToLog(teamAAlive ? "VITTORIA DEL TEAM A!" : "VITTORIA DEL TEAM B!");
            if (this.onUpdate) this.onUpdate();
        }
    }

    addToLog(msg) {
        this.log.push(msg);
        if (this.onUpdate) this.onUpdate();
    }
}

// --- RENDERING HELPERS (Ripristinati da engine.js) ---
function getCardIllustration2v2(c) {
    const id = c.id;
    const type = c.type;
    const color = type === 'attack' ? '#f43f5e' : (type === 'defense' ? '#3b82f6' : '#a855f7');
    
    let seed = id * 1337;
    const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    let pixels = '';
    const templateIdx = id % 4;

    if (templateIdx === 0) {
        pixels += `<rect x="4" y="4" width="8" height="10" fill="${color}"/>`;
        pixels += `<rect x="12" y="4" width="2" height="10" fill="rgba(255,255,255,0.3)"/>`;
        for(let i=0; i<3; i++) if(rnd()>0.5) pixels += `<rect x="6" y="${6+i*2}" width="4" height="1" fill="rgba(0,0,0,0.2)"/>`;
    } else if (templateIdx === 1) {
        for(let i=0; i<8; i++) pixels += `<rect x="${4+i}" y="${12-i}" width="2" height="2" fill="${color}"/>`;
        pixels += `<rect x="12" y="4" width="2" height="2" fill="#ffccaa"/>`;
        pixels += `<rect x="3" y="13" width="2" height="2" fill="#ff8888"/>`;
    } else if (templateIdx === 2) {
        pixels += `<rect x="4" y="4" width="10" height="12" rx="1" fill="${color}"/>`;
        pixels += `<rect x="6" y="6" width="6" height="3" fill="#1a1a1a"/>`;
        pixels += `<rect x="5" y="10" width="1" height="1" fill="rgba(255,255,255,0.5)"/>`;
        pixels += `<rect x="7" y="10" width="1" height="1" fill="rgba(255,255,255,0.5)"/>`;
        pixels += `<rect x="9" y="10" width="1" height="1" fill="rgba(255,255,255,0.5)"/>`;
    } else {
        pixels += `<rect x="4" y="3" width="10" height="13" fill="white"/>`;
        pixels += `<rect x="5" y="4" width="8" height="11" fill="none" stroke="${color}" stroke-width="0.5"/>`;
        for(let i=0; i<4; i++) pixels += `<rect x="6" y="${6+i*2}" width="6" height="0.5" fill="#eee"/>`;
    }
    
    return `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">${pixels}</svg>`;
}

function createCardElement2v2(c, interactive, hidden, idx) {
    const d = document.createElement('div');
    d.className = `card ${c.type || ''} ${hidden ? 'hidden' : ''} ${targeting2v2Mode && selected2v2CardIndex === idx ? 'selected' : ''}`;
    
    if (!hidden && c.name) {
        d.innerHTML = `
            <div class="card-illustration">
                ${getCardIllustration2v2(c)}
            </div>
            <div class="card-name">${c.name}</div>
            <div class="card-desc">${c.description}</div>
        `;
    }
    
    if (interactive && idx !== null) {
        d.onclick = () => onCard2v2Clicked(idx);
    }
    return d;
}

// --- UI LOGIC 2V2 ---
window.startGame2v2 = function() {
    window.switchScreen('game-container', 'active-screen-block');
    document.body.classList.remove('mode-1v1');
    document.body.classList.add('mode-2v2', 'in-game');
    
    game2v2 = new Game2v2(CARDS);
    game2v2.onUpdate = updateUI2v2;
    game2v2.onCardDraw = typeof animateCardDraw !== 'undefined' ? animateCardDraw : null;
    game2v2.onAnimation = typeof playActionAnimation !== 'undefined' ? playActionAnimation : null;
    game2v2.onParticle = typeof spawnDamageParticles !== 'undefined' ? spawnDamageParticles : null;

    window.dispatchEvent(new Event('resize'));
    updateUI2v2();
};

function updateUI2v2() {
    if (!game2v2) return;
    const active = game2v2.players[game2v2.turn];
    
    // Sincronizzazione con gli elementi comuni
    if (elements.deckCount) elements.deckCount.innerText = game2v2.sharedDeck.length;
    
    buildScoreboard2v2();
    buildArena2v2();
    
    if (elements.log) {
        elements.log.innerHTML = game2v2.log.slice().reverse()
            .map(m => `<div class="log-entry">${m}</div>`).join('');
    }

    const attackBtn = document.getElementById('btn-attack');
    const passBtn = document.getElementById('btn-pass');
    const potionsContainer = document.querySelector('.potions-container');

    const canInteract = !active.isAI && !targeting2v2Mode;

    if (attackBtn) {
        attackBtn.style.display = (canInteract && active.atk > 0 && active.status.stunned === 0) ? 'flex' : 'none';
    }
    if (passBtn) {
        passBtn.style.display = canInteract ? 'flex' : 'none';
    }
    if (potionsContainer) {
        potionsContainer.style.display = canInteract ? 'flex' : 'none';
    }

    renderHands2v2(active);
    renderPotions2v2(active);

    if (game2v2.gameOver) {
        if (elements.victoryText) elements.victoryText.innerText = game2v2.log[game2v2.log.length - 1];
        if (elements.overlay) {
            elements.overlay.classList.remove('hidden');
            elements.overlay.classList.add('show');
        }
    }
}

function buildScoreboard2v2() {
    const sb = document.getElementById('scoreboard');
    if (!sb) return;
    sb.innerHTML = '';

    const teamA = document.createElement('div');
    teamA.className = 'team-container team-a';
    const teamB = document.createElement('div');
    teamB.className = 'team-container team-b';

    Object.values(game2v2.players).forEach(p => {
        const div = document.createElement('div');
        let targetClass = '';
        if (targeting2v2Mode && valid2v2TargetIds.includes(p.id)) {
            // Regola richiesta: Verde sui player umani (Team A), Viola sui prof AI (Team B)
            if (p.team === 'A') targetClass = 'valid-target-buff';
            else targetClass = 'valid-target-ai';
        }

        div.className = `player-stats ${p.team === 'B' ? 'opponent' : ''} ${p.state === 'defeated' ? 'defeated' : ''} ${targetClass}`;
        div.onclick = () => onTarget2v2Clicked(p.id);
        
        div.innerHTML = `
            <div class="stat-row">
                <span>${p.name}</span>
                <span>🧪 x${p.potions.length}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar hp-bar" style="width:${(p.hp / game2v2.maxHp) * 100}%"></div>
            </div>
            <div class="progress-bar-bg small-bar">
                <div class="progress-bar atk-bar" style="width:${(Math.min(p.atk, 600) / 600) * 100}%"></div>
            </div>
            <div class="progress-bar-bg small-bar">
                <div class="progress-bar def-bar" style="width:${(Math.min(p.def, 600) / 600) * 100}%"></div>
            </div>
            <div style="font-size:0.8rem; margin-top: 5px;">
                ${Math.floor(p.hp)} HP | <span style="color:var(--atk-color)">ATK ${p.atk}</span> | <span style="color:var(--def-color)">DEF ${p.def}</span>
            </div>
        `;
        
        if (p.team === 'A') teamA.appendChild(div);
        else teamB.appendChild(div);
    });

    sb.appendChild(teamA);
    sb.appendChild(teamB);
}

function buildArena2v2() {
    const area = document.getElementById('played-cards-area');
    if (!area) return;
    area.innerHTML = '';
    
    Object.values(game2v2.players).forEach(p => {
        const slot = document.createElement('div');
        slot.className = 'played-card-slot';
        if (p.lastPlayedCard) {
            slot.appendChild(createCardElement2v2(p.lastPlayedCard, false, false, null));
        }
        area.appendChild(slot);
    });
}

function renderHands2v2(player) {
    const handEl = document.getElementById('player-hand');
    const oppHandEl = document.getElementById('opponent-hand');
    if (handEl) handEl.innerHTML = '';
    if (oppHandEl) oppHandEl.innerHTML = '';

    // Determiniamo quale mano mostrare nel contenitore principale
    // Se è il turno di un umano, mostriamo la sua mano.
    // Se è il turno dell'AI, mostriamo la mano di Player 1 (come riferimento) ma disabilitata.
    let displayPlayer = player;
    const isHumanTurn = !player.isAI;
    
    if (!isHumanTurn) {
        displayPlayer = game2v2.players['player1']; // Mostra P1 durante i turni AI
    }

    if (displayPlayer && displayPlayer.hand) {
        displayPlayer.hand.forEach((card, idx) => {
            const cardEl = createCardElement2v2(card, isHumanTurn, false, idx);
            if (!isHumanTurn) {
                cardEl.style.opacity = '0.5';
                cardEl.style.pointerEvents = 'none';
                cardEl.style.filter = 'grayscale(0.5)';
            }
            handEl.appendChild(cardEl);
        });
    }

    // Carte degli altri (retro) - Ripristinato cap a 5 per evitare affollamento
    let oppCount = 0;
    Object.values(game2v2.players).forEach(p => { 
        if (p.id !== displayPlayer.id) oppCount += p.hand.length; 
    });
    
    for (let i = 0; i < Math.min(5, oppCount); i++) {
        const card = document.createElement('div');
        card.className = 'card back';
        oppHandEl.appendChild(card);
    }
}

function renderPotions2v2(player) {
    const potEl = document.getElementById('player-potions');
    if (!potEl) return;
    potEl.innerHTML = '';
    if (!player.isAI) {
        player.potions.forEach((p, idx) => {
            const btn = document.createElement('button');
            btn.className = 'potion';
            btn.innerText = p.name;
            btn.onclick = () => game2v2.usePotion(player.id, idx);
            potEl.appendChild(btn);
        });
    }
}

// --- EVENT HANDLERS 2V2 ---
function onCard2v2Clicked(idx) {
    // Se clicco la stessa carta già selezionata, deseleziono
    if (targeting2v2Mode && selected2v2CardIndex === idx) {
        targeting2v2Mode = false;
        selected2v2CardIndex = null;
        valid2v2TargetIds = [];
        updateUI2v2();
        return;
    }

    const player = game2v2.players[game2v2.turn];
    const card = player.hand[idx];
    
    selected2v2CardIndex = idx;
    targeting2v2Mode = true;
    targeting2v2Attack = false;

    // Determina bersagli validi
    valid2v2TargetIds = [];
    const isPositive = isCardPositive(card);
    const isGlobal = isCardGlobal(card);

    if (isGlobal) {
        valid2v2TargetIds = ['player1', 'player2', 'player3', 'player4'];
    } else if (isPositive || card.targetType === 'ally' || card.targetType === 'self') {
        valid2v2TargetIds = game2v2.teams['A'];
    } else {
        valid2v2TargetIds = game2v2.teams['B'];
    }

    updateUI2v2();
}

function onTarget2v2Clicked(id) {
    if (!targeting2v2Mode) return;
    if (!valid2v2TargetIds.includes(id)) return;

    if (targeting2v2Attack) {
        game2v2.executeAttack(game2v2.turn, id);
    } else if (selected2v2CardIndex !== null) {
        game2v2.playCard(game2v2.turn, selected2v2CardIndex, id);
    }
    
    targeting2v2Mode = false;
    targeting2v2Attack = false;
    selected2v2CardIndex = null;
    valid2v2TargetIds = [];
    updateUI2v2();
}

window.onAttack2v2Clicked = () => {
    targeting2v2Mode = true;
    targeting2v2Attack = true;
    valid2v2TargetIds = game2v2.teams['B']; // Solo nemici per attacco base
    updateUI2v2();
};

window.onPass2v2Clicked = () => {
    game2v2.endTurn();
};

// ============================================================================
// CHESS GAME MANAGER — Server-authoritative, per-move micro-payment model
// ============================================================================
// Flow:
//   1. Both players pay initial wager → escrow
//   2. Each move: moving player pays moveCost → escrow (pot grows every move)
//   3. Game ends: winner gets pot minus platform cut
//   4. Draws: pot split 50/50 minus platform cut
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { Chess } from 'chess.js';
import {
  StakeTierDef,
  getTierByValue,
  centsToSats,
  GameEndReason,
  PLATFORM_CUT_PERCENT,
  applyPlatformCut,
  getCaptureCostSats,
  ChessPieceType,
} from './Constants';
import { fetchBalance, priceService } from '../wallet/BsvService';

// ============================================================================
// TYPES
// ============================================================================

export type GamePhase = 'awaiting_wagers' | 'playing' | 'paused' | 'gameover';
export type PlayerSlot = 'white' | 'black';

export interface PlayerState {
  socketId: string;
  address: string;
  username: string;
  color: PlayerSlot;
  wagerPaid: boolean;
  moveCount: number;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  tier: StakeTierDef;
  depositSats: number;      // each player's escrow deposit
  baseSats: number;         // king capture value (100% of tier) in sats
  bsvPriceAtStart: number;
  chess: Chess;              // chess.js instance (server-authoritative)
  white: PlayerState;
  black: PlayerState;
  pot: number;               // accumulated sats in escrow
  // Pending payment (wager or move cost)
  pendingPayment: {
    type: 'wager' | 'move';
    fromSlot: PlayerSlot;
    amount: number;
    toAddress: string;       // escrow address
    move?: string;           // SAN notation if move payment
    moveFrom?: string;       // square (e.g., 'e2')
    moveTo?: string;         // square (e.g., 'e4')
    promotion?: string;      // promotion piece if applicable
  } | null;
  // Pause state (when player needs to add funds)
  pausedFor: PlayerSlot | null;
  pausedAt: number | null;
  pauseReason: string | null;
  // Timing
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  endReason: GameEndReason | null;
  winner: PlayerSlot | null;
  turnStartedAt: number;
  moveHistory: { san: string; from: string; to: string; color: 'w' | 'b'; txid?: string }[];
}

export interface MoveResult {
  success: boolean;
  error?: string;
  san?: string;
  fen?: string;
  // Payment required from the moving player
  paymentRequired?: {
    amount: number;
    toAddress: string;
    fromSlot: PlayerSlot;
  };
  // Game state after move
  isCheck?: boolean;
  isCheckmate?: boolean;
  isStalemate?: boolean;
  isDraw?: boolean;
  drawReason?: string;
}

export interface GameOverResult {
  winner: PlayerSlot | null;   // null for draws
  loser: PlayerSlot | null;
  reason: GameEndReason;
  pot: number;
  winnerPayout: number;
  loserPayout: number;         // non-zero for draws
  platformCut: number;
  whiteAddress: string;
  blackAddress: string;
}

// ============================================================================
// GAME MANAGER
// ============================================================================

export class ChessGameManager {
  private games = new Map<string, GameState>();
  private playerToGame = new Map<string, string>();
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private pauseTimers = new Map<string, NodeJS.Timeout>();
  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  private readonly TURN_TIMEOUT_MS = 300_000;      // 5 min per move
  private readonly PAUSE_TIMEOUT_MS = 60_000;       // 60s to add funds
  private readonly RECONNECT_GRACE_MS = 120_000;    // 2 min to reconnect

  // Callbacks for socket layer
  onTurnTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;
  onPauseTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;
  onFundsNeeded: ((gameId: string, slot: PlayerSlot, amountNeeded: number) => void) | null = null;
  onDisconnectTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;

  // ==========================================================================
  // CREATE GAME
  // ==========================================================================

  async createGame(
    p1Sid: string, p1Addr: string, p1Name: string,
    p2Sid: string, p2Addr: string, p2Name: string,
    tierValue: number,
  ): Promise<GameState | null> {
    const tier = getTierByValue(tierValue);
    if (!tier) return null;

    const bsvPrice = await priceService.getPrice();
    const depositSats = centsToSats(tier.depositCents, bsvPrice);
    const baseSats = centsToSats(tier.baseCents, bsvPrice);
    const gameId = uuidv4();

    // Randomly assign colors
    const p1IsWhite = Math.random() < 0.5;

    const mkPlayer = (sid: string, addr: string, name: string, color: PlayerSlot): PlayerState => ({
      socketId: sid, address: addr, username: name, color,
      wagerPaid: false, moveCount: 0,
      connected: true, disconnectedAt: null,
    });

    const game: GameState = {
      id: gameId,
      phase: 'awaiting_wagers',
      tier,
      depositSats,
      baseSats,
      bsvPriceAtStart: bsvPrice,
      chess: new Chess(),
      white: mkPlayer(
        p1IsWhite ? p1Sid : p2Sid,
        p1IsWhite ? p1Addr : p2Addr,
        p1IsWhite ? p1Name : p2Name,
        'white',
      ),
      black: mkPlayer(
        p1IsWhite ? p2Sid : p1Sid,
        p1IsWhite ? p2Addr : p1Addr,
        p1IsWhite ? p2Name : p1Name,
        'black',
      ),
      pot: 0,
      pendingPayment: null,
      pausedFor: null, pausedAt: null, pauseReason: null,
      createdAt: Date.now(), startedAt: null, endedAt: null,
      endReason: null, winner: null,
      turnStartedAt: 0,
      moveHistory: [],
    };

    this.games.set(gameId, game);
    this.playerToGame.set(p1Sid, gameId);
    this.playerToGame.set(p2Sid, gameId);
    return game;
  }

  // ==========================================================================
  // WAGER PAYMENT — Both players must pay before game starts
  // ==========================================================================

  requestWagerPayment(gameId: string, slot: PlayerSlot, escrowAddress: string): {
    amount: number; toAddress: string;
  } | null {
    const game = this.games.get(gameId);
    if (!game || game.phase !== 'awaiting_wagers') return null;
    if (game[slot].wagerPaid) return null;

    game.pendingPayment = {
      type: 'wager',
      fromSlot: slot,
      amount: game.depositSats,
      toAddress: escrowAddress,
    };

    return { amount: game.depositSats, toAddress: escrowAddress };
  }

  confirmWagerPayment(gameId: string, slot: PlayerSlot, txid: string): {
    success: boolean;
    bothPaid: boolean;
    error?: string;
  } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, bothPaid: false, error: 'Game not found' };

    game[slot].wagerPaid = true;
    game.pot += game.depositSats;
    game.pendingPayment = null;

    const bothPaid = game.white.wagerPaid && game.black.wagerPaid;
    if (bothPaid) {
      game.phase = 'playing';
      game.startedAt = Date.now();
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return { success: true, bothPaid };
  }

  // ==========================================================================
  // MAKE MOVE — Validates move, requires micro-payment before applying
  // ==========================================================================

  attemptMove(
    socketId: string,
    from: string,
    to: string,
    promotion?: string,
    escrowAddress?: string,
  ): MoveResult {
    const game = this.getGameBySocket(socketId);
    if (!game) return { success: false, error: 'Not in a game' };
    if (game.phase !== 'playing') return { success: false, error: 'Game not active' };
    if (game.pendingPayment) return { success: false, error: 'Payment pending — complete it first' };

    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };

    // Verify it's this player's turn
    const currentTurn: PlayerSlot = game.chess.turn() === 'w' ? 'white' : 'black';
    if (slot !== currentTurn) return { success: false, error: 'Not your turn' };

    // Validate the move with chess.js (don't apply yet — need payment first)
    const chess = new Chess(game.chess.fen());
    const move = chess.move({ from, to, promotion: promotion || undefined });
    if (!move) return { success: false, error: 'Illegal move' };

    // Set pending payment for this move
    game.pendingPayment = {
      type: 'move',
      fromSlot: slot,
      amount: game.baseSats,
      toAddress: escrowAddress || '',
      move: move.san,
      moveFrom: from,
      moveTo: to,
      promotion: promotion || undefined,
    };

    // Pause turn timer while waiting for payment
    this.clearTurnTimer(game.id);

    return {
      success: true,
      san: move.san,
      fen: chess.fen(),
      paymentRequired: {
        amount: game.baseSats,
        toAddress: escrowAddress || '',
        fromSlot: slot,
      },
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw(),
      drawReason: chess.isStalemate() ? 'stalemate'
        : chess.isThreefoldRepetition() ? 'threefold_repetition'
        : chess.isInsufficientMaterial() ? 'insufficient_material'
        : chess.isDraw() ? 'fifty_move_rule'
        : undefined,
    };
  }

  // ==========================================================================
  // CONFIRM MOVE PAYMENT — Apply the move after TX verification
  // ==========================================================================

  confirmMovePayment(
    socketId: string,
    txid: string,
  ): {
    success: boolean;
    error?: string;
    move?: { san: string; from: string; to: string; color: 'w' | 'b' };
    fen?: string;
    gameOver?: boolean;
    gameOverResult?: GameOverResult;
  } {
    const game = this.getGameBySocket(socketId);
    if (!game || !game.pendingPayment || game.pendingPayment.type !== 'move') {
      return { success: false, error: 'No pending move payment' };
    }

    const pp = game.pendingPayment;
    const slot = this.getSlot(game, socketId);
    if (slot !== pp.fromSlot) return { success: false, error: 'Wrong player' };

    // Apply the move to the authoritative chess instance
    const move = game.chess.move({
      from: pp.moveFrom!,
      to: pp.moveTo!,
      promotion: pp.promotion || undefined,
    });

    if (!move) return { success: false, error: 'Move no longer valid' };

    // Update state
    game.pot += pp.amount;
    game[slot].moveCount++;
    game.pendingPayment = null;

    const moveRecord = { san: move.san, from: move.from, to: move.to, color: move.color, txid };
    game.moveHistory.push(moveRecord);

    // Unpause if was paused
    if (game.phase === 'paused') {
      game.phase = 'playing';
      game.pausedFor = null;
      game.pausedAt = null;
      game.pauseReason = null;
      this.clearPauseTimer(game.id);
    }

    // Check game over conditions
    if (game.chess.isCheckmate()) {
      const result = this.endGame(game, slot, 'checkmate');
      return { success: true, move: moveRecord, fen: game.chess.fen(), gameOver: true, gameOverResult: result };
    }

    if (game.chess.isStalemate()) {
      const result = this.endGameDraw(game, 'stalemate');
      return { success: true, move: moveRecord, fen: game.chess.fen(), gameOver: true, gameOverResult: result };
    }

    if (game.chess.isThreefoldRepetition()) {
      const result = this.endGameDraw(game, 'threefold_repetition');
      return { success: true, move: moveRecord, fen: game.chess.fen(), gameOver: true, gameOverResult: result };
    }

    if (game.chess.isInsufficientMaterial()) {
      const result = this.endGameDraw(game, 'insufficient_material');
      return { success: true, move: moveRecord, fen: game.chess.fen(), gameOver: true, gameOverResult: result };
    }

    if (game.chess.isDraw()) {
      const result = this.endGameDraw(game, 'fifty_move_rule');
      return { success: true, move: moveRecord, fen: game.chess.fen(), gameOver: true, gameOverResult: result };
    }

    // Continue — start next turn timer
    game.turnStartedAt = Date.now();
    this.startTurnTimer(game);

    return { success: true, move: moveRecord, fen: game.chess.fen(), gameOver: false };
  }

  // ==========================================================================
  // DRAW OFFER
  // ==========================================================================

  offerDraw(socketId: string): { success: boolean; opponentSocketId?: string; error?: string } {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase !== 'playing') return { success: false, error: 'Game not active' };
    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };
    const oppSlot = this.opponentSlot(slot);
    return { success: true, opponentSocketId: game[oppSlot].socketId };
  }

  acceptDraw(socketId: string): { success: boolean; result?: GameOverResult; error?: string } {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase !== 'playing') return { success: false, error: 'Game not active' };
    const result = this.endGameDraw(game, 'draw_agreement');
    return { success: true, result };
  }

  // ==========================================================================
  // RESIGN
  // ==========================================================================

  resign(socketId: string): { gameId: string; result: GameOverResult } | null {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase === 'gameover') return null;
    const slot = this.getSlot(game, socketId);
    if (!slot) return null;
    const winner = this.opponentSlot(slot);
    const result = this.endGame(game, winner, 'resignation');
    return { gameId: game.id, result };
  }

  // ==========================================================================
  // GAME END — Winner takes pot
  // ==========================================================================

  endGame(game: GameState, winner: PlayerSlot, reason: GameEndReason): GameOverResult {
    game.phase = 'gameover';
    game.endedAt = Date.now();
    game.endReason = reason;
    game.winner = winner;
    game.pendingPayment = null;
    this.clearTurnTimer(game.id);
    this.clearPauseTimer(game.id);
    this.clearDisconnectTimer(game.id, 'white');
    this.clearDisconnectTimer(game.id, 'black');

    const loser = this.opponentSlot(winner);
    const cutPct = PLATFORM_CUT_PERCENT;
    const winnerPayout = Math.floor(game.pot * (1 - cutPct / 100));
    const platformCut = game.pot - winnerPayout;

    return {
      winner, loser, reason,
      pot: game.pot, winnerPayout, loserPayout: 0, platformCut,
      whiteAddress: game.white.address,
      blackAddress: game.black.address,
    };
  }

  // ==========================================================================
  // GAME END — Draw (split pot)
  // ==========================================================================

  endGameDraw(game: GameState, reason: GameEndReason): GameOverResult {
    game.phase = 'gameover';
    game.endedAt = Date.now();
    game.endReason = reason;
    game.winner = null;
    game.pendingPayment = null;
    this.clearTurnTimer(game.id);
    this.clearPauseTimer(game.id);
    this.clearDisconnectTimer(game.id, 'white');
    this.clearDisconnectTimer(game.id, 'black');

    const cutPct = PLATFORM_CUT_PERCENT;
    const afterCut = Math.floor(game.pot * (1 - cutPct / 100));
    const eachPlayer = Math.floor(afterCut / 2);
    const platformCut = game.pot - eachPlayer * 2;

    return {
      winner: null, loser: null, reason,
      pot: game.pot, winnerPayout: eachPlayer, loserPayout: eachPlayer, platformCut,
      whiteAddress: game.white.address,
      blackAddress: game.black.address,
    };
  }

  // ==========================================================================
  // PAUSE / RESUME (player needs to add funds)
  // ==========================================================================

  pauseForFunds(game: GameState, forSlot: PlayerSlot, amountNeeded: number, reason: string): void {
    game.phase = 'paused';
    game.pausedFor = forSlot;
    game.pausedAt = Date.now();
    game.pauseReason = reason;
    this.clearTurnTimer(game.id);

    const timer = setTimeout(() => {
      if (game.phase !== 'paused') return;
      const winnerSlot = this.opponentSlot(forSlot);
      this.endGame(game, winnerSlot, 'insufficient_funds');
      this.onPauseTimeout?.(game.id, winnerSlot, forSlot);
    }, this.PAUSE_TIMEOUT_MS);

    this.pauseTimers.set(game.id, timer);
    this.onFundsNeeded?.(game.id, forSlot, amountNeeded);
  }

  // ==========================================================================
  // DISCONNECT / RECONNECT
  // ==========================================================================

  handleDisconnect(socketId: string): {
    gameId: string; slot: PlayerSlot;
    graceStarted: boolean; immediateResult: GameOverResult | null;
  } | null {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase === 'gameover') return null;
    const slot = this.getSlot(game, socketId);
    if (!slot) return null;

    game[slot].connected = false;
    game[slot].disconnectedAt = Date.now();
    const winner = this.opponentSlot(slot);

    this.clearTurnTimer(game.id);

    const timerKey = `${game.id}:${slot}`;
    this.clearDisconnectTimer(game.id, slot);

    const timer = setTimeout(() => {
      const g = this.games.get(game.id);
      if (!g || g.phase === 'gameover') return;
      if (!g[slot].connected) {
        this.endGame(g, winner, 'disconnect');
        this.onDisconnectTimeout?.(game.id, winner, slot);
      }
    }, this.RECONNECT_GRACE_MS);

    this.disconnectTimers.set(timerKey, timer);
    return { gameId: game.id, slot, graceStarted: true, immediateResult: null };
  }

  handleReconnect(socketId: string, gameId: string, address: string): {
    success: boolean; game?: GameState; slot?: PlayerSlot; error?: string;
  } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.phase === 'gameover') return { success: false, error: 'Game already ended' };

    let slot: PlayerSlot | null = null;
    if (game.white.address === address) slot = 'white';
    else if (game.black.address === address) slot = 'black';
    if (!slot) return { success: false, error: 'Not in this game' };

    this.clearDisconnectTimer(gameId, slot);

    game[slot].connected = true;
    game[slot].disconnectedAt = null;
    game[slot].socketId = socketId;
    this.playerToGame.set(socketId, gameId);

    if (game.phase === 'playing' && !game.pendingPayment) {
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return { success: true, game, slot };
  }

  // ==========================================================================
  // TURN TIMER
  // ==========================================================================

  private startTurnTimer(game: GameState): void {
    this.clearTurnTimer(game.id);
    const timer = setTimeout(() => {
      if (game.phase !== 'playing') return;
      const currentTurn: PlayerSlot = game.chess.turn() === 'w' ? 'white' : 'black';
      const winner = this.opponentSlot(currentTurn);
      this.endGame(game, winner, 'timeout');
      this.onTurnTimeout?.(game.id, winner, currentTurn);
    }, this.TURN_TIMEOUT_MS);
    this.turnTimers.set(game.id, timer);
  }

  private clearTurnTimer(gameId: string): void {
    const t = this.turnTimers.get(gameId);
    if (t) { clearTimeout(t); this.turnTimers.delete(gameId); }
  }

  private clearPauseTimer(gameId: string): void {
    const t = this.pauseTimers.get(gameId);
    if (t) { clearTimeout(t); this.pauseTimers.delete(gameId); }
  }

  private clearDisconnectTimer(gameId: string, slot: PlayerSlot): void {
    const key = `${gameId}:${slot}`;
    const t = this.disconnectTimers.get(key);
    if (t) { clearTimeout(t); this.disconnectTimers.delete(key); }
  }

  // ==========================================================================
  // SERIALIZATION — Get safe game state for client
  // ==========================================================================

  getClientState(game: GameState, forSlot: PlayerSlot): object {
    return {
      gameId: game.id,
      phase: game.phase,
      fen: game.chess.fen(),
      turn: game.chess.turn() === 'w' ? 'white' : 'black',
      myColor: forSlot,
      opponent: {
        username: game[this.opponentSlot(forSlot)].username,
        address: game[this.opponentSlot(forSlot)].address,
      },
      pot: game.pot,
      depositSats: game.depositSats,
      baseSats: game.baseSats,
      myWagerPaid: game[forSlot].wagerPaid,
      opponentWagerPaid: game[this.opponentSlot(forSlot)].wagerPaid,
      moveHistory: game.moveHistory,
      isCheck: game.chess.isCheck(),
      pendingPayment: game.pendingPayment && game.pendingPayment.fromSlot === forSlot
        ? { amount: game.pendingPayment.amount, toAddress: game.pendingPayment.toAddress }
        : null,
    };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  getGame(id: string) { return this.games.get(id); }
  getGameBySocket(sid: string) {
    const id = this.playerToGame.get(sid);
    return id ? this.games.get(id) : undefined;
  }
  getSlot(g: GameState, sid: string): PlayerSlot | null {
    if (g.white.socketId === sid) return 'white';
    if (g.black.socketId === sid) return 'black';
    return null;
  }
  opponentSlot(s: PlayerSlot): PlayerSlot { return s === 'white' ? 'black' : 'white'; }
  removeGame(id: string) {
    const g = this.games.get(id);
    if (!g) return;
    if (this.playerToGame.get(g.white.socketId) === id) this.playerToGame.delete(g.white.socketId);
    if (this.playerToGame.get(g.black.socketId) === id) this.playerToGame.delete(g.black.socketId);
    this.clearTurnTimer(id);
    this.clearPauseTimer(id);
    this.clearDisconnectTimer(id, 'white');
    this.clearDisconnectTimer(id, 'black');
    this.games.delete(id);
  }
  getActiveCount() { return this.games.size; }
}

export const gameManager = new ChessGameManager();
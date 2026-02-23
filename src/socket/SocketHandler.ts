// ============================================================================
// SOCKET HANDLER — BSV Chess
// ============================================================================

import { Server, Socket } from 'socket.io';
import { gameManager, PlayerSlot, GameOverResult } from '../game/ChessGameManager';
import { matchmakingQueue } from '../game/Matchmaking';
import { getTierByValue } from '../game/Constants';
import { escrowManager, priceService, fetchBalance, verifyAndBroadcastTx } from '../wallet/BsvService';
import * as db from '../DB/Database';
import { socketRateLimiter } from './SocketRateLimiter';
import { sessionManager } from './SessionManager';
import { lobbyManager } from '../game/LobbyManager';

function rateCheck(socket: Socket, event: string): boolean {
  if (!socketRateLimiter.check(socket.id, event)) {
    socket.emit('error', { message: 'Too many requests. Slow down.' });
    return false;
  }
  return true;
}

const pendingRevocations = new Map<string, NodeJS.Timeout>();
const REVOCATION_DELAY_MS = 125_000;

export function setupSocketHandlers(io: Server): void {

  // ==========================================================================
  // LOBBY BROADCAST (throttled)
  // ==========================================================================
  let lobbyBroadcastTimer: NodeJS.Timeout | null = null;
  function broadcastLobby(): void {
    if (lobbyBroadcastTimer) return;
    lobbyBroadcastTimer = setTimeout(() => {
      lobbyBroadcastTimer = null;
      const players = lobbyManager.getOnlinePlayers();
      const count = lobbyManager.getOnlineCount();
      io.emit('lobby_update', { players, onlineCount: count });
    }, 500);
  }

  // Challenge expiry callback
  lobbyManager.onChallengeExpired = (challenge) => {
    io.to(challenge.fromSocketId).emit('challenge_expired', {
      challengeId: challenge.id, toUsername: challenge.toUsername,
      message: `Challenge to ${challenge.toUsername} expired`,
    });
    io.to(challenge.toSocketId).emit('challenge_expired', {
      challengeId: challenge.id, fromUsername: challenge.fromUsername,
      message: `Challenge from ${challenge.fromUsername} expired`,
    });
  };

  // ==========================================================================
  // TIMEOUT CALLBACKS
  // ==========================================================================

  gameManager.onTurnTimeout = async (gameId, winnerSlot, loserSlot) => {
    const game = gameManager.getGame(gameId);
    if (!game) return;
    await handleGameEnd(game, gameManager.endGame(game, winnerSlot, 'timeout'));
  };

  gameManager.onPauseTimeout = async (gameId, winnerSlot, loserSlot) => {
    const game = gameManager.getGame(gameId);
    if (!game) return;
    const result = gameManager.endGame(game, winnerSlot, 'insufficient_funds');
    await handleGameEnd(game, result);
  };

  gameManager.onFundsNeeded = (gameId, slot, amountNeeded) => {
    const game = gameManager.getGame(gameId);
    if (!game) return;
    io.to(game[slot].socketId).emit('funds_needed', {
      amountNeeded, address: game[slot].address, timeoutMs: 60_000,
      message: `Add ${amountNeeded} sats to continue. You have 60 seconds.`,
    });
    const oppSlot = gameManager.opponentSlot(slot);
    io.to(game[oppSlot].socketId).emit('game_paused', {
      reason: `${game[slot].username} needs to add funds (60s)`, timeoutMs: 60_000,
    });
  };

  gameManager.onDisconnectTimeout = async (gameId, winnerSlot, loserSlot) => {
    const game = gameManager.getGame(gameId);
    if (!game || game.phase === 'gameover') return;
    const result = gameManager.endGame(game, winnerSlot, 'disconnect');
    io.to(game[winnerSlot].socketId).emit('opponent_disconnected', {
      gameOver: true, message: `${game[loserSlot].username} didn't reconnect in time. You win!`,
    });
    await handleGameEnd(game, result);
  };

  // ==========================================================================
  // CONNECTION
  // ==========================================================================

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 ${socket.id} connected`);

    // ========================================================================
    // FIND MATCH
    // ========================================================================
    socket.on('find_match', async (data: {
      address: string; username: string; stakeTier: number;
    }) => {
      if (!rateCheck(socket, 'find_match')) return;
      const { address, username, stakeTier } = data;

      const tier = getTierByValue(stakeTier);
      if (!tier) { socket.emit('error', { message: 'Invalid tier' }); return; }
      if (!username || username.length > 20) { socket.emit('error', { message: 'Bad username' }); return; }
      if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
        socket.emit('error', { message: 'Invalid BSV address' }); return;
      }

      const clean = username.replace(/[<>&"']/g, '').trim();
      const sessionToken = sessionManager.create(socket.id, address);
      socket.emit('session_token', { token: sessionToken });

      await db.ensurePlayer(address, clean);

      const result = matchmakingQueue.enqueue({
        socketId: socket.id, address, username: clean, stakeTier, queuedAt: Date.now(),
      });

      if (result.matched && result.opponent) {
        const game = await gameManager.createGame(
          result.opponent.socketId, result.opponent.address, result.opponent.username,
          socket.id, address, clean, stakeTier,
        );
        if (!game) { socket.emit('error', { message: 'Game creation failed' }); return; }

        await db.recordGameStart(game.id, stakeTier, game.white.address, game.black.address);

        lobbyManager.setStatus(result.opponent.socketId, 'in_game');
        lobbyManager.setStatus(socket.id, 'in_game');
        broadcastLobby();

        const escrowAddr = escrowManager.getGameAddress(game.id);

        // Notify white player
        io.to(game.white.socketId).emit('match_found', {
          gameId: game.id,
          myColor: 'white',
          opponent: { username: game.black.username, address: game.black.address },
          tier: { name: tier.name, depositCents: tier.depositCents, baseCents: tier.baseCents },
          depositSats: game.depositSats,
          baseSats: game.baseSats,
          escrowAddress: escrowAddr,
          bsvPrice: game.bsvPriceAtStart,
        });

        // Notify black player
        io.to(game.black.socketId).emit('match_found', {
          gameId: game.id,
          myColor: 'black',
          opponent: { username: game.white.username, address: game.white.address },
          tier: { name: tier.name, depositCents: tier.depositCents, baseCents: tier.baseCents },
          depositSats: game.depositSats,
          baseSats: game.baseSats,
          escrowAddress: escrowAddr,
          bsvPrice: game.bsvPriceAtStart,
        });

        console.log(`♟️ ${game.white.username} (white) vs ${game.black.username} (black) @ ${tier.name}`);
      } else {
        lobbyManager.setStatus(socket.id, 'matchmaking');
        broadcastLobby();
        socket.emit('matchmaking_started', { tier: tier.name });
      }
    });

    socket.on('cancel_matchmaking', () => {
      if (!rateCheck(socket, 'cancel_matchmaking')) return;
      matchmakingQueue.remove(socket.id);
      lobbyManager.setStatus(socket.id, 'idle');
      socket.emit('matchmaking_cancelled');
      broadcastLobby();
    });

    // ========================================================================
    // LOBBY
    // ========================================================================

    socket.on('join_lobby', async (data: { address: string; username: string }) => {
      if (!rateCheck(socket, 'join_lobby')) return;
      const { address, username } = data;
      if (!username || username.length > 20) return;
      if (!address || !/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return;

      const clean = username.replace(/[<>&"']/g, '').trim();
      const sessionToken = sessionManager.create(socket.id, address);
      socket.emit('session_token', { token: sessionToken });

      let stats = { gamesWon: 0, gamesPlayed: 0 };
      try {
        const playerStats = await db.getPlayerStats(address);
        if (playerStats) stats = { gamesWon: playerStats.games_won || 0, gamesPlayed: playerStats.games_played || 0 };
      } catch { /* ignore */ }

      lobbyManager.join(socket.id, address, clean, stats);
      broadcastLobby();
    });

    socket.on('get_lobby', () => {
      if (!rateCheck(socket, 'get_lobby')) return;
      socket.emit('lobby_update', {
        players: lobbyManager.getOnlinePlayers(),
        onlineCount: lobbyManager.getOnlineCount(),
      });
    });

    socket.on('challenge_player', (data: { toAddress: string; stakeTier: number }) => {
      if (!rateCheck(socket, 'challenge_player')) return;
      const tier = getTierByValue(data.stakeTier);
      if (!tier) { socket.emit('error', { message: 'Invalid tier' }); return; }

      const result = lobbyManager.createChallenge(socket.id, data.toAddress, data.stakeTier);
      if (!result.success) { socket.emit('challenge_error', { error: result.error }); return; }

      const challenge = result.challenge!;
      socket.emit('challenge_sent', {
        challengeId: challenge.id, toUsername: challenge.toUsername,
        toAddress: challenge.toAddress, stakeTier: data.stakeTier, tierName: tier.name,
        expiresAt: challenge.expiresAt,
      });
      io.to(challenge.toSocketId).emit('challenge_received', {
        challengeId: challenge.id, fromUsername: challenge.fromUsername,
        fromAddress: challenge.fromAddress, stakeTier: data.stakeTier, tierName: tier.name,
        expiresAt: challenge.expiresAt,
      });
    });

    socket.on('accept_challenge', async (data: { challengeId: string }) => {
      if (!rateCheck(socket, 'accept_challenge')) return;
      const result = lobbyManager.acceptChallenge(data.challengeId, socket.id);
      if (!result.success) { socket.emit('challenge_error', { error: result.error }); return; }

      const challenge = result.challenge!;
      const tier = getTierByValue(challenge.stakeTier);
      if (!tier) { socket.emit('error', { message: 'Invalid tier' }); return; }

      const fromToken = sessionManager.create(challenge.fromSocketId, challenge.fromAddress);
      const toToken = sessionManager.create(challenge.toSocketId, challenge.toAddress);
      io.to(challenge.fromSocketId).emit('session_token', { token: fromToken });
      io.to(challenge.toSocketId).emit('session_token', { token: toToken });

      await db.ensurePlayer(challenge.fromAddress, challenge.fromUsername);
      await db.ensurePlayer(challenge.toAddress, challenge.toUsername);

      const game = await gameManager.createGame(
        challenge.fromSocketId, challenge.fromAddress, challenge.fromUsername,
        challenge.toSocketId, challenge.toAddress, challenge.toUsername,
        challenge.stakeTier,
      );
      if (!game) { socket.emit('error', { message: 'Game creation failed' }); return; }

      await db.recordGameStart(game.id, challenge.stakeTier, game.white.address, game.black.address);

      lobbyManager.setStatus(challenge.fromSocketId, 'in_game');
      lobbyManager.setStatus(challenge.toSocketId, 'in_game');
      broadcastLobby();

      const escrowAddr = escrowManager.getGameAddress(game.id);

      io.to(game.white.socketId).emit('match_found', {
        gameId: game.id, myColor: 'white',
        opponent: { username: game.black.username, address: game.black.address },
        tier: { name: tier.name, depositCents: tier.depositCents, baseCents: tier.baseCents },
        depositSats: game.depositSats, baseSats: game.baseSats,
        escrowAddress: escrowAddr, bsvPrice: game.bsvPriceAtStart,
      });
      io.to(game.black.socketId).emit('match_found', {
        gameId: game.id, myColor: 'black',
        opponent: { username: game.white.username, address: game.white.address },
        tier: { name: tier.name, depositCents: tier.depositCents, baseCents: tier.baseCents },
        depositSats: game.depositSats, baseSats: game.baseSats,
        escrowAddress: escrowAddr, bsvPrice: game.bsvPriceAtStart,
      });

      console.log(`♟️ Challenge: ${game.white.username} vs ${game.black.username} @ ${tier.name}`);
    });

    socket.on('decline_challenge', (data: { challengeId: string }) => {
      if (!rateCheck(socket, 'decline_challenge')) return;
      const result = lobbyManager.declineChallenge(data.challengeId, socket.id);
      if (!result.success) return;
      const challenge = result.challenge!;
      io.to(challenge.fromSocketId).emit('challenge_declined', {
        challengeId: challenge.id, byUsername: challenge.toUsername,
      });
      socket.emit('challenge_declined_ack', { challengeId: challenge.id });
    });

    socket.on('cancel_challenge', (data: { challengeId: string }) => {
      if (!rateCheck(socket, 'cancel_challenge')) return;
      lobbyManager.cancelChallengesFrom(socket.id);
      socket.emit('challenge_cancelled_ack', { challengeId: data.challengeId });
    });

    // ========================================================================
    // WAGER PAYMENT — Both players pay before game starts
    // ========================================================================
    socket.on('submit_wager', async (data: { rawTxHex: string }) => {
      if (!rateCheck(socket, 'submit_payment')) return;

      const game = gameManager.getGameBySocket(socket.id);
      if (!game || game.phase !== 'awaiting_wagers') {
        socket.emit('error', { message: 'No game awaiting wager' }); return;
      }

      const slot = gameManager.getSlot(game, socket.id);
      if (!slot) { socket.emit('error', { message: 'Not a player' }); return; }
      if (game[slot].wagerPaid) { socket.emit('error', { message: 'Wager already paid' }); return; }

      const escrowAddr = escrowManager.getGameAddress(game.id);

      // Verify & broadcast the wager TX
      const result = await verifyAndBroadcastTx(
        data.rawTxHex, escrowAddr, game.depositSats, game.id, game[slot].address,
      );

      if (!result.verified) {
        socket.emit('wager_result', { success: false, error: result.error });
        return;
      }

      const confirm = gameManager.confirmWagerPayment(game.id, slot, result.txid);
      socket.emit('wager_result', { success: true, txid: result.txid });

      const oppSlot = gameManager.opponentSlot(slot);
      io.to(game[oppSlot].socketId).emit('opponent_wager_paid', { slot });

      if (confirm.bothPaid) {
        // Game starts! Notify both players
        const startData = {
          fen: game.chess.fen(),
          turn: 'white' as const,
          pot: game.pot,
          depositSats: game.depositSats,
          baseSats: game.baseSats,
        };
        io.to(game.white.socketId).emit('game_start', startData);
        io.to(game.black.socketId).emit('game_start', startData);
        console.log(`♟️ Game ${game.id.slice(0, 8)} started — pot: ${game.pot} sats`);
      }
    });

    // ========================================================================
    // MAKE MOVE — Validate, then require micro-payment
    // ========================================================================
    socket.on('make_move', async (data: { from: string; to: string; promotion?: string }) => {
      if (!rateCheck(socket, 'fire_shot')) return;

      const game = gameManager.getGameBySocket(socket.id);
      if (!game) { socket.emit('error', { message: 'No active game' }); return; }

      const escrowAddr = escrowManager.getGameAddress(game.id);
      const result = gameManager.attemptMove(socket.id, data.from, data.to, data.promotion, escrowAddr);

      if (!result.success) {
        socket.emit('move_error', { error: result.error });
        return;
      }

      // Move applied immediately — broadcast to both players
      const move = result.move!;
      const moveData = {
        san: move.san, from: move.from, to: move.to, color: move.color,
        fen: result.fen, pot: game.pot,
        isCheck: result.isCheck || false,
        capturePayment: result.capturePayment || null,
      };

      io.to(game.white.socketId).emit('move_confirmed', moveData);
      io.to(game.black.socketId).emit('move_confirmed', moveData);

      // Handle game over
      if (result.gameOver && result.gameOverResult) {
        await handleGameEnd(game, result.gameOverResult);
      }
    });

    // ========================================================================
    // DRAW OFFER / ACCEPT / DECLINE
    // ========================================================================
    socket.on('offer_draw', () => {
      const result = gameManager.offerDraw(socket.id);
      if (!result.success) { socket.emit('error', { message: result.error }); return; }
      io.to(result.opponentSocketId!).emit('draw_offered', {
        message: 'Your opponent is offering a draw',
      });
      socket.emit('draw_offer_sent');
    });

    socket.on('accept_draw', async () => {
      const result = gameManager.acceptDraw(socket.id);
      if (!result.success) { socket.emit('error', { message: result.error }); return; }
      const game = gameManager.getGameBySocket(socket.id);
      if (game) await handleGameEnd(game, result.result!);
    });

    socket.on('decline_draw', () => {
      const game = gameManager.getGameBySocket(socket.id);
      if (!game) return;
      const slot = gameManager.getSlot(game, socket.id);
      if (!slot) return;
      const oppSlot = gameManager.opponentSlot(slot);
      io.to(game[oppSlot].socketId).emit('draw_declined');
    });

    // ========================================================================
    // RESIGN
    // ========================================================================
    socket.on('resign', async () => {
      if (!rateCheck(socket, 'forfeit')) return;
      const result = gameManager.resign(socket.id);
      if (!result) return;
      const game = gameManager.getGame(result.gameId);
      if (!game) return;
      await handleGameEnd(game, result.result);
    });

    // ========================================================================
    // FUNDS ADDED
    // ========================================================================
    socket.on('funds_added', async () => {
      if (!rateCheck(socket, 'funds_added')) return;
      const game = gameManager.getGameBySocket(socket.id);
      if (!game || game.phase !== 'paused') return;
      const slot = gameManager.getSlot(game, socket.id);
      if (!slot || game.pausedFor !== slot) return;

      const balance = await fetchBalance(game[slot].address);
      const needed = game.pendingPayment?.amount || game.baseSats;
      if (balance < needed) {
        socket.emit('error', { message: `Still insufficient. Need ${needed} sats, have ${balance}.` });
        return;
      }

      // Resume
      game.phase = 'playing';
      game.pausedFor = null;
      game.pausedAt = null;
      game.pauseReason = null;

      const oppSlot = gameManager.opponentSlot(slot);
      io.to(game[oppSlot].socketId).emit('game_resumed', {
        message: `${game[slot].username} added funds. Game continuing...`,
      });
      socket.emit('game_resumed', { message: 'Funds confirmed! You can continue.' });
    });

    // ========================================================================
    // RECONNECT
    // ========================================================================
    socket.on('reconnect_game', (data: { gameId: string; address: string }) => {
      if (!rateCheck(socket, 'reconnect_game')) return;
      const result = gameManager.handleReconnect(socket.id, data.gameId, data.address);
      if (!result.success) {
        socket.emit('reconnect_result', { success: false, error: result.error });
        return;
      }

      const game = result.game!;
      const slot = result.slot!;

      // Cancel pending session revocation
      const revocationKey = `${game.id}:${slot}`;
      const pendingTimer = pendingRevocations.get(revocationKey);
      if (pendingTimer) { clearTimeout(pendingTimer); pendingRevocations.delete(revocationKey); }

      const sessionToken = sessionManager.create(socket.id, data.address);
      socket.emit('session_token', { token: sessionToken });

      socket.emit('reconnect_result', {
        success: true,
        gameState: gameManager.getClientState(game, slot),
      });

      const opp = gameManager.opponentSlot(slot);
      io.to(game[opp].socketId).emit('opponent_reconnected');
    });

    // ========================================================================
    // DISCONNECT
    // ========================================================================
    socket.on('disconnect', async () => {
      console.log(`🔌 ${socket.id} disconnected`);
      socketRateLimiter.cleanup(socket.id);
      matchmakingQueue.remove(socket.id);
      lobbyManager.leave(socket.id);
      broadcastLobby();

      const gameResult = gameManager.handleDisconnect(socket.id);

      if (gameResult) {
        const game = gameManager.getGame(gameResult.gameId);
        if (gameResult.graceStarted && game) {
          const revocationKey = `${gameResult.gameId}:${gameResult.slot}`;
          const timer = setTimeout(() => {
            sessionManager.revokeBySocket(socket.id);
            pendingRevocations.delete(revocationKey);
          }, REVOCATION_DELAY_MS);
          pendingRevocations.set(revocationKey, timer);

          const opp = gameManager.opponentSlot(gameResult.slot);
          io.to(game[opp].socketId).emit('opponent_disconnected', {
            gameOver: false,
            message: `${game[gameResult.slot].username} disconnected. 2 min to reconnect...`,
            graceMs: 120_000,
          });
        } else {
          sessionManager.revokeBySocket(socket.id);
        }
      } else {
        sessionManager.revokeBySocket(socket.id);
      }
    });

    // ========================================================================
    // INFO
    // ========================================================================
    socket.on('get_queue_info', () => {
      if (!rateCheck(socket, 'get_queue_info')) return;
      socket.emit('queue_info', {
        queues: matchmakingQueue.getQueueSizes(),
        activeGames: gameManager.getActiveCount(),
      });
    });

    socket.on('get_leaderboard', async () => {
      if (!rateCheck(socket, 'get_leaderboard')) return;
      try { socket.emit('leaderboard', await db.getLeaderboard()); }
      catch { socket.emit('error', { message: 'Leaderboard failed' }); }
    });
  });

  // ==========================================================================
  // GAME END HANDLER — settle escrow, record to DB
  // ==========================================================================

  async function handleGameEnd(game: any, result: GameOverResult) {
    const white = game.white;
    const black = game.black;

    io.to(white.socketId).emit('settling', { message: '💰 Settling accounts...' });
    io.to(black.socketId).emit('settling', { message: '💰 Settling accounts...' });

    let settleTxid = '';

    if (result.winner) {
      // Winner takes pot
      const winnerAddr = result.winner === 'white' ? result.whiteAddress : result.blackAddress;
      if (result.pot > 0 && (result.winnerPayout > 546 || result.platformCut > 546)) {
        const tx = await escrowManager.settle(
          game.id, winnerAddr, result.winnerPayout, result.platformCut,
        );
        if (tx.success) {
          settleTxid = tx.txid || '';
          console.log(`💸 Settled: ${result.winnerPayout}→winner, ${result.platformCut}→platform`);
        } else {
          console.error(`❌ Settlement failed: ${tx.error}`);
        }
      }
    } else {
      // Draw — split pot
      if (result.pot > 0 && result.winnerPayout > 546) {
        // Settle to white first, then black (two separate TXs for simplicity)
        // In production, build a single TX with multiple outputs
        const tx = await escrowManager.settle(
          game.id, result.whiteAddress, result.winnerPayout,
          result.platformCut + result.loserPayout, // platform + black's share as "platform" for now
        );
        if (tx.success) {
          settleTxid = tx.txid || '';
          // TODO: build proper multi-output draw settlement
          console.log(`💸 Draw settlement: ${result.winnerPayout} each, ${result.platformCut} platform`);
        }
      }
    }

    // Emit results
    const base = {
      winner: result.winner,
      reason: result.reason,
      pot: result.pot,
      settleTxid,
    };

    if (result.winner) {
      const winnerSocket = result.winner === 'white' ? white.socketId : black.socketId;
      const loserSocket = result.winner === 'white' ? black.socketId : white.socketId;
      const loserName = result.winner === 'white' ? black.username : white.username;
      const winnerName = result.winner === 'white' ? white.username : black.username;

      io.to(winnerSocket).emit('game_over', {
        ...base, payout: result.winnerPayout,
        message: winMsg(result.reason, loserName),
      });
      io.to(loserSocket).emit('game_over', {
        ...base, payout: 0,
        message: loseMsg(result.reason, winnerName),
      });
    } else {
      // Draw
      io.to(white.socketId).emit('game_over', {
        ...base, payout: result.winnerPayout,
        message: drawMsg(result.reason),
      });
      io.to(black.socketId).emit('game_over', {
        ...base, payout: result.loserPayout,
        message: drawMsg(result.reason),
      });
    }

    // Record to DB
    try {
      await db.recordGameEnd(
        game.id,
        result.winner ? (result.winner === 'white' ? result.whiteAddress : result.blackAddress) : null,
        result.reason,
        result.pot, result.winnerPayout, result.platformCut, settleTxid,
        { moveCount: white.moveCount },
        { moveCount: black.moveCount },
      );
    } catch (err) { console.error('DB record failed:', err); }

    pendingRevocations.delete(`${game.id}:white`);
    pendingRevocations.delete(`${game.id}:black`);

    lobbyManager.setStatus(white.socketId, 'idle');
    lobbyManager.setStatus(black.socketId, 'idle');
    broadcastLobby();

    setTimeout(() => gameManager.removeGame(game.id), 60_000);
  }

  function winMsg(reason: string, opp: string): string {
    const m: Record<string, string> = {
      checkmate: `Checkmate! You defeated ${opp}!`,
      resignation: `${opp} resigned!`,
      disconnect: `${opp} disconnected. You win!`,
      timeout: `${opp} ran out of time!`,
      insufficient_funds: `${opp} ran out of funds!`,
    };
    return m[reason] || 'You won!';
  }

  function loseMsg(reason: string, opp: string): string {
    const m: Record<string, string> = {
      checkmate: `Checkmate! ${opp} wins.`,
      resignation: 'You resigned.',
      disconnect: 'You disconnected and lost.',
      timeout: 'You ran out of time!',
      insufficient_funds: 'You ran out of funds!',
    };
    return m[reason] || 'You lost.';
  }

  function drawMsg(reason: string): string {
    const m: Record<string, string> = {
      stalemate: 'Stalemate — it\'s a draw!',
      draw_agreement: 'Draw agreed!',
      threefold_repetition: 'Threefold repetition — draw!',
      fifty_move_rule: '50-move rule — draw!',
      insufficient_material: 'Insufficient material — draw!',
    };
    return m[reason] || 'It\'s a draw!';
  }
}
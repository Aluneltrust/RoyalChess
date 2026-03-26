// ============================================================================
// useMultiplayer — Socket.IO hook for BSV Chess
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { BACKEND_URL, STORAGE_KEYS } from '../constants';
import { setSessionToken } from '../services';

export type GamePhase = 'lobby' | 'matchmaking' | 'awaiting_wagers' | 'playing' | 'paused' | 'gameover';

export interface MultiplayerCallbacks {
  onMatchFound: (data: any) => void;
  onGameStart: (data: any) => void;
  onMoveConfirmed: (data: any) => void;
  onGameOver: (data: any) => void;
  onDrawOffered: () => void;
  onFundsNeeded: (data: any) => void;
  onOpponentDisconnected: (data: any) => void;
  onReconnected: (data: any) => void;
  onError: (msg: string) => void;
}

export function useMultiplayer(callbacks: MultiplayerCallbacks) {
  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby');
  const [isConnected, setIsConnected] = useState(false);
  const [gameId, setGameId] = useState('');
  const [myColor, setMyColor] = useState<'white' | 'black'>('white');
  const [opponentName, setOpponentName] = useState('');
  const [opponentAddress, setOpponentAddress] = useState('');
  const [escrowAddress, setEscrowAddress] = useState('');
  const [depositSats, setDepositSats] = useState(0);
  const [baseSats, setBaseSats] = useState(0);
  const [pot, setPot] = useState(0);
  const [myWagerPaid, setMyWagerPaid] = useState(false);
  const [opponentWagerPaid, setOpponentWagerPaid] = useState(false);
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [isCheck, setIsCheck] = useState(false);
  const [winner, setWinner] = useState<'white' | 'black' | 'draw' | null>(null);
  const [message, setMessage] = useState('');
  const [pauseMessage, setPauseMessage] = useState('');
  const [pendingPayment, setPendingPayment] = useState<{ amount: number; toAddress: string } | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const myColorRef = useRef(myColor);
  const gameIdRef = useRef(gameId);

  useEffect(() => { myColorRef.current = myColor; }, [myColor]);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;
    const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('session_token', (data: { token: string }) => {
      setSessionToken(data.token);
    });

    socket.on('match_found', (data) => {
      setGameId(data.gameId);
      setMyColor(data.myColor);
      setOpponentName(data.opponent.username);
      setOpponentAddress(data.opponent.address);
      setEscrowAddress(data.escrowAddress);
      setDepositSats(data.depositSats);
      setBaseSats(data.baseSats);
      setPot(0);
      setMyWagerPaid(false);
      setOpponentWagerPaid(false);
      setGamePhase('awaiting_wagers');
      setMessage(`Matched with ${data.opponent.username}! Pay your deposit to start.`);
      localStorage.setItem(STORAGE_KEYS.GAME_ID, data.gameId);
      callbacks.onMatchFound(data);
    });

    socket.on('wager_result', (data) => {
      if (data.success) {
        setMyWagerPaid(true);
        setMessage('Wager paid! Waiting for opponent...');
      } else {
        setMessage(`Wager failed: ${data.error}`);
      }
    });

    socket.on('opponent_wager_paid', () => {
      setOpponentWagerPaid(true);
    });

    socket.on('game_start', (data) => {
      setFen(data.fen);
      setPot(data.pot);
      setGamePhase('playing');
      setMessage('Game on!');
      callbacks.onGameStart(data);
    });

    socket.on('move_confirmed', (data) => {
      setFen(data.fen);
      setPot(data.pot);
      setIsCheck(data.isCheck || false);
      setPendingPayment(null);
      callbacks.onMoveConfirmed(data);
    });

    socket.on('draw_offered', () => {
      callbacks.onDrawOffered();
    });

    socket.on('draw_declined', () => {
      setMessage('Draw offer declined.');
    });

    socket.on('draw_offer_sent', () => {
      setMessage('Draw offer sent...');
    });

    socket.on('funds_needed', (data) => {
      setGamePhase('paused');
      setPauseMessage(data.message);
      callbacks.onFundsNeeded(data);
    });

    socket.on('game_paused', (data) => {
      setGamePhase('paused');
      setPauseMessage(data.reason);
    });

    socket.on('game_resumed', (data) => {
      setGamePhase('playing');
      setPauseMessage('');
      setMessage(data.message || 'Game resumed!');
    });

    socket.on('settling', () => {
      setMessage('Settling accounts...');
    });

    socket.on('game_over', (data) => {
      setGamePhase('gameover');
      setPot(data.pot);
      if (data.winner === null) {
        setWinner('draw');
      } else {
        setWinner(data.winner);
      }
      setMessage(data.message);
      localStorage.removeItem(STORAGE_KEYS.GAME_ID);
      callbacks.onGameOver(data);
    });

    socket.on('opponent_disconnected', (data) => {
      callbacks.onOpponentDisconnected(data);
      if (data.gameOver) {
        setMessage(data.message);
      } else {
        setMessage(data.message);
      }
    });

    socket.on('opponent_reconnected', () => {
      setMessage('Opponent reconnected!');
    });

    socket.on('reconnect_result', (data) => {
      if (data.success) {
        const gs = data.gameState;
        setGameId(gs.gameId);
        setMyColor(gs.myColor);
        setOpponentName(gs.opponent.username);
        setOpponentAddress(gs.opponent.address);
        setFen(gs.fen);
        setPot(gs.pot);
        setDepositSats(gs.depositSats);
        setBaseSats(gs.baseSats);
        setMyWagerPaid(gs.myWagerPaid);
        setOpponentWagerPaid(gs.opponentWagerPaid);
        setIsCheck(gs.isCheck || false);
        setGamePhase(gs.phase === 'gameover' ? 'gameover' : gs.phase);
        setMessage('Reconnected!');
        callbacks.onReconnected(gs);
      }
    });

    socket.on('matchmaking_started', (data) => {
      setGamePhase('matchmaking');
      setMessage(`Searching for ${data.tier} opponent...`);
    });

    socket.on('matchmaking_cancelled', () => {
      setGamePhase('lobby');
      setMessage('');
    });

    // Lobby events
    socket.on('lobby_update', (data) => {
      setLobbyPlayers(data.players || []);
    });

    socket.on('challenge_received', (data) => {
      setIncomingChallenge({
        id: data.challengeId,
        fromUsername: data.fromUsername,
        fromAddress: data.fromAddress,
        stakeTier: data.stakeTier,
      });
    });

    socket.on('challenge_declined', (data) => {
      setMessage(`${data.byUsername || 'Opponent'} declined your challenge.`);
    });

    socket.on('challenge_expired', () => {
      setIncomingChallenge(null);
      setMessage('Challenge expired.');
    });

    socket.on('challenge_cancelled', () => {
      setIncomingChallenge(null);
    });

    socket.on('challenge_error', (data) => {
      setMessage(data.error || 'Challenge failed');
    });

    // Game cancelled during wager phase (opponent left)
    socket.on('game_cancelled', (data) => {
      setGamePhase('lobby');
      setGameId('');
      setMyWagerPaid(false);
      setOpponentWagerPaid(false);
      setPendingPayment(null);
      setMessage(data.reason || 'Game cancelled.');
    });

    socket.on('wager_refunded', (data) => {
      setMessage(`Deposit refunded: ${data.amount} sats. TX: ${data.txid?.slice(0, 12)}...`);
    });

    socket.on('error', (data) => {
      setMessage(data.message || 'Error');
      callbacks.onError(data.message);
    });

    socketRef.current = socket;
  }, []);

  // Auto-reconnect to active game
  useEffect(() => {
    if (!isConnected) return;
    const savedGameId = localStorage.getItem(STORAGE_KEYS.GAME_ID);
    const savedAddr = localStorage.getItem(STORAGE_KEYS.WALLET_ADDR);
    if (savedGameId && savedAddr) {
      socketRef.current?.emit('reconnect_game', { gameId: savedGameId, address: savedAddr });
    }
  }, [isConnected]);

  const findMatch = useCallback((address: string, username: string, stakeTier: number) => {
    socketRef.current?.emit('find_match', { address, username, stakeTier });
  }, []);

  const cancelMatchmaking = useCallback(() => {
    socketRef.current?.emit('cancel_matchmaking');
    setGamePhase('lobby');
  }, []);

  const submitWager = useCallback((rawTxHex: string) => {
    socketRef.current?.emit('submit_wager', { rawTxHex });
  }, []);

  const makeMove = useCallback((from: string, to: string, promotion?: string) => {
    socketRef.current?.emit('make_move', { from, to, promotion });
  }, []);

  const submitMovePayment = useCallback((rawTxHex: string) => {
    socketRef.current?.emit('submit_move_payment', { rawTxHex });
  }, []);

  const submitCapturePayment = useCallback((rawTxHex: string) => {
    socketRef.current?.emit('submit_capture_payment', { rawTxHex });
  }, []);
  const offerDraw = useCallback(() => { socketRef.current?.emit('offer_draw'); }, []);
  const acceptDraw = useCallback(() => { socketRef.current?.emit('accept_draw'); }, []);
  const declineDraw = useCallback(() => { socketRef.current?.emit('decline_draw'); }, []);
  const resign = useCallback(() => { socketRef.current?.emit('resign'); }, []);
  const notifyFundsAdded = useCallback(() => { socketRef.current?.emit('funds_added'); }, []);

  const goToLobby = useCallback(() => { setGamePhase('lobby'); }, []);

  // ========================================================================
  // LOBBY — Online players + challenges
  // ========================================================================

  const [lobbyPlayers, setLobbyPlayers] = useState<{ address: string; username: string; status: string; gamesWon: number; gamesPlayed: number }[]>([]);
  const [incomingChallenge, setIncomingChallenge] = useState<{ id: string; fromUsername: string; fromAddress: string; stakeTier: number } | null>(null);

  // Join lobby (called after connecting + setting username)
  const joinLobby = useCallback((address: string, username: string) => {
    const s = socketRef.current;
    if (!s?.connected) return;
    s.emit('join_lobby', { address, username });
    // Also request fresh lobby list
    setTimeout(() => s.emit('get_lobby'), 600);
  }, []);

  const refreshLobby = useCallback(() => {
    socketRef.current?.emit('get_lobby');
  }, []);

  const challengePlayer = useCallback((toAddress: string, stakeTier: number) => {
    socketRef.current?.emit('challenge_player', { toAddress, stakeTier });
  }, []);

  const acceptChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('accept_challenge', { challengeId });
    setIncomingChallenge(null);
  }, []);

  const declineChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('decline_challenge', { challengeId });
    setIncomingChallenge(null);
  }, []);

  const resetGame = useCallback(() => {
    setGamePhase('lobby');
    setGameId('');
    setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    setPot(0);
    setWinner(null);
    setMessage('');
    setPendingPayment(null);
    setMyWagerPaid(false);
    setOpponentWagerPaid(false);
    setIsCheck(false);
  }, []);

  return {
    // State
    gamePhase, isConnected, gameId, myColor, opponentName, opponentAddress,
    escrowAddress, depositSats, baseSats, pot, myWagerPaid, opponentWagerPaid,
    fen, isCheck, winner, message, pauseMessage, pendingPayment,
    lobbyPlayers, incomingChallenge,
    socketRef,
    // Actions
    connect, findMatch, cancelMatchmaking, submitWager, makeMove,
    submitCapturePayment, offerDraw, acceptDraw, declineDraw, resign,
    notifyFundsAdded, goToLobby, resetGame, setMessage,
    joinLobby, refreshLobby, challengePlayer, acceptChallenge, declineChallenge,
  };
}
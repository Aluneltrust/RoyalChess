// ============================================================================
// BSV CHESS — Main App Orchestrator
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PrivateKey } from '@bsv/sdk';
import { BSV_NETWORK, STORAGE_KEYS } from './constants';
import {
  bsvWalletService, bsvPriceService, fetchBalance, setSessionToken, soundManager,
  isEmbedded, bridgeGetAddress, bridgeGetBalance, bridgeGetUsername, bridgeSignTransaction,
} from './services';
import {
  encryptAndStoreWif, decryptStoredWif, hasStoredWallet,
  getAddressHint, deleteStoredWallet,
} from './utils/pinCrypto';
import { useMultiplayer } from './hooks/useMultiplatyer';
import ChessBoard, { ChessBoardHandle } from './components/ChessBoard';
import MoveHistory from './components/MoveHistory';
import WalletPage from './components/WalletPage';
import {
  PinUnlockScreen, PinSetupScreen, ConnectScreen,
  LobbyScreen, MatchmakingScreen, WagerScreen,
  GameOverModal, PausedModal, DrawOfferModal,
} from './components/GameScreens';

export default function App() {
  // ============================================================================
  // WALLET STATE
  // ============================================================================
  const [privateKey, setPrivateKey] = useState<PrivateKey | null>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState(0);
  const [username, setUsername] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [embeddedMode] = useState(() => isEmbedded());

  // ============================================================================
  // UI STATE
  // ============================================================================
  const [selectedTier, setSelectedTier] = useState(1);
  const [bsvPrice, setBsvPrice] = useState(50);
  const [showWallet, setShowWallet] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [addressHint, setAddressHint] = useState<string | null>(null);
  const [showDrawOffer, setShowDrawOffer] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<any[]>([]);
  const [payout, setPayout] = useState(0);
  const pendingImportWif = useRef<string | null>(null);
  const boardRef = useRef<ChessBoardHandle>(null);

  // ============================================================================
  // MULTIPLAYER CALLBACKS
  // ============================================================================
  const callbacks = {
    onMatchFound: () => {},
    onGameStart: () => {},

    onMoveConfirmed: (data: any) => {
      setLastMove({ from: data.from, to: data.to });
      setMoveHistory(prev => [...prev, {
        san: data.san, from: data.from, to: data.to,
        color: data.color,
      }]);

      // Play appropriate sound
      if (data.isCheckmate) {
        soundManager.playCaptKing();
      } else if (data.capturedPiece) {
        soundManager.playCaptureByPiece(data.capturedPiece);
      } else if (data.isCastle) {
        soundManager.playCastle();
      } else if (data.isCheck) {
        soundManager.playCheck();
      } else {
        soundManager.playPieceMove(data.movingPiece);
      }

      // Coin sound for payment
      if (data.capturePayment) {
        setTimeout(() => soundManager.playCoin(), 300);
      }
      refreshBalance();
    },

    onGameOver: (data: any) => {
      setPayout(data.payout || 0);
      if (data.winner && data.payout > 0) {
        soundManager.playVictory();
      } else if (data.winner) {
        soundManager.playDefeat();
      } else {
        soundManager.playDraw();
      }
      refreshBalance();
    },

    onDrawOffered: () => setShowDrawOffer(true),

    onFundsNeeded: () => {},

    onOpponentDisconnected: () => {},

    onReconnected: (gs: any) => {
      setMoveHistory(gs.moveHistory || []);
      if (!embeddedMode && privateKey) bsvWalletService.connect(privateKey.toWif());
    },

    onError: () => setIsProcessing(false),
  };

  const mp = useMultiplayer(callbacks);

  // ============================================================================
  // INIT
  // ============================================================================
  useEffect(() => {
    mp.connect(); // Connect socket immediately like TikTakTo
    loadWallet();
    loadUsername();
    bsvPriceService.updatePrice().then(setBsvPrice);
    const interval = setInterval(async () => {
      setBsvPrice(await bsvPriceService.updatePrice());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-join lobby when socket connected + wallet ready
  useEffect(() => {
    if (mp.isConnected && walletAddress && username && mp.gamePhase === 'lobby') {
      mp.joinLobby(walletAddress, username);
    }
  }, [mp.isConnected, walletAddress, username, mp.gamePhase]);

  // Periodically refresh lobby while on lobby screen
  useEffect(() => {
    if (mp.isConnected && mp.gamePhase === 'lobby') {
      mp.refreshLobby();
      const interval = setInterval(() => mp.refreshLobby(), 5000);
      return () => clearInterval(interval);
    }
  }, [mp.isConnected, mp.gamePhase]);

  // ============================================================================
  // WALLET FUNCTIONS
  // ============================================================================
  const loadWallet = async () => {
    // When embedded in AlunelGames, get wallet from parent via postMessage
    if (embeddedMode) {
      try {
        const address = await bridgeGetAddress();
        setWalletAddress(address);
        // Fetch balance and username separately to isolate failures
        try {
          const bal = await bridgeGetBalance();
          setBalance(bal);
        } catch { /* balance defaults to 0 */ }
        try {
          const name = await bridgeGetUsername();
          if (name) saveUsername(name);
        } catch { /* username falls back to loadUsername */ }
        mp.goToLobby();
      } catch (e) {
        console.error('Bridge wallet init failed:', e);
        // Fallback to standalone mode
        setShowIntro(true);
      }
      return;
    }

    if (hasStoredWallet()) {
      setNeedsPin(true);
      setAddressHint(getAddressHint());
      return;
    }
    setShowIntro(true);
  };

  const unlockWithPin = async (pin: string) => {
    setPinError('');
    try {
      const wif = await decryptStoredWif(pin);
      const pk = PrivateKey.fromWif(wif);
      const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
      setPrivateKey(pk);
      setWalletAddress(address);
      setNeedsPin(false);
      setPinInput('');
      await refreshBalance(address);
      mp.goToLobby();
    } catch (e: any) {
      setPinError(e.message === 'Wrong PIN' ? 'Wrong PIN. Try again.' : e.message);
      setPinInput('');
    }
  };

  const createWallet = async (pin: string) => {
    setIsProcessing(true);
    setPinError('');
    try {
      const pk = PrivateKey.fromRandom();
      const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
      await encryptAndStoreWif(pk.toWif(), pin, address);
      setPrivateKey(pk);
      setWalletAddress(address);
      setNeedsPinSetup(false);
      setPinInput('');
      setPinConfirm('');
      mp.goToLobby();
    } catch (e: any) {
      setPinError(e.message);
    }
    setIsProcessing(false);
  };

  const handleImportWif = (wif: string) => {
    try {
      PrivateKey.fromWif(wif);
      pendingImportWif.current = wif;
      setShowIntro(false);
      setNeedsPinSetup(true);
    } catch {
      alert('Invalid WIF key');
    }
  };

  const handleCreateWalletClick = () => {
    setShowIntro(false);
    setNeedsPinSetup(true);
  };

  const handlePinSetupSubmit = async (pin: string) => {
    if (pin !== pinConfirm) { setPinError('PINs do not match'); return; }
    if (pendingImportWif.current) {
      setIsProcessing(true);
      try {
        const pk = PrivateKey.fromWif(pendingImportWif.current);
        const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
        await encryptAndStoreWif(pendingImportWif.current, pin, address);
        pendingImportWif.current = null;
        setPrivateKey(pk);
        setWalletAddress(address);
        setNeedsPinSetup(false);
        setPinInput('');
        setPinConfirm('');
        await refreshBalance(address);
        mp.goToLobby();
      } catch (e: any) { setPinError(e.message); }
      setIsProcessing(false);
    } else {
      await createWallet(pin);
    }
  };

  const deleteWallet = () => {
    deleteStoredWallet();
    setNeedsPin(false);
    setShowIntro(true);
    setPrivateKey(null);
    setWalletAddress('');
  };

  const loadUsername = () => {
    const saved = localStorage.getItem(STORAGE_KEYS.USERNAME);
    if (saved) setUsername(saved);
  };

  const saveUsername = (name: string) => {
    setUsername(name);
    localStorage.setItem(STORAGE_KEYS.USERNAME, name);
  };

  const refreshBalance = async (address?: string) => {
    if (embeddedMode) {
      try {
        setBalance(await bridgeGetBalance());
      } catch { /* ignore */ }
      return;
    }
    const addr = address || walletAddress;
    if (!addr) return;
    setBalance(await fetchBalance(addr));
  };

  // ============================================================================
  // GAME ACTIONS
  // ============================================================================
  const handleMove = (from: string, to: string, promotion?: string) => {
    if (isProcessing) return;
    mp.makeMove(from, to, promotion);
  };

  const handlePayWager = async () => {
    if (isProcessing) return;
    if (!embeddedMode && !privateKey) return;
    setIsProcessing(true);
    try {
      let result: { success: boolean; rawTxHex?: string; error?: string };

      if (embeddedMode) {
        // Sign via parent wallet bridge
        result = await bridgeSignTransaction(
          mp.escrowAddress, mp.depositSats,
          JSON.stringify({ app: 'BSVCHESS', action: 'WAGER', game: mp.gameId.substring(0, 8) }),
        );
      } else {
        // Sign locally
        if (!bsvWalletService.isConnected()) {
          await bsvWalletService.connect(privateKey!.toWif());
        }
        result = await bsvWalletService.sendGamePayment(
          mp.escrowAddress, mp.depositSats, mp.gameId, 'wager',
        );
      }

      if (result.success && result.rawTxHex) {
        mp.submitWager(result.rawTxHex);
        soundManager.playCoin();
      } else {
        mp.setMessage(`Wager failed: ${result.error}`);
      }
    } catch (err: any) {
      mp.setMessage(`Wager error: ${err.message}`);
    }
    setIsProcessing(false);
  };

  const handleResetGame = () => {
    mp.resetGame();
    setMoveHistory([]);
    setLastMove(null);
    setPayout(0);
  };

  const currentTurn = mp.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const isMyTurn = currentTurn === mp.myColor;

  // ============================================================================
  // RENDER
  // ============================================================================

  // Wallet page overlay
  if (showWallet) {
    return <WalletPage onBack={() => setShowWallet(false)} walletPrivateKey={privateKey} walletAddress={walletAddress} />;
  }

  // Intro / Connect
  if (showIntro) {
    return <ConnectScreen isProcessing={isProcessing} onCreateWallet={handleCreateWalletClick} onImportWif={handleImportWif} />;
  }

  // PIN Setup
  if (needsPinSetup) {
    return <PinSetupScreen pinInput={pinInput} setPinInput={setPinInput} pinConfirm={pinConfirm}
      setPinConfirm={setPinConfirm} pinError={pinError} isProcessing={isProcessing}
      onSubmit={handlePinSetupSubmit} />;
  }

  // PIN Unlock
  if (needsPin) {
    return <PinUnlockScreen addressHint={addressHint} pinInput={pinInput} setPinInput={setPinInput}
      pinError={pinError} onUnlock={unlockWithPin} onDelete={deleteWallet} />;
  }

  // Lobby
  if (mp.gamePhase === 'lobby') {
    return <LobbyScreen username={username} walletAddress={walletAddress} balance={balance}
      selectedTier={selectedTier} bsvPrice={bsvPrice}
      lobbyPlayers={mp.lobbyPlayers} incomingChallenge={mp.incomingChallenge}
      onSaveUsername={saveUsername}
      onSelectTier={setSelectedTier} onFindMatch={() => mp.findMatch(walletAddress, username, selectedTier)}
      onShowWallet={() => setShowWallet(true)} onRefreshBalance={() => refreshBalance()}
      onChallengePlayer={mp.challengePlayer}
      onAcceptChallenge={mp.acceptChallenge}
      onDeclineChallenge={mp.declineChallenge} />;
  }

  // Matchmaking
  if (mp.gamePhase === 'matchmaking') {
    return <MatchmakingScreen selectedTier={selectedTier} onCancel={mp.cancelMatchmaking} />;
  }

  // Awaiting wagers
  if (mp.gamePhase === 'awaiting_wagers') {
    return <WagerScreen wagerSats={mp.depositSats} opponentName={mp.opponentName}
      myWagerPaid={mp.myWagerPaid} opponentWagerPaid={mp.opponentWagerPaid}
      isProcessing={isProcessing} onPayWager={handlePayWager} />;
  }

  // Playing or Game Over
  return (
    <div className="game-container">
      {/* Board — fills the viewport */}
      <div className="board-area">
        {/* Floating top bar — opponent info */}
        <div className="floating-bar top-bar">
          <div className="player-badge opponent">
            <span className="badge-dot" style={{ background: mp.myColor === 'white' ? '#1e1a16' : '#f5e6cc' }} />
            <span className="badge-name">{mp.opponentName}</span>
          </div>
          <div className="turn-indicator">
            {mp.gamePhase === 'playing' && (
              <span className={`turn-pill ${isMyTurn ? 'your-turn' : 'their-turn'}`}>
                {isMyTurn ? (isProcessing ? 'Processing…' : 'Your move') : `${mp.opponentName}'s move`}
              </span>
            )}
          </div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => setShowWallet(true)} title="Wallet">💰</button>
            {mp.gamePhase === 'playing' && (
              <>
                <button className="icon-btn" onClick={mp.offerDraw} title="Offer Draw">🤝</button>
                <button className="icon-btn danger" onClick={mp.resign} title="Resign">🏳️</button>
              </>
            )}
          </div>
        </div>

        {/* Message toast */}
        {mp.message && <div className="game-toast">{mp.message}</div>}

        {/* 3D Board */}
        <ChessBoard
          ref={boardRef}
          fen={mp.fen}
          myColor={mp.myColor}
          isMyTurn={isMyTurn}
          disabled={isProcessing || mp.gamePhase !== 'playing'}
          isCheck={mp.isCheck}
          lastMove={lastMove}
          onMove={handleMove}
        />

        {/* View controls — centered above stats */}
        <div className="view-controls">
          <button className="view-btn" onClick={() => boardRef.current?.resetView()}>↺ Reset View</button>
          <button className="view-btn" onClick={() => boardRef.current?.topView()}>⬇ Top View</button>
        </div>

        {/* Bottom stats bar */}
        <div className="floating-bar bottom-bar">
          <div className="stats-row">
            <div className="player-badge you">
              <span className="badge-dot" style={{ background: mp.myColor === 'white' ? '#f5e6cc' : '#1e1a16' }} />
              <span className="badge-name">{username}</span>
              <span className="badge-balance">{balance.toLocaleString()} sats</span>
            </div>

            <div className="econ-strip">
              <div className="econ-item">
                <span className="econ-label">Deposit</span>
                <span className="econ-val">{mp.depositSats.toLocaleString()}</span>
              </div>
              <div className="econ-divider" />
              <div className="econ-item">
                <span className="econ-label">Base</span>
                <span className="econ-val">{mp.baseSats.toLocaleString()}</span>
              </div>
              <div className="econ-divider" />
              <div className="econ-item pot">
                <span className="econ-label">Pot</span>
                <span className="econ-val">{mp.pot.toLocaleString()}</span>
              </div>
            </div>

            {mp.escrowAddress && (
              <a className="escrow-link" href={`https://whatsonchain.com/address/${mp.escrowAddress}`} target="_blank" rel="noopener">
                🔒 {mp.escrowAddress.slice(0, 6)}…{mp.escrowAddress.slice(-4)} ↗
              </a>
            )}
          </div>

          <div className="moves-row">
            <MoveHistory moves={moveHistory} moveCostSats={mp.baseSats} />
          </div>
        </div>
      </div>

      {/* Modals */}
      {mp.gamePhase === 'paused' && (
        <PausedModal pauseMessage={mp.pauseMessage} walletAddress={walletAddress}
          onFundsAdded={() => { refreshBalance(); mp.notifyFundsAdded(); }}
          onForfeit={mp.resign} />
      )}

      {mp.gamePhase === 'gameover' && (
        <GameOverModal winner={mp.winner} myColor={mp.myColor} message={mp.message}
          pot={mp.pot} payout={payout} opponentName={mp.opponentName}
          onPlayAgain={handleResetGame} />
      )}

      {showDrawOffer && (
        <DrawOfferModal
          onAccept={() => { mp.acceptDraw(); setShowDrawOffer(false); }}
          onDecline={() => { mp.declineDraw(); setShowDrawOffer(false); }}
        />
      )}
    </div>
  );
}
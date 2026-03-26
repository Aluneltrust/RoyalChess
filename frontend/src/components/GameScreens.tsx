// ============================================================================
// GAME SCREENS — PIN, Connect, Lobby, Matchmaking, Modals for BSV Chess
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  Wallet, Trophy, Clock, Lock, Coins, Landmark,
  Check, Pause, RefreshCw, Eye, Crown, Flag,
  Swords, Shield, ChevronRight, Users,
} from 'lucide-react';
import { STAKE_TIERS, BACKEND_URL } from '../constants';

// ============================================================================
// PIN UNLOCK SCREEN
// ============================================================================

interface PinUnlockProps {
  addressHint: string | null;
  pinInput: string;
  setPinInput: (v: string) => void;
  pinError: string;
  onUnlock: (pin: string) => void;
  onDelete: () => void;
}

export function PinUnlockScreen({ addressHint, pinInput, setPinInput, pinError, onUnlock, onDelete }: PinUnlockProps) {
  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="game-logo">♟️</div>
        <h1 className="game-title">BSV CHESS</h1>
        <p className="game-subtitle">Enter PIN to unlock your wallet</p>

        {addressHint && (
          <div className="address-hint">{addressHint.slice(0, 8)}...{addressHint.slice(-6)}</div>
        )}

        <div className="pin-input-group">
          <div className="pin-field">
            <span className="pin-label">Enter PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="• • • •"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pinInput.length === 4) onUnlock(pinInput); }}
              autoFocus
              className="pin-input"
            />
          </div>
          <button className="btn btn-primary" onClick={() => onUnlock(pinInput)} disabled={pinInput.length !== 4}>
            Unlock
          </button>
        </div>

        {pinError && <div className="pin-error">{pinError}</div>}

        <div className="pin-footer">
          <button className="btn btn-small btn-text" onClick={() => {
            if (confirm('Delete your encrypted wallet? Make sure you backed up your WIF!')) onDelete();
          }}>
            Forgot PIN? Reset wallet
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PIN SETUP SCREEN
// ============================================================================

interface PinSetupProps {
  pinInput: string;
  setPinInput: (v: string) => void;
  pinConfirm: string;
  setPinConfirm: (v: string) => void;
  pinError: string;
  isProcessing: boolean;
  onSubmit: (pin: string) => void;
}

export function PinSetupScreen({ pinInput, setPinInput, pinConfirm, setPinConfirm, pinError, isProcessing, onSubmit }: PinSetupProps) {
  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="game-logo">♟️</div>
        <h1 className="game-title">BSV CHESS</h1>
        <p className="game-subtitle">Create a PIN for your new wallet</p>

        <div className="pin-input-group">
          <div className="pin-field">
            <span className="pin-label">Choose PIN</span>
            <input type="password" inputMode="numeric" maxLength={4} placeholder="• • • •"
              value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              autoFocus className="pin-input" />
          </div>
          <div className="pin-field">
            <span className="pin-label">Confirm PIN</span>
            <input type="password" inputMode="numeric" maxLength={4} placeholder="• • • •"
              value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pinInput.length === 4 && pinConfirm.length === 4 && pinInput === pinConfirm) onSubmit(pinInput); }}
              className="pin-input" />
          </div>
          <button className="btn btn-primary" onClick={() => onSubmit(pinInput)}
            disabled={pinInput.length !== 4 || pinConfirm.length !== 4 || pinInput !== pinConfirm || isProcessing}>
            {isProcessing ? 'Encrypting...' : 'Set PIN'}
          </button>
        </div>

        {pinError && <div className="pin-error">{pinError}</div>}

        <div className="security-notice">
          <strong>You own this wallet.</strong> Your private key is generated in your browser, encrypted with your PIN, and never leaves your device. Back up your WIF from the wallet page after setup.
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CONNECT SCREEN — No wallet
// ============================================================================

interface ConnectScreenProps {
  isProcessing: boolean;
  onCreateWallet: () => void;
  onImportWif: (wif: string) => void;
}

export function ConnectScreen({ isProcessing, onCreateWallet, onImportWif }: ConnectScreenProps) {
  const [showImport, setShowImport] = useState(false);
  const [importWif, setImportWif] = useState('');

  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="game-logo">♟️</div>
        <h1 className="game-title">BSV CHESS</h1>
        <p className="game-subtitle">On-Chain Multiplayer Chess</p>
        <p className="game-description">
          Every move costs real satoshis. Checkmate your opponent to win the pot.
          All payments settle live on the BSV blockchain.
        </p>

        <button className="btn btn-primary btn-large" onClick={onCreateWallet} disabled={isProcessing}>
          {isProcessing ? 'Creating...' : 'Create Wallet & Play'}
        </button>

        <div className="connect-divider"><span>or</span></div>

        {!showImport ? (
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
            Import Existing Wallet
          </button>
        ) : (
          <div className="import-group">
            <input type="password" placeholder="Paste your WIF key..." value={importWif}
              onChange={(e) => setImportWif(e.target.value)} className="wif-input" />
            <button className="btn btn-primary" onClick={() => { if (importWif) onImportWif(importWif); }}
              disabled={!importWif}>
              Import
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// LOBBY SCREEN
// ============================================================================

interface LobbyScreenProps {
  username: string;
  walletAddress: string;
  balance: number;
  selectedTier: number;
  bsvPrice: number;
  lobbyPlayers: { address: string; username: string; status: string; gamesWon: number; gamesPlayed: number }[];
  incomingChallenge: { id: string; fromUsername: string; fromAddress: string; stakeTier: number } | null;
  onSaveUsername: (name: string) => void;
  onSelectTier: (tier: number) => void;
  onFindMatch: () => void;
  onShowWallet: () => void;
  onRefreshBalance: () => void;
  onChallengePlayer: (toAddress: string, stakeTier: number) => void;
  onAcceptChallenge: (challengeId: string) => void;
  onDeclineChallenge: (challengeId: string) => void;
}

export function LobbyScreen(props: LobbyScreenProps) {
  const { username, walletAddress, balance, selectedTier, bsvPrice,
    lobbyPlayers, incomingChallenge,
    onSaveUsername, onSelectTier, onFindMatch, onShowWallet, onRefreshBalance,
    onChallengePlayer, onAcceptChallenge, onDeclineChallenge } = props;
  const [editName, setEditName] = useState(username);

  // Sync editName when username prop updates (e.g. from bridge)
  useEffect(() => {
    if (username && username !== editName) setEditName(username);
  }, [username]);

  // Filter out self from lobby
  const otherPlayers = lobbyPlayers.filter(p => p.address !== walletAddress);

  return (
    <div className="lobby-screen">
      <div className="lobby-card">
        <h1 className="lobby-title">♟️ BSV Chess</h1>

        {/* Username */}
        <div className="username-section">
          <input type="text" placeholder="Your name" value={editName} maxLength={20}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => { if (editName.trim()) onSaveUsername(editName.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && editName.trim()) onSaveUsername(editName.trim()); }}
            className="username-input" />
        </div>

        {/* Balance */}
        <div className="balance-display" onClick={onRefreshBalance}>
          <Wallet size={16} /> {balance.toLocaleString()} sats
          <button className="btn btn-tiny" onClick={(e) => { e.stopPropagation(); onShowWallet(); }}>
            Manage
          </button>
        </div>

        {/* Incoming Challenge */}
        {incomingChallenge && (
          <div className="challenge-incoming">
            <Shield size={16} />
            <span><strong>{incomingChallenge.fromUsername}</strong> challenges you! ({incomingChallenge.stakeTier}¢)</span>
            <button className="btn btn-primary btn-small" onClick={() => onAcceptChallenge(incomingChallenge.id)}>Accept</button>
            <button className="btn btn-secondary btn-small" onClick={() => onDeclineChallenge(incomingChallenge.id)}>Decline</button>
          </div>
        )}

        {/* Tier Selection */}
        <div className="tier-section">
          <h3>Select Stakes</h3>
          <div className="tier-grid">
            {STAKE_TIERS.map(tier => (
              <button key={tier.tier}
                className={`tier-btn ${selectedTier === tier.tier ? 'selected' : ''}`}
                onClick={() => onSelectTier(tier.tier)}>
                <span className="tier-name">{tier.name}</span>
                <span className="tier-amount">{tier.depositCents > 99 ? (tier.depositCents/100).toFixed(0) + " dollar" : tier.depositCents + "¢"} deposit</span>
                <span className="tier-move">King={tier.baseCents > 99 ? "$" + (tier.baseCents/100).toFixed(0) : tier.baseCents + "¢"}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Find Match */}
        <button className="btn btn-primary btn-large" onClick={onFindMatch}
          disabled={!username || balance < 250}>
          <Swords size={18} /> Find Match
        </button>

        {balance < 250 && (
          <div className="balance-warning">
            Need funds to play. Open wallet to receive BSV.
          </div>
        )}

        {/* Online Players */}
        <div className="players-list">
          <h3>Online Players ({lobbyPlayers.length})</h3>
          {lobbyPlayers.length === 0 ? (
            <p className="no-players">No other players online. Use Find Match to queue up!</p>
          ) : (
            lobbyPlayers.map(p => (
              <div key={p.address} className="player-row">
                <span className="name">{p.username}</span>
                <span className="stats">{p.gamesWon}W / {p.gamesPlayed}G</span>
                {p.address !== walletAddress && p.status === 'idle' && (
                  <button className="challenge-btn"
                    onClick={() => onChallengePlayer(p.address, selectedTier)}>
                    Challenge
                  </button>
                )}
                {p.status === 'in_game' && <span className="stats">In game</span>}
                {p.status === 'matchmaking' && <span className="stats">Searching...</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MATCHMAKING SCREEN
// ============================================================================

export function MatchmakingScreen({ selectedTier, onCancel }: { selectedTier: number; onCancel: () => void }) {
  return (
    <div className="matchmaking-screen">
      <div className="matchmaking-card">
        <div className="spinner-icon">♟️</div>
        <h2>Finding Opponent...</h2>
        <p>Stake: {selectedTier}¢</p>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ============================================================================
// WAGER SCREEN — Pay before game starts
// ============================================================================

interface WagerScreenProps {
  wagerSats: number;
  opponentName: string;
  myWagerPaid: boolean;
  opponentWagerPaid: boolean;
  isProcessing: boolean;
  onPayWager: () => void;
}

export function WagerScreen({ wagerSats, opponentName, myWagerPaid, opponentWagerPaid, isProcessing, onPayWager }: WagerScreenProps) {
  return (
    <div className="wager-screen">
      <div className="wager-card">
        <h2>♟️ Match Found!</h2>
        <p>vs <strong>{opponentName}</strong></p>

        <div className="wager-info">
          <Coins size={20} /> Deposit: <strong>{wagerSats.toLocaleString()} sats</strong>
        </div>

        <div className="wager-status">
          <div className={`wager-player ${myWagerPaid ? 'paid' : ''}`}>
            {myWagerPaid ? <Check size={16} /> : <Clock size={16} />}
            You: {myWagerPaid ? 'Paid' : 'Pending'}
          </div>
          <div className={`wager-player ${opponentWagerPaid ? 'paid' : ''}`}>
            {opponentWagerPaid ? <Check size={16} /> : <Clock size={16} />}
            {opponentName}: {opponentWagerPaid ? 'Paid' : 'Pending'}
          </div>
        </div>

        {!myWagerPaid && (
          <button className="btn btn-primary btn-large" onClick={onPayWager} disabled={isProcessing}>
            {isProcessing ? 'Paying...' : `Pay ${wagerSats.toLocaleString()} sats`}
          </button>
        )}

        {myWagerPaid && !opponentWagerPaid && (
          <p className="waiting-text">Waiting for {opponentName} to pay...</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// GAME OVER MODAL
// ============================================================================

interface GameOverModalProps {
  winner: 'white' | 'black' | 'draw' | null;
  myColor: 'white' | 'black';
  message: string;
  pot: number;
  payout: number;
  opponentName: string;
  onPlayAgain: () => void;
}

export function GameOverModal({ winner, myColor, message, pot, payout, opponentName, onPlayAgain }: GameOverModalProps) {
  const iWon = winner === myColor;
  const isDraw = winner === 'draw';

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-emoji">
          {isDraw ? <Users size={56} /> : iWon ? <Crown size={56} className="icon-gold" /> : <Flag size={56} className="icon-red" />}
        </div>
        <h2>{isDraw ? 'DRAW!' : iWon ? 'VICTORY!' : 'DEFEAT!'}</h2>
        <p>{message}</p>

        <div className="pot-breakdown">
          <div className="pot-title"><Coins size={16} /> Pot: {pot.toLocaleString()} sats</div>
          {payout > 0 && (
            <div className="payout-info">
              {isDraw ? 'Your share' : 'You receive'}: <strong>{payout.toLocaleString()} sats</strong>
            </div>
          )}
        </div>

        <button className="btn btn-primary" onClick={onPlayAgain}>
          <RefreshCw size={14} /> Play Again
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// PAUSED MODAL
// ============================================================================

interface PausedModalProps {
  pauseMessage: string;
  walletAddress: string;
  onFundsAdded: () => void;
  onForfeit: () => void;
}

export function PausedModal({ pauseMessage, walletAddress, onFundsAdded, onForfeit }: PausedModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <Pause size={48} />
        <h2>Game Paused</h2>
        <p>{pauseMessage}</p>
        <div className="wallet-address-full" onClick={() => navigator.clipboard.writeText(walletAddress)}>
          {walletAddress}
        </div>
        <button className="btn btn-primary" onClick={onFundsAdded}><Check size={14} /> I've Added Funds</button>
        <button className="btn btn-secondary" onClick={onForfeit}>Resign</button>
      </div>
    </div>
  );
}

// ============================================================================
// DRAW OFFER MODAL
// ============================================================================

interface DrawOfferModalProps {
  onAccept: () => void;
  onDecline: () => void;
}

export function DrawOfferModal({ onAccept, onDecline }: DrawOfferModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <Users size={48} />
        <h2>Draw Offered</h2>
        <p>Your opponent is offering a draw. Accept?</p>
        <div className="modal-buttons">
          <button className="btn btn-primary" onClick={onAccept}>Accept Draw</button>
          <button className="btn btn-secondary" onClick={onDecline}>Decline</button>
        </div>
      </div>
    </div>
  );
}
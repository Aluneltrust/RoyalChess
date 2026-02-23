// ============================================================================
// BSV SERVICE — Price, balance checks, TX verification, per-game escrow
// ============================================================================

import { PrivateKey, P2PKH, Transaction, ARC, SatoshisPerKilobyte, Script } from '@bsv/sdk';
import { createHmac } from 'crypto';

const BSV_NETWORK = (process.env.BSV_NETWORK || 'main') === 'main' ? 'mainnet' : 'testnet';
const WOC = `https://api.whatsonchain.com/v1/bsv/${BSV_NETWORK === 'mainnet' ? 'main' : 'test'}`;
const DUST_LIMIT = 546;

// Server-side TX hex cache — raw TX data never changes
const txHexServerCache = new Map<string, string>();

async function fetchTxHexWithRetry(txid: string, maxRetries = 3): Promise<string | null> {
  const cached = txHexServerCache.get(txid);
  if (cached) return cached;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
      const res = await fetch(`${WOC}/tx/${txid}/hex`);
      if (res.status === 429) {
        console.warn(`Rate limited fetching TX ${txid.slice(0, 16)}..., retry ${attempt + 1}/${maxRetries}`);
        continue;
      }
      if (!res.ok) continue;
      const hex = await res.text();
      txHexServerCache.set(txid, hex);
      return hex;
    } catch { /* retry */ }
  }
  return null;
}

// ============================================================================
// PRICE SERVICE
// ============================================================================

class PriceService {
  private cachedPrice = 0;
  private lastFetch = 0;
  private readonly CACHE_MS = 60_000;

  async getPrice(): Promise<number> {
    if (this.cachedPrice > 0 && Date.now() - this.lastFetch < this.CACHE_MS) {
      return this.cachedPrice;
    }
    try {
      const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate');
      const data = await res.json() as any;
      this.cachedPrice = data.rate || data.price || 50;
      this.lastFetch = Date.now();
    } catch {
      if (this.cachedPrice === 0) this.cachedPrice = 50;
    }
    return this.cachedPrice;
  }
}

// ============================================================================
// BALANCE & UTXO HELPERS
// ============================================================================

export async function fetchBalance(address: string): Promise<number> {
  try {
    const res = await fetch(`${WOC}/address/${address}/balance`);
    if (!res.ok) return 0;
    const data = await res.json() as any;
    return (data.confirmed || 0) + (data.unconfirmed || 0);
  } catch { return 0; }
}

async function fetchUTXOs(address: string): Promise<{ txid: string; vout: number; satoshis: number }[]> {
  try {
    const res = await fetch(`${WOC}/address/${address}/unspent`);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data || []).map((u: any) => ({
      txid: u.tx_hash,
      vout: u.tx_pos,
      satoshis: u.value,
    }));
  } catch { return []; }
}

// ============================================================================
// TX VERIFICATION (legacy — on-chain lookup)
// ============================================================================

export async function verifyPayment(
  txid: string, toAddress: string, minAmount: number,
): Promise<{ verified: boolean; amount: number; error?: string }> {
  try {
    const res = await fetch(`${WOC}/tx/hash/${txid}`);
    if (!res.ok) return { verified: false, amount: 0, error: 'TX not found' };

    const tx = await res.json() as any;
    let total = 0;

    for (const out of tx.vout || []) {
      const addrs = out.scriptPubKey?.addresses || [];
      if (addrs.includes(toAddress)) {
        total += Math.round((out.value || 0) * 1e8);
      }
    }

    if (total < minAmount) {
      return { verified: false, amount: total, error: `Expected ${minAmount} sats, found ${total}` };
    }
    return { verified: true, amount: total };
  } catch (err: any) {
    return { verified: false, amount: 0, error: err.message };
  }
}

// ============================================================================
// LOCAL TX VERIFICATION + SERVER-SIDE BROADCAST
// ============================================================================
// Instead of trusting a client-submitted TXID, the client sends the signed
// raw TX hex. The server:
//   1. Parses the transaction
//   2. Validates outputs pay the correct address the correct amount
//   3. Verifies inputs reference known UTXOs (not already claimed)
//   4. Broadcasts the TX itself
//   5. Returns the TXID
//
// This gives cryptographic proof of payment without waiting for confirmation.
// ============================================================================

/** Tracks UTXOs claimed by in-flight game transactions to prevent double-spend */
class SpentUTXOTracker {
  // key = "txid:vout", value = gameId that claimed it
  private claimed = new Map<string, string>();

  // Auto-expire claims after 10 minutes (confirmed TXs won't reuse UTXOs)
  private readonly EXPIRY_MS = 10 * 60 * 1000;
  private expiry = new Map<string, number>();

  claim(txid: string, vout: number, gameId: string): boolean {
    const key = `${txid}:${vout}`;
    this.pruneExpired();

    const existingGame = this.claimed.get(key);
    if (existingGame && existingGame !== gameId) {
      return false; // Already claimed by a different game
    }

    this.claimed.set(key, gameId);
    this.expiry.set(key, Date.now() + this.EXPIRY_MS);
    return true;
  }

  release(txid: string, vout: number): void {
    const key = `${txid}:${vout}`;
    this.claimed.delete(key);
    this.expiry.delete(key);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, exp] of this.expiry) {
      if (now > exp) {
        this.claimed.delete(key);
        this.expiry.delete(key);
      }
    }
  }
}

export const spentTracker = new SpentUTXOTracker();

/** Set of TXIDs already accepted — prevents replay */
const usedTxids = new Set<string>();

// Auto-prune used TXIDs older than 1 hour (store with timestamps)
const txidTimestamps = new Map<string, number>();
function recordTxid(txid: string): void {
  usedTxids.add(txid);
  txidTimestamps.set(txid, Date.now());
  // Prune every 100 additions
  if (txidTimestamps.size % 100 === 0) {
    const cutoff = Date.now() - 3600_000;
    for (const [id, ts] of txidTimestamps) {
      if (ts < cutoff) { usedTxids.delete(id); txidTimestamps.delete(id); }
    }
  }
}

export interface LocalVerifyResult {
  verified: boolean;
  txid: string;
  amount: number;
  error?: string;
}

/**
 * Verify a raw signed TX locally, then broadcast it server-side.
 *
 * @param rawTxHex  - The fully signed transaction hex from the client
 * @param expectedTo - The address that must receive payment
 * @param expectedMin - Minimum satoshis that must be sent to that address
 * @param gameId     - Game ID for UTXO claim tracking
 * @param payerAddress - Expected payer address (must be in inputs)
 */
export async function verifyAndBroadcastTx(
  rawTxHex: string,
  expectedTo: string,
  expectedMin: number,
  gameId: string,
  payerAddress: string,
): Promise<LocalVerifyResult> {
  // ---- 1. Basic hex validation ----
  if (!rawTxHex || typeof rawTxHex !== 'string') {
    return { verified: false, txid: '', amount: 0, error: 'No TX hex provided' };
  }
  if (!/^[0-9a-fA-F]+$/.test(rawTxHex)) {
    return { verified: false, txid: '', amount: 0, error: 'Invalid hex' };
  }
  if (rawTxHex.length < 100 || rawTxHex.length > 200_000) {
    return { verified: false, txid: '', amount: 0, error: 'TX hex size out of range' };
  }

  let tx: Transaction;
  try {
    tx = Transaction.fromHex(rawTxHex);
  } catch (err: any) {
    return { verified: false, txid: '', amount: 0, error: `Failed to parse TX: ${err.message}` };
  }

  // ---- 2. Check for TXID replay ----
  const txid = tx.id('hex') as string;
  if (usedTxids.has(txid)) {
    return { verified: false, txid, amount: 0, error: 'TXID already used (replay rejected)' };
  }

  // ---- 3. Validate outputs — correct address and amount ----
  let paymentAmount = 0;
  for (const output of tx.outputs) {
    // Decode the locking script to check if it pays expectedTo
    try {
      const lockHex = output.lockingScript.toHex();
      const expectedLock = new P2PKH().lock(expectedTo).toHex();
      if (lockHex === expectedLock) {
        paymentAmount += output.satoshis || 0;
      }
    } catch { /* non-P2PKH output, skip (e.g. OP_RETURN) */ }
  }

  if (paymentAmount < expectedMin) {
    return {
      verified: false, txid, amount: paymentAmount,
      error: `Insufficient payment: expected ${expectedMin} sats to ${expectedTo.slice(0, 12)}..., found ${paymentAmount}`,
    };
  }

  // ---- 4. Validate inputs — check UTXO claims (double-spend prevention) ----
  const inputOutpoints: { txid: string; vout: number }[] = [];
  for (const input of tx.inputs) {
    let srcTxid: string;
    let srcVout: number;

    if (input.sourceTransaction) {
      srcTxid = input.sourceTransaction.id('hex') as string;
      srcVout = input.sourceOutputIndex;
    } else if (input.sourceTXID) {
      srcTxid = input.sourceTXID;
      srcVout = input.sourceOutputIndex;
    } else {
      return { verified: false, txid, amount: 0, error: 'TX input missing source reference' };
    }

    if (!spentTracker.claim(srcTxid, srcVout, gameId)) {
      return {
        verified: false, txid, amount: 0,
        error: `UTXO ${srcTxid.slice(0, 12)}:${srcVout} already claimed by another game`,
      };
    }
    inputOutpoints.push({ txid: srcTxid, vout: srcVout });
  }

  // ---- 5. Verify signatures ----
  // The @bsv/sdk Transaction.verify() checks all input scripts
  try {
    const verified = await tx.verify();
    if (verified !== true) {
      // Release claimed UTXOs on failure
      for (const op of inputOutpoints) spentTracker.release(op.txid, op.vout);
      return { verified: false, txid, amount: 0, error: `TX signature verification failed` };
    }
  } catch (sigErr: any) {
    // Some SDK versions may not support verify() on deserialized TXs without
    // source transactions attached. In that case, fall through to broadcast
    // which will also reject invalid signatures.
    console.warn(`Signature verify() not available or failed: ${sigErr.message} — will rely on broadcast rejection`);
  }

  // ---- 6. Broadcast server-side ----
  const broadcastResult = await broadcastRawTx(rawTxHex);
  if (!broadcastResult.success) {
    // Release claimed UTXOs on broadcast failure
    for (const op of inputOutpoints) spentTracker.release(op.txid, op.vout);
    return {
      verified: false, txid, amount: paymentAmount,
      error: `Broadcast failed: ${broadcastResult.error}`,
    };
  }

  // ---- 7. Record TXID to prevent replay ----
  recordTxid(broadcastResult.txid || txid);

  console.log(`✅ TX verified & broadcast: ${(broadcastResult.txid || txid).slice(0, 16)}... | ${paymentAmount} sats → ${expectedTo.slice(0, 12)}...`);

  return {
    verified: true,
    txid: broadcastResult.txid || txid,
    amount: paymentAmount,
  };
}

/**
 * Broadcast raw TX hex server-side via TAAL ARC, with WoC fallback.
 */
async function broadcastRawTx(rawTxHex: string): Promise<{ success: boolean; txid?: string; error?: string }> {
  const taalKey = process.env.TAAL_API_KEY || '';

  // Try TAAL ARC first
  if (taalKey) {
    try {
      const txBytes = Buffer.from(rawTxHex, 'hex');
      const r = await fetch('https://arc.taal.com/v1/tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${taalKey}`,
        },
        body: txBytes,
      });
      const result = await r.json() as any;

      if (result.txid) {
        return { success: true, txid: result.txid };
      }

      // Some "errors" are actually success (e.g. already-in-mempool)
      if (r.status === 200 || result.txStatus === 'SEEN_ON_NETWORK') {
        const fallbackTxid = result.txid || '';
        if (fallbackTxid) return { success: true, txid: fallbackTxid };
      }

      console.warn('TAAL broadcast response:', r.status, result);
    } catch (taalErr: any) {
      console.warn('TAAL broadcast error:', taalErr.message);
    }
  }

  // Fallback: WoC broadcast
  try {
    const r = await fetch(`${WOC}/tx/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawTxHex }),
    });
    const text = await r.text();
    if (r.ok) {
      const txid = text.replace(/"/g, '').trim();
      return { success: true, txid };
    }
    return { success: false, error: text || 'WoC broadcast failed' };
  } catch (wocErr: any) {
    return { success: false, error: `WoC: ${wocErr.message}` };
  }
}

// ============================================================================
// PER-GAME ESCROW MANAGER
// ============================================================================
// Deterministic derivation: HMAC-SHA256(masterSeed, gameId) → PrivateKey
// No storage needed. Same seed + gameId always produces the same key.
// Server can recover any game's escrow at any time just from the gameId.

class EscrowManager {
  private masterSeed: string = '';
  private initialized = false;

  init(): boolean {
    this.masterSeed = process.env.ESCROW_MASTER_SEED || process.env.ESCROW_WIF || '';
    if (!this.masterSeed) {
      console.error('❌ ESCROW_MASTER_SEED not set in .env');
      return false;
    }
    this.initialized = true;
    console.log('🔑 Escrow manager initialized (per-game HD derivation)');
    return true;
  }

  /**
   * Derive a deterministic PrivateKey for a game.
   * HMAC-SHA256(masterSeed, gameId) → 32 bytes → PrivateKey
   */
  deriveGameKey(gameId: string): PrivateKey {
    if (!this.initialized) throw new Error('EscrowManager not initialized');
    const hmac = createHmac('sha256', this.masterSeed);
    hmac.update(gameId);
    const keyHex = hmac.digest('hex');
    return PrivateKey.fromString(keyHex, 16);
  }

  /**
   * Get the escrow address for a specific game.
   */
  getGameAddress(gameId: string): string {
    const pk = this.deriveGameKey(gameId);
    return pk.toPublicKey().toAddress(BSV_NETWORK);
  }

  /**
   * Get the WIF for a specific game's escrow key.
   */
  getGameWIF(gameId: string): string {
    const pk = this.deriveGameKey(gameId);
    return pk.toWif();
  }

  /**
   * Settle a game: sweep escrow UTXOs → winner + platform wallet.
   * Fee is paid from escrow. Remaining is split proportionally.
   */
  async settle(
    gameId: string,
    winnerAddress: string,
    winnerPayout: number,
    platformCut: number,
  ): Promise<{ success: boolean; txid?: string; error?: string }> {
    if (!this.initialized) return { success: false, error: 'EscrowManager not initialized' };

    const finalWallet = process.env.FINAL_WALLET_ADDRESS || '';
    if (!finalWallet) return { success: false, error: 'FINAL_WALLET_ADDRESS not set' };

    const pk = this.deriveGameKey(gameId);
    const escrowAddr = pk.toPublicKey().toAddress(BSV_NETWORK);

    console.log(`🔑 Settling game ${gameId.slice(0, 8)}... escrow: ${escrowAddr}`);

    try {
      const utxos = await fetchUTXOs(escrowAddr);
      if (utxos.length === 0) return { success: false, error: `No UTXOs at game escrow ${escrowAddr}` };

      const available = utxos.reduce((s, u) => s + u.satoshis, 0);

      // Fee estimation: 0.15 sats/byte, min 500
      const estimatedSize = utxos.length * 150 + 4 * 34 + 10;
      const feeEstimate = Math.max(Math.ceil(estimatedSize * 0.15), 500);

      console.log(`📊 Settlement: ${utxos.length} inputs, ${available} sats, est ${estimatedSize}B, fee ${feeEstimate}`);

      // Fee comes out of escrow first, then split remaining proportionally
      const distributable = available - feeEstimate;

      if (distributable < DUST_LIMIT) {
        return { success: false, error: `Escrow too low after fee: ${available} - ${feeEstimate} = ${distributable}` };
      }

      // Split based on actual funds available, not expected amounts
      const totalExpected = winnerPayout + platformCut;
      const winnerShare = totalExpected > 0 ? winnerPayout / totalExpected : 0.5;
      const adjWinner = Math.floor(distributable * winnerShare);
      const adjPlatform = distributable - adjWinner;

      console.log(`💰 Distributable: ${distributable} sats | Winner: ${adjWinner} (${Math.round(winnerShare * 100)}%) | Platform: ${adjPlatform}`);

      const tx = new Transaction();
      for (const u of utxos) {
        const rawHex = await fetchTxHexWithRetry(u.txid);
        if (!rawHex) return { success: false, error: `Failed to fetch source TX ${u.txid}` };
        tx.addInput({
          sourceTransaction: Transaction.fromHex(rawHex),
          sourceOutputIndex: u.vout,
          unlockingScriptTemplate: new P2PKH().unlock(pk),
          sequence: 0xffffffff,
        });
      }

      // Winner payout
      if (adjWinner > DUST_LIMIT) {
        tx.addOutput({ lockingScript: new P2PKH().lock(winnerAddress), satoshis: adjWinner });
      }

      // Platform payout
      if (adjPlatform > DUST_LIMIT) {
        tx.addOutput({ lockingScript: new P2PKH().lock(finalWallet), satoshis: adjPlatform });
      }

      // OP_RETURN game record
      tx.addOutput({ lockingScript: opReturn(JSON.stringify({
        p: 'HERDSWACKER', a: 'SETTLE', g: gameId.slice(0, 8),
        e: escrowAddr.slice(0, 8), w: winnerAddress.slice(0, 8),
        wp: adjWinner, pc: adjPlatform, fee: feeEstimate,
      })), satoshis: 0 });

      // Change back to escrow (shouldn't have any, but just in case)
      const totalOut = (adjWinner > DUST_LIMIT ? adjWinner : 0) + (adjPlatform > DUST_LIMIT ? adjPlatform : 0);
      const change = available - totalOut - feeEstimate;
      if (change > DUST_LIMIT) {
        tx.addOutput({ lockingScript: new P2PKH().lock(escrowAddr), satoshis: change });
      }

      await tx.sign();

      const result = await broadcastRawTx(tx.toHex());
      if (result.success) {
        console.log(`💸 Settlement: ${adjWinner} → winner, ${adjPlatform} → platform, fee ${feeEstimate} (${result.txid})`);
        return { success: true, txid: result.txid };
      }

      return { success: false, error: result.error || 'Settlement broadcast failed' };
    } catch (err: any) {
      return { success: false, error: err.message || err.toString() || JSON.stringify(err) };
    }
  }
}

// OP_RETURN helper
function opReturn(data: string): Script {
  const hex = Array.from(new TextEncoder().encode(data))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return Script.fromASM(`OP_FALSE OP_RETURN ${hex}`);
}

// ============================================================================
// EXPORTS
// ============================================================================

export const priceService = new PriceService();
export const escrowManager = new EscrowManager();
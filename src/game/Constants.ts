// ============================================================================
// GAME CONSTANTS — BSV Chess — Single source of truth
// ============================================================================
//
// ECONOMIC MODEL:
//   - Players deposit tier value into escrow (forfeit protection)
//   - Moves are FREE — no per-move cost
//   - CAPTURES trigger payments: victim pays capturer based on piece value
//   - Capturer receives 97%, platform takes 3%
//   - Game end: winner gets opponent's deposit minus 3% platform cut
//   - Checkmate = king "capture" — loser pays king value to winner
// ============================================================================

// ============================================================================
// STAKE TIERS
// ============================================================================

export interface StakeTierDef {
  tier: number;          // ID matching cents value
  name: string;
  depositCents: number;  // each player's escrow deposit (forfeit protection)
  baseCents: number;     // base value = king capture cost (100% of tier)
}

export const STAKE_TIERS: StakeTierDef[] = [
  { tier: 1,    name: 'Penny',     depositCents: 1,    baseCents: 1    },
  { tier: 25,   name: 'Quarter',   depositCents: 25,   baseCents: 25   },
  { tier: 50,   name: 'Half',      depositCents: 50,   baseCents: 50   },
  { tier: 100,  name: 'Dollar',    depositCents: 100,  baseCents: 100  },
  { tier: 500,  name: 'Five',      depositCents: 500,  baseCents: 500  },
  { tier: 1000, name: 'Ten',       depositCents: 1000, baseCents: 1000 },
];

export function getTierByValue(tier: number): StakeTierDef | undefined {
  return STAKE_TIERS.find(t => t.tier === tier);
}

// ============================================================================
// PIECE CAPTURE VALUES (percentage of tier baseCents)
// ============================================================================

export type ChessPieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

export const PIECE_CAPTURE_PERCENT: Record<ChessPieceType, number> = {
  k: 100,  // King   = 100% of base (checkmate payout)
  q: 90,   // Queen  = 90%
  r: 80,   // Rook   = 80%
  b: 70,   // Bishop = 70%
  n: 70,   // Knight = 70%
  p: 20,   // Pawn   = 20%
};

/**
 * Calculate the capture cost in cents for a given piece at a given tier.
 * This is what the VICTIM pays when their piece is captured.
 */
export function getCaptureCostCents(piece: ChessPieceType, tier: StakeTierDef): number {
  return tier.baseCents * (PIECE_CAPTURE_PERCENT[piece] / 100);
}

/**
 * Calculate capture cost in satoshis.
 */
export function getCaptureCostSats(piece: ChessPieceType, tier: StakeTierDef, bsvPriceUsd: number): number {
  return centsToSats(getCaptureCostCents(piece, tier), bsvPriceUsd);
}

// ============================================================================
// PLATFORM CUT
// ============================================================================

export const PLATFORM_CUT_PERCENT = 3; // 3% on every capture + deposit payout

/**
 * Apply platform cut: returns { recipient amount, platform amount }
 */
export function applyPlatformCut(totalSats: number): { recipientSats: number; platformSats: number } {
  const platformSats = Math.ceil(totalSats * PLATFORM_CUT_PERCENT / 100);
  return { recipientSats: totalSats - platformSats, platformSats };
}

// ============================================================================
// PRICE CONVERSION
// ============================================================================

export function centsToSats(cents: number, bsvPriceUsd: number): number {
  if (bsvPriceUsd <= 0) throw new Error('Invalid BSV price');
  const dollars = cents / 100;
  const bsv = dollars / bsvPriceUsd;
  return Math.ceil(bsv * 100_000_000);
}

// ============================================================================
// BALANCE REQUIREMENTS
// ============================================================================
// Player needs: deposit + enough to cover losing ALL their pieces
// Worst case: lose queen(90) + 2 rooks(160) + 2 bishops(140) + 2 knights(140) + 8 pawns(160) = 790% of base
// Plus a TX fee buffer

const WORST_CASE_CAPTURE_PERCENT = 90 + 80*2 + 70*2 + 70*2 + 20*8; // = 790%

export function getMinBalanceCents(tier: StakeTierDef): number {
  const deposit = tier.depositCents;
  const worstCaseCaptures = tier.baseCents * (WORST_CASE_CAPTURE_PERCENT / 100);
  return Math.ceil((deposit + worstCaseCaptures) * 1.1); // 10% buffer
}

export function getMinBalanceSats(tier: StakeTierDef, bsvPriceUsd: number): number {
  return centsToSats(getMinBalanceCents(tier), bsvPriceUsd);
}

// ============================================================================
// GAME END REASONS
// ============================================================================

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'disconnect'
  | 'timeout'
  | 'insufficient_funds'
  | 'draw_agreement'
  | 'threefold_repetition'
  | 'fifty_move_rule'
  | 'insufficient_material';
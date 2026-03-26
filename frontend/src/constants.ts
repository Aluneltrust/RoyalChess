// ============================================================================
// FRONTEND CONSTANTS — BSV Chess
// ============================================================================

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
export const BSV_NETWORK = import.meta.env.VITE_BSV_NETWORK || 'main';

export interface StakeTierDef {
  tier: number;
  name: string;
  depositCents: number;
  baseCents: number;    // king capture = 100% of this
}

export const STAKE_TIERS: StakeTierDef[] = [
  { tier: 1,    name: 'Penny',   depositCents: 1,    baseCents: 1    },
  { tier: 25,   name: 'Quarter', depositCents: 25,   baseCents: 25   },
  { tier: 50,   name: 'Half',    depositCents: 50,   baseCents: 50   },
  { tier: 100,  name: 'Dollar',  depositCents: 100,  baseCents: 100  },
  { tier: 500,  name: 'Five',    depositCents: 500,  baseCents: 500  },
  { tier: 1000, name: 'Ten',     depositCents: 1000, baseCents: 1000 },
];

// Piece capture values (% of baseCents)
export const PIECE_CAPTURE_PERCENT: Record<string, number> = {
  k: 100, q: 90, r: 80, b: 70, n: 70, p: 20,
};

export const PLATFORM_CUT_PERCENT = 3;

export const STORAGE_KEYS = {
  USERNAME: 'bsv_chess_username',
  WALLET_ENC: 'bsv_chess_wallet_enc',
  WALLET_ADDR: 'bsv_chess_wallet_addr',
  GAME_ID: 'bsv_chess_game_id',
};
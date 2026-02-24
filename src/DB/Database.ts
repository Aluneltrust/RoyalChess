// ============================================================================
// DATABASE — PostgreSQL (Railway)
// ============================================================================

import { Pool } from 'pg';

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }
  return pool;
}

export async function initDatabase(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS players (
      address       TEXT PRIMARY KEY,
      username      TEXT NOT NULL DEFAULT 'Anonymous',
      games_played  INTEGER NOT NULL DEFAULT 0,
      games_won     INTEGER NOT NULL DEFAULT 0,
      games_drawn   INTEGER NOT NULL DEFAULT 0,
      total_winnings BIGINT NOT NULL DEFAULT 0,
      total_wagered  BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS games (
      id              TEXT PRIMARY KEY,
      stake_tier      INTEGER NOT NULL,
      white_address   TEXT NOT NULL,
      black_address   TEXT NOT NULL,
      winner_address  TEXT,
      end_reason      TEXT,
      pot             BIGINT NOT NULL DEFAULT 0,
      winner_payout   BIGINT NOT NULL DEFAULT 0,
      platform_cut    BIGINT NOT NULL DEFAULT 0,
      settle_txid     TEXT,
      white_moves     INTEGER DEFAULT 0,
      black_moves     INTEGER DEFAULT 0,
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      ended_at        TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_address);
    CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_address);
    CREATE INDEX IF NOT EXISTS idx_players_wins ON players(games_won DESC);
  `);
  console.log('✅ Database initialized (PostgreSQL)');
}

// ============================================================================
// PLAYERS
// ============================================================================

export async function ensurePlayer(address: string, username: string): Promise<void> {
  await getPool().query(
    `INSERT INTO players (address, username) VALUES ($1, $2)
     ON CONFLICT (address) DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()`,
    [address, username]
  );
}

export async function getPlayerStats(address: string): Promise<any | null> {
  const result = await getPool().query(
    `SELECT p.*,
     (SELECT json_agg(row_to_json(g) ORDER BY g.ended_at DESC)
      FROM (SELECT id, stake_tier, winner_address, pot, winner_payout, end_reason, ended_at
            FROM games WHERE (white_address=$1 OR black_address=$1) AND ended_at IS NOT NULL
            ORDER BY ended_at DESC LIMIT 10) g) as recent_games
     FROM players p WHERE p.address=$1`,
    [address]
  );
  return result.rows[0] || null;
}

// ============================================================================
// GAMES
// ============================================================================

export async function recordGameStart(
  gameId: string, stakeTier: number, whiteAddr: string, blackAddr: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO games (id, stake_tier, white_address, black_address, started_at) VALUES ($1,$2,$3,$4,NOW())`,
    [gameId, stakeTier, whiteAddr, blackAddr]
  );
}

export async function recordGameEnd(
  gameId: string,
  winnerAddress: string | null,
  endReason: string,
  pot: number,
  winnerPayout: number,
  platformCut: number,
  settleTxid: string,
  whiteStats: { moveCount: number },
  blackStats: { moveCount: number },
): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE games SET
        winner_address=$2, end_reason=$3, pot=$4,
        winner_payout=$5, platform_cut=$6, settle_txid=$7,
        white_moves=$8, black_moves=$9, ended_at=NOW()
       WHERE id=$1`,
      [gameId, winnerAddress, endReason, pot, winnerPayout, platformCut, settleTxid,
       whiteStats.moveCount, blackStats.moveCount]
    );

    const g = (await client.query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
    if (g) {
      // Update both players
      await client.query(
        `UPDATE players SET games_played=games_played+1, updated_at=NOW() WHERE address=$1`,
        [g.white_address]
      );
      await client.query(
        `UPDATE players SET games_played=games_played+1, updated_at=NOW() WHERE address=$1`,
        [g.black_address]
      );

      if (winnerAddress) {
        await client.query(
          `UPDATE players SET games_won=games_won+1, total_winnings=total_winnings+$2, updated_at=NOW() WHERE address=$1`,
          [winnerAddress, winnerPayout]
        );
      } else {
        // Draw
        await client.query(
          `UPDATE players SET games_drawn=games_drawn+1, updated_at=NOW() WHERE address=$1`,
          [g.white_address]
        );
        await client.query(
          `UPDATE players SET games_drawn=games_drawn+1, updated_at=NOW() WHERE address=$1`,
          [g.black_address]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// LEADERBOARD
// ============================================================================

export async function getLeaderboard(limit = 20): Promise<any[]> {
  const result = await getPool().query(
    `SELECT address, username, games_played, games_won, games_drawn, total_winnings,
     CASE WHEN games_played>0 THEN ROUND(games_won::numeric/games_played*100,1) ELSE 0 END as win_rate
     FROM players WHERE games_played>=1
     ORDER BY games_won DESC, win_rate DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}
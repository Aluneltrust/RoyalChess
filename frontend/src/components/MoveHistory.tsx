// ============================================================================
// MOVE HISTORY — PGN-style move list with TX links
// ============================================================================

import React from 'react';

interface Move {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  txid?: string;
}

interface MoveHistoryProps {
  moves: Move[];
  moveCostSats: number;
}

export default function MoveHistory({ moves, moveCostSats }: MoveHistoryProps) {
  if (moves.length === 0) return null;

  // Group into pairs (white, black)
  const pairs: { num: number; white?: Move; black?: Move }[] = [];
  for (let i = 0; i < moves.length; i++) {
    const moveNum = Math.floor(i / 2) + 1;
    if (i % 2 === 0) {
      pairs.push({ num: moveNum, white: moves[i] });
    } else {
      pairs[pairs.length - 1].black = moves[i];
    }
  }

  return (
    <div className="move-history">
      <h4>Moves ({moves.length})</h4>
      <div className="move-list">
        {pairs.map(({ num, white, black }) => (
          <div key={num} className="move-pair">
            <span className="move-num">{num}.</span>
            {white && (
              <span className="move-san white-move" title={white.txid ? `TX: ${white.txid.slice(0, 16)}...` : ''}>
                {white.san}
                {white.txid && (
                  <a href={`https://whatsonchain.com/tx/${white.txid}`} target="_blank"
                    rel="noopener" className="tx-link">↗</a>
                )}
              </span>
            )}
            {black && (
              <span className="move-san black-move" title={black.txid ? `TX: ${black.txid.slice(0, 16)}...` : ''}>
                {black.san}
                {black.txid && (
                  <a href={`https://whatsonchain.com/tx/${black.txid}`} target="_blank"
                    rel="noopener" className="tx-link">↗</a>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="move-cost-info">
        {moveCostSats > 0 && `${moveCostSats} sats/move • ${moves.length} moves = ${(moves.length * moveCostSats).toLocaleString()} sats`}
      </div>
    </div>
  );
}
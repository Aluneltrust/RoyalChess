// ============================================================================
// SESSION TOKEN MANAGER
// Issues short-lived tokens when players connect via socket.
// Validated on REST proxy endpoints to prevent unauthorized use.
// ============================================================================

import crypto from 'crypto';

interface Session {
  socketId: string;
  address: string;
  createdAt: number;
}

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

class SessionManager {
  private sessions: Map<string, Session> = new Map();

  /**
   * Create a session token for a connected socket.
   * Returns the token string.
   */
  create(socketId: string, address: string): string {
    // Remove any existing token for this socket
    this.revokeBySocket(socketId);

    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, { socketId, address, createdAt: Date.now() });
    return token;
  }

  /**
   * Validate a token. Returns the session if valid, null if not.
   */
  validate(token: string): Session | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    // Check expiry
    if (Date.now() - session.createdAt > TOKEN_TTL_MS) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  /**
   * Check if a token is valid (boolean shorthand).
   */
  isValid(token: string): boolean {
    return this.validate(token) !== null;
  }

  /**
   * Revoke all tokens for a disconnected socket.
   */
  revokeBySocket(socketId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.socketId === socketId) {
        this.sessions.delete(token);
      }
    }
  }

  /**
   * Periodic cleanup of expired tokens. Call every ~5 min.
   */
  prune(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now - session.createdAt > TOKEN_TTL_MS) {
        this.sessions.delete(token);
      }
    }
  }

  get activeCount(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new SessionManager();

// Prune expired sessions every 5 minutes
setInterval(() => sessionManager.prune(), 5 * 60 * 1000);
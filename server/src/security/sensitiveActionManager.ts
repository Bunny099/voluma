import crypto from 'crypto';

type SensitiveAction =
  | 'EXPORT_WALLET'
  | 'WITHDRAW_SOL'
  | 'WITHDRAW_TOKEN';

interface SensitiveVerification {
  userId: string;
  action: SensitiveAction;
  expiresAt: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1_000;

export class SensitiveActionManager {
  private readonly verifications = new Map<string, SensitiveVerification>();

  constructor() {
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  issue(userId: string, action: SensitiveAction): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + TOKEN_TTL_MS;

    this.verifications.set(token, {
      userId,
      action,
      expiresAt,
    });

    return { token, expiresAt };
  }

  consume(userId: string, action: SensitiveAction, token: string | undefined): boolean {
    if (!token) return false;

    const verification = this.verifications.get(token);
    if (!verification) return false;

    this.verifications.delete(token);

    return verification.userId === userId
      && verification.action === action
      && verification.expiresAt > Date.now();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, verification] of this.verifications) {
      if (verification.expiresAt <= now) {
        this.verifications.delete(token);
      }
    }
  }
}

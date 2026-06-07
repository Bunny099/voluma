import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';
import crypto from 'crypto';
import { TTLCache } from '../lib/ttl-cache';
import { RPCManager } from '../rpc/rpcManager';
import { walletRepo, type WalletRecord } from '../db/walletRepo';
import { pendingTxRepo } from '../db/pendingTxRepo';
import { walletActivityRepo, type WalletActivityLog } from '../db/walletActivityRepo';

export interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
}

export interface PendingTxInfo {
  txHash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  inputMint: string;
  outputMint: string;
  amountIn: number;
  createdAt: number;
  failureReason?: string | null;
}

export interface WalletSecurityInfo {
  encryptionVersion: number;
  supportsExport: boolean;
}

export interface WalletInfo {
  publicKey: string;
  createdAt: number;
  lastUsedAt: number | null;
  balanceSol: number | null;
  tokens: TokenBalance[];
  pendingTxs: PendingTxInfo[];
  recentActivity: WalletActivityLog[];
  security: WalletSecurityInfo;
}

interface EncryptionEnvelope {
  encryptedKey: string;
  iv: string;
  encryptionVersion: number;
  kdfSalt: string | null;
  authTag: string | null;
}

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const CONFIRM_TIMEOUT = 30_000;
const TRADE_CACHE_MAX = 5_000;
const BALANCE_CACHE_TTL_MS = 3_000;

export class WalletManager {
  private cache = new Map<string, WalletRecord>();
  private tradeCache = new Set<string>();
  private readonly balanceCache = new TTLCache<string, unknown>(BALANCE_CACHE_TTL_MS, 500);

  constructor(
    private readonly rpcManager: RPCManager,
    private readonly resolveSymbol: (mint: string) => string,
  ) {}

  async initialize(): Promise<void> {
    const records = await walletRepo.getAll();
    for (const record of records) {
      this.cache.set(record.userId, record);
    }
    console.info(`[WalletManager] Loaded ${this.cache.size} wallet(s) from DB`);
  }

  async createWallet(userId: string): Promise<{ publicKey: string }> {
    const existing = this.cache.get(userId);
    if (existing) return { publicKey: existing.publicKey };

    const keypair = Keypair.generate();
    const encrypted = encryptV2(keypair.secretKey);

    const record: WalletRecord = {
      userId,
      publicKey: keypair.publicKey.toBase58(),
      encryptedKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      encryptionVersion: encrypted.encryptionVersion,
      kdfSalt: encrypted.kdfSalt,
      authTag: encrypted.authTag,
      createdAt: Date.now(),
      lastUsedAt: null,
    };

    await walletRepo.insert(record);
    this.cache.set(userId, record);
    await walletActivityRepo.insert(userId, record.publicKey, 'WALLET_CREATED');

    return { publicKey: record.publicKey };
  }

  hasWallet(userId: string): boolean {
    return this.cache.has(userId);
  }

  getPublicKey(userId: string): string | null {
    return this.cache.get(userId)?.publicKey ?? null;
  }

  invalidateWallet(userId: string): void {
    this.balanceCache.delete(`balance:${userId}`);
    this.balanceCache.delete(`spl:${userId}`);
    this.balanceCache.delete(`spl2022:${userId}`);
  }

  getKeypair(userId: string): Keypair | null {
    const record = this.cache.get(userId);
    if (!record) return null;

    try {
      const secret = decryptRecord(record);
      walletRepo.touch(userId).catch((error) => {
        console.error('[WalletManager] touch failed:', error.message);
      });

      if (record.encryptionVersion < 2) {
        this.migrateLegacyEncryption(userId, record, secret).catch((error) => {
          console.error('[WalletManager] legacy migration failed:', error.message);
        });
      }

      return Keypair.fromSecretKey(secret);
    } catch {
      console.error('[WalletManager] Decryption failed for userId:', userId);
      return null;
    }
  }

  async getWalletInfo(userId: string): Promise<WalletInfo | null> {
    const record = this.cache.get(userId);
    if (!record) return null;

    const publicKey = new PublicKey(record.publicKey);
    const connection = this.rpcManager.getHttpConnection();

    const [lamports, tokenAccounts, token2022Accounts, allPending, recentActivity] = await Promise.all([
      this.balanceCache.getOrSet(
        `balance:${userId}`,
        () => connection.getBalance(publicKey, 'confirmed').catch(() => null),
      ) as Promise<number | null>,
      this.balanceCache.getOrSet(
        `spl:${userId}`,
        () => connection.getParsedTokenAccountsByOwner(
          publicKey,
          { programId: TOKEN_PROGRAM_ID },
          'confirmed',
        ).catch(() => null),
      ) as Promise<any>,
      this.balanceCache.getOrSet(
        `spl2022:${userId}`,
        () => connection.getParsedTokenAccountsByOwner(
          publicKey,
          { programId: TOKEN_2022_PROGRAM_ID },
          'confirmed',
        ).catch(() => null),
      ) as Promise<any>,
      pendingTxRepo.getByWallet(userId),
      walletActivityRepo.getRecentByUser(userId, 20),
    ]);

    const allTokenAccounts = [
      ...(tokenAccounts?.value ?? []),
      ...(token2022Accounts?.value ?? []),
    ];

    const tokens: TokenBalance[] = allTokenAccounts
      .map((account) => {
        const info = (account.account.data as any).parsed?.info;
        const uiAmount = info?.tokenAmount?.uiAmount as number | null;
        if (!info) return null;

        return {
          mint: info.mint as string,
          symbol: this.resolveSymbol(info.mint as string),
          balance: uiAmount ?? 0,
          decimals: info.tokenAmount.decimals as number,
        };
      })
      .filter((token): token is TokenBalance => token !== null && token.balance > 0);

    const pendingTxs: PendingTxInfo[] = allPending.map((tx) => ({
      txHash: tx.txHash,
      status: tx.status,
      inputMint: tx.inputMint ?? '',
      outputMint: tx.outputMint ?? '',
      amountIn: tx.rawAmountIn ?? 0,
      createdAt: tx.createdAt,
      failureReason: tx.failureReason,
    }));

    return {
      publicKey: record.publicKey,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      balanceSol: lamports !== null ? lamports / LAMPORTS_PER_SOL : null,
      tokens,
      pendingTxs,
      recentActivity,
      security: {
        encryptionVersion: record.encryptionVersion,
        supportsExport: true,
      },
    };
  }

  async exportWallet(userId: string): Promise<{
    publicKey: string;
    privateKeyBase58: string;
    secretKeyJson: string;
  }> {
    const keypair = this.getKeypair(userId);
    if (!keypair) throw new Error('No trading wallet found');

    return {
      publicKey: keypair.publicKey.toBase58(),
      privateKeyBase58: encodeBase58(keypair.secretKey),
      secretKeyJson: JSON.stringify([...keypair.secretKey]),
    };
  }

  async withdrawSOL(
    userId: string,
    destination: string,
    amountSol: number,
  ): Promise<{ txHash: string; status: 'PENDING' | 'CONFIRMED' }> {
    const keypair = this.getKeypair(userId);
    if (!keypair) throw new Error('No trading wallet found');

    const connection = this.rpcManager.getHttpConnection();
    const destPubkey = new PublicKey(destination);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: keypair.publicKey,
    }).add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: destPubkey,
        lamports,
      }),
    );
    tx.sign(keypair);

    const txHash = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });
    const confirm = await this.confirmWithTimeout(txHash);

    this.invalidateWallet(userId);

    if (!confirm.confirmed) {
      await pendingTxRepo.insert(
        txHash,
        userId,
        null,
        lamports,
        'So11111111111111111111111111111111111111112',
        destination,
      );
      return { txHash, status: 'PENDING' };
    }

    await walletRepo.touch(userId);
    return { txHash, status: 'CONFIRMED' };
  }

  async withdrawToken(
    userId: string,
    destination: string,
    tokenMint: string,
    uiAmount: number,
  ): Promise<{ txHash: string; status: 'PENDING' | 'CONFIRMED' }> {
    const keypair = this.getKeypair(userId);
    if (!keypair) throw new Error('No trading wallet found');

    const connection = this.rpcManager.getHttpConnection();
    const mintPubkey = new PublicKey(tokenMint);
    const destPubkey = new PublicKey(destination);

    const mintInfo = await connection.getParsedAccountInfo(mintPubkey, 'confirmed');
    const parsedMint = (mintInfo.value?.data as any)?.parsed?.info;
    if (!parsedMint) throw new Error(`Cannot fetch mint info for ${tokenMint}`);
    const decimals: number = parsedMint.decimals;

    const multiplier = BigInt(10 ** decimals);
    const uiAmountStr = uiAmount.toFixed(decimals);
    const [intPart, fracPart = ''] = uiAmountStr.split('.');
    const fracPadded = fracPart.padEnd(decimals, '0').slice(0, decimals);
    const rawAmount = BigInt(intPart ?? '0') * multiplier + BigInt(fracPadded);

    if (rawAmount <= 0n) throw new Error('Transfer amount must be greater than zero');

    const sourceATA = await getAssociatedTokenAddress(mintPubkey, keypair.publicKey);
    const destATA = await getAssociatedTokenAddress(mintPubkey, destPubkey);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: keypair.publicKey,
    });

    let destATAExists = true;
    try {
      await getAccount(connection, destATA, 'confirmed');
    } catch (error) {
      if (
        error instanceof TokenAccountNotFoundError ||
        error instanceof TokenInvalidAccountOwnerError
      ) {
        destATAExists = false;
      } else {
        throw error;
      }
    }

    if (!destATAExists) {
      tx.add(createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        destATA,
        destPubkey,
        mintPubkey,
      ));
    }

    tx.add(createTransferCheckedInstruction(
      sourceATA,
      mintPubkey,
      destATA,
      keypair.publicKey,
      rawAmount,
      decimals,
    ));
    tx.sign(keypair);

    const txHash = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });
    const confirm = await this.confirmWithTimeout(txHash);

    this.invalidateWallet(userId);

    if (!confirm.confirmed) {
      await pendingTxRepo.insert(
        txHash,
        userId,
        null,
        Number(rawAmount),
        tokenMint,
        destination,
      );
      return { txHash, status: 'PENDING' };
    }

    await walletRepo.touch(userId);
    return { txHash, status: 'CONFIRMED' };
  }

  markTradeSubmitted(key: string): boolean {
    if (this.tradeCache.has(key)) return false;
    this.tradeCache.add(key);
    if (this.tradeCache.size > TRADE_CACHE_MAX) this.trimTradeCache();
    return true;
  }

  private trimTradeCache(): void {
    const entries = [...this.tradeCache];
    this.tradeCache.clear();
    for (const entry of entries.slice(entries.length >>> 1)) {
      this.tradeCache.add(entry);
    }
  }

  private async confirmWithTimeout(
    txHash: string,
  ): Promise<{ confirmed: boolean; err?: string }> {
    const connection = this.rpcManager.getHttpConnection();
    const deadline = Date.now() + CONFIRM_TIMEOUT;
    while (Date.now() < deadline) {
      const status = await connection.getSignatureStatus(txHash, {
        searchTransactionHistory: false,
      });
      const confirmation = status?.value?.confirmationStatus;
      if (confirmation === 'confirmed' || confirmation === 'finalized') {
        return { confirmed: true };
      }
      if (status?.value?.err) {
        return {
          confirmed: false,
          err: `On-chain failure: ${JSON.stringify(status.value.err)}`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    return { confirmed: false };
  }

  private async migrateLegacyEncryption(
    userId: string,
    record: WalletRecord,
    secretKey: Uint8Array,
  ): Promise<void> {
    const encrypted = encryptV2(secretKey);
    await walletRepo.updateEncryption(userId, encrypted);

    this.cache.set(userId, {
      ...record,
      encryptedKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      encryptionVersion: encrypted.encryptionVersion,
      kdfSalt: encrypted.kdfSalt,
      authTag: encrypted.authTag,
    });
  }
}

function getMasterSecret(): string {
  return process.env.WALLET_ENCRYPTION_KEY ?? '';
}

function legacyKey(): Buffer {
  return Buffer.from(getMasterSecret().padEnd(32, '0').slice(0, 32), 'utf8');
}

function deriveKeyV2(saltHex: string): Buffer {
  return crypto.scryptSync(getMasterSecret(), Buffer.from(saltHex, 'hex'), 32);
}

function encryptV2(secretKey: Uint8Array): EncryptionEnvelope {
  const iv = crypto.randomBytes(12);
  const salt = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKeyV2(salt.toString('hex')), iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(secretKey)),
    cipher.final(),
  ]);

  return {
    encryptedKey: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    encryptionVersion: 2,
    kdfSalt: salt.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decryptRecord(record: WalletRecord): Uint8Array {
  if (record.encryptionVersion >= 2 && record.kdfSalt && record.authTag) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deriveKeyV2(record.kdfSalt),
      Buffer.from(record.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));

    return new Uint8Array(Buffer.concat([
      decipher.update(Buffer.from(record.encryptedKey, 'hex')),
      decipher.final(),
    ]));
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    legacyKey(),
    Buffer.from(record.iv, 'hex'),
  );

  return new Uint8Array(Buffer.concat([
    decipher.update(Buffer.from(record.encryptedKey, 'hex')),
    decipher.final(),
  ]));
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (!bytes.length) return '';

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = alphabet[remainder] + encoded;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte === 0) {
      encoded = alphabet[0] + encoded;
    } else {
      break;
    }
  }

  return encoded;
}

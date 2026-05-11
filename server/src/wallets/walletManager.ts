import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import * as crypto from "crypto";
import { walletRepo, type WalletRecord } from "../db/walletRepo";
import { pendingTxRepo } from "../db/pendingTxRepo";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bR",
);

// Well-known mint → symbol mapping (display only)
const KNOWN_SYMBOLS = new Map([
  ["So11111111111111111111111111111111111111112", "SOL"],
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
  ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"],
  ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BONK"],
  ["JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "JUP"],
  ["mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", "mSOL"],
  ["7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", "ETH"],
]);

export interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
}

export interface PendingTxInfo {
  txHash: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  inputMint: string;
  outputMint: string;
  amountIn: number;
  createdAt: number;
}

export interface WalletInfo {
  publicKey: string;
  createdAt: number;
  lastUsedAt: number | null;
  balanceSol: number | null;
  tokens: TokenBalance[];
  pendingTxs: PendingTxInfo[];
}

function getEncKey(): Buffer {
  const raw = process.env.WALLET_ENCRYPTION_KEY!;
  return Buffer.from(raw.padEnd(32, "0").slice(0, 32), "utf8");
}

function encrypt(secretKey: Uint8Array): { encryptedKey: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getEncKey(), iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(secretKey)),
    cipher.final(),
  ]);
  return { encryptedKey: enc.toString("hex"), iv: iv.toString("hex") };
}

function decrypt(encryptedKey: string, iv: string): Uint8Array {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    getEncKey(),
    Buffer.from(iv, "hex"),
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, "hex")),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
}

const CONFIRM_TIMEOUT = 30_000;
const TRADE_CACHE_MAX = 5_000;

export class WalletManager {
  private cache = new Map<string, WalletRecord>();
  private tradeCache = new Set<string>();

  constructor(private readonly connection: Connection) {
    this.loadFromDB();
  }

  private loadFromDB(): void {
    for (const record of walletRepo.getAll()) {
      this.cache.set(record.userId, record);
    }
    console.info(`[WalletManager] Loaded ${this.cache.size} wallet(s) from DB`);
  }

  // ── Create / retrieve ──────────────────────────────────────────────────────

  createWallet(userId: string): { publicKey: string } {
    const existing = this.cache.get(userId);
    if (existing) return { publicKey: existing.publicKey };

    const keypair = Keypair.generate();
    const { encryptedKey, iv } = encrypt(keypair.secretKey);

    const record: WalletRecord = {
      userId,
      publicKey: keypair.publicKey.toBase58(),
      encryptedKey,
      iv,
      createdAt: Date.now(),
      lastUsedAt: null,
    };

    walletRepo.insert(record);
    this.cache.set(userId, record);

    return { publicKey: record.publicKey };
  }

  hasWallet(userId: string): boolean {
    return this.cache.has(userId);
  }

  getPublicKey(userId: string): string | null {
    return this.cache.get(userId)?.publicKey ?? null;
  }

  getKeypair(userId: string): Keypair | null {
    const record = this.cache.get(userId);
    if (!record) return null;
    try {
      const secret = decrypt(record.encryptedKey, record.iv);
      walletRepo.touch(userId);
      return Keypair.fromSecretKey(secret);
    } catch {
      console.error("[WalletManager] Decryption failed for userId:", userId);
      return null;
    }
  }

  // ── Balance + token info ───────────────────────────────────────────────────

  async getWalletInfo(userId: string): Promise<WalletInfo | null> {
    const record = this.cache.get(userId);
    if (!record) return null;

    const pubkey = new PublicKey(record.publicKey);

    const [lamports, tokenAccounts, token2022Accounts] = await Promise.all([
      this.connection.getBalance(pubkey, "confirmed").catch(() => null),
      this.connection
        .getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID })
        .catch(() => null),
      this.connection
        .getParsedTokenAccountsByOwner(pubkey, {
          programId: TOKEN_2022_PROGRAM_ID,
        })
        .catch(() => null),
    ]);

    const allTokenAccounts = [
      ...(tokenAccounts?.value ?? []),
      ...(token2022Accounts?.value ?? []),
    ];

    const tokens: TokenBalance[] = allTokenAccounts
      .map((a) => {
        const info = (a.account.data as any).parsed?.info;
        const uiAmount = info?.tokenAmount?.uiAmount as number | null;
        if (!info) return null;
        const balance = uiAmount ?? 0;
        return {
          mint: info.mint as string,
          symbol: KNOWN_SYMBOLS.get(info.mint) ?? "UNKNOWN",
          balance,
          decimals: info.tokenAmount.decimals as number,
        };
      })
      .filter((t): t is TokenBalance => t !== null && t.balance > 0);

    // Attach any pending/confirmed txs associated with this wallet's public key
    const allPending = pendingTxRepo.getByWallet(record.userId);
    const pendingTxs: PendingTxInfo[] = allPending.map((tx) => ({
      txHash: tx.txHash,
      status: tx.status,
      inputMint: tx.inputMint ?? "",
      outputMint: tx.outputMint ?? "",
      amountIn: tx.rawAmountIn ?? 0,
      createdAt: tx.createdAt,
    }));

    return {
      publicKey: record.publicKey,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt ?? null,
      balanceSol: lamports !== null ? lamports / LAMPORTS_PER_SOL : null,
      tokens,
      pendingTxs,
    };
  }

  // ── SOL withdrawal ─────────────────────────────────────────────────────────

  async withdrawSOL(
    userId: string,
    destination: string,
    amountSol: number,
  ): Promise<{ txHash: string; status: "PENDING" | "CONFIRMED" }> {
    const keypair = this.getKeypair(userId);
    if (!keypair) throw new Error("No trading wallet found");

    const destPubkey = new PublicKey(destination);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

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

    const txHash = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });

    const confirm = await this.confirmWithTimeout(txHash);

    if (!confirm.confirmed) {
      // Timeout — persist as pending so background checker can resolve later
      pendingTxRepo.insert(
        txHash,
        userId,
        null,
        lamports,
        "So11111111111111111111111111111111111111112",
        destination,
      );
      return { txHash, status: "PENDING" };
    }

    walletRepo.touch(userId);
    return { txHash, status: "CONFIRMED" };
  }

  async withdrawToken(
    userId: string,
    destination: string,
    tokenMint: string,
    uiAmount: number,
  ): Promise<{ txHash: string; status: "PENDING" | "CONFIRMED" }> {
    const keypair = this.getKeypair(userId);
    if (!keypair) throw new Error("No trading wallet found");

    const mintPubkey = new PublicKey(tokenMint);
    const destPubkey = new PublicKey(destination);

    const mintInfo = await this.connection.getParsedAccountInfo(
      mintPubkey,
      "confirmed",
    );
    const parsedMint = (mintInfo.value?.data as any)?.parsed?.info;
    if (!parsedMint) throw new Error(`Cannot fetch mint info for ${tokenMint}`);
    const decimals: number = parsedMint.decimals;

    const multiplier = BigInt(10 ** decimals);
    const uiAmountStr = uiAmount.toFixed(decimals);
    const [intPart, fracPart = ""] = uiAmountStr.split(".");
    const fracPadded = fracPart.padEnd(decimals, "0").slice(0, decimals);
    const rawAmount = BigInt(intPart!) * multiplier + BigInt(fracPadded);

    if (rawAmount <= 0n)
      throw new Error("Transfer amount must be greater than zero");

    const sourceATA = await getAssociatedTokenAddress(
      mintPubkey,
      keypair.publicKey,
    );

    const destATA = await getAssociatedTokenAddress(mintPubkey, destPubkey);

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: keypair.publicKey,
    });

    let destATAExists = true;
    try {
      await getAccount(this.connection, destATA, "confirmed");
    } catch (e) {
      if (
        e instanceof TokenAccountNotFoundError ||
        e instanceof TokenInvalidAccountOwnerError
      ) {
        destATAExists = false;
      } else {
        throw e;
      }
    }

    if (!destATAExists) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          keypair.publicKey, // payer
          destATA, // account to create
          destPubkey, // owner of new account
          mintPubkey, // mint
        ),
      );
    }

    tx.add(
      createTransferCheckedInstruction(
        sourceATA, // from
        mintPubkey, // mint
        destATA, // to
        keypair.publicKey, // owner
        rawAmount, // amount in raw units
        decimals, // decimals (validated on-chain)
      ),
    );

    tx.sign(keypair);

    const txHash = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });

    const confirm = await this.confirmWithTimeout(txHash);

    if (!confirm.confirmed) {
      pendingTxRepo.insert(
        txHash,
        userId,
        null,
        Number(rawAmount),
        tokenMint,
        destination,
      );
      return { txHash, status: "PENDING" };
    }

    walletRepo.touch(userId);
    return { txHash, status: "CONFIRMED" };
  }

  // ── Trade dedup guard ──────────────────────────────────────────────────────

  markTradeSubmitted(key: string): boolean {
    if (this.tradeCache.has(key)) return false;
    this.tradeCache.add(key);
    if (this.tradeCache.size > TRADE_CACHE_MAX) this.trimTradeCache();
    return true;
  }

  private trimTradeCache(): void {
    const arr = [...this.tradeCache];
    this.tradeCache.clear();
    for (const k of arr.slice(arr.length >>> 1)) this.tradeCache.add(k);
  }

  // ── Confirmation ───────────────────────────────────────────────────────────

  private async confirmWithTimeout(
    txHash: string,
  ): Promise<{ confirmed: boolean; err?: string }> {
    const deadline = Date.now() + CONFIRM_TIMEOUT;
    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(txHash, {
        searchTransactionHistory: false,
      });
      const conf = status?.value?.confirmationStatus;
      if (conf === "confirmed" || conf === "finalized")
        return { confirmed: true };
      if (status?.value?.err)
        return {
          confirmed: false,
          err: `On-chain failure: ${JSON.stringify(status.value.err)}`,
        };
      await new Promise((r) => setTimeout(r, 1_200));
    }

    return { confirmed: false };
  }
}

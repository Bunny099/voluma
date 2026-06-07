import {
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js';
import { type ConfidenceLevel, type EventDirection, type NormalizedEvent } from './provider';

const DEX_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
]);

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

interface TokenDelta {
  owner?: string;
  mint: string;
  rawDelta: bigint;
  uiDelta: number;
  decimals: number;
}

interface TransferInstruction {
  source?: string;
  destination?: string;
  mint?: string;
  amountRaw?: bigint;
  amountUi?: number;
  decimals?: number;
  kind: 'SOL' | 'TOKEN';
}

export function enrichEventFromParsedTransaction(params: {
  signature: string;
  logs: string[];
  baseEvent: NormalizedEvent;
  transaction: ParsedTransactionWithMeta;
  watchedWallets: Set<string>;
  preferredWallet?: string;
  providerId: string;
  resolveSymbol: (mint: string) => string;
}): NormalizedEvent {
  const {
    signature,
    logs,
    baseEvent,
    transaction,
    watchedWallets,
    preferredWallet,
    providerId,
    resolveSymbol,
  } = params;

  const joinedLogs = logs.join('\n');
  const timestamp = Date.now();
  const slot = transaction.slot;
  const accountKeys = transaction.transaction.message.accountKeys.map((key) => toBase58(key.pubkey));
  const signerKeys = transaction.transaction.message.accountKeys
    .filter((key) => key.signer)
    .map((key) => toBase58(key.pubkey));
  const tokenDeltas = collectTokenDeltas(transaction);
  const transfers = collectTransfers(transaction);

  const matchedWallet = preferredWallet
    ?? findWatchedWallet(watchedWallets, accountKeys, tokenDeltas)
    ?? signerKeys[0];

  const dexProgramId = [...DEX_PROGRAMS].find((programId) => joinedLogs.includes(programId))
    ?? findInstructionProgramId(transaction, DEX_PROGRAMS);

  const hasDex = Boolean(dexProgramId);
  const transferInstruction = pickTransferInstruction(transfers, matchedWallet);
  const walletTokenDeltas = matchedWallet
    ? tokenDeltas.filter((delta) => delta.owner === matchedWallet && delta.rawDelta !== 0n)
    : tokenDeltas.filter((delta) => delta.rawDelta !== 0n);

  let direction: EventDirection = hasDex ? 'SWAP' : transferInstruction ? 'TRANSFER' : baseEvent.direction;
  let type: NormalizedEvent['type'] = hasDex ? 'SWAP' : transferInstruction ? 'TRANSFER' : baseEvent.type;
  let tokenMint = baseEvent.tokenMint;
  let tokenSymbol = tokenMint ? resolveSymbol(tokenMint) : baseEvent.tokenSymbol;
  let amount = baseEvent.amount;
  let amountUi = baseEvent.amountUi;
  let amountDecimals = baseEvent.amountDecimals;
  let amountSol = baseEvent.amountSol;
  let confidence: ConfidenceLevel = 'MEDIUM';

  if (hasDex) {
    const solDelta = findSolDelta(walletTokenDeltas);
    const nonSolDeltas = walletTokenDeltas
      .filter((delta) => delta.mint !== WRAPPED_SOL_MINT)
      .sort((a, b) => compareAbsBigInt(b.rawDelta, a.rawDelta));

    const positiveNonSol = nonSolDeltas.find((delta) => delta.rawDelta > 0n);
    const negativeNonSol = nonSolDeltas.find((delta) => delta.rawDelta < 0n);

    if (positiveNonSol && solDelta !== null && solDelta < 0) {
      direction = 'BUY';
      tokenMint = positiveNonSol.mint;
      amount = Number(absBigInt(positiveNonSol.rawDelta));
      amountUi = Math.abs(positiveNonSol.uiDelta);
      amountDecimals = positiveNonSol.decimals;
      amountSol = Math.abs(solDelta);
      confidence = matchedWallet ? 'EXACT' : 'HIGH';
    } else if (negativeNonSol && solDelta !== null && solDelta > 0) {
      direction = 'SELL';
      tokenMint = negativeNonSol.mint;
      amount = Number(absBigInt(negativeNonSol.rawDelta));
      amountUi = Math.abs(negativeNonSol.uiDelta);
      amountDecimals = negativeNonSol.decimals;
      amountSol = Math.abs(solDelta);
      confidence = matchedWallet ? 'EXACT' : 'HIGH';
    } else {
      direction = 'SWAP';
      const dominant = nonSolDeltas[0];
      if (dominant) {
        tokenMint = dominant.mint;
        amount = Number(absBigInt(dominant.rawDelta));
        amountUi = Math.abs(dominant.uiDelta);
        amountDecimals = dominant.decimals;
      }
      if (solDelta !== null) amountSol = Math.abs(solDelta);
      confidence = matchedWallet ? 'HIGH' : 'MEDIUM';
    }
  } else if (transferInstruction) {
    direction = 'TRANSFER';
    type = 'TRANSFER';
    if (transferInstruction.kind === 'SOL') {
      amount = Number(transferInstruction.amountRaw ?? 0n);
      amountUi = transferInstruction.amountUi;
      amountDecimals = 9;
      amountSol = transferInstruction.amountUi;
      tokenMint = WRAPPED_SOL_MINT;
      confidence = transferInstruction.source || transferInstruction.destination ? 'EXACT' : 'HIGH';
    } else {
      tokenMint = transferInstruction.mint ?? tokenMint;
      amount = transferInstruction.amountRaw != null ? Number(transferInstruction.amountRaw) : amount;
      amountUi = transferInstruction.amountUi;
      amountDecimals = transferInstruction.decimals;
      confidence = transferInstruction.source || transferInstruction.destination ? 'HIGH' : 'MEDIUM';
    }
  }

  if (tokenMint) {
    tokenSymbol = resolveSymbol(tokenMint);
  }

  return {
    ...baseEvent,
    signature,
    timestamp,
    slot,
    type,
    direction,
    wallet: matchedWallet ?? baseEvent.wallet,
    tokenMint,
    tokenSymbol,
    amount,
    amountUi,
    amountDecimals,
    amountSol,
    programId: dexProgramId
      ?? (transferInstruction?.kind === 'SOL' ? SYSTEM_PROGRAM : baseEvent.programId),
    confidence,
    rawLogs: joinedLogs,
    metadata: {
      ...baseEvent.metadata,
      source: 'parsed_transaction',
      providerId,
      transferKind: transferInstruction?.kind,
    },
  };
}

function collectTokenDeltas(transaction: ParsedTransactionWithMeta): TokenDelta[] {
  const pre = transaction.meta?.preTokenBalances ?? [];
  const post = transaction.meta?.postTokenBalances ?? [];
  const grouped = new Map<string, {
    owner?: string;
    mint: string;
    preRaw: bigint;
    postRaw: bigint;
    decimals: number;
  }>();

  for (const balance of pre) {
    const key = `${balance.owner ?? 'unknown'}:${balance.mint}`;
    grouped.set(key, {
      owner: balance.owner,
      mint: balance.mint,
      preRaw: BigInt(balance.uiTokenAmount.amount),
      postRaw: 0n,
      decimals: balance.uiTokenAmount.decimals,
    });
  }

  for (const balance of post) {
    const key = `${balance.owner ?? 'unknown'}:${balance.mint}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.postRaw = BigInt(balance.uiTokenAmount.amount);
      existing.decimals = balance.uiTokenAmount.decimals;
      if (!existing.owner) existing.owner = balance.owner;
    } else {
      grouped.set(key, {
        owner: balance.owner,
        mint: balance.mint,
        preRaw: 0n,
        postRaw: BigInt(balance.uiTokenAmount.amount),
        decimals: balance.uiTokenAmount.decimals,
      });
    }
  }

  return [...grouped.values()].map((delta) => ({
    owner: delta.owner,
    mint: delta.mint,
    rawDelta: delta.postRaw - delta.preRaw,
    uiDelta: Number(delta.postRaw - delta.preRaw) / Math.pow(10, delta.decimals),
    decimals: delta.decimals,
  }));
}

function collectTransfers(transaction: ParsedTransactionWithMeta): TransferInstruction[] {
  const transfers: TransferInstruction[] = [];

  for (const instruction of transaction.transaction.message.instructions) {
    if ('parsed' in instruction) {
      const parsedInstruction = instruction as ParsedInstruction;
      const parsed = parsedInstruction.parsed as {
        type?: string;
        info?: Record<string, unknown>;
      };

      if (parsedInstruction.program === 'system' && parsed.type === 'transfer') {
        const lamports = BigInt(Number(parsed.info?.lamports ?? 0));
        transfers.push({
          kind: 'SOL',
          source: parsed.info?.source as string | undefined,
          destination: parsed.info?.destination as string | undefined,
          amountRaw: lamports,
          amountUi: Number(lamports) / 1_000_000_000,
        });
      }

      if (
        (parsedInstruction.program === 'spl-token' || parsedInstruction.program === 'spl-token-2022')
        && (parsed.type === 'transfer' || parsed.type === 'transferChecked')
      ) {
        const decimals = Number(parsed.info?.tokenAmount && typeof parsed.info.tokenAmount === 'object'
          ? (parsed.info.tokenAmount as { decimals?: number }).decimals ?? 0
          : parsed.info?.decimals ?? 0);
        const rawAmount = parsed.info?.amount != null
          ? BigInt(String(parsed.info.amount))
          : parsed.info?.tokenAmount && typeof parsed.info.tokenAmount === 'object'
            ? BigInt(String((parsed.info.tokenAmount as { amount?: string }).amount ?? '0'))
            : 0n;

        transfers.push({
          kind: 'TOKEN',
          source: parsed.info?.source as string | undefined,
          destination: parsed.info?.destination as string | undefined,
          mint: parsed.info?.mint as string | undefined,
          amountRaw: rawAmount,
          amountUi: Number(rawAmount) / Math.pow(10, decimals),
          decimals,
        });
      }
    } else {
      const decoded = instruction as PartiallyDecodedInstruction;
      if (decoded.programId.toBase58() === SYSTEM_PROGRAM) {
        continue;
      }
    }
  }

  return transfers;
}

function pickTransferInstruction(
  transfers: TransferInstruction[],
  wallet?: string,
): TransferInstruction | undefined {
  if (!wallet) return transfers[0];
  return transfers.find((transfer) => (
    transfer.source === wallet || transfer.destination === wallet
  )) ?? transfers[0];
}

function findWatchedWallet(
  watchedWallets: Set<string>,
  accountKeys: string[],
  tokenDeltas: TokenDelta[],
): string | undefined {
  for (const wallet of watchedWallets) {
    if (accountKeys.includes(wallet)) return wallet;
  }

  for (const wallet of watchedWallets) {
    if (tokenDeltas.some((delta) => delta.owner === wallet)) return wallet;
  }

  return undefined;
}

function findInstructionProgramId(
  transaction: ParsedTransactionWithMeta,
  candidates: Set<string>,
): string | undefined {
  for (const instruction of transaction.transaction.message.instructions) {
    if ('programId' in instruction) {
      const programId = instruction.programId.toBase58();
      if (candidates.has(programId)) return programId;
    }
  }
  return undefined;
}

function findSolDelta(tokenDeltas: TokenDelta[]): number | null {
  const solDelta = tokenDeltas.find((delta) => delta.mint === WRAPPED_SOL_MINT);
  return solDelta ? solDelta.uiDelta : null;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function compareAbsBigInt(left: bigint, right: bigint): number {
  const diff = absBigInt(left) - absBigInt(right);
  if (diff === 0n) return 0;
  return diff > 0n ? 1 : -1;
}

function toBase58(value: { toBase58(): string } | string): string {
  return typeof value === 'string' ? value : value.toBase58();
}

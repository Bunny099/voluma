import { Connection } from "@solana/web3.js";

const connection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

const queue: string[] = [];
const processing = new Set<string>();

const MAX_QUEUE = 100;

export const enqueue = (signature: string) => {
  if (processing.has(signature)) return;
  if (queue.length > MAX_QUEUE) return;

  queue.push(signature);
  processing.add(signature);
};

export const startProcessor = (
  onMatch: (wallet: string) => void,
  getWallets: () => { wallet: string; active: boolean }[]
) => {
  setInterval(async () => {
    if (queue.length === 0) return;

    const batch = queue.splice(0, 3); 

    for (const sig of batch) {
      try {
        const tx = await connection.getParsedTransaction(sig, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.transaction) continue;

        const accounts =
          tx.transaction.message.accountKeys.map((acc: any) =>
            acc.pubkey.toString()
          );

        const wallets = getWallets();

        for (const w of wallets) {
          if (!w.active) continue;

          if (accounts.includes(w.wallet)) {
            console.log("🔥 WALLET MATCH:", w.wallet);

            onMatch(w.wallet);
          }
        }

      
        await new Promise((r) => setTimeout(r, 150));
      } catch (err) {
        console.log("RPC error, skipping...");
      }
    }
  }, 500);
};
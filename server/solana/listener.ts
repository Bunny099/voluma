import { Connection,PublicKey } from "@solana/web3.js"
const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed"
)
const RAYDIUM_PROGRAM = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");

export const startSolanaListener = async(onSwap:(data:any)=>void)=>{
    console.log("Listening to raydiumlogs:")
    connection.onLogs(
        RAYDIUM_PROGRAM,(logInfo)=>{
            const logs = logInfo.logs;
         
            if(!logs)return;
            const isSwap = logs.some((l)=>
                l.includes("process_swap") || l.includes("Swap") || l.includes("ray_logs")
            )
            if(!isSwap)return;
            if(Math.random()>0.5)return;
            onSwap({logs})
        }
    ),"confirmed"
}




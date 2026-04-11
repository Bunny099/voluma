import { WebSocketServer } from "ws";
import { startSolanaListener } from "../solana/listener";


import { processLogs } from "../lib/processLog";
const wss = new WebSocketServer({ port: 3001 });
console.log(`WS Server is running on: wss://localhost:3001`);

let buyVolume =0;
let sellVolume  =0;
startSolanaListener((tx)=>{
    const parsed = processLogs(tx.logs);
    if(!parsed)return;
    console.log("Parsed:",parsed);
    if(parsed.type === "BUY"){
        buyVolume += parsed.volume
    }else{
        sellVolume+= parsed.volume
    }
})


wss.on("connection",(ws)=>{

    console.log("Client connected!");
   
    const interval = setInterval(()=>{
        const payload = {
            buyVolume,sellVolume
        }
        console.log("Sending  payload:",payload)
        ws.send(JSON.stringify(payload))
    },500) 
    ws.on("close",()=>{
        console.log("Client dissconnected!")
        clearInterval(interval)
    })
})
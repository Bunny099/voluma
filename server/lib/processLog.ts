

export const processLogs = (logs:string[])=>{
    let volume: number | null = null;
    let direction : "BUY" | "SELL"| null = null;
    for(const log of logs){
        if(log.includes("amount_in")){
            const match  = log.match(/amount_in:\s*(\d+)/);
            if(match){
                volume = Number(match[1])/1e9;

            }
        }
        if(log.includes("->")){
            const match = log.match(/(\d+)\s*->\s*(\d+)/);
            if(match){
                const input =Number( match[1]);
                const output = Number(match[2]);
                direction =output > input ? "BUY":"SELL";
               
            }
        }
    }
    if(!volume || !direction)return null ;
    if(volume<=0 || volume>1000)return null;
    const safeValue =Math.min(volume,10);
    return{
        type:direction,
        volume:safeValue
    }
    
    
}
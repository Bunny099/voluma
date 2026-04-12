
type WalletTrigger={
    wallet:string,
    active:boolean
}

const trackedwallets:WalletTrigger[]=[];
export const addWallet = ( wallet:string)=>{
    trackedwallets.push({wallet,active:true})
}
export const getWallets = ()=>trackedwallets;

export const matchWallet = (logs:string[])=>{
    for(const trigger of trackedwallets){
        if(!trigger.active) continue;
        if(logs.some((l)=>l.includes(trigger.wallet))){
            console.log("MATCH FOUND:", trigger.wallet)
            return trigger.wallet
        }
            
    }
    return null;
}
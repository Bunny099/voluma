type TriggerEvent={
    type:"WALLET_MATCH",
    wallet:string,
    timestamp:number
}

let listeners :((event:TriggerEvent)=>void)[]=[];

export const onTrigger = (cb:(event:TriggerEvent)=>void)=>{
    listeners.push(cb)
}

export const emitTrigger = (event:TriggerEvent)=>{
    for(const l of listeners){
        l(event)
    }
}
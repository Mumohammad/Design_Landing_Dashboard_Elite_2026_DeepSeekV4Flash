"use client"

import {useCallback,useEffect,useState} from "react"
import {createClient} from "@/lib/supabase/client"
export type LeaveTypeRow={id:string;name_en:string|null;name_ar:string|null;code:string|null}

/** Catalog errors remain visible; never substitute an empty successful catalog. */
export function useLeaveTypes(){
 const [result,setResult]=useState<{revision:number;rows:LeaveTypeRow[];error:boolean}|null>(null)
 const [revision,setRevision]=useState(0)
 const retry=useCallback(()=>setRevision(value=>value+1),[])
 useEffect(()=>{
  const controller=new AbortController()
  void (async()=>{
   try{
    const client=createClient(),all:LeaveTypeRow[]=[]
    let total:number|undefined
    for(let offset=0;;offset+=1000){
     const result=await client.from("leave_types").select("id,name_en,name_ar,code",{count:"exact"}).order("name_en",{ascending:true}).order("id",{ascending:true}).range(offset,offset+999).abortSignal(controller.signal)
     if(controller.signal.aborted)return
     if(result.error||!Array.isArray(result.data)||result.count===null||!Number.isSafeInteger(result.count)||result.count<0||(total!==undefined&&total!==result.count))throw Error("Catalog unavailable")
     total=result.count
     if(result.data.length!==Math.min(1000,Math.max(0,total-offset)))throw Error("Incomplete catalog")
     all.push(...result.data)
     if(all.length>=total)break
    }
    if(new Set(all.map(row=>row.id)).size!==all.length)throw Error("Catalog changed")
    setResult({revision,rows:all,error:false})
   }catch{if(!controller.signal.aborted)setResult({revision,rows:[],error:true})}
  })()
  return()=>controller.abort()
 },[revision])
 const current=result?.revision===revision?result:null
 return{rows:current?.rows??[],loading:current===null,error:current?.error??false,retry}
}

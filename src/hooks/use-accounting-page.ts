"use client"
import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { readAccountingPage, type AccountingPageKind, type PaymentSummary } from "@/lib/accounting/paged-reads"
export function useAccountingPage<T>(kind: AccountingPageKind | null, revision = 0, party?: string) {
 const [search,setSearchValue]=useState("")
 const [page,setPageValue]=useState(1)
 const [retry,setRetry]=useState(0)
 const [result,setResult]=useState<{rows:T[];count:number;summary:PaymentSummary|null;loading:boolean;error:boolean}>({rows:[],count:0,summary:null,loading:!!kind,error:false})
 const pending=useCallback(()=>setResult(old=>({...old,rows:[],loading:true,error:false})),[])
 const setSearch=useCallback((value:string)=>{setSearchValue(value.slice(0,200));setPageValue(1);pending()},[pending])
 const setPage=useCallback((value:number)=>{setPageValue(Math.max(1,Math.trunc(value)));pending()},[pending])
 const reload=useCallback(()=>{setRetry(n=>n+1);pending()},[pending])
 useEffect(()=>{
  const controller=new AbortController()
  const timer=setTimeout(async()=>{
   if(!kind){setResult({rows:[],count:0,summary:null,loading:false,error:false});return}
   pending()
   try{
    const value=await readAccountingPage<T>(createClient(),kind,{search,page,party,signal:controller.signal})
    if(controller.signal.aborted)return
    const last=Math.max(1,Math.ceil(value.total/25))
    if(page>last){setPage(last);return}
    setResult({rows:value.rows,count:value.total,summary:value.summary,loading:false,error:false})
   }catch{if(!controller.signal.aborted)setResult({rows:[],count:0,summary:null,loading:false,error:true})}
  },search?250:0)
  return()=>{clearTimeout(timer);controller.abort()}
 },[kind,search,page,party,revision,retry,pending,setPage])
 return {...result,search,setSearch,reload,pagination:{totalRecords:result.count,currentPage:page,totalPages:Math.max(1,Math.ceil(result.count/25)),onPageChange:setPage}}
}

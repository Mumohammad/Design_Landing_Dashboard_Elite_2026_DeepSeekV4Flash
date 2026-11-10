"use client"
import {useCallback,useEffect,useState} from "react"
import {createClient} from "@/lib/supabase/client"
import {readInvoicePage,type InvoicePage} from "@/lib/accounting/invoice-pages"
export function useInvoicePage<T>(kind:"invoices"|"customers"|"suppliers",enabled=true){
 const [search,setSearchValue]=useState(""),[status,setStatusValue]=useState("all"),[page,setPageValue]=useState(1),[revision,setRevision]=useState(0)
 const [result,setResult]=useState<InvoicePage<T>|null>(null),[loading,setLoading]=useState(enabled),[error,setError]=useState(false)
 const pageSize=kind==="invoices"?50:25
 const pending=useCallback(()=>{setResult(null);setLoading(true);setError(false)},[])
 const setSearch=useCallback((value:string)=>{const next=value.slice(0,200);if(next===search)return;setSearchValue(next);setPageValue(1);pending()},[search,pending])
 const setStatus=useCallback((value:string)=>{if(value===status)return;setStatusValue(value);setPageValue(1);pending()},[status,pending])
 const setPage=useCallback((value:number)=>{const next=Math.max(1,Math.trunc(value));if(next===page)return;setPageValue(next);pending()},[page,pending])
 const reload=useCallback(()=>{setRevision(x=>x+1);pending()},[pending])
 useEffect(()=>{
  if(!enabled)return
  let active=true;const controller=new AbortController()
  const timer=setTimeout(async()=>{pending();const deadline=setTimeout(()=>controller.abort(),30000);try{
   const value=await readInvoicePage<T>(createClient(),kind,{search,status,page,pageSize,signal:controller.signal})
   if(!active||controller.signal.aborted)return
   const last=Math.max(1,Math.ceil(value.total/pageSize));if(page>last){setPage(last);return}
   setResult(value);setLoading(false)
  }catch{if(active){setResult(null);setLoading(false);setError(true)}}finally{clearTimeout(deadline)}},search?250:0)
  return()=>{active=false;clearTimeout(timer);controller.abort()}
 },[kind,enabled,search,status,page,pageSize,revision,pending,setPage])
 return {rows:result?.rows??[],summary:result?.summary??null,loading,error,search,setSearch,status,setStatus,reload,
  pagination:{totalRecords:result?.total??0,currentPage:page,totalPages:Math.max(1,Math.ceil((result?.total??0)/pageSize)),onPageChange:setPage}}
}

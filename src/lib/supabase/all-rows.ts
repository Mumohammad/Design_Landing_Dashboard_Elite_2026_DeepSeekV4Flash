/** Fetch every row in stable 1,000-row pages; PostgREST caps each response. */
export async function fetchAllRows<T>(query:()=>{range:(from:number,to:number)=>PromiseLike<{data:unknown[]|null;error:{message:string}|null}>}):Promise<{data:T[]|null;error:{message:string}|null}>{
 const rows:T[]=[]
 for(let offset=0;;offset+=1000){const result=await query().range(offset,offset+999);if(result.error)return{data:null,error:result.error};rows.push(...((result.data??[]) as T[]));if((result.data?.length??0)<1000)return{data:rows,error:null}}
}

const STAGING_HOST="viowrovartosrkqukjxy.supabase.co"
const PRODUCTION_REF="wwfnsbilmyxeawgzicmv"
const PRODUCTION_ALIAS="elite-dashboard-blush.vercel.app"
const loopback=host=>["127.0.0.1","localhost"].includes(host)
/** Check both write backend and the actual app CSP before creating synthetic fixtures. */
export async function assertModuleTestTarget(page,backendUrl,appUrl){
 const backend=new URL(backendUrl),app=new URL(appUrl)
 if(backend.username||backend.password||app.username||app.password)throw Error("Credential-bearing test URLs are forbidden")
 if(loopback(backend.hostname)&&loopback(app.hostname)&&["http:","https:"].includes(backend.protocol)&&["http:","https:"].includes(app.protocol))return{kind:"loopback"}
 if(backend.origin!=="https://"+STAGING_HOST||backend.pathname!=="/"||backend.search||backend.hash||app.port||app.protocol!=="https:"||app.hostname===PRODUCTION_ALIAS||!/^elite-dashboard-[a-z0-9]+-elitesaasc-5643\.vercel\.app$/.test(app.hostname)||app.hostname.includes(PRODUCTION_REF))throw Error("Test target must be approved isolated staging; production is forbidden")
 const response=await page.request.get(new URL("/landing",app).href,{maxRedirects:0})
 if(response.status()!==200)throw Error("Staging target did not return an unredirected app page")
 const policy=response.headers()["content-security-policy"]??""
 const connect=policy.split(";").map(value=>value.trim()).find(value=>value.startsWith("connect-src "))??""
 const sources=connect.split(/\s+/).slice(1)
 if(!sources.includes("https://"+STAGING_HOST)||policy.includes(PRODUCTION_REF)||sources.includes("https://*.supabase.co")||sources.includes("*"))throw Error("Staging CSP does not exclusively identify the approved test database")
 return{kind:"staging"}
}

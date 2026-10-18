// Offline format verification only. Uses the SDK's bundled demonstration
// certificate/key, never tenant credentials, databases or the ZATCA network.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash, X509Certificate } from "node:crypto"
import ts from "typescript"
import QRCode from "qrcode"

const sdk = path.resolve(process.env.ZATCA_SDK_ROOT || process.argv[2] || "")
if (!process.env.ZATCA_SDK_ROOT && !process.argv[2]) throw new Error("Provide the official SDK folder through ZATCA_SDK_ROOT or the first argument")
const {version} = JSON.parse(fs.readFileSync(path.join(sdk,"Apps/global.json"),"utf8"))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid SDK version")
const jar = path.join(sdk,`Apps/cli-${version}-jar-with-dependencies.jar`)
const output = path.resolve("supabase/.temp/zatca-sdk-verification")
fs.mkdirSync(output,{recursive:true})
const defaults = JSON.parse(fs.readFileSync(path.join(sdk,"Configuration/defaults.json"),"utf8"))
for(const key of Object.keys(defaults)) if (key !== "certPassword") {
  const resolved = path.resolve(sdk,"Configuration",defaults[key])
  if (!resolved.startsWith(sdk+path.sep)) throw new Error("SDK resource escapes the selected SDK folder")
  defaults[key] = resolved
}
// This known public, expired SDK sample cannot be mistaken for an operator's
// own certificate. Refuse customized SDK credential files, even in offline QA.
const certificate = new X509Certificate(Buffer.from(fs.readFileSync(defaults.certPath,"utf8").trim(),"base64"))
if(certificate.fingerprint256 !== "95:95:30:09:5B:3D:00:05:70:10:DC:A9:2E:F5:18:4C:ED:4C:56:5C:9F:39:ED:41:6B:60:B4:7E:09:6A:D9:2A") {
  throw new Error("The SDK certificate differs from the reviewed public sample; refusing to use a potentially real credential")
}
const configPath = path.join(output,"sdk-config.json")
fs.writeFileSync(configPath,JSON.stringify(defaults))
const modules = new Map()
function loadModule(file) {
  file=path.resolve(file)
  if(modules.has(file)) return modules.get(file)
  const exports={}; modules.set(file,exports)
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function("exports","require",code)(exports,(name)=>name==="qrcode"?QRCode:loadModule(path.resolve(path.dirname(file),name+".ts")))
  return exports
}
const {buildZatcaUblInvoice} = loadModule("src/lib/accounting/zatca-ubl.ts")
const genesis = Buffer.from(createHash("sha256").update("0").digest("hex"),"utf8").toString("base64")
if(fs.readFileSync(defaults.pihPath,"utf8").trim()!==genesis) throw new Error("SDK PIH sample differs from the reviewed genesis fixture")
const party={name:"Synthetic SDK test company",vatNumber:"399999999900003",crNumber:"1010010000",address:"Synthetic Street",buildingNumber:"1234",additionalNumber:"1234",district:"Synthetic District",city:"Riyadh",region:"Riyadh",postalCode:"12345",countryCode:"SA"}
const base={invoiceNumber:"SDK-TEST-000001",uuid:"00000000-0000-4000-8000-000000000001",invoiceCounter:1,previousInvoiceHash:genesis,paymentMeansCode:"30",deliveryDate:"2026-10-18",issueDate:"2026-10-18",issueTime:"09:30:00",currency:"SAR",seller:party,buyer:{...party,name:"Synthetic SDK test buyer",vatNumber:"399999999800003"},lines:[{line_no:1,description:"Synthetic service",quantity:1,unit_price:100,amount:100,vat_rate:15,vat_amount:15}],subtotal:100,discount:0,vatAmount:15,total:115,qr:{sellerName:party.name,sellerVatNumber:party.vatNumber,timestamp:"2026-10-18T09:30:00Z",total:115,vatAmount:15}}
const childEnv={SDK_CONFIG:configPath,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}
function run(label,args,required=[]) {
  const result=spawnSync("java",["-Dfile.encoding=UTF-8","-jar",jar,"--globalVersion",version,...args],{cwd:output,env:childEnv,encoding:"utf8",timeout:120000,maxBuffer:5*1024*1024})
  const log=(result.stdout??"")+"\n"+(result.stderr??"")
  fs.writeFileSync(path.join(output,label+".log"),log)
  // SDK 3.0.8 exits 0 even after validation/signing failure. Require explicit
  // success text and every expected validation stage; never trust exit alone.
  const passed=!result.error && result.status===0 && !/GLOBAL VALIDATION RESULT\s*=\s*FAILED|failed to sign invoice|validation result\s*:\s*FAILED/i.test(log) && required.every((text)=>log.includes(text))
  return {passed,stages:required.length,exit:result.status}
}
const evidence={sdkVersion:version,certificate:"public expired SDK demonstration certificate",signer:"SDK demonstration signer, not application signer",productionValidated:false,cases:[]}
for(const invoiceKind of ["standard","simplified"]) for(const docType of ["invoice","credit_note","debit_note"]) {
  const label=`${invoiceKind}-${docType}`
  const data={...base,invoiceKind,docType,...(docType!=="invoice"?{referenceInvoiceNumber:"SDK-ORIGINAL-000001",noteReason:"Synthetic test adjustment"}:{})}
  const input=path.join(output,label+".xml"), signed=path.join(output,label+"-sdk-signed.xml")
  fs.writeFileSync(input,buildZatcaUblInvoice(data))
  const sign=run(label+"-sign",["-sign","-invoice",input,"-signedInvoice",signed],["invoice has been signed successfully"])
  const stages=["[XSD] validation result : PASSED","[EN] validation result : PASSED","[KSA] validation result : PASSED","[PIH] validation result : PASSED","GLOBAL VALIDATION RESULT = PASSED"]
  if(invoiceKind==="simplified") stages.push("[QR] validation result : PASSED","[SIGNATURE] validation result : PASSED")
  const validation=sign.passed?run(label+"-validate",["-validate","-invoice",signed],stages):{passed:false,stages:0}
  const entry={case:label,signing:sign.passed,validation:validation.passed}
  evidence.cases.push(entry)
  console.log(`${entry.validation?"PASS":"FAIL"}: ${label} offline SDK sample validation`)
}
fs.writeFileSync(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2))
console.log("Application signing, genuine onboarding, authority acceptance and production QR remain unverified.")
if(evidence.cases.some((entry)=>!entry.validation)) process.exitCode=1

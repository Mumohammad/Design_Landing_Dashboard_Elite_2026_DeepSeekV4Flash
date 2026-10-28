// Offline verification of the APPLICATION signer (zatca-signer.ts) with the
// official SDK validator. Uses the SDK's public demonstration certificate/key,
// never tenant credentials, databases or the ZATCA network.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto"
import { createRequire } from "node:module"
import ts from "typescript"
import QRCode from "qrcode"
import { X509 } from "jsrsasign"

const sdk = path.resolve(process.env.ZATCA_SDK_ROOT || process.argv[2] || "")
if (!process.env.ZATCA_SDK_ROOT && !process.argv[2]) throw new Error("Provide the official SDK folder through ZATCA_SDK_ROOT or the first argument")
const {version} = JSON.parse(fs.readFileSync(path.join(sdk,"Apps/global.json"),"utf8"))
if (!/^(?:\d+-R)?\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid SDK version")
const publicSamples={
  "3.0.8":{fingerprint:"95:95:30:09:5B:3D:00:05:70:10:DC:A9:2E:F5:18:4C:ED:4C:56:5C:9F:39:ED:41:6B:60:B4:7E:09:6A:D9:2A",jar:`cli-${version}-jar-with-dependencies.jar`},
  // Official developer portal's Java 11 archive, downloaded 19 October 2026.
  // Archive SHA-256: 91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6.
  "238-R3.4.8":{fingerprint:"A2:86:D2:87:B2:4F:FF:C0:52:BB:E2:00:B1:0C:B3:B3:EE:E4:E5:8D:21:C9:D4:7F:E4:0B:94:64:4C:75:70:69",jar:`zatca-einvoicing-sdk-${version}.jar`},
}
const sample=publicSamples[version]
if(!sample) throw new Error("Unreviewed SDK version; review its public demonstration fixture before use")
const jar = path.join(sdk,"Apps",sample.jar)
if(version==="3.0.8") throw new Error("The application signer is verified against the current SDK only")
const output = path.resolve("supabase/.temp",`zatca-app-signer-${version}`)
fs.mkdirSync(output,{recursive:true})
const defaults = JSON.parse(fs.readFileSync(path.join(sdk,"Configuration/defaults.json"),"utf8"))
for(const key of Object.keys(defaults)) if (key !== "certPassword") {
  const resolved = path.resolve(sdk,"Configuration",defaults[key])
  if (!resolved.startsWith(sdk+path.sep)) throw new Error("SDK resource escapes the selected SDK folder")
  defaults[key] = resolved
}
// A known public SDK sample cannot be mistaken for an operator's
// own certificate. Refuse customized SDK credential files, even in offline QA.
const certificate = new X509Certificate(Buffer.from(fs.readFileSync(defaults.certPath,"utf8").trim(),"base64"))
if(certificate.fingerprint256 !== sample.fingerprint) {
  throw new Error("The SDK certificate differs from the reviewed public sample; refusing to use a potentially real credential")
}
try {
  const sampleKey=createPrivateKey({key:Buffer.from(fs.readFileSync(defaults.privateKeyPath,"utf8").trim(),"base64"),type:"sec1",format:"der"})
  if(!createPublicKey(sampleKey).export({type:"spki",format:"der"}).equals(certificate.publicKey.export({type:"spki",format:"der"}))) throw new Error()
} catch {
  throw new Error("The SDK key does not match the reviewed public demonstration certificate; refusing to use it")
}
const configPath = path.join(output,"sdk-config.json")
fs.writeFileSync(configPath,JSON.stringify(defaults))
const modules = new Map()
const requireDependency = createRequire(import.meta.url)
function loadModule(file) {
  file=path.resolve(file)
  if(modules.has(file)) return modules.get(file)
  const exports={}; modules.set(file,exports)
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function("exports","require",code)(exports,(name)=> {
    if(name==="qrcode") return QRCode
    if(["node:crypto","jsrsasign","xml-crypto","@xmldom/xmldom"].includes(name)) return requireDependency(name)
    if(!name.startsWith("./")) throw new Error("Unexpected dependency in offline SDK harness")
    return loadModule(path.resolve(path.dirname(file),name+".ts"))
  })
  return exports
}

const {buildZatcaUblInvoice} = loadModule("src/lib/accounting/zatca-ubl.ts")
const {signZatcaInvoice} = loadModule("src/lib/accounting/zatca-signer.ts")
const genesis = Buffer.from(createHash("sha256").update("0").digest("hex"),"utf8").toString("base64")
const party={name:"Synthetic SDK test company",vatNumber:"399999999900003",crNumber:"1010010000",address:"Synthetic Street",buildingNumber:"1234",additionalNumber:"1234",district:"Synthetic District",city:"Riyadh",region:"Riyadh",postalCode:"12345",countryCode:"SA"}
const base={invoiceNumber:"APP-SIGN-000001",uuid:"00000000-0000-4000-8000-000000000101",invoiceCounter:1,previousInvoiceHash:genesis,paymentMeansCode:"30",deliveryDate:"2026-10-18",issueDate:"2026-10-18",issueTime:"09:30:00",currency:"SAR",seller:party,buyer:{...party,name:"Synthetic SDK test buyer",vatNumber:"399999999800003"},lines:[{line_no:1,description:"Synthetic service",quantity:1,unit_price:100,amount:100,vat_rate:15,vat_amount:15}],subtotal:100,discount:0,vatAmount:15,total:115,qr:{sellerName:party.name,sellerVatNumber:party.vatNumber,timestamp:"2026-10-18T09:30:00Z",total:115,vatAmount:15}}
const childEnv={SDK_CONFIG:configPath,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}
function run(label,args,required=[]) {
  const result=spawnSync("java",["-Dfile.encoding=UTF-8","-Duser.timezone=Asia/Riyadh","-jar",jar,"--globalVersion",version,...args],{cwd:output,env:childEnv,encoding:"utf8",timeout:120000,maxBuffer:5*1024*1024})
  const log=(result.stdout??"")+"\n"+(result.stderr??"")
  fs.writeFileSync(path.join(output,label+".log"),log)
  const passed=!result.error && result.status===0 && !/GLOBAL VALIDATION RESULT\s*=\s*FAILED|validation result\s*:\s*FAILED/i.test(log) && required.every((text)=>log.includes(text))
  return {passed,log}
}
const credentials={
  certificateBase64:fs.readFileSync(defaults.certPath,"utf8").trim(),
  privateKeyPem:createPrivateKey({key:Buffer.from(fs.readFileSync(defaults.privateKeyPath,"utf8").trim(),"base64"),type:"sec1",format:"der"}).export({type:"pkcs8",format:"pem"}).toString(),
}
const cases=["standard","simplified"].flatMap(invoiceKind=>["invoice","credit_note","debit_note"].map(docType=>({
  label:`${invoiceKind}-${docType}`,data:{...base,invoiceKind,docType,...(docType!=="invoice"?{referenceInvoiceNumber:"SDK-ORIGINAL-000001",noteReason:"Synthetic test adjustment"}:{})},
})))
for(const invoiceKind of ["standard","simplified"]) cases.push({label:`${invoiceKind}-discounted-invoice`,data:{...base,invoiceKind,docType:"invoice",
  lines:[{...base.lines[0],discount:10,amount:90,vat_amount:13.5}],subtotal:90,discount:10,vatAmount:13.5,total:103.5,qr:{...base.qr,total:103.5,vatAmount:13.5}}})
cases.push({label:"simplified-utc-invoice",data:{...base,invoiceKind:"simplified",docType:"invoice",issueTime:"09:30:00Z"}})
cases.push({label:"simplified-arabic-invoice",data:{...base,invoiceKind:"simplified",docType:"invoice",seller:{...party,name:"شركة النخبة للتطوير التجريبية"},qr:{...base.qr,sellerName:"شركة النخبة للتطوير التجريبية"},lines:[{...base.lines[0],description:"خدمة توصيل تجريبية"}]}})
const evidence={sdkVersion:version,signer:"application zatca-signer.ts",certificate:"public SDK demonstration certificate, not taxpayer credentials",cases:[]}
let last=null
for(const {label,data} of cases) {
  const unsigned=buildZatcaUblInvoice(data)
  const signed=signZatcaInvoice({environment:"sandbox",kind:data.invoiceKind,unsignedXml:unsigned,credentials,signingTime:"2026-10-18T09:31:00"})
  const file=path.join(output,label+"-app-signed.xml")
  fs.writeFileSync(file,signed.signedXml)
  const stages=["[XSD] validation result : PASSED","[EN] validation result : PASSED","[KSA] validation result : PASSED","[QR] validation result : PASSED","[SIGNATURE] validation result : PASSED","[PIH] validation result : PASSED","GLOBAL VALIDATION RESULT = PASSED"]
  const validation=run(label+"-validate",["-validate","-invoice",file],data.invoiceKind==="simplified"?stages:stages.filter(s=>!/QR|SIGNATURE/.test(s)))
  const hash=run(label+"-hash",["-generateHash","-invoice",file],["invoice hash has been generated successfully"])
  const sdkHash=hash.log.match(/INVOICE HASH = ([A-Za-z0-9+/]{43}=)/)?.[1]
  const entry={case:label,validation:validation.passed,hashMatchesSdk:sdkHash===signed.invoiceHash}
  evidence.cases.push(entry)
  if(data.invoiceKind==="simplified") last=signed.signedXml
  console.log(`${entry.validation&&entry.hashMatchesSdk?"PASS":"FAIL"}: ${label} application-signed SDK validation`)
}
const tampered=path.join(output,"app-tampered.xml")
fs.writeFileSync(tampered,last.replace("<cbc:ID>APP-SIGN-000001</cbc:ID>","<cbc:ID>APP-SIGN-000999</cbc:ID>"))
const rejected=run("app-tampered-validate",["-validate","-invoice",tampered])
evidence.tamperingRejected=!rejected.passed && /\[(?:QR|SIGNATURE)\] validation result : FAILED/.test(rejected.log)
const forgedProps=path.join(output,"app-forged-signing-time.xml")
fs.writeFileSync(forgedProps,last.replace(/<xades:SigningTime>[^<]+/,"<xades:SigningTime>2026-10-18T09:59:59"))
const forged=run("app-forged-validate",["-validate","-invoice",forgedProps])
evidence.signedPropertiesBound=!forged.passed && /\[SIGNATURE\] validation result : FAILED/.test(forged.log)
console.log(`${evidence.tamperingRejected?"PASS":"FAIL"}: tampered invoice rejected`)
console.log(`${evidence.signedPropertiesBound?"PASS":"FAIL"}: altered SignedProperties rejected`)
fs.writeFileSync(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2))
console.log("Offline SDK validation only. Authority acceptance requires the sandbox/simulation compliance and reporting APIs.")
if(evidence.cases.some(e=>!e.validation||!e.hashMatchesSdk)||!evidence.tamperingRejected||!evidence.signedPropertiesBound) process.exitCode=1

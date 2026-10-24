// Offline format verification only. Uses the SDK's bundled demonstration
// certificate/key, never tenant credentials, databases or the ZATCA network.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto"
import { createRequire } from "node:module"
import ts from "typescript"
import QRCode from "qrcode"
import { X509 } from "jsrsasign"
import { auditPublicSdkSignature } from "./audit-zatca-sdk-signature.mjs"

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
const output = path.resolve("supabase/.temp",version==="3.0.8"?"zatca-sdk-verification":`zatca-sdk-verification-${version}`)
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
const {computeInvoiceHash,buildSigningInput,verifyZatcaPayload} = loadModule("src/lib/accounting/zatca-crypto.ts")
const {decodeZatcaPhase2Qr,buildZatcaPhase2QrCandidate} = loadModule("src/lib/accounting/zatca-phase2-qr.ts")
const genesis = Buffer.from(createHash("sha256").update("0").digest("hex"),"utf8").toString("base64")
if(fs.readFileSync(defaults.pihPath,"utf8").trim()!==genesis) throw new Error("SDK PIH sample differs from the reviewed genesis fixture")
const party={name:"Synthetic SDK test company",vatNumber:"399999999900003",crNumber:"1010010000",address:"Synthetic Street",buildingNumber:"1234",additionalNumber:"1234",district:"Synthetic District",city:"Riyadh",region:"Riyadh",postalCode:"12345",countryCode:"SA"}
const base={invoiceNumber:"SDK-TEST-000001",uuid:"00000000-0000-4000-8000-000000000001",invoiceCounter:1,previousInvoiceHash:genesis,paymentMeansCode:"30",deliveryDate:"2026-10-18",issueDate:"2026-10-18",issueTime:"09:30:00",currency:"SAR",seller:party,buyer:{...party,name:"Synthetic SDK test buyer",vatNumber:"399999999800003"},lines:[{line_no:1,description:"Synthetic service",quantity:1,unit_price:100,amount:100,vat_rate:15,vat_amount:15}],subtotal:100,discount:0,vatAmount:15,total:115,qr:{sellerName:party.name,sellerVatNumber:party.vatNumber,timestamp:"2026-10-18T09:30:00Z",total:115,vatAmount:15}}
const childEnv={SDK_CONFIG:configPath,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}
function run(label,args,required=[]) {
  const result=spawnSync("java",["-Dfile.encoding=UTF-8","-Duser.timezone=Asia/Riyadh","-jar",jar,"--globalVersion",version,...args],{cwd:output,env:childEnv,encoding:"utf8",timeout:120000,maxBuffer:5*1024*1024})
  const log=(result.stdout??"")+"\n"+(result.stderr??"")
  fs.writeFileSync(path.join(output,label+".log"),log)
  // SDK 3.0.8 exits 0 even after validation/signing failure. Require explicit
  // success text and every expected validation stage; never trust exit alone.
  const passed=!result.error && result.status===0 && !/GLOBAL VALIDATION RESULT\s*=\s*FAILED|failed to sign invoice|validation result\s*:\s*FAILED/i.test(log) && required.every((text)=>log.includes(text))
  return {passed,stages:required.length,exit:result.status,log}
}
function compareHash(label, file) {
  const generated=run(label+"-hash",["-generateHash","-invoice",file],["invoice hash has been generated successfully"])
  const expected=generated.log.match(/INVOICE HASH = ([A-Za-z0-9+/]{43}=)/)?.[1]
  return generated.passed && Boolean(expected) && computeInvoiceHash(fs.readFileSync(file,"utf8"))===expected
}
const evidence={sdkVersion:version,sdkTimeZone:"Asia/Riyadh",certificate:"public SDK demonstration certificate, not taxpayer credentials",certificateValidTo:certificate.validTo,signer:"SDK demonstration signer, not application signer",hashing:"application restricted canonicalization compared with SDK hash generation",productionValidated:false,cases:[]}
const cases=["standard","simplified"].flatMap(invoiceKind=>["invoice","credit_note","debit_note"].map(docType=>({
  label:`${invoiceKind}-${docType}`,data:{...base,invoiceKind,docType,...(docType!=="invoice"?{referenceInvoiceNumber:"SDK-ORIGINAL-000001",noteReason:"Synthetic test adjustment"}:{})},
})))
for(const invoiceKind of ["standard","simplified"]) cases.push({label:`${invoiceKind}-discounted-invoice`,data:{...base,invoiceKind,docType:"invoice",
  lines:[{...base.lines[0],discount:10,amount:90,vat_amount:13.5}],subtotal:90,discount:10,vatAmount:13.5,total:103.5,
  qr:{...base.qr,total:103.5,vatAmount:13.5}}})
// Current SDK converts a zoned source into JVM-local QR time without a suffix.
// Pin the JVM timezone and test a separate UTC source, never infer a zone.
if(version!=="3.0.8") cases.push({label:"simplified-utc-invoice",data:{...base,invoiceKind:"simplified",docType:"invoice",issueTime:"09:30:00Z"}})
for(const {label,data} of cases) {
  const {invoiceKind}=data
  const input=path.join(output,label+".xml"), signed=path.join(output,label+"-sdk-signed.xml")
  fs.writeFileSync(input,buildZatcaUblInvoice(data))
  const unsignedHash=compareHash(label+"-unsigned",input)
  const sign=run(label+"-sign",["-sign","-invoice",input,"-signedInvoice",signed],["invoice has been signed successfully"])
  const stages=["[XSD] validation result : PASSED","[EN] validation result : PASSED","[KSA] validation result : PASSED","[PIH] validation result : PASSED","GLOBAL VALIDATION RESULT = PASSED"]
  if(invoiceKind==="simplified") stages.push("[QR] validation result : PASSED","[SIGNATURE] validation result : PASSED")
  const validation=sign.passed?run(label+"-validate",["-validate","-invoice",signed],stages):{passed:false,stages:0}
  const signedHash=sign.passed && compareHash(label+"-signed",signed)
  const entry={case:label,signing:sign.passed,validation:validation.passed,unsignedHash,signedHash}
  evidence.cases.push(entry)
  console.log(`${entry.validation&&unsignedHash&&signedHash?"PASS":"FAIL"}: ${label} SDK sample validation and application/SDK hash comparison`)
}
// Differential hash edge cases exercise canonical byte behavior, independently
// of the SDK signer's reformatting and its public certificate's validity.
const unsignedSample=fs.readFileSync(path.join(output,"simplified-invoice.xml"),"utf8")
const variants={
  unicode:unsignedSample.replace("Synthetic service","خدمة تجريبية &amp; &lt;service&gt; 🚚"),
  crlf:unsignedSample.replaceAll("\n","\r\n"),
  comments:unsignedSample.replace("<cbc:UBLVersionID>","<!-- ignored comment --><cbc:UBLVersionID>"),
  cdata:unsignedSample.replace("Synthetic service","<![CDATA[Synthetic & <service>]]>"),
  attributes:unsignedSample.replace('currencyID="SAR"','currencyID=\'SAR\''),
}
evidence.hashVariants=[]
for(const [label,xml] of Object.entries(variants)) {
  const file=path.join(output,`hash-${label}.xml`)
  fs.writeFileSync(file,xml)
  const passed=compareHash(`variant-${label}`,file)
  evidence.hashVariants.push({case:label,passed})
  console.log(`${passed?"PASS":"FAIL"}: application/SDK ${label} hash comparison`)
}
const signedSample=fs.readFileSync(path.join(output,version==="3.0.8"?"simplified-invoice-sdk-signed.xml":"simplified-utc-invoice-sdk-signed.xml"),"utf8")
const signature=signedSample.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)?.[1]
if(version!=="3.0.8") evidence.signedInfoAudit=auditPublicSdkSignature(signedSample)
// Independent QR audit: SDK validation is not evidence that its own generated
// tag assignments match the published standard. The supplied 3.0.8 sample puts
// SPKI in tag 7 and signature r/s in tags 8/9. Preserve this finding rather than
// teaching the production decoder to accept a conflicting mapping.
const qr=signedSample.match(/<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)/)?.[1]
if(!qr || !signature) throw new Error("SDK QR audit fixture is incomplete")
const qrBytes=Buffer.from(qr,"base64"), qrFields=[]
for(let offset=0;offset<qrBytes.length;) {
  if(offset+2>qrBytes.length) throw new Error("SDK QR audit found a truncated field")
  const tag=qrBytes[offset++],length=qrBytes[offset++]
  if(!length || offset+length>qrBytes.length) throw new Error("SDK QR audit found an invalid field length")
  qrFields.push({tag,value:qrBytes.subarray(offset,offset+length)}); offset+=length
}
const signatureDer=Buffer.from(signature,"base64")
const rLength=signatureDer[3],sOffset=4+rLength,sLength=signatureDer[sOffset+1]
const expectedLegacy=[
  Buffer.from(computeInvoiceHash(signedSample),"utf8"),
  certificate.publicKey.export({type:"spki",format:"der"}),
  // The SDK copies the DER INTEGER content, including a possible sign-padding
  // zero. Do not normalize to 32 bytes: randomized ECDSA exposes that mismatch.
  signatureDer.subarray(4,4+rLength), signatureDer.subarray(sOffset+2,sOffset+2+sLength),
]
const profileAudit=["binary-digest-signature","base64-text-digest-signature"].map((profile)=>{
  try { decodeZatcaPhase2Qr(qr,"simplified",profile,version==="3.0.8"?"utc":"offsetless-plus03"); return {profile,formatMatches:true} }
  catch(error) { return {profile,formatMatches:false,code:error.code??"UNKNOWN"} }
})
const publicCertificate=new X509()
publicCertificate.readCertPEM(certificate.toString())
const certificateSignature=Buffer.from(publicCertificate.getSignatureValueHex(),"hex")
const expectedPublished=[
  Buffer.from(computeInvoiceHash(signedSample),"utf8"), Buffer.from(signature,"utf8"),
  certificate.publicKey.export({type:"spki",format:"der"}),certificateSignature,
]
const publishedStampFieldsBound=qrFields.length===9 && expectedPublished.every((value,index)=>value.equals(qrFields[index+5]?.value??Buffer.alloc(0)))
let applicationQrMatches=false
if(version!=="3.0.8") {
  const candidate=buildZatcaPhase2QrCandidate("sandbox","base64-text-digest-signature",{
    kind:"simplified",timeProfile:"offsetless-plus03",sellerName:party.name,sellerVatNumber:party.vatNumber,timestamp:"2026-10-18T12:30:00",
    total:base.total.toFixed(2),vatAmount:base.vatAmount.toFixed(2),invoiceHashBase64:computeInvoiceHash(signedSample),
    signatureBase64:signature,publicKeySpkiDer:certificate.publicKey.export({type:"spki",format:"der"}),certificateSignatureDer:certificateSignature,
  })
  applicationQrMatches=candidate===qr
  if(!publishedStampFieldsBound || !applicationQrMatches || !profileAudit.some(p=>p.profile==="base64-text-digest-signature"&&p.formatMatches)) {
    throw new Error("Current SDK QR differs from the independently bound UTC-profile candidate")
  }
}
evidence.qrLayoutAudit={
  tags:qrFields.map(({tag,value})=>({tag,bytes:value.length})),
  suppliedSdkLegacyMapping:qrFields.length===9 && qrFields.every(({tag},index)=>tag===index+1) && expectedLegacy.every((value,index)=>value.equals(qrFields[index+5]?.value??Buffer.alloc(0))),
  profiles:profileAudit,
  publishedStampFieldsBound,applicationQrMatches,
  timeProfile:version==="3.0.8"?"utc":"offsetless-plus03",
  productionCompatible:false,
}
if(version==="3.0.8" && (!evidence.qrLayoutAudit.suppliedSdkLegacyMapping || profileAudit.some((profile)=>profile.formatMatches))) {
  throw new Error("The reviewed SDK QR behavior changed; inspect the public fixture before accepting new evidence")
}
console.log(version==="3.0.8"?"BLOCKED: supplied SDK legacy QR tag layout conflicts with the published assignments":"PASS: current SDK UTC-source QR matches application encoding with invoice hash, signature, certificate key and CA signature byte-bound")
// This checks only the SDK's observed primitive input. It does NOT validate
// complete SignedInfo/SignedProperties binding or assert XMLDSig compliance.
evidence.sdkDigestSignature=Boolean(signature) && verifyZatcaPayload(buildSigningInput(computeInvoiceHash(signedSample)),signature,certificate.publicKey.export({type:"spki",format:"pem"}))
const tampered=path.join(output,"simplified-tampered.xml")
fs.writeFileSync(tampered,signedSample.replace("Synthetic service","Altered synthetic service"))
const rejected=run("tampered-validate",["-validate","-invoice",tampered])
// SDK stops at the first failed stage: a changed canonical hash is rejected
// by QR verification before it reaches SIGNATURE. Require valid structure/tax
// stages so a schema/business error cannot masquerade as a crypto control.
evidence.tamperingRejected=!rejected.passed && ["XSD","EN","KSA"].every((stage)=>rejected.log.includes(`[${stage}] validation result : PASSED`)) && /\[(?:QR|SIGNATURE)\] validation result : FAILED/.test(rejected.log) && !/GLOBAL VALIDATION RESULT = PASSED/.test(rejected.log)
console.log(`${evidence.sdkDigestSignature&&evidence.tamperingRejected?"PASS":"FAIL"}: SDK digest-signature input and tampered-invoice rejection controls`)
fs.writeFileSync(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2))
console.log("Application signing, genuine onboarding, authority acceptance and production QR remain unverified.")
if(evidence.cases.some((entry)=>!entry.validation||!entry.unsignedHash||!entry.signedHash)||evidence.hashVariants.some((entry)=>!entry.passed)||!evidence.sdkDigestSignature||!evidence.tamperingRejected) process.exitCode=1

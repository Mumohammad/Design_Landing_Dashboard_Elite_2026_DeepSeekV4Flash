// Offline investigation of the reviewed public SDK fixture only. Never called
// by the app and never a substitute for authority acceptance or certificate trust.
import { createHash, verify, X509Certificate } from 'node:crypto'
import { DOMParser } from '@xmldom/xmldom'
import { C14nCanonicalization } from 'xml-crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const DS='http://www.w3.org/2000/09/xmldsig#'
const XADES='http://uri.etsi.org/01903/v1.3.2#'
const SHA256='http://www.w3.org/2001/04/xmlenc#sha256'
const FINGERPRINT='A2:86:D2:87:B2:4F:FF:C0:52:BB:E2:00:B1:0C:B3:B3:EE:E4:E5:8D:21:C9:D4:7F:E4:0B:94:64:4C:75:70:69'
const fail=()=>Error('The reviewed public SDK signature fixture is required')
const one=(node,namespace,name)=>{const all=node.getElementsByTagNameNS(namespace,name);if(all.length!==1)throw fail();return all[0]}
const decode=text=>{if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw fail();return Buffer.from(text,'base64')}
function canonical(element){
 const inherited=new Map()
 for(let parent=element.parentNode;parent?.nodeType===1;parent=parent.parentNode){
  for(const attr of Array.from(parent.attributes)) if(attr.namespaceURI==='http://www.w3.org/2000/xmlns/'){
   const prefix=attr.name==='xmlns'?'':attr.localName
   if(!inherited.has(prefix))inherited.set(prefix,attr.value)
  }
 }
 return new C14nCanonicalization().process(element,{ancestorNamespaces:[...inherited].map(([prefix,namespaceURI])=>({prefix,namespaceURI}))})
}
export function auditPublicSdkSignature(xml){
 if(Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY|\bxml:(?:base|id|lang|space)\s*=/.test(xml)||!xml.includes('SDK-TEST-000001'))throw fail()
 const doc=new DOMParser({errorHandler:()=>{throw fail()}}).parseFromString(xml,'application/xml')
 const signature=one(doc,DS,'Signature'),info=one(signature,DS,'SignedInfo')
 const cert=new X509Certificate(decode(one(signature,DS,'X509Certificate').textContent))
 if(cert.fingerprint256!==FINGERPRINT)throw fail()
 if(one(info,DS,'CanonicalizationMethod').getAttribute('Algorithm')!=='http://www.w3.org/2006/12/xml-c14n11'||one(info,DS,'SignatureMethod').getAttribute('Algorithm')!=='http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')throw fail()
 const value=decode(one(signature,DS,'SignatureValue').textContent)
 const properties=one(signature,XADES,'SignedProperties'),id=properties.getAttribute('Id')
 const refs=Array.from(info.getElementsByTagNameNS(DS,'Reference'))
 const reference=refs.find(ref=>ref.getAttribute('URI')==='#'+id)
 if(refs.length!==2||!reference||one(reference,DS,'DigestMethod').getAttribute('Algorithm')!==SHA256)throw fail()
 const claimedProperties=decode(one(reference,DS,'DigestValue').textContent)
 const certDigest=one(one(signature,XADES,'CertDigest'),DS,'DigestValue')
 const claimedCertificate=decode(certDigest.textContent)
 const canonicalInfo=Buffer.from(canonical(info),'utf8')
 const verifyAs=encoding=>{try{return verify('sha256',canonicalInfo,{key:cert.publicKey,dsaEncoding:encoding},value)}catch{return false}}
 return {sdk:'238-R3.4.8',scope:'reviewed public demonstration fixture; restricted common C14N 1.0/1.1 subset',
  signedInfoSignatureVerified:verifyAs('der')||verifyAs('ieee-p1363'),
  signedPropertiesReferenceTypeMatches:reference.getAttribute('Type')==='http://uri.etsi.org/01903#SignedProperties',
  signedPropertiesDigestBytes:claimedProperties.length,
  signedPropertiesRawSha256Matches:claimedProperties.equals(createHash('sha256').update(canonical(properties),'utf8').digest()),
  certificateDigestBytes:claimedCertificate.length,
  certificateRawSha256Matches:claimedCertificate.equals(createHash('sha256').update(cert.raw).digest()),productionValidated:false}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dir=path.resolve('supabase/.temp/zatca-sdk-verification-238-R3.4.8')
 const xml=fs.readFileSync(path.join(dir,'simplified-utc-invoice-sdk-signed.xml'),'utf8')
 const evidence=auditPublicSdkSignature(xml)
 fs.writeFileSync(path.join(dir,'signed-info-audit.json'),JSON.stringify(evidence,null,2))
 console.log(JSON.stringify(evidence))
 console.log('Production gate remains closed: passing SDK format validation alone does not establish the required SignedInfo and SignedProperties binding.')
}

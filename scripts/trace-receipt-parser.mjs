// Next's own tracer follows the worker's native/ESM dependency graph. The
// worker is a runtime asset, so a string spawn path alone is not sufficient.
import nft from 'next/dist/compiled/@vercel/nft/index.js'
import { readFileSync, writeFileSync, readdirSync, realpathSync, lstatSync, readlinkSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { createRequire } from 'node:module'

const root=process.cwd(),entry=resolve('workers/receipt-extract.cjs')
const {nodeFileTrace}=nft
const result=await nodeFileTrace([entry],{base:root,processCwd:root})
const allFiles=new Set([...result.fileList].map(file=>resolve(root,file)))
// unpdf selects its bundled PDF.js/decoder modules dynamically. Static tracing
// cannot discover every selected module, so retain that public package's assets.
function packageAssets(folder){for(const entry of readdirSync(folder,{withFileTypes:true})){const file=resolve(folder,entry.name);if(entry.isDirectory())packageAssets(file);else if(entry.isFile())allFiles.add(file)}}
packageAssets(realpathSync('node_modules/unpdf'))
// Sharp chooses optional native packages from a computed platform name. NFT
// can emit the native files without the pnpm links needed to resolve that name.
const sharpRoot=realpathSync('node_modules/sharp'),sharpRequire=createRequire(resolve(sharpRoot,'package.json'))
const sharpPackage=JSON.parse(readFileSync(resolve(sharpRoot,'package.json'),'utf8'))
const nativePackages=[]
for(const name of Object.keys(sharpPackage.optionalDependencies??{}).filter(name=>name.startsWith('@img/sharp-'))){
 let packageFile;try{packageFile=sharpRequire.resolve(name+'/package')}catch{continue}
 const folder=realpathSync(dirname(packageFile));nativePackages.push({name,folder});packageAssets(folder)
}
for(const folder of [sharpRoot,...nativePackages.map(pkg=>pkg.folder)]){
 const from=createRequire(resolve(folder,'package.json'))
 for(const pkg of nativePackages)for(const search of from.resolve.paths(pkg.name)??[]){
  const candidate=resolve(search,pkg.name)
  if(!candidate.startsWith(root+sep))continue
  try{if(lstatSync(candidate).isSymbolicLink()&&realpathSync(candidate)===pkg.folder)allFiles.add(candidate)}catch{ /* uninstalled search location */ }
 }
}
const workerFiles=[...allFiles]
for(const file of workerFiles){
 const name=relative(root,file).replaceAll('\\','/')
 if(name.startsWith('../')||name.includes('/.env')||/(^|\/)\.env(?:\.|$)|supabase\/\.temp\//.test(name))throw Error('Unexpected private/outside file in receipt worker trace')
}
const targets=[resolve('.next/server/app/api/telegram/expenses/route.js.nft.json')]
function pages(folder){for(const entry of readdirSync(folder,{withFileTypes:true})){const file=resolve(folder,entry.name);if(entry.isDirectory())pages(file);else if(entry.isFile()&&entry.name.endsWith('.js.nft.json'))targets.push(file)}}
pages(resolve('.next/server/app/(dashboard)/expenses/claims'))
if(targets.length<3)throw Error('Receipt parser route/action traces are missing')
for(const target of targets){
 const trace=JSON.parse(readFileSync(target,'utf8'))
 if(trace.version!==1||!Array.isArray(trace.files))throw Error('Unsupported Next runtime trace')
 if(trace.additionalRoots?.length)throw Error('Cross-root receipt runtime tracing is not supported; explicit symlink remapping required')
 trace.files=[...new Set([...trace.files,...workerFiles.map(file=>relative(dirname(target),file).split(sep).join('/'))])].sort()
 // Turbopack's optional hashes and symlinks are indexed by files[]. Reordering
 // requires new indexes. Hashes are optional in NFT v1; resolve every symlink
 // afresh so consumers also see newly traced native package resolution links.
 delete trace.fileHashes
 trace.symlinks=trace.files.flatMap((file,index)=>{
  const source=resolve(dirname(target),file)
  return lstatSync(source).isSymbolicLink()?[[index,relative(dirname(target),resolve(dirname(source),readlinkSync(source))).split(sep).join('/')]]:[]
 })
 writeFileSync(target,JSON.stringify(trace))
}
writeFileSync('.next/receipt-parser-dependency-trace.json',JSON.stringify({version:1,files:workerFiles.map(file=>relative(root,file).split(sep).join('/')).sort(),targets:targets.map(file=>relative(root,file).split(sep).join('/')).sort(),warnings:result.warnings.size},null,2))
console.log(JSON.stringify({check:'receipt parser runtime dependency tracing',workerFiles:workerFiles.length,targets:targets.length,result:'PASS'}))

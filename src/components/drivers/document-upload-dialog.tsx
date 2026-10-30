"use client"
import {useEffect,useState} from "react"
import {useTranslation} from "@/hooks/use-translation"
import {registerDriverDocument} from "@/app/actions/drivers/documents"
import {DOC_UPLOAD_TYPES,DOC_REGISTER_TYPES} from "@/lib/drivers/documents"
import {DRIVER_PHOTO_MIME_TYPES,driverPhotoImageMeta} from "@/lib/drivers/photo"
import {emitDriverChanged} from "@/lib/drivers/driver-events"
import {createClient} from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import {FileUp,Loader2,Upload} from "lucide-react"
import {Button} from "@/components/ui/button"
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select"
const labels:Record<string,[string,string]>={national_id:["National ID","الهوية الوطنية"],iqama:["Iqama","الإقامة"],passport:["Passport","جواز السفر"],driving_license:["Driving licence","رخصة القيادة"],vehicle_license:["Vehicle licence","رخصة المركبة"],medical_certificate:["Medical certificate","الشهادة الطبية"],health_certificate:["Health certificate","الشهادة الصحية"],police_clearance:["Police clearance","صحيفة الحالة الجنائية"],employment_contract:["Employment contract","عقد العمل"],bank_letter:["Bank letter","خطاب البنك"],photo:["Photo","الصورة"],other:["Other document","مستند آخر"],home_delivery_permit:["Home delivery permit","تصريح التوصيل"],ajeer_permit:["Ajeer permit","تصريح أجير"],food_handling_certificate:["Food handling certificate","شهادة تداول الأغذية"],vehicle_lease_agreement:["Vehicle lease agreement","عقد إيجار المركبة"],driver_card:["Driver card","بطاقة السائق"],work_permit:["Work permit","تصريح العمل"],authorization_letter:["Authorization letter","خطاب التفويض"],training_certificate:["Training certificate","شهادة التدريب"]}
type Props={open:boolean;onOpenChange:(open:boolean)=>void;driverId:string;expectedDriverVersion:number;driverType?:string;isAr?:boolean;defaultDocType?:string|null;onUploaded?:()=>void}
export function DocumentUploadDialog(props:Props){
 if(!props.open)return null
 return <DocumentUploadForm key={JSON.stringify([props.driverId,props.expectedDriverVersion,props.defaultDocType])} {...props}/>
}
function DocumentUploadForm({open,onOpenChange,driverId,expectedDriverVersion,defaultDocType=null,onUploaded}:Props){
 const {locale}=useTranslation(),ar=locale==="ar",initial=defaultDocType??DOC_UPLOAD_TYPES[0]
 const allowed=defaultDocType?[defaultDocType]:[...DOC_UPLOAD_TYPES]
 const [docType,setDocType]=useState(initial),[docNumber,setDocNumber]=useState(""),[expiryDate,setExpiryDate]=useState(""),[file,setFile]=useState<File|null>(null),[uploading,setUploading]=useState(false),[revision,setRevision]=useState(0)
 const [readResult,setReadResult]=useState<{docType:string;revision:number;tenantId:string|null;existing:boolean;failed:boolean}|null>(null)
 const current=readResult?.docType===docType&&readResult.revision===revision?readResult:null
 const loading=current===null,tenantId=current?.tenantId??null,existing=current?.existing??false,readFailed=current?.failed??false
 useEffect(()=>{
  if(!open)return
  let cancelled=false
  const load=async()=>{
   try{
    const client=createClient(),driver=await client.from("drivers").select("tenant_id,profile_version").eq("id",driverId).is("deleted_at",null).single()
    if(driver.error||!driver.data||driver.data.profile_version!==expectedDriverVersion||expectedDriverVersion<1)throw Error("Reviewed driver changed")
    const current=await client.from("driver_documents").select("id",{count:"exact"}).eq("driver_id",driverId).eq("doc_type",docType).eq("is_active",true).is("deleted_at",null).limit(1)
    if(current.error||current.count===null)throw Error("Document read failed")
    if(!cancelled)setReadResult({docType,revision,tenantId:driver.data.tenant_id,existing:current.count>0,failed:false})
   }catch{if(!cancelled)setReadResult({docType,revision,tenantId:null,existing:false,failed:true})}
  }
  void load();return()=>{cancelled=true}
 },[open,driverId,expectedDriverVersion,docType,revision])
 const upload=async()=>{
  if(uploading||!file||!tenantId||loading||readFailed)return
  if(!(DOC_REGISTER_TYPES as readonly string[]).includes(docType)||file.size<1||file.size>20971520){toast.error(ar?"اختر ملفاً صالحاً بحجم لا يتجاوز 20 ميجابايت.":"Choose a valid file no larger than 20 MB.");return}
  const image=driverPhotoImageMeta(file),mime=file.type==="application/pdf"||!file.type&&file.name.toLowerCase().endsWith(".pdf")?"application/pdf":image.ok?image.contentType:""
  if(mime!=="application/pdf"&&!DRIVER_PHOTO_MIME_TYPES.has(mime)){toast.error(ar?"يسمح بملفات PDF والصور المدعومة فقط.":"Use a PDF or supported image file.");return}
  setUploading(true)
  try{
   const extension=(file.name.split(".").pop()??"bin").toLowerCase().replace(/[^a-z0-9]/g,"")||"bin",path=tenantId+"/"+driverId+"/"+docType+"-"+crypto.randomUUID()+"."+extension
   const uploaded=await createClient().storage.from("driver-documents").upload(path,file,{upsert:false,contentType:mime})
   if(uploaded.error)throw Error("Upload not confirmed")
   const result=await registerDriverDocument({driverId,expectedDriverVersion,docType,filePath:path,...(docNumber.trim()?{docNumber:docNumber.trim()}:{}),...(expiryDate?{expiryDate}:{}),fileSize:file.size,mimeType:mime})
   if(!result.ok){toast.error(ar?result.errorAr:result.error);return}
   toast.success(ar?"تم حفظ المستند مع الاحتفاظ بالسجل السابق.":"Document saved; prior evidence is retained.");onOpenChange(false);onUploaded?.();emitDriverChanged({driverId,action:"document"})
  }catch{toast.error(ar?"تعذر تأكيد رفع المستند. أعد تحميل الملف قبل المحاولة مجدداً؛ لن تُحذف الملفات المرفوعة.":"The document upload could not be confirmed. Reload the profile before retrying; uploaded files are retained.")}finally{setUploading(false)}
 }
 return <Dialog open={open} onOpenChange={value=>{if(!uploading)onOpenChange(value)}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><FileUp className="size-5 text-primary"/>{ar?"رفع مستند":"Upload Document"}</DialogTitle><DialogDescription>{ar?"يُحفظ الملف الجديد بشكل مستقل. تبقى المستندات السابقة محفوظة في سجل الاستبدال.":"The new file is stored separately. Previous documents remain in replacement history."}</DialogDescription></DialogHeader>
 {readFailed?<div role="alert" className="space-y-2"><p className="text-sm text-destructive">{ar?"تعذر تحميل المستندات أو تغير ملف السائق. أعد تحميل الملف وراجع حالته قبل الرفع.":"Could not load the evidence, or the driver changed. Reload and review the profile before uploading."}</p><Button variant="outline" onClick={()=>setRevision(v=>v+1)}>{ar?"أعد المحاولة":"Try again"}</Button></div>:null}
 {existing&&!readFailed?<p className="rounded-lg border bg-muted p-3 text-sm">{ar?"يوجد مستند سارٍ من هذا النوع؛ سيُنقل إلى سجل الاستبدال.":"A current document of this type will move to replacement history."}</p>:null}
 <div className="space-y-4"><div className="space-y-2"><Label htmlFor="doc-type">{ar?"نوع المستند":"Document type"}</Label><Select value={docType} onValueChange={setDocType} disabled={uploading||allowed.length<=1}><SelectTrigger id="doc-type"><SelectValue/></SelectTrigger><SelectContent>{allowed.map(type=><SelectItem key={type} value={type}>{labels[type]?.[ar?1:0]??(ar?"مستند":"Document")}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="doc-number">{ar?"رقم المستند (اختياري)":"Document number (optional)"}</Label><Input id="doc-number" value={docNumber} onChange={e=>setDocNumber(e.target.value)} maxLength={100} disabled={uploading}/></div><div className="space-y-2"><Label htmlFor="doc-expiry">{ar?"تاريخ الانتهاء (اختياري)":"Expiry date (optional)"}</Label><Input id="doc-expiry" type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} disabled={uploading}/></div></div><div className="space-y-2"><Label htmlFor="doc-file">{ar?"الملف (20 ميجابايت كحد أقصى)":"File (max 20 MB)"}</Label><Input id="doc-file" type="file" accept="image/*,application/pdf" onChange={e=>setFile(e.target.files?.[0]??null)} disabled={uploading}/></div></div>
 <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)} disabled={uploading}>{ar?"إلغاء":"Cancel"}</Button><Button onClick={()=>void upload()} disabled={uploading||!file||loading||readFailed||!tenantId}>{uploading?<Loader2 className="size-4 animate-spin"/>:<Upload className="size-4"/>}{ar?"رفع":"Upload"}</Button></DialogFooter></DialogContent></Dialog>
}

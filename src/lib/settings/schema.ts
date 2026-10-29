import { z } from "zod"
const optionalText = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).nullable().optional()
export const companySettingsSchema = z.object({
 name_ar:z.string().trim().min(1).max(200),name_en:z.string().trim().min(1).max(200),
 legal_name:optionalText(250),cr_number:z.string().regex(/^[0-9]{10}$/).nullable().optional(),
 vat_number:z.string().regex(/^3[0-9]{13}3$/).nullable().optional(),address:optionalText(1000),city:optionalText(100),region:optionalText(100),building_number:z.string().regex(/^[0-9]{4}$/).nullable().optional(),additional_number:z.string().regex(/^[0-9]{4}$/).nullable().optional(),district:optionalText(100),postal_code:z.string().regex(/^[0-9]{5}$/).nullable().optional(),country:z.string().trim().min(1).max(100).optional(),phone:optionalText(32),
 email:z.string().email().max(320).nullable().optional(),logo_url:z.string().url().max(1024).nullable().optional(),
 timezone:z.string().trim().min(1).max(100).optional(),default_locale:z.enum(["ar","en"]).optional(),
}).strict()
export const PAYROLL_SETTING_KEYS = ["payroll.default_working_days","payroll.saudi_minimum_wage","payroll.min_net_floor"] as const
export const payrollSettingsSchema = z.array(z.object({key:z.enum(PAYROLL_SETTING_KEYS),value:z.string().trim().regex(/^[0-9]+(?:\.[0-9]{1,2})?$/).max(14)}).strict()).min(1).max(3).superRefine((rows,ctx)=>{
 if(new Set(rows.map(row=>row.key)).size!==rows.length)ctx.addIssue({code:"custom",message:"Duplicate setting"})
 for(const row of rows){const n=Number(row.value);if(n>999999999.99||(row.key==="payroll.default_working_days"&&(!Number.isInteger(n)||n<1||n>31)))ctx.addIssue({code:"custom",message:"Invalid reference value"})}
})
export function isSaudiIban(value:string):boolean {
 if(!/^SA\d{22}$/.test(value))return false
 const rearranged=value.slice(4)+value.slice(0,4)
 let remainder=0
 for(const char of rearranged){const digits=/[A-Z]/.test(char)?String(char.charCodeAt(0)-55):char;for(const digit of digits)remainder=(remainder*10+Number(digit))%97}
 return remainder===1
}
export const wpsSettingsSchema=z.object({molReference:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{0,49}$/),wpsIban:z.string().transform(value=>value.replace(/\s/g,"").toUpperCase()).refine(isSaudiIban)}).strict()
export type SettingsCode="SETTINGS_INVALID"|"SETTINGS_STALE"|"SETTINGS_FORBIDDEN"|"SETTINGS_RATE_LIMIT"|"SETTINGS_UNAVAILABLE"
const messages:Record<SettingsCode,{ar:string;en:string}>={
 SETTINGS_INVALID:{ar:"راجع الحقول المطلوبة وصيغ القيم ثم أعد المحاولة.",en:"Check the required fields and value formats, then try again."},
 SETTINGS_STALE:{ar:"تغيرت إعدادات المنشأة. أعد تحميل الصفحة وراجع القيم قبل الحفظ.",en:"Company settings changed. Reload the page and review the values before saving."},
 SETTINGS_FORBIDDEN:{ar:"ليست لديك صلاحية إدارة هذه الإعدادات.",en:"You do not have permission to manage these settings."},
 SETTINGS_RATE_LIMIT:{ar:"محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",en:"Too many attempts. Wait a moment and try again."},
 SETTINGS_UNAVAILABLE:{ar:"تعذر تأكيد نتيجة الحفظ. أعد تحميل الصفحة وراجع القيم قبل المحاولة.",en:"The save result could not be confirmed. Reload and review the values before retrying."},
}
export function settingsMessage(code:SettingsCode,locale:"ar"|"en"):string{return messages[code]?.[locale]??messages.SETTINGS_UNAVAILABLE[locale]}

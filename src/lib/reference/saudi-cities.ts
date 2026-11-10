// Saudi cities and governorate seats grouped by the 13 administrative regions.
// Picking a city fills drivers.current_region automatically.
export interface SaudiRegion { code: string; en: string; ar: string }
export interface SaudiCity { en: string; ar: string; region: string }

export const SAUDI_REGIONS: readonly SaudiRegion[] = [
  { code: "RD", en: "Riyadh", ar: "الرياض" },
  { code: "MK", en: "Makkah", ar: "مكة المكرمة" },
  { code: "MD", en: "Madinah", ar: "المدينة المنورة" },
  { code: "EP", en: "Eastern Province", ar: "المنطقة الشرقية" },
  { code: "QS", en: "Qassim", ar: "القصيم" },
  { code: "AS", en: "Asir", ar: "عسير" },
  { code: "TB", en: "Tabuk", ar: "تبوك" },
  { code: "HA", en: "Hail", ar: "حائل" },
  { code: "NB", en: "Northern Borders", ar: "الحدود الشمالية" },
  { code: "JZ", en: "Jazan", ar: "جازان" },
  { code: "NJ", en: "Najran", ar: "نجران" },
  { code: "BH", en: "Al Bahah", ar: "الباحة" },
  { code: "JF", en: "Al Jawf", ar: "الجوف" },
]

const c = (region: string, list: [string, string][]): SaudiCity[] => list.map(([en, ar]) => ({ en, ar, region }))

export const SAUDI_CITIES: readonly SaudiCity[] = [
  ...c("RD", [["Riyadh", "الرياض"], ["Al Kharj", "الخرج"], ["Ad Diriyah", "الدرعية"], ["Al Majmaah", "المجمعة"], ["Az Zulfi", "الزلفي"], ["Shaqra", "شقراء"], ["Ad Dawadimi", "الدوادمي"], ["Al Quwaiyah", "القويعية"], ["Wadi Ad Dawasir", "وادي الدواسر"], ["Al Aflaj", "الأفلاج"], ["As Sulayyil", "السليل"], ["Afif", "عفيف"], ["Al Ghat", "الغاط"], ["Huraymila", "حريملاء"], ["Al Muzahimiyah", "المزاحمية"], ["Rimah", "رماح"], ["Thadiq", "ثادق"], ["Al Hariq", "الحريق"], ["Hawtat Bani Tamim", "حوطة بني تميم"], ["Ad Dilam", "الدلم"], ["Al Hayathem", "الحياثم"], ["Durma", "ضرما"], ["Marat", "مرات"], ["Al Rain", "الرين"]]),
  ...c("MK", [["Makkah", "مكة المكرمة"], ["Jeddah", "جدة"], ["Taif", "الطائف"], ["Rabigh", "رابغ"], ["Al Qunfudhah", "القنفذة"], ["Al Lith", "الليث"], ["Al Jumum", "الجموم"], ["Al Kamil", "الكامل"], ["Khulais", "خليص"], ["Ranyah", "رنية"], ["Turabah", "تربة"], ["Al Khurmah", "الخرمة"], ["Al Muwayh", "الموية"], ["Maysan", "ميسان"], ["Adham", "أضم"], ["Al Ardiyat", "العرضيات"], ["Bahrah", "بحرة"], ["King Abdullah Economic City", "مدينة الملك عبدالله الاقتصادية"]]),
  ...c("MD", [["Madinah", "المدينة المنورة"], ["Yanbu", "ينبع"], ["Al Ula", "العلا"], ["Badr", "بدر"], ["Khaybar", "خيبر"], ["Al Mahd", "المهد"], ["Al Hinakiyah", "الحناكية"], ["Wadi Al Fara", "وادي الفرع"], ["Al Ais", "العيص"]]),
  ...c("EP", [["Dammam", "الدمام"], ["Al Khobar", "الخبر"], ["Dhahran", "الظهران"], ["Al Ahsa", "الأحساء"], ["Al Hofuf", "الهفوف"], ["Al Mubarraz", "المبرز"], ["Al Qatif", "القطيف"], ["Jubail", "الجبيل"], ["Hafar Al Batin", "حفر الباطن"], ["Ras Tanura", "رأس تنورة"], ["Al Khafji", "الخفجي"], ["Abqaiq", "بقيق"], ["An Nairyah", "النعيرية"], ["Qaryat Al Ulya", "قرية العليا"], ["Al Udayd", "العديد"], ["Saihat", "سيهات"], ["Safwa", "صفوى"], ["Tarout", "تاروت"], ["Al Qaisumah", "القيصومة"], ["Salwa", "سلوى"]]),
  ...c("QS", [["Buraydah", "بريدة"], ["Unaizah", "عنيزة"], ["Ar Rass", "الرس"], ["Al Mithnab", "المذنب"], ["Al Bukayriyah", "البكيرية"], ["Al Badai", "البدائع"], ["Al Asyah", "الأسياح"], ["An Nabhaniyah", "النبهانية"], ["Uyun Al Jiwa", "عيون الجواء"], ["Riyadh Al Khabra", "رياض الخبراء"], ["Ash Shimasiyah", "الشماسية"], ["Uqlat As Suqur", "عقلة الصقور"], ["Dariyah", "ضرية"]]),
  ...c("AS", [["Abha", "أبها"], ["Khamis Mushait", "خميس مشيط"], ["Bisha", "بيشة"], ["An Namas", "النماص"], ["Muhayil", "محايل عسير"], ["Sarat Abidah", "سراة عبيدة"], ["Tathlith", "تثليث"], ["Rijal Almaa", "رجال ألمع"], ["Ahad Rafidah", "أحد رفيدة"], ["Dhahran Al Janub", "ظهران الجنوب"], ["Balqarn", "بلقرن"], ["Al Majardah", "المجاردة"], ["Tanomah", "تنومة"], ["Bariq", "بارق"], ["Tarib", "طريب"]]),
  ...c("TB", [["Tabuk", "تبوك"], ["Al Wajh", "الوجه"], ["Duba", "ضباء"], ["Tayma", "تيماء"], ["Umluj", "أملج"], ["Haql", "حقل"], ["Al Bad", "البدع"], ["NEOM", "نيوم"]]),
  ...c("HA", [["Hail", "حائل"], ["Baqaa", "بقعاء"], ["Al Ghazalah", "الغزالة"], ["Ash Shinan", "الشنان"], ["Al Hait", "الحائط"], ["As Sulaimi", "السليمي"], ["Ash Shamli", "الشملي"], ["Mawqaq", "موقق"], ["Samira", "سميراء"]]),
  ...c("NB", [["Arar", "عرعر"], ["Rafha", "رفحاء"], ["Turaif", "طريف"], ["Al Uwayqilah", "العويقيلة"]]),
  ...c("JZ", [["Jazan", "جازان"], ["Sabya", "صبيا"], ["Abu Arish", "أبو عريش"], ["Samtah", "صامطة"], ["Al Harth", "الحرث"], ["Ad Darb", "الدرب"], ["Ahad Al Masarihah", "أحد المسارحة"], ["Baish", "بيش"], ["Farasan", "فرسان"], ["Ad Dayer", "الداير"], ["Al Aridhah", "العارضة"], ["Al Aydabi", "العيدابي"], ["Damad", "ضمد"], ["Al Tuwal", "الطوال"], ["Fifa", "فيفاء"], ["Haroob", "هروب"], ["Al Raith", "الريث"]]),
  ...c("NJ", [["Najran", "نجران"], ["Sharurah", "شرورة"], ["Hubuna", "حبونا"], ["Badr Al Janub", "بدر الجنوب"], ["Yadamah", "يدمة"], ["Thar", "ثار"], ["Khubash", "خباش"]]),
  ...c("BH", [["Al Bahah", "الباحة"], ["Baljurashi", "بلجرشي"], ["Al Mandaq", "المندق"], ["Al Mikhwah", "المخواة"], ["Al Aqiq", "العقيق"], ["Qilwah", "قلوة"], ["Al Qura", "القرى"]]),
  ...c("JF", [["Sakaka", "سكاكا"], ["Al Qurayyat", "القريات"], ["Dumat Al Jandal", "دومة الجندل"], ["Tabarjal", "طبرجل"]]),
]

export function regionByCode(code: string): SaudiRegion | undefined {
  return SAUDI_REGIONS.find((r) => r.code === code)
}

/** Resolve a typed/stored city name in either language. */
export function findSaudiCity(value: string | null | undefined): SaudiCity | undefined {
  const v = value?.trim().toLowerCase()
  if (!v) return undefined
  return SAUDI_CITIES.find((city) => city.ar === v || city.en.toLowerCase() === v)
}

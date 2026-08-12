// ─────────────────────────────────────────────────────────────────────────────
// Driver Registration — 4-language dictionary (ar / en / ur / bn).
// Self-contained: the public portal keeps its own locale system so it never
// conflicts with the main app's ar/en LocaleContext.
// ─────────────────────────────────────────────────────────────────────────────

export type RegistrationLocale = "ar" | "en" | "ur" | "bn"

export const registrationLocaleMeta: Record<
  RegistrationLocale,
  { label: string; flag: string; dir: "rtl" | "ltr"; font: string }
> = {
  ar: { label: "العربية", flag: "🇸🇦", dir: "rtl", font: "cairo" },
  en: { label: "English", flag: "🇬🇧", dir: "ltr", font: "inter" },
  ur: { label: "اردو", flag: "🇵🇰", dir: "rtl", font: "cairo" },
  bn: { label: "বাংলা", flag: "🇧🇩", dir: "ltr", font: "inter" },
}

export interface RegistrationDictionary {
  meta: { title: string; description: string }
  header: { brand: string; tagline: string }
  language: { label: string }
  welcome: {
    badge: string
    title: string
    subtitle: string
    steps: string
    ctaStart: string
    trustPoints: string[]
  }
  progress: { step: string; of: string; complete: string }
  steps: {
    personal: string
    contact: string
    identity: string
    license: string
    work: string
    platforms: string
    vehicle: string
    documents: string
    review: string
  }
  common: {
    back: string
    next: string
    continue: string
    submit: string
    optional: string
    required: string
    select: string
    upload: string
    remove: string
    yes: string
    no: string
    none: string
    valid: string
    expiringSoon: string
    expired: string
    today: string
    invalidDate: string
    errorGeneric: string
    errorRequired: string
    errorInvalidMobile: string
    errorInvalidEmail: string
    errorTooLong: string
    uploadErrorType: string
    uploadErrorSize: string
    uploading: string
    uploaded: string
    dragDrop: string
    or: string
    takePhoto: string
    chooseFile: string
    photo: string
    document: string
  }
  personal: {
    heading: string
    subheading: string
    firstName: string
    firstNamePh: string
    middleName: string
    middleNamePh: string
    lastName: string
    lastNamePh: string
    fullName: string
    dateOfBirth: string
    nationality: string
    nationalityPh: string
    gender: string
    male: string
    female: string
    profilePhoto: string
    profilePhotoHint: string
  }
  contact: {
    heading: string
    subheading: string
    mobile: string
    mobilePh: string
    altMobile: string
    altMobilePh: string
    email: string
    emailPh: string
    city: string
    cityPh: string
    district: string
    districtPh: string
    address: string
    addressPh: string
  }
  identity: {
    heading: string
    subheading: string
    type: string
    iqama: string
    nationalId: string
    passport: string
    number: string
    expiry: string
    attachment: string
    attachmentHint: string
    numberPh: string
  }
  license: {
    heading: string
    subheading: string
    number: string
    numberPh: string
    type: string
    typePh: string
    country: string
    countryPh: string
    expiry: string
    attachment: string
    attachmentHint: string
  }
  work: {
    heading: string
    subheading: string
    fullTime: string
    fullTimeDesc: string
    freelancer: string
    freelancerDesc: string
    categoryHeading: string
    sponsored1: string
    sponsored1Desc: string
    sponsored2: string
    sponsored2Desc: string
    freelancerNote: string
  }
  platforms: {
    heading: string
    subheading: string
    none: string
    noneDesc: string
    errorNone: string
  }
  vehicle: {
    heading: string
    subheading: string
    haveVehicle: string
    ownership: string
    ownershipPh: string
    type: string
    typePh: string
    make: string
    makePh: string
    model: string
    modelPh: string
    year: string
    yearPh: string
    plate: string
    platePh: string
    regExpiry: string
    insuranceExpiry: string
    regAttachment: string
    insuranceAttachment: string
    owned: string
    leased: string
    motorbike: string
    car: string
    van: string
    truck: string
  }
  documents: {
    heading: string
    subheading: string
    identityDoc: string
    licenseDoc: string
    vehicleRegDoc: string
    vehicleInsuranceDoc: string
    requiredLabel: string
  }
  review: {
    heading: string
    subheading: string
    consentTerms: string
    consentPrivacy: string
    consentRequired: string
    edit: string
    confirmSubmit: string
    validating: string
    submitting: string
  }
  success: {
    heading: string
    message: string
    applicationNumber: string
    status: string
    statusValue: string
    copy: string
    copied: string
    print: string
    downloadPdf: string
    returnHome: string
    whatNext: string
    note: string
    documentCompletion: string
    submittedDate: string
  }
  print: {
    title: string
    applicant: string
    workType: string
    driverCategory: string
    platforms: string
    submissionDate: string
    status: string
  }
  footer: { rights: string }
}

const en: RegistrationDictionary = {
  meta: {
    title: "Driver Registration | Elite Development",
    description:
      "Apply to drive with Elite Development. Complete your driver application online — no account needed. Available in العربية, English, اردو and বাংলা.",
  },
  header: { brand: "Elite Development", tagline: "Driver Application Portal" },
  language: { label: "Language" },
  welcome: {
    badge: "Driver Registration",
    title: "Start your journey with Elite Development.",
    subtitle: "Complete your application in a few simple steps — no account, no sign-in.",
    steps: "Takes about 10 minutes",
    ctaStart: "Start Application",
    trustPoints: [
      "No account required",
      "Your documents stay private",
      "Apply from any device",
    ],
  },
  progress: { step: "Step", of: "of", complete: "Complete" },
  steps: {
    personal: "Personal",
    contact: "Contact",
    identity: "Identity",
    license: "Driving License",
    work: "Work Type",
    platforms: "Platforms",
    vehicle: "Vehicle",
    documents: "Documents",
    review: "Review",
  },
  common: {
    back: "Back",
    next: "Continue",
    continue: "Continue",
    submit: "Submit Application",
    optional: "Optional",
    required: "Required",
    select: "Select",
    upload: "Upload Document",
    remove: "Remove",
    yes: "Yes",
    no: "No",
    none: "None",
    valid: "Valid",
    expiringSoon: "Expiring soon",
    expired: "Expired",
    today: "Today",
    invalidDate: "Please enter a valid date",
    errorGeneric: "Something went wrong. Please try again.",
    errorRequired: "This field is required",
    errorInvalidMobile: "Please enter a valid mobile number (e.g. 05XXXXXXXX)",
    errorInvalidEmail: "Please enter a valid email address",
    errorTooLong: "Input is too long",
    uploadErrorType: "Only JPG, PNG, WEBP or PDF files are allowed",
    uploadErrorSize: "File must be 5 MB or smaller",
    uploading: "Uploading…",
    uploaded: "Uploaded",
    dragDrop: "Drag file here",
    or: "or",
    takePhoto: "Take Photo",
    chooseFile: "Choose File",
    photo: "Photo",
    document: "Document",
  },
  personal: {
    heading: "Personal Details",
    subheading: "Tell us who you are.",
    firstName: "First Name",
    firstNamePh: "e.g. Ahmed",
    middleName: "Middle Name",
    middleNamePh: "e.g. Mohammed",
    lastName: "Last Name",
    lastNamePh: "e.g. Al-Qahtani",
    fullName: "Full Name",
    dateOfBirth: "Date of Birth",
    nationality: "Nationality",
    nationalityPh: "e.g. Saudi",
    gender: "Gender",
    male: "Male",
    female: "Female",
    profilePhoto: "Profile Photo",
    profilePhotoHint: "A clear, recent photo of yourself",
  },
  contact: {
    heading: "Contact Information",
    subheading: "How can we reach you?",
    mobile: "Mobile Number",
    mobilePh: "05XXXXXXXX",
    altMobile: "Alternative Mobile",
    altMobilePh: "Optional",
    email: "Email Address",
    emailPh: "you@example.com",
    city: "City",
    cityPh: "e.g. Riyadh",
    district: "District",
    districtPh: "e.g. Al Olaya",
    address: "Address",
    addressPh: "Street, building, apartment",
  },
  identity: {
    heading: "Identity Information",
    subheading: "Choose the document you'll use.",
    type: "Identity Type",
    iqama: "Iqama",
    nationalId: "National ID",
    passport: "Passport",
    number: "Identity Number",
    expiry: "Expiry Date",
    attachment: "Identity Document",
    attachmentHint: "A clear scan or photo of your identity document",
    numberPh: "Enter identity number",
  },
  license: {
    heading: "Driving License",
    subheading: "Your valid driving license details.",
    number: "License Number",
    numberPh: "Enter license number",
    type: "License Type",
    typePh: "e.g. Light Vehicle",
    country: "Issuing Country",
    countryPh: "e.g. Saudi Arabia",
    expiry: "License Expiry",
    attachment: "Driving License",
    attachmentHint: "A clear scan or photo of your license",
  },
  work: {
    heading: "How would you like to work with us?",
    subheading: "Choose the arrangement that fits you.",
    fullTime: "Full-Time",
    fullTimeDesc: "Work with Elite Development as a full-time driver.",
    freelancer: "Freelancer",
    freelancerDesc: "Work under freelance terms.",
    categoryHeading: "Choose your category",
    sponsored1: "Sponsored — Type 1",
    sponsored1Desc: "Company provides vehicle, petrol and accommodation.",
    sponsored2: "Sponsored — Type 2",
    sponsored2Desc: "Company provides vehicle and accommodation, without petrol.",
    freelancerNote: "Compensation and operating terms are determined by company policy.",
  },
  platforms: {
    heading: "Which platforms do you work with?",
    subheading: "Select one or more platforms you have experience with.",
    none: "None / No Platform Experience",
    noneDesc: "Clears all other selections.",
    errorNone: "Please select at least one platform or choose None.",
  },
  vehicle: {
    heading: "Vehicle",
    subheading: "Do you currently have a vehicle?",
    haveVehicle: "Do you have a vehicle?",
    ownership: "Ownership",
    ownershipPh: "Owned / Leased",
    type: "Vehicle Type",
    typePh: "e.g. Car",
    make: "Make",
    makePh: "e.g. Toyota",
    model: "Model",
    modelPh: "e.g. Corolla",
    year: "Year",
    yearPh: "e.g. 2022",
    plate: "Plate Number",
    platePh: "e.g. ABC 1234",
    regExpiry: "Registration Expiry",
    insuranceExpiry: "Insurance Expiry",
    regAttachment: "Vehicle Registration",
    insuranceAttachment: "Vehicle Insurance",
    owned: "Owned",
    leased: "Leased",
    motorbike: "Motorbike",
    car: "Car",
    van: "Van",
    truck: "Truck",
  },
  documents: {
    heading: "Document Center",
    subheading: "Upload clear photos or scans of your documents.",
    identityDoc: "Identity Document",
    licenseDoc: "Driving License",
    vehicleRegDoc: "Vehicle Registration",
    vehicleInsuranceDoc: "Vehicle Insurance",
    requiredLabel: "Required",
  },
  review: {
    heading: "Review & Submit",
    subheading: "Check your details before submitting.",
    consentTerms: "I agree to the terms and conditions of Elite Development.",
    consentPrivacy: "I consent to Elite Development processing my personal data for recruitment purposes.",
    consentRequired: "Please accept the consent statements to submit.",
    edit: "Edit",
    confirmSubmit: "Submit Application",
    validating: "Validating…",
    submitting: "Submitting…",
  },
  success: {
    heading: "Application Received",
    message: "Thank you for applying to Elite Development.",
    applicationNumber: "Application Number",
    status: "Status",
    statusValue: "Submitted",
    copy: "Copy Number",
    copied: "Copied!",
    print: "Print Confirmation",
    downloadPdf: "Download PDF",
    returnHome: "Return to Website",
    whatNext: "Our recruitment team will review your application and contact you on the mobile number you provided.",
    note: "Keep your application number — you'll need it to follow up.",
    documentCompletion: "Document completion",
    submittedDate: "Submission date",
  },
  print: {
    title: "Elite Development — Driver Application",
    applicant: "Applicant",
    workType: "Work type",
    driverCategory: "Driver category",
    platforms: "Platforms",
    submissionDate: "Submission date",
    status: "Status",
  },
  footer: { rights: "© {year} Elite Development" },
}

const ar: RegistrationDictionary = {
  meta: {
    title: "تسجيل السائقين | Elite Development",
    description:
      "قدّم طلبك للعمل كسائق مع نخبة التطوير. أكمل طلبك إلكترونيًا — دون الحاجة إلى حساب. متوفر بالعربية والإنجليزية والأردية والبنغالية.",
  },
  header: { brand: "نخبة التطوير", tagline: "بوابة طلبات السائقين" },
  language: { label: "اللغة" },
  welcome: {
    badge: "تسجيل السائقين",
    title: "ابدأ رحلتك مع نخبة التطوير.",
    subtitle: "أكمل طلبك في خطوات بسيطة — دون حساب أو تسجيل دخول.",
    steps: "يستغرق حوالي ١٠ دقائق",
    ctaStart: "ابدأ التقديم",
    trustPoints: ["لا يتطلب حسابًا", "مستنداتك تبقى خاصة", "قدّم من أي جهاز"],
  },
  progress: { step: "الخطوة", of: "من", complete: "مكتمل" },
  steps: {
    personal: "البيانات الشخصية",
    contact: "التواصل",
    identity: "الهوية",
    license: "رخصة القيادة",
    work: "نوع العمل",
    platforms: "المنصات",
    vehicle: "المركبة",
    documents: "المستندات",
    review: "المراجعة",
  },
  common: {
    back: "رجوع",
    next: "متابعة",
    continue: "متابعة",
    submit: "إرسال الطلب",
    optional: "اختياري",
    required: "مطلوب",
    select: "اختر",
    upload: "رفع المستند",
    remove: "إزالة",
    yes: "نعم",
    no: "لا",
    none: "لا يوجد",
    valid: "ساري",
    expiringSoon: "ينتهي قريبًا",
    expired: "منتهي",
    today: "اليوم",
    invalidDate: "يرجى إدخال تاريخ صحيح",
    errorGeneric: "حدث خطأ ما. حاول مرة أخرى.",
    errorRequired: "هذا الحقل مطلوب",
    errorInvalidMobile: "يرجى إدخال رقم جوال صحيح (مثال: 05XXXXXXXX)",
    errorInvalidEmail: "يرجى إدخال بريد إلكتروني صحيح",
    errorTooLong: "الإدخال طويل جدًا",
    uploadErrorType: "يُسمح فقط بملفات JPG أو PNG أو WEBP أو PDF",
    uploadErrorSize: "يجب أن يكون الملف ٥ ميجابايت أو أقل",
    uploading: "جارٍ الرفع…",
    uploaded: "تم الرفع",
    dragDrop: "اسحب الملف هنا",
    or: "أو",
    takePhoto: "التقاط صورة",
    chooseFile: "اختيار ملف",
    photo: "صورة",
    document: "مستند",
  },
  personal: {
    heading: "البيانات الشخصية",
    subheading: "أخبرنا من أنت.",
    firstName: "الاسم الأول",
    firstNamePh: "مثال: أحمد",
    middleName: "الاسم الأوسط",
    middleNamePh: "مثال: محمد",
    lastName: "اسم العائلة",
    lastNamePh: "مثال: القحطاني",
    fullName: "الاسم الكامل",
    dateOfBirth: "تاريخ الميلاد",
    nationality: "الجنسية",
    nationalityPh: "مثال: سعودي",
    gender: "الجنس",
    male: "ذكر",
    female: "أنثى",
    profilePhoto: "الصورة الشخصية",
    profilePhotoHint: "صورة واضحة وحديثة لك",
  },
  contact: {
    heading: "بيانات التواصل",
    subheading: "كيف نتواصل معك؟",
    mobile: "رقم الجوال",
    mobilePh: "05XXXXXXXX",
    altMobile: "جوال بديل",
    altMobilePh: "اختياري",
    email: "البريد الإلكتروني",
    emailPh: "you@example.com",
    city: "المدينة",
    cityPh: "مثال: الرياض",
    district: "الحي",
    districtPh: "مثال: العليا",
    address: "العنوان",
    addressPh: "الشارع، المبنى، الشقة",
  },
  identity: {
    heading: "بيانات الهوية",
    subheading: "اختر المستند الذي ستستخدمه.",
    type: "نوع الهوية",
    iqama: "إقامة",
    nationalId: "هوية وطنية",
    passport: "جواز سفر",
    number: "رقم الهوية",
    expiry: "تاريخ الانتهاء",
    attachment: "وثيقة الهوية",
    attachmentHint: "صورة أو مسح واضح لوثيقة هويتك",
    numberPh: "أدخل رقم الهوية",
  },
  license: {
    heading: "رخصة القيادة",
    subheading: "بيانات رخصة قيادتك السارية.",
    number: "رقم الرخصة",
    numberPh: "أدخل رقم الرخصة",
    type: "نوع الرخصة",
    typePh: "مثال: مركبة خفيفة",
    country: "دولة الإصدار",
    countryPh: "مثال: المملكة العربية السعودية",
    expiry: "انتهاء الرخصة",
    attachment: "رخصة القيادة",
    attachmentHint: "صورة أو مسح واضح لرخصتك",
  },
  work: {
    heading: "كيف تود العمل معنا؟",
    subheading: "اختر الترتيب المناسب لك.",
    fullTime: "دوام كامل",
    fullTimeDesc: "العمل مع نخبة التطوير كسائق بدوام كامل.",
    freelancer: "سائق حر",
    freelancerDesc: "العمل وفق شروط العمل الحر.",
    categoryHeading: "اختر الفئة",
    sponsored1: "مكفول — النوع ١",
    sponsored1Desc: "توفر الشركة المركبة والبنزين والسكن.",
    sponsored2: "مكفول — النوع ٢",
    sponsored2Desc: "توفر الشركة المركبة والسكن دون البنزين.",
    freelancerNote: "تُحدد التعويضات وشروط التشغيل وفق سياسة الشركة.",
  },
  platforms: {
    heading: "ما المنصات التي تعمل معها؟",
    subheading: "اختر منصة أو أكثر لديك خبرة بها.",
    none: "لا يوجد / لا خبرة بالمنصات",
    noneDesc: "يلغي جميع الاختيارات الأخرى.",
    errorNone: "يرجى اختيار منصة واحدة على الأقل أو اختيار «لا يوجد».",
  },
  vehicle: {
    heading: "المركبة",
    subheading: "هل تملك مركبة حاليًا؟",
    haveVehicle: "هل لديك مركبة؟",
    ownership: "الملكية",
    ownershipPh: "مملوكة / مستأجرة",
    type: "نوع المركبة",
    typePh: "مثال: سيارة",
    make: "الصانع",
    makePh: "مثال: تويوتا",
    model: "الموديل",
    modelPh: "مثال: كورولا",
    year: "السنة",
    yearPh: "مثال: 2022",
    plate: "رقم اللوحة",
    platePh: "مثال: أ ب ج 1234",
    regExpiry: "انتهاء الاستمارة",
    insuranceExpiry: "انتهاء التأمين",
    regAttachment: "استمارة المركبة",
    insuranceAttachment: "تأمين المركبة",
    owned: "مملوكة",
    leased: "مستأجرة",
    motorbike: "دراجة نارية",
    car: "سيارة",
    van: "فان",
    truck: "شاحنة",
  },
  documents: {
    heading: "مركز المستندات",
    subheading: "ارفع صورًا أو مسحات واضحة لمستنداتك.",
    identityDoc: "وثيقة الهوية",
    licenseDoc: "رخصة القيادة",
    vehicleRegDoc: "استمارة المركبة",
    vehicleInsuranceDoc: "تأمين المركبة",
    requiredLabel: "مطلوب",
  },
  review: {
    heading: "المراجعة والإرسال",
    subheading: "راجع بياناتك قبل الإرسال.",
    consentTerms: "أوافق على الشروط والأحكام الخاصة بنخبة التطوير.",
    consentPrivacy: "أوافق على معالجة نخبة التطوير لبياناتي الشخصية لأغراض التوظيف.",
    consentRequired: "يرجى الموافقة على إقرارَي الموافقة للإرسال.",
    edit: "تعديل",
    confirmSubmit: "إرسال الطلب",
    validating: "جارٍ التحقق…",
    submitting: "جارٍ الإرسال…",
  },
  success: {
    heading: "تم استلام الطلب",
    message: "شكرًا لتقديمك لدى نخبة التطوير.",
    applicationNumber: "رقم الطلب",
    status: "الحالة",
    statusValue: "تم الإرسال",
    copy: "نسخ الرقم",
    copied: "تم النسخ!",
    print: "طباعة الإقرار",
    downloadPdf: "تنزيل PDF",
    returnHome: "العودة إلى الموقع",
    whatNext: "سيراجع فريق التوظيف طلبك ويتواصل معك على رقم الجوال الذي قدمته.",
    note: "احتفظ برقم طلبك — ستحتاجه للمتابعة.",
    documentCompletion: "اكتمال المستندات",
    submittedDate: "تاريخ الإرسال",
  },
  print: {
    title: "نخبة التطوير — طلب سائق",
    applicant: "مقدم الطلب",
    workType: "نوع العمل",
    driverCategory: "فئة السائق",
    platforms: "المنصات",
    submissionDate: "تاريخ الإرسال",
    status: "الحالة",
  },
  footer: { rights: "© {year} نخبة التطوير" },
}

const ur: RegistrationDictionary = {
  meta: {
    title: "ڈرائیور رجسٹریشن | Elite Development",
    description:
      "ایلیٹ ڈویلپمنٹ کے ساتھ ڈرائیور بننے کے لیے درخواست دیں۔ اپنی درخواست آن لائن مکمل کریں — کسی اکاؤنٹ کی ضرورت نہیں۔ عربی، انگریزی، اردو اور بنگالی میں دستیاب۔",
  },
  header: { brand: "ایلیٹ ڈویلپمنٹ", tagline: "ڈرائیور درخواست پورٹل" },
  language: { label: "زبان" },
  welcome: {
    badge: "ڈرائیور رجسٹریشن",
    title: "ایلیٹ ڈویلپمنٹ کے ساتھ اپنا سفر شروع کریں۔",
    subtitle: "اپنی درخواست چند آسان مراحل میں مکمل کریں — کوئی اکاؤنٹ، کوئی لاگ ان نہیں۔",
    steps: "تقریباً 10 منٹ لگتے ہیں",
    ctaStart: "درخواست شروع کریں",
    trustPoints: ["اکاؤنٹ کی ضرورت نہیں", "آپ کی دستاویزات نجی رہتی ہیں", "کسی بھی ڈیوائس سے درخواست دیں"],
  },
  progress: { step: "مرحلہ", of: "از", complete: "مکمل" },
  steps: {
    personal: "ذاتی معلومات",
    contact: "رابطہ",
    identity: "شناخت",
    license: "ڈرائیونگ لائسنس",
    work: "کام کی قسم",
    platforms: "پلیٹ فارمز",
    vehicle: "گاڑی",
    documents: "دستاویزات",
    review: "جائزہ",
  },
  common: {
    back: "واپس",
    next: "جاری رکھیں",
    continue: "جاری رکھیں",
    submit: "درخواست جمع کریں",
    optional: "اختیاری",
    required: "ضروری",
    select: "منتخب کریں",
    upload: "دستاویز اپ لوڈ کریں",
    remove: "ہٹائیں",
    yes: "ہاں",
    no: "نہیں",
    none: "کوئی نہیں",
    valid: "درست",
    expiringSoon: "جلد ختم ہونے والا",
    expired: "ختم شدہ",
    today: "آج",
    invalidDate: "براہ کرم درست تاریخ درج کریں",
    errorGeneric: "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔",
    errorRequired: "یہ خانہ ضروری ہے",
    errorInvalidMobile: "براہ کرم درست موبائل نمبر درج کریں (مثال: 05XXXXXXXX)",
    errorInvalidEmail: "براہ کرم درست ای میل درج کریں",
    errorTooLong: "ان پٹ بہت لمبا ہے",
    uploadErrorType: "صرف JPG، PNG، WEBP یا PDF فائلیں اجازت ہیں",
    uploadErrorSize: "فائل 5 MB یا کم ہونی چاہیے",
    uploading: "اپ لوڈ ہو رہا ہے…",
    uploaded: "اپ لوڈ ہو گیا",
    dragDrop: "فائل یہاں گھسیٹیں",
    or: "یا",
    takePhoto: "تصویر لیں",
    chooseFile: "فائل منتخب کریں",
    photo: "تصویر",
    document: "دستاویز",
  },
  personal: {
    heading: "ذاتی معلومات",
    subheading: "ہمیں بتائیں آپ کون ہیں۔",
    firstName: "پہلا نام",
    firstNamePh: "مثال: احمد",
    middleName: "دوم نام",
    middleNamePh: "مثال: محمد",
    lastName: "خاندانی نام",
    lastNamePh: "مثال: القحطانی",
    fullName: "مکمل نام",
    dateOfBirth: "تاریخ پیدائش",
    nationality: "قومیت",
    nationalityPh: "مثال: سعودی",
    gender: "جنس",
    male: "مرد",
    female: "خاتون",
    profilePhoto: "پروفائل تصویر",
    profilePhotoHint: "آپ کی واضح اور حالیہ تصویر",
  },
  contact: {
    heading: "رابطے کی معلومات",
    subheading: "ہم آپ تک کیسے پہنچیں؟",
    mobile: "موبائل نمبر",
    mobilePh: "05XXXXXXXX",
    altMobile: "متبادل موبائل",
    altMobilePh: "اختیاری",
    email: "ای میل",
    emailPh: "you@example.com",
    city: "شہر",
    cityPh: "مثال: ریاض",
    district: "علاقہ",
    districtPh: "مثال: العلیا",
    address: "پتہ",
    addressPh: "گلی، عمارت، اپارٹمنٹ",
  },
  identity: {
    heading: "شناختی معلومات",
    subheading: "وہ دستاویز منتخب کریں جو آپ استعمال کریں گے۔",
    type: "شناخت کی قسم",
    iqama: "اقامہ",
    nationalId: "قومی شناخت",
    passport: "پاسپورٹ",
    number: "شناختی نمبر",
    expiry: "ختم ہونے کی تاریخ",
    attachment: "شناختی دستاویز",
    attachmentHint: "آپ کی شناختی دستاویز کا واضح اسکین یا تصویر",
    numberPh: "شناختی نمبر درج کریں",
  },
  license: {
    heading: "ڈرائیونگ لائسنس",
    subheading: "آپ کے درست ڈرائیونگ لائسنس کی تفصیلات۔",
    number: "لائسنس نمبر",
    numberPh: "لائسنس نمبر درج کریں",
    type: "لائسنس کی قسم",
    typePh: "مثال: ہلکی گاڑی",
    country: "جاری کرنے والا ملک",
    countryPh: "مثال: سعودی عرب",
    expiry: "لائسنس کی میعاد",
    attachment: "ڈرائیونگ لائسنس",
    attachmentHint: "آپ کے لائسنس کا واضح اسکین یا تصویر",
  },
  work: {
    heading: "آپ ہمارے ساتھ کیسے کام کرنا چاہتے ہیں؟",
    subheading: "اپنے لیے مناسب انتظام منتخب کریں۔",
    fullTime: "مکمل وقت",
    fullTimeDesc: "ایلیٹ ڈویلپمنٹ کے ساتھ مکمل وقت کے ڈرائیور کے طور پر کام کریں۔",
    freelancer: "فری لانسر",
    freelancerDesc: "فری لانس شرائط پر کام کریں۔",
    categoryHeading: "اپنی کیٹیگری منتخب کریں",
    sponsored1: "مکفول — قسم 1",
    sponsored1Desc: "کمپنی گاڑی، پیٹرول اور رہائش فراہم کرتی ہے۔",
    sponsored2: "مکفول — قسم 2",
    sponsored2Desc: "کمپنی گاڑی اور رہائش فراہم کرتی ہے، پیٹرول کے بغیر۔",
    freelancerNote: "معاوضہ اور آپریٹنگ شرائط کمپنی پالیسی کے مطابق طے ہوتی ہیں۔",
  },
  platforms: {
    heading: "آپ کون سے پلیٹ فارمز کے ساتھ کام کرتے ہیں؟",
    subheading: "ایک یا زیادہ پلیٹ فارمز منتخب کریں جن کا تجربہ ہے۔",
    none: "کوئی نہیں / کوئی پلیٹ فارم تجربہ نہیں",
    noneDesc: "دیگر تمام انتخاب صاف کرتا ہے۔",
    errorNone: "براہ کرم کم از کم ایک پلیٹ فارم منتخب کریں یا «کوئی نہیں» چنیں۔",
  },
  vehicle: {
    heading: "گاڑی",
    subheading: "کیا آپ کے پاس فی الحال گاڑی ہے؟",
    haveVehicle: "کیا آپ کے پاس گاڑی ہے؟",
    ownership: "ملکیت",
    ownershipPh: "ملکیتی / لیز",
    type: "گاڑی کی قسم",
    typePh: "مثال: کار",
    make: "مینوفیکچرر",
    makePh: "مثال: ٹویوٹا",
    model: "ماڈل",
    modelPh: "مثال: کرولا",
    year: "سال",
    yearPh: "مثال: 2022",
    plate: "نمبر پلیٹ",
    platePh: "مثال: ABC 1234",
    regExpiry: "رجسٹریشن کی میعاد",
    insuranceExpiry: "انشورنس کی میعاد",
    regAttachment: "گاڑی کی رجسٹریشن",
    insuranceAttachment: "گاڑی کا انشورنس",
    owned: "ملکیتی",
    leased: "لیز",
    motorbike: "موٹر سائیکل",
    car: "کار",
    van: "وین",
    truck: "ٹرک",
  },
  documents: {
    heading: "دستاویزات سینٹر",
    subheading: "اپنی دستاویزات کی واضح تصاویر یا اسکین اپ لوڈ کریں۔",
    identityDoc: "شناختی دستاویز",
    licenseDoc: "ڈرائیونگ لائسنس",
    vehicleRegDoc: "گاڑی کی رجسٹریشن",
    vehicleInsuranceDoc: "گاڑی کا انشورنس",
    requiredLabel: "ضروری",
  },
  review: {
    heading: "جائزہ اور جمع کروائیں",
    subheading: "جمع کرنے سے پہلے اپنی تفصیلات چیک کریں۔",
    consentTerms: "میں ایلیٹ ڈویلپمنٹ کی شرائط و ضوابط سے اتفاق کرتا ہوں۔",
    consentPrivacy: "میں بھرتی کے مقاصد کے لیے اپنے ذاتی ڈیٹا کی پروسیسنگ پر رضامند ہوں۔",
    consentRequired: "جمع کرنے کے لیے براہ کرم دونوں رضامندیوں کو قبول کریں۔",
    edit: "ترمیم",
    confirmSubmit: "درخواست جمع کریں",
    validating: "تصدیق ہو رہی ہے…",
    submitting: "جمع ہو رہا ہے…",
  },
  success: {
    heading: "درخواست موصول ہو گئی",
    message: "ایلیٹ ڈویلپمنٹ میں درخواست دینے کا شکریہ۔",
    applicationNumber: "درخواست نمبر",
    status: "حالت",
    statusValue: "جمع شدہ",
    copy: "نمبر کاپی کریں",
    copied: "کاپی ہو گیا!",
    print: "رسید پرنٹ کریں",
    downloadPdf: "PDF ڈاؤن لوڈ کریں",
    returnHome: "ویب سائٹ پر واپس جائیں",
    whatNext: "ہماری بھرتی ٹیم آپ کی درخواست کا جائزہ لے گی اور فراہم کردہ موبائل نمبر پر رابطہ کرے گی۔",
    note: "اپنا درخواست نمبر محفوظ رکھیں — فالو اپ کے لیے ضروری ہوگا۔",
    documentCompletion: "دستاویزات کی تکمیل",
    submittedDate: "جمع کرنے کی تاریخ",
  },
  print: {
    title: "ایلیٹ ڈویلپمنٹ — ڈرائیور درخواست",
    applicant: "درخواست دہندہ",
    workType: "کام کی قسم",
    driverCategory: "ڈرائیور کیٹیگری",
    platforms: "پلیٹ فارمز",
    submissionDate: "جمع کرنے کی تاریخ",
    status: "حالت",
  },
  footer: { rights: "© {year} ایلیٹ ڈویلپمنٹ" },
}

const bn: RegistrationDictionary = {
  meta: {
    title: "ড্রাইভার রেজিস্ট্রেশন | Elite Development",
    description:
      "Elite Development-এ ড্রাইভার হিসেবে আবেদন করুন। অনলাইনে আপনার আবেদন সম্পূর্ণ করুন — কোনো অ্যাকাউন্ট লাগবে না। আরবি, ইংরেজি, উর্দু ও বাংলায় উপলব্ধ।",
  },
  header: { brand: "এলিট ডেভেলপমেন্ট", tagline: "ড্রাইভার আবেদন পোর্টাল" },
  language: { label: "ভাষা" },
  welcome: {
    badge: "ড্রাইভার রেজিস্ট্রেশন",
    title: "Elite Development-এর সাথে আপনার যাত্রা শুরু করুন।",
    subtitle: "কয়েকটি সহজ ধাপে আপনার আবেদন সম্পূর্ণ করুন — কোনো অ্যাকাউন্ট, কোনো লগইন নয়।",
    steps: "প্রায় ১০ মিনিট সময় লাগে",
    ctaStart: "আবেদন শুরু করুন",
    trustPoints: ["কোনো অ্যাকাউন্ট লাগবে না", "আপনার নথি ব্যক্তিগত থাকে", "যেকোনো ডিভাইস থেকে আবেদন করুন"],
  },
  progress: { step: "ধাপ", of: "এর", complete: "সম্পূর্ণ" },
  steps: {
    personal: "ব্যক্তিগত তথ্য",
    contact: "যোগাযোগ",
    identity: "পরিচয়",
    license: "ড্রাইভিং লাইসেন্স",
    work: "কাজের ধরন",
    platforms: "প্ল্যাটফর্ম",
    vehicle: "যানবাহন",
    documents: "নথিপত্র",
    review: "পর্যালোচনা",
  },
  common: {
    back: "পেছনে",
    next: "চালিয়ে যান",
    continue: "চালিয়ে যান",
    submit: "আবেদন জমা দিন",
    optional: "ঐচ্ছিক",
    required: "আবশ্যক",
    select: "নির্বাচন করুন",
    upload: "নথি আপলোড করুন",
    remove: "মুছে ফেলুন",
    yes: "হ্যাঁ",
    no: "না",
    none: "কিছুই নয়",
    valid: "বৈধ",
    expiringSoon: "শীঘ্রই মেয়াদোত্তীর্ণ",
    expired: "মেয়াদোত্তীর্ণ",
    today: "আজ",
    invalidDate: "অনুগ্রহ করে একটি বৈধ তারিখ দিন",
    errorGeneric: "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
    errorRequired: "এই ঘরটি আবশ্যক",
    errorInvalidMobile: "অনুগ্রহ করে একটি বৈধ মোবাইল নম্বর দিন (যেমন: 05XXXXXXXX)",
    errorInvalidEmail: "অনুগ্রহ করে একটি বৈধ ইমেইল দিন",
    errorTooLong: "ইনপুট অনেক বড়",
    uploadErrorType: "শুধুমাত্র JPG, PNG, WEBP বা PDF ফাইল অনুমোদিত",
    uploadErrorSize: "ফাইল ৫ MB বা তার কম হতে হবে",
    uploading: "আপলোড হচ্ছে…",
    uploaded: "আপলোড হয়েছে",
    dragDrop: "ফাইল এখানে টেনে আনুন",
    or: "বা",
    takePhoto: "ছবি তুলুন",
    chooseFile: "ফাইল নির্বাচন করুন",
    photo: "ছবি",
    document: "নথি",
  },
  personal: {
    heading: "ব্যক্তিগত তথ্য",
    subheading: "আপনি কে তা জানান।",
    firstName: "প্রথম নাম",
    firstNamePh: "যেমন: আহমেদ",
    middleName: "মাঝের নাম",
    middleNamePh: "যেমন: মোহাম্মদ",
    lastName: "পদবি",
    lastNamePh: "যেমন: আল-কাহতানি",
    fullName: "পুরো নাম",
    dateOfBirth: "জন্ম তারিখ",
    nationality: "জাতীয়তা",
    nationalityPh: "যেমন: সৌদি",
    gender: "লিঙ্গ",
    male: "পুরুষ",
    female: "নারী",
    profilePhoto: "প্রোফাইল ছবি",
    profilePhotoHint: "আপনার একটি পরিষ্কার, সাম্প্রতিক ছবি",
  },
  contact: {
    heading: "যোগাযোগের তথ্য",
    subheading: "আমরা কীভাবে আপনার সাথে যোগাযোগ করব?",
    mobile: "মোবাইল নম্বর",
    mobilePh: "05XXXXXXXX",
    altMobile: "বিকল্প মোবাইল",
    altMobilePh: "ঐচ্ছিক",
    email: "ইমেইল",
    emailPh: "you@example.com",
    city: "শহর",
    cityPh: "যেমন: রিয়াদ",
    district: "জেলা",
    districtPh: "যেমন: আল ওলায়া",
    address: "ঠিকানা",
    addressPh: "রাস্তা, বাড়ি, অ্যাপার্টমেন্ট",
  },
  identity: {
    heading: "পরিচয় তথ্য",
    subheading: "আপনি যে নথিটি ব্যবহার করবেন তা নির্বাচন করুন।",
    type: "পরিচয়ের ধরন",
    iqama: "ইকামা",
    nationalId: "জাতীয় পরিচয়পত্র",
    passport: "পাসপোর্ট",
    number: "পরিচয় নম্বর",
    expiry: "মেয়াদোত্তীর্ণের তারিখ",
    attachment: "পরিচয় নথি",
    attachmentHint: "আপনার পরিচয় নথির একটি পরিষ্কার স্ক্যান বা ছবি",
    numberPh: "পরিচয় নম্বর লিখুন",
  },
  license: {
    heading: "ড্রাইভিং লাইসেন্স",
    subheading: "আপনার বৈধ ড্রাইভিং লাইসেন্সের বিবরণ।",
    number: "লাইসেন্স নম্বর",
    numberPh: "লাইসেন্স নম্বর লিখুন",
    type: "লাইসেন্সের ধরন",
    typePh: "যেমন: হালকা যানবাহন",
    country: "ইস্যুকারী দেশ",
    countryPh: "যেমন: সৌদি আরব",
    expiry: "লাইসেন্সের মেয়াদ",
    attachment: "ড্রাইভিং লাইসেন্স",
    attachmentHint: "আপনার লাইসেন্সের পরিষ্কার স্ক্যান বা ছবি",
  },
  work: {
    heading: "আপনি কীভাবে আমাদের সাথে কাজ করতে চান?",
    subheading: "আপনার জন্য উপযুক্ত ব্যবস্থা নির্বাচন করুন।",
    fullTime: "ফুল-টাইম",
    fullTimeDesc: "Elite Development-এর সাথে ফুল-টাইম ড্রাইভার হিসেবে কাজ করুন।",
    freelancer: "ফ্রিল্যান্সার",
    freelancerDesc: "ফ্রিল্যান্স শর্তে কাজ করুন।",
    categoryHeading: "আপনার ক্যাটাগরি নির্বাচন করুন",
    sponsored1: "স্পন্সরড — টাইপ ১",
    sponsored1Desc: "কোম্পানি যানবাহন, পেট্রল ও আবাসন সরবরাহ করে।",
    sponsored2: "স্পন্সরড — টাইপ ২",
    sponsored2Desc: "কোম্পানি যানবাহন ও আবাসন সরবরাহ করে, পেট্রল ছাড়া।",
    freelancerNote: "ক্ষতিপূরণ ও পরিচালনার শর্ত কোম্পানির নীতি অনুযায়ী নির্ধারিত হয়।",
  },
  platforms: {
    heading: "আপনি কোন প্ল্যাটফর্মগুলোর সাথে কাজ করেন?",
    subheading: "আপনার অভিজ্ঞতা আছে এমন এক বা একাধিক প্ল্যাটফর্ম নির্বাচন করুন।",
    none: "কিছুই নয় / কোনো প্ল্যাটফর্ম অভিজ্ঞতা নেই",
    noneDesc: "অন্য সব নির্বাচন মুছে দেয়।",
    errorNone: "অনুগ্রহ করে কমপক্ষে একটি প্ল্যাটফর্ম নির্বাচন করুন বা «কিছুই নয়» বেছে নিন।",
  },
  vehicle: {
    heading: "যানবাহন",
    subheading: "আপনার বর্তমানে একটি যানবাহন আছে?",
    haveVehicle: "আপনার কি যানবাহন আছে?",
    ownership: "মালিকানা",
    ownershipPh: "নিজস্ব / লিজ",
    type: "যানবাহনের ধরন",
    typePh: "যেমন: গাড়ি",
    make: "প্রস্তুতকারক",
    makePh: "যেমন: টয়োটা",
    model: "মডেল",
    modelPh: "যেমন: করোলা",
    year: "সাল",
    yearPh: "যেমন: 2022",
    plate: "নম্বর প্লেট",
    platePh: "যেমন: ABC 1234",
    regExpiry: "রেজিস্ট্রেশনের মেয়াদ",
    insuranceExpiry: "বিমার মেয়াদ",
    regAttachment: "যানবাহন রেজিস্ট্রেশন",
    insuranceAttachment: "যানবাহন বিমা",
    owned: "নিজস্ব",
    leased: "লিজ",
    motorbike: "মোটরবাইক",
    car: "গাড়ি",
    van: "ভ্যান",
    truck: "ট্রাক",
  },
  documents: {
    heading: "নথি কেন্দ্র",
    subheading: "আপনার নথিগুলোর পরিষ্কার ছবি বা স্ক্যান আপলোড করুন।",
    identityDoc: "পরিচয় নথি",
    licenseDoc: "ড্রাইভিং লাইসেন্স",
    vehicleRegDoc: "যানবাহন রেজিস্ট্রেশন",
    vehicleInsuranceDoc: "যানবাহন বিমা",
    requiredLabel: "আবশ্যক",
  },
  review: {
    heading: "পর্যালোচনা ও জমা দিন",
    subheading: "জমা দেওয়ার আগে আপনার তথ্য যাচাই করুন।",
    consentTerms: "আমি Elite Development-এর শর্তাবলীতে সম্মত।",
    consentPrivacy: "নিয়োগের উদ্দেশ্যে আমার ব্যক্তিগত তথ্য প্রক্রিয়াকরণে আমি সম্মত।",
    consentRequired: "জমা দিতে অনুগ্রহ করে সম্মতির দুটি ঘরে টিক দিন।",
    edit: "সম্পাদনা",
    confirmSubmit: "আবেদন জমা দিন",
    validating: "যাচাই হচ্ছে…",
    submitting: "জমা হচ্ছে…",
  },
  success: {
    heading: "আবেদন গৃহীত হয়েছে",
    message: "Elite Development-এ আবেদনের জন্য ধন্যবাদ।",
    applicationNumber: "আবেদন নম্বর",
    status: "অবস্থা",
    statusValue: "জমা হয়েছে",
    copy: "নম্বর কপি করুন",
    copied: "কপি হয়েছে!",
    print: "রসিদ প্রিন্ট করুন",
    downloadPdf: "PDF ডাউনলোড করুন",
    returnHome: "ওয়েবসাইটে ফিরে যান",
    whatNext: "আমাদের নিয়োগ দল আপনার আবেদন পর্যালোচনা করবে এবং প্রদত্ত মোবাইল নম্বরে যোগাযোগ করবে।",
    note: "আপনার আবেদন নম্বরটি সংরক্ষণ করুন — ফলো-আপের জন্য লাগবে।",
    documentCompletion: "নথি সম্পন্নতা",
    submittedDate: "জমার তারিখ",
  },
  print: {
    title: "এলিট ডেভেলপমেন্ট — ড্রাইভার আবেদন",
    applicant: "আবেদনকারী",
    workType: "কাজের ধরন",
    driverCategory: "ড্রাইভার ক্যাটাগরি",
    platforms: "প্ল্যাটফর্ম",
    submissionDate: "জমার তারিখ",
    status: "অবস্থা",
  },
  footer: { rights: "© {year} এলিট ডেভেলপমেন্ট" },
}

export const registrationDictionaries: Record<RegistrationLocale, RegistrationDictionary> = {
  en,
  ar,
  ur,
  bn,
}

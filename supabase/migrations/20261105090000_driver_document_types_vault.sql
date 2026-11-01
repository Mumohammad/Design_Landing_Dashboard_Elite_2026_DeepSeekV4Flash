-- Driver document vault: insurance and vehicle handover/return/accident
-- evidence stored alongside identity documents (same atomic register RPC).
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'medical_insurance';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'vehicle_insurance';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'vehicle_handover_report';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'vehicle_return_report';
ALTER TYPE public.driver_document_type ADD VALUE IF NOT EXISTS 'accident_report';

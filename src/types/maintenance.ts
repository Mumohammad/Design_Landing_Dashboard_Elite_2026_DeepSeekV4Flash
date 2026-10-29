import { z } from "zod"

// Module 2 — Fleet Maintenance (vehicle_maintenance_events +
// vehicle_odometer_logs). Columns mirror migrations 016_vehicles.sql and
// 017_vehicle_handover.sql exactly — this is a SURFACING job over the
// existing schema; no new tables/columns are introduced.

export type MaintenanceType = "preventive" | "emergency" | "periodic" | "repair"

export type MaintenanceEventStatus = "open" | "in_progress" | "completed" | "cancelled"

export type OdometerSource = "manual" | "gps" | "obd" | "import"

export const maintenanceTypeSchema = z.enum(["preventive", "emergency", "periodic", "repair"])

export const maintenanceEventStatusSchema = z.enum(["open", "in_progress", "completed", "cancelled"])

export const odometerSourceSchema = z.enum(["manual", "gps", "obd", "import"])

/** Create a maintenance event. Vehicle + type + description required. */
export const maintenanceEventCreateSchema = z.object({
  vehicle_id: z.string().uuid("Vehicle is required"),
  maintenance_type: maintenanceTypeSchema,
  reported_by_driver_id: z.string().uuid().nullable().optional(),
  fault_description: z.string().trim().min(3, "Fault description is required").max(2000),
  provider: z.string().trim().max(200).nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  parts_replaced: z.string().trim().max(1000).nullable().optional(),
  odometer_at_service: z
    .number()
    .int("Odometer must be a whole number")
    .min(0)
    .max(5_000_000)
    .nullable()
    .optional(),
  date_in: z.string().nullable().optional(),
  next_service_km: z
    .number()
    .int()
    .min(0)
    .max(5_000_000)
    .nullable()
    .optional(),
  next_service_date: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type MaintenanceEventCreateInput = z.infer<typeof maintenanceEventCreateSchema>

/** Edit an OPEN event (status guard lives in the action, not the schema). */
export const maintenanceEventUpdateSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  maintenance_type: maintenanceTypeSchema,
  fault_description: z.string().trim().min(3).max(2000),
  provider: z.string().trim().max(200).nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  parts_replaced: z.string().trim().max(1000).nullable().optional(),
  next_service_km: z.number().int().min(0).max(5_000_000).nullable().optional(),
  next_service_date: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type MaintenanceEventUpdateInput = z.infer<typeof maintenanceEventUpdateSchema>

/** Complete an event: actuals (cost, odometer, dates) become immutable facts. */
export const maintenanceEventCompleteSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  cost: z.number().min(0),
  date_out: z.string().nullable().optional(),
  odometer_at_service: z
    .number()
    .int("Odometer must be a whole number")
    .min(0)
    .max(5_000_000)
    .nullable()
    .optional(),
  parts_replaced: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type MaintenanceEventCompleteInput = z.infer<typeof maintenanceEventCompleteSchema>

/** Cancel an event — mandatory reason, audited. */
export const maintenanceEventCancelSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  reason: z.string().trim().min(3, "Cancellation reason is required").max(500),
})

export type MaintenanceEventCancelInput = z.infer<typeof maintenanceEventCancelSchema>

/** Add an odometer reading (fraud guard lives in the DB trigger VEH003). */
export const odometerLogCreateSchema = z.object({
  vehicle_id: z.string().uuid("Vehicle is required"),
  reading: z
    .number()
    .int("Odometer reading must be a whole number")
    .min(0, "Odometer reading cannot be negative")
    .max(5_000_000, "Odometer reading looks implausible"),
  recorded_at: z.string().nullable().optional(),
  source: odometerSourceSchema.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

export type OdometerLogCreateInput = z.infer<typeof odometerLogCreateSchema>

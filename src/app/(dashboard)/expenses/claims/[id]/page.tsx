import { ClaimDetail } from "@/components/expense-claims/claim-detail"

export default async function ExpenseClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <div className="p-6 text-sm">Not found</div>
  return <ClaimDetail id={id} />
}

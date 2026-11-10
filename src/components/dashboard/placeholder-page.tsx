import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type PlaceholderPageProps = {
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
}

export function PlaceholderPage({
  title,
  description,
  actionLabel = "فتح",
  actionHref,
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="px-4 lg:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="@container/main px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>{description}</p>
            {actionHref ? (
              <Button asChild variant="outline">
                <Link href={actionHref}>{actionLabel}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

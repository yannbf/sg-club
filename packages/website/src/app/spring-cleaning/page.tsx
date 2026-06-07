import Link from 'next/link'
import { Sparkles, ArrowRight } from 'lucide-react'
import { SPRING_CLEANINGS } from '@/lib/spring-cleaning'
import { AdminGate } from '@/components/AdminGate'
import { Card } from '@/components/ui/Card'

export default function SpringCleaningIndexPage() {
  const editions = [...SPRING_CLEANINGS].sort((a, b) => b.year - a.year)

  return (
    <AdminGate>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-accent-yellow" />
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Spring Cleaning
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each cleaning is namespaced by year so editions stay independent.
            Pick one to review members flagged for warnings or expulsion.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {editions.map((edition) => (
            <Link key={edition.slug} href={`/spring-cleaning/${edition.slug}`}>
              <Card className="group flex items-center justify-between gap-4 p-5 transition-all hover:border-card-border-strong hover:shadow-md">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card-background-hover">
                    <Sparkles className="h-5 w-5 text-accent-yellow" />
                  </div>
                  <div>
                    <p className="font-display text-lg font-semibold">
                      {edition.label}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Review {edition.year} member health
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AdminGate>
  )
}

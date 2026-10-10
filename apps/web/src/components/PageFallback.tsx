import { LoadingRegion, Skeleton, SkeletonCards } from './ui'

// Suspense fallback for lazily loaded pages: the same shimmer skeletons
// the pages show while their data loads.
export default function PageFallback() {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <LoadingRegion className="flex flex-col gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </LoadingRegion>
      <SkeletonCards count={6} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6" cardClassName="h-24" />
    </main>
  )
}

// Suspense fallback for lazily loaded pages: the same shimmer skeletons
// the pages show while their data loads.
export default function PageFallback() {
  return (
    <main className="container-content py-section-mobile lg:py-section" aria-busy="true">
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="h-4 w-32 rounded-sm skeleton" />
        <div className="h-10 w-2/3 rounded-sm skeleton" />
        <div className="h-4 w-1/2 rounded-sm skeleton" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-card skeleton" />)}
        </div>
      </div>
    </main>
  )
}

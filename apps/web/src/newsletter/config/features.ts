// Contributor suggestion workflow (/contribute, /admin/suggestions,
// ContributeModal, the "¿Tenés algo para contar?" banner, contributor
// notifications). The API has no suggestion endpoints yet, so the pages
// behind this flag still run on localStorage mocks (store/articleStore,
// store/eventStore, store/notificationStore): a contributor would be told
// their suggestion was sent while staff never see it. Keep it off until the
// backend exists and those stores call it; flipping this flag re-enables
// every route and entry point.
export const CONTRIBUTIONS_ENABLED = false

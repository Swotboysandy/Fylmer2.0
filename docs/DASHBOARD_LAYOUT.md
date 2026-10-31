# Dashboard layout references
XERJ searches: ref-beui dashboard sidebar; ref-shadcn-ui ResizablePanelGroup; ref-opencut layout. Selected actual shadcn registry resizable.tsx (apps/v4/registry/new-york-v4/ui/resizable.tsx), copied unchanged except cn import. Existing shadcn MIT license and repository pin are in docs/upstream-components and docs/reference-repositories.json. BeUI sidebar adds navigation not needed for this focused editor; OpenCut search did not provide a suitable editor shell.

AnchorShot integrates the upstream panels into direction, preview and scene-detail columns. Desktop minimum widths protect controls; narrower viewports keep the stacked layout. Independent pane scrolling, bounded preview height and a reserved voice-orb area keep controls accessible. This is a custom editor composition using upstream components, not a copied full dashboard.

Build and six creation/landing browser checks passed. Desktop screenshot inspected; mobile overflow check false. No paid models used; changes remain local.

Unified workspace follow-up: Review and Dream now reuse DashboardLayout. Review adds scene selection and collapses secondary project controls; inspector generation is explicitly expandable. Removed old console labels and unsupported sample-rate display. Eight creation, viewport and two-anchor browser checks passed; mobile Review overflow check false. Existing internal editing forms are retained and restyled, not replaced with fake controls.

# Dashboard layout references
XERJ searches: ref-beui dashboard sidebar; ref-shadcn-ui ResizablePanelGroup; ref-opencut layout. Selected actual shadcn registry resizable.tsx (apps/v4/registry/new-york-v4/ui/resizable.tsx), copied unchanged except cn import. Existing shadcn MIT license and repository pin are in docs/upstream-components and docs/reference-repositories.json. BeUI sidebar adds navigation not needed for this focused editor; OpenCut search did not provide a suitable editor shell.

AnchorShot integrates the upstream panels into direction, preview and scene-detail columns. Desktop minimum widths protect controls; narrower viewports keep the stacked layout. Independent pane scrolling, bounded preview height and a reserved voice-orb area keep controls accessible. This is a custom editor composition using upstream components, not a copied full dashboard.

Build and six creation/landing browser checks passed. Desktop screenshot inspected; mobile overflow check false. No paid models used; changes remain local.

Unified workspace follow-up: Review and Dream now reuse DashboardLayout. Review adds scene selection and collapses secondary project controls; inspector generation is explicitly expandable. Removed old console labels and unsupported sample-rate display. Eight creation, viewport and two-anchor browser checks passed; mobile Review overflow check false. Existing internal editing forms are retained and restyled, not replaced with fake controls.

Editor-shell redesign: installed 21st-ui, shadcnspace and official shadcn skills. Read public ShadcnSpace radix/sidebar-01 registry, especially nav-main.tsx; used its separation of primary navigation and contextual actions as a reference, not a copied block. 21st MCP authentication is not configured; no hosted generation or paid credits used. Reused existing accessible tabs and resizable components to preserve behavior. Added navigation rail and shared toolbar across workspaces. Updated legacy refresh test to expect persistent projects.

Scene details: compact monochrome editor with inline prompt and duration, validation, save feedback, and preserved image/mask data. Removed technical audit copy and redundant actions. Desktop and 390px mobile screenshots checked: equal field widths and aligned edges, 8px label spacing, 20px form gaps, no horizontal overflow.

Final validation: production build passed (existing bundle-size warning); all 8 scoped browser tests passed across cleanStudio, landingPreservation, projects and sceneDetails. Checks cover viewport fit, project rename/switch/refresh, saved anchors, scene edit persistence without image replacement, and invalid duration rejection. All checks used offline samples without model credits.

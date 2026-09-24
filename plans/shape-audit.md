# Shape library audit

Initial source audit for the built-in stencil libraries. The audit separates
notation decisions from geometry and boundary implementation so a visual
change does not silently change connector behavior.

Status values are **Correct**, **Geometry issue**, **Notation issue**,
**Boundary issue**, **Renderer issue**, and **Metadata issue**. “Correct” means
that no correction is currently justified by the source implementation; it is
not a claim that every possible resize or visual combination has been manually
reviewed.

## General

| Shape | Status | Finding |
| --- | --- | --- |
| Rectangle | Correct | Shared rectangle silhouette and renderer agree. |
| Rounded rectangle | Correct | Shared rounded rectangle geometry is bounded by node size. |
| Circle | Boundary issue | Uses ellipse geometry; the default is square, but the shape has no aspect-ratio contract during resize. |
| Ellipse | Metadata issue | `round rectangle` is an incorrect search alias. |
| Diamond | Correct | Polygon silhouette and diamond boundary agree. |
| Triangle | Correct | Polygon silhouette is bounded and resize-safe. |
| Hexagon | Correct | Proportional inset is bounded. |
| Pentagon | Correct | Polygon silhouette is bounded. |
| Parallelogram | Correct | Shared polygon and boundary use the same slant. |
| Trapezoid | Correct | Remains a neutral, top-narrow trapezoid. |
| Cylinder | Geometry issue / Boundary issue | Bottom Bézier controls extend below the node; boundary is only a rectangular approximation. |
| Cloud | Geometry issue / Boundary issue | A right-side Bézier control reaches `width * 1.05`; boundary does not follow the curves closely. |
| Document | Boundary issue | Visual wave and polygon approximation are intentionally approximate and need a later curve-accuracy pass. |
| Image | Correct | Rectangular media frame is intentional. |
| Text | Correct | Text uses the rectangle renderer intentionally. |
| Line / Arrow line | Correct | Shared line geometry and marker rendering agree. |
| Frame / Section | Correct | Container boundaries are intentionally rectangular/rounded. |
| Note / Sticky note / Callout | Correct | Existing generic annotation geometry is bounded. |
| Table | Correct | Rectangular container is intentional. |

## Flowchart

| Shape | Status | Finding |
| --- | --- | --- |
| Start / end | Correct | Rounded terminator is bounded. |
| Process | Correct | Uses the shared rectangle. |
| Decision | Correct | Diamond geometry and boundary agree. |
| Input / output | Correct | Uses the shared parallelogram. |
| Document / Multiple documents | Boundary issue | The visual wave is shared, but stacked-document boundary handling remains approximate. |
| Database | Geometry issue / Boundary issue | Shares the overflowing cylinder path and approximation. |
| Stored data | Geometry issue / Boundary issue | Uses a rounded-rectangle fallback instead of a dedicated stored-data silhouette/boundary. |
| Internal storage | Notation issue / Renderer issue | Current geometry has two vertical dividers; the intended symbol has one left divider and one horizontal divider near the top. |
| Manual input | Correct | Slanted input polygon is bounded. |
| Manual operation | Geometry issue | Incorrectly shares the top-narrow generic trapezoid instead of using a separate bottom-inset polygon. |
| Preparation | Correct | Hexagonal preparation polygon is bounded. |
| Predefined process | Correct | Shared divider geometry is bounded. |
| Delay | Correct | Shared delay path is bounded at normal sizes. |
| Display | Correct | Shared display path is bounded at normal sizes. |
| On/off-page connectors | Correct | Connector silhouettes are bounded; marker semantics are audited separately. |
| Merge / Extract / Loop limit | Correct | Shared polygons are bounded. |
| Sort | Geometry issue | Divider stops at arbitrary 18%/82% positions instead of intersecting the diamond edges. |
| Collate | Geometry issue | Waist points use asymmetric 36%/64% coordinates instead of the center. |

## ERD

| Shape / connector | Status | Finding |
| --- | --- | --- |
| Entity | Correct | Table renderer, field-row anchors, and table-oriented metadata are aligned. |
| Associative entity | Correct | Semantic variant is represented by entity metadata and dashed outline. |
| Weak entity | Correct | Double-outline behavior is renderer-owned and bounded. |
| View | Correct | Entity metadata provides view styling. |
| Schema / subject area | Correct | Container semantics are intentionally rectangular. |
| Legacy attribute | Correct | Ellipse is intentional for backwards compatibility. |
| Cardinality connectors | Notation issue (audit) | Marker combinations exist, but a dedicated endpoint-combination and direction regression set is still needed. |

## DFD

| Shape / notation | Status | Finding |
| --- | --- | --- |
| Process | Correct | Yourdon/DeMarco and Gane/Sarson are metadata-driven renderer variants. |
| External entity | Correct | Shared semantic type with notation-specific renderer. |
| Data store | Correct | Shared semantic type with notation-specific store renderer. |
| Notation switching | Boundary issue (audit) | Visual renderer changes are centralized, but every variant needs explicit connector-boundary regression coverage. |

## UML use case

| Shape | Status | Finding |
| --- | --- | --- |
| Actor | Geometry issue / Renderer issue | Canvas and export use fixed coordinates, so proportions drift when resized. |
| Use case | Correct | Ellipse silhouette and boundary are shared. |
| System boundary | Correct | Rectangular container is intentional. |
| Package | Geometry issue / Boundary issue | Fixed tab dimensions can exceed narrow node widths; boundary repeats the same fixed coordinates. |
| UML note | Correct | Folded-corner silhouette clamps its fold. |

## Cross-cutting follow-up

- Move confirmed specialized geometry into `shapeSilhouette()` and keep
  connector boundaries derived from the same dimensions.
- Remove obsolete specialized fallbacks from `NodeGraphic.tsx` and SVG export
  only after parity tests cover canvas and export output.
- Add bounds, resize, connector-intersection, preview, and export tests for
  the corrected symbols.
- Keep DFD semantic node types and ERD cardinality metadata unchanged while
  adding notation-focused regression coverage.

## Correction pass completed

- Flowchart Internal Storage, Manual Operation, Stored Data boundaries, Sort,
  and Collate now use responsive shared geometry.
- Cloud and Cylinder paths and their sampled boundaries stay inside the node;
  Document, Folded Note, Package, and storage boundaries use the same size
  constraints as their rendered silhouettes.
- DFD notation variants keep their semantic node types while their connector
  boundaries follow the selected renderer, including the fixed-radius
  Gane/Sarson process box.
- UML Actor geometry is proportional, Package tabs scale to narrow nodes, and
  Circle carries an intrinsic aspect ratio during resize.
- Canvas, drag previews, palette thumbnails, gallery fixtures, and SVG export
  now render through the shared `NodeGraphic`/`shapeSilhouette` path. The
  development gallery is available at `?shape-gallery=1` during Vite dev.

Remaining intentionally approximate boundaries are the stacked-document
envelope and open actor figure. They remain bounded by the node rectangle and
are documented here rather than silently introducing a different connector
shape from the visible renderer.

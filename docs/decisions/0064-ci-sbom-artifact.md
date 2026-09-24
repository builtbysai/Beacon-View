# ADR 0064: Retain a CycloneDX SBOM from every CI run

## Status

Accepted

## Context

Beacon's release gate requires dependency supply-chain evidence. The existing CI job
audits production dependencies, but did not preserve an inventory tied to a specific
commit.

## Decision

CI installs the frozen pnpm dependency graph with lifecycle scripts disabled, then uses
the pinned Anchore SBOM action to produce a CycloneDX JSON inventory. The resulting
artifact is retained for 90 days with its CI run.

The SBOM job has only repository read access. It does not submit dependency data to a
third-party service, attach assets to GitHub releases, or scan production credentials.

## Consequences

Each validated commit has a downloadable dependency inventory suitable for review and
vulnerability-response work. It does not replace image-level SBOMs, release signing,
or an independent security review; those remain release gates.

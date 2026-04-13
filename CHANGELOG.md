# Changelog — @godman-protocols/lax

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.2.0] — 2026-04-14

### Added
- `createBudget(params)` — define a LatencyBudget with hard ceiling and soft target
- `createProbe(params)` — create a LatencyProbe for runtime measurement data
- `routeTask(budget, probes)` — deterministic 3-tier routing: `within_target` → `within_budget` → `best_effort`
- `registerSLA(params)` — register an SLA contract with deadline and agent
- `checkSLACompliance(sla, actualMs)` — evaluate whether execution met SLA
- Smoke test: 14 assertions, all PASS (Sprint 966b)
- Full TypeScript types, strict mode
- Zero external runtime dependencies (Node.js only)

### Changed
- Package promoted from skeleton (v0.1.0) to working protocol

---

## [0.1.0] — 2026-03-24

### Added
- Repository skeleton: README, Apache 2.0 license, package.json, tsconfig.json
- Plugin configs: `.openclaw`, `.claude-plugin`, `.cursor-plugin`, `.codex`
- `src/index.ts` placeholder

---

[0.2.0]: https://github.com/Godman-s/lax/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Godman-s/lax/releases/tag/v0.1.0

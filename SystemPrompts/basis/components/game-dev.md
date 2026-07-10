---
id: game-dev
purpose: Game-engine specifics — frame budget, determinism, hot-loop allocation, ECS discipline.
when-to-include: domain is game
min-strictness: lean
domains: [game]
backends: all
layers: []
---
## Game Development

### Frame budget
The update+render loop is a hot path with a fixed per-frame budget (~16.6ms at 60fps, ~8.3ms at 120fps). Measure with a frame profiler, not guesses. A change that adds per-frame cost must report its measured delta, not just "it still runs".

### Determinism
Simulation must reproduce from the same inputs and seed. Drive physics/gameplay off a fixed timestep, decoupled from render rate via an accumulator — never off wall-clock delta. Seed all RNG explicitly; no implicit or global entropy in sim code.

### Allocation discipline
No per-frame heap allocation on the hot path — pool, reuse, or preallocate. Don't `collect()` into a fresh container each frame; keep buffers across frames and clear in place. Hot-loop allocation surfaces as frame spikes, not average cost.

### ECS discipline
Honor system ordering and component-borrow rules: no aliased mutable access to the same component set within one system. Keep systems single-responsibility; express cross-system dependencies through explicit ordering, not shared mutable globals. Prefer data-oriented batches over per-entity virtual dispatch.

### State and assets
Game-state transitions (menu/loading/play/pause) are explicit; log them at the boundary, never per frame. Load assets through the asset layer with dev hot-reload; never block the main loop on synchronous I/O — stream or load off-thread.

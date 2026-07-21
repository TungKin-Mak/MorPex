# MorPex v8.5 — Personal AI Work Operating System

**Status**: Architecture Score 100/100 — Kernel stable, ready for data collection
**Philosophy**: Human-controlled evolution. AI observes → suggests → human decides.
**Not**: A chatbot, a digital twin, or an autonomous life agent.

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the complete architecture overview:

- Layer stack (Experience → Interaction → Event → Cognitive Loop → Runtime → Cognition → Evolution → Control)
- 9-phase CognitiveLoop data flow
- Mission state machine (9 states)
- Event types (41 events, all actively emitted)
- API endpoints (12 v8 REST endpoints)
- Human control switches (workflow candidates, behavior drift confirmation)
- 44 production modules, all real implementations

## Core Principles

1. **Human-in-the-loop**: AI never auto-registers workflows, never auto-updates behavior profiles, never auto-executes without approval
2. **Event Sourcing**: All state changes persist as events. State = f(events), not direct mutation
3. **Dependency injection**: No hardcoded module wiring. All dependencies passed through constructors
4. **Layer isolation**: Interaction never imports Runtime. Protocol never imports anything. All communication through EventBus
5. **Zero stubs**: All 44 production modules are real implementations

## Quick Start

```bash
npm run dev              # Start StudioServer (REST API + SSE)
npx tsx tests/run-test.ts tests/unit/cognitive-loop.test.ts   # Run a test
```

## Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** (exit code 0) |
| Unit tests | 34/34 pass |
| Architecture tests | 32/32 pass |
| Scenario tests | 34/34 pass |
| Integration tests | 52/52 pass |
| Production modules | 44 (all real, zero stubs) |
| Event types | 41 (all actively emitted) |
| Architecture score | **100/100** |

## Evolution Path

```
v8.5 Kernel (current)     — 100/100 architecture, human-controlled
    ↓
Data Collection Phase     — 1,000+ real missions, 3+ months runtime
    ↓
v9 Personal Intelligence  — Workflow Evolution, Proactive Assistant,
  (only when data ready)     Decision Support, Personal Work Model
```

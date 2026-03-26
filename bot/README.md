# Bot MVP Runtime

## Run simulation

```bash
pnpm bot:simulate
```

## Run simulation checks

```bash
pnpm bot:test
```

## Run real-data validation (Gamma API)

```bash
pnpm bot:example:real
```

## Run full test suite

```bash
pnpm bot:test:all
```

该 MVP 通过合成行情数据串联 ingest -> feature -> signal -> risk -> execution -> metrics -> montecarlo，
用于验证并行子模块集成是否可跑通。

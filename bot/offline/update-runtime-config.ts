import { readFile, writeFile } from 'fs/promises'

async function main(): Promise<void> {
  const target = new URL('../config/generated/runtime-defaults.json', import.meta.url)
  const raw = await readFile(target, 'utf8')
  const current = JSON.parse(raw) as Record<string, unknown>
  const now = new Date()
  const nextVersion = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.${String(now.getUTCDate()).padStart(2, '0')}-${now.getUTCHours()}${String(now.getUTCMinutes()).padStart(2, '0')}`
  const updated = {
    ...current,
    version: nextVersion,
    generatedAt: now.toISOString(),
    approval: {
      status: 'draft',
      approvedBy: 'pending-review',
    },
    markets: {
      ...(typeof current.markets === 'object' && current.markets ? current.markets : {}),
      refreshIntervalMs: 900000,
    },
  }

  await writeFile(target, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ updated: true, version: nextVersion, file: target.pathname }, null, 2))
}

void main()

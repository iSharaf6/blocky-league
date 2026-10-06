import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { buildEconomyModel } = await server.ssrLoadModule('/scripts/economy-model.ts');
  const model = buildEconomyModel();
  mkdirSync('docs/economy', { recursive: true });
  writeFileSync('docs/economy/model.json', JSON.stringify(model, null, 2) + '\n');
  console.log(JSON.stringify(model.profiles.map(p => ({name:p.profile.name, day7:p.rows[6], day30:p.rows[29], day90:p.rows[89]})), null, 2));
} finally { await server.close(); }

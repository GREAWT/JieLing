import './check-node.mjs';
// Set this before importing Vite: the desktop terminal can inherit development mode.
process.env.NODE_ENV = 'production';

// 规则 md 与方法论文档打包为 Skill 文档下载。规则直接从 src/knowledge/rules 复制，
// 不在 skill/ 下留第二份，避免与唯一真源漂移。
// 写进 public/ 而非 dist/：Vite 原样复制到 dist，开发服务器也能访问同一批 URL。
const { cp, mkdir, readdir, rm } = await import('node:fs/promises');
await rm('public/skill', { recursive: true, force: true });
await mkdir('public/skill/references/rules', { recursive: true });
await cp('skill/SKILL.md', 'public/skill/SKILL.md');
await cp('src/knowledge/fingerprints.json', 'public/skill/references/fingerprints.json');
for (const name of await readdir('src/knowledge/rules')) {
  if (name.endsWith('.md')) {
    await cp(`src/knowledge/rules/${name}`, `public/skill/references/rules/${name}`);
  }
}

const { build } = await import('vite');
await build({ mode: 'production' });
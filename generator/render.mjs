// Renders the profile README images from the HTML in this folder.
// Pulls the live plugin registry first so the counts and icons stay current.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const here = new URL('.', import.meta.url).pathname;
const pages = ['banner', 'plugins'];
const types = { '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };

const res = await fetch('https://justinholt.com/plugins.json');
await writeFile(join(here, 'plugins.json'), await res.text());

const server = createServer(async (req, reply) => {
  try {
    const path = join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(path);
    reply.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    reply.end(body);
  } catch {
    reply.writeHead(404).end();
  }
}).listen(0);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });

for (const name of pages) {
  await page.goto(`http://localhost:${server.address().port}/${name}.html`);
  await page.waitForSelector('body[data-ready]');
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator('.canvas').screenshot({ omitBackground: true });
  // Re-encode as WebP in the browser: a fraction of the PNG's size, and it keeps the transparent corners.
  const webp = await page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  }, png.toString('base64'));
  await writeFile(join(here, '../assets', `${name}.webp`), Buffer.from(webp, 'base64'));
  console.log(`assets/${name}.webp`);
}

await browser.close();
server.close();

// Rebuild the plugin table in the README between its markers.
const { plugins } = JSON.parse(await readFile(join(here, 'plugins.json'), 'utf8'));
const row = p => `| ${p.icon ? `<img src="${p.icon}" width="24" alt="">` : ''} | [${p.name}](${p.url}) | ${p.tagline} |`;
const table = (title, list) => [`**${title}**`, '', '| | Plugin | |', '| --- | --- | --- |', ...list.map(row), ''].join('\n');
const listed = plugins.filter(p => p.listed);
const block = [
  table('Released', listed.filter(p => p.status === 'released')),
  table('In development', listed.filter(p => p.status !== 'released')),
].join('\n');

const readme = join(here, '../README.md');
const current = await readFile(readme, 'utf8');
await writeFile(readme, current.replace(/<!-- plugins:start -->[\s\S]*<!-- plugins:end -->/, `<!-- plugins:start -->\n${block}<!-- plugins:end -->`));
console.log('README.md');

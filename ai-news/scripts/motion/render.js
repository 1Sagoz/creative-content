// Renders every clip in motion.html to a video file.
// Usage: node render.js <outDir> [clipIdPrefix]
// Opaque clips -> H.264 MP4. Transparent clips -> ProRes 4444 MOV with alpha.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const FPS = 30;
const out = path.resolve(process.argv[2] || 'clips');
const only = process.argv[3] || '';
const page_url = 'file://' + path.resolve(__dirname, 'motion.html');
fs.mkdirSync(out, { recursive: true });

function ffmpeg(file, alpha) {
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (alpha) args.push('-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', file);
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file);
  return spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
}

async function renderClip(browser, id) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(page_url + '?clip=' + encodeURIComponent(id));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const { dur, alpha } = await page.evaluate(() => ({ dur: window.DUR, alpha: window.ALPHA }));
  const file = path.join(out, id + (alpha ? '.mov' : '.mp4'));
  const ff = ffmpeg(file, alpha);
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
  const frames = Math.round(dur * FPS);
  const stage = await page.$('.stage');
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.seekTo(t), f / FPS);
    const buf = await stage.screenshot({ type: 'png', omitBackground: alpha });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  console.log('done', path.basename(file), frames + ' frames');
}

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage();
  await p.goto(page_url + '?clip=01-quote');
  const ids = (await p.evaluate(() => window.CLIPS.map(c => c.id))).filter(i => i.startsWith(only));
  await p.close();
  const queue = [...ids];
  const worker = async () => { while (queue.length) await renderClip(browser, queue.shift()); };
  await Promise.all([worker(), worker(), worker()]);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

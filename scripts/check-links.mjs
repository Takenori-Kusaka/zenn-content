// 章ラベルの参照が、実際に辿れるリンクになっているかを検査する。
//
//   node scripts/check-links.mjs [books/<book> ...]
//
// 読者は「第Ⅲ部-7」というラベルを見せられても、目次を目で探したいとは思いません。
// ラベルで章を指すなら、その場から辿れるリンクである必要があります。
//
//   L1: 裸のラベル(リンクになっていない章ラベル)
//       節ごとに、同じラベルの初出はリンクであることを求めます。
//       2回目以降の言及はリンクでなくてかまいません(文中がリンクだらけになるため)。
//       図(mermaid)の中、frontmatter、コード、そして自分自身の章を指す言及は対象外です。
//
//   L2: 省略形の継続参照(例:「第Ⅰ部C-1およびD-2」の D-2)
//       章の統合や順序変更のとき、完全なラベルだけが機械的に置き換えられ、
//       省略形が古い番号のまま取り残されます。実際に 2026-09-04 の統合で
//       「第Ⅱ部A-2からA-5」が旧番号のまま残り、別の章を指していました。
//
// リンク先の章が存在するかどうかは check-books.mjs が検査します。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS = path.join(ROOT, 'books');

const LABEL = /第[ⅠⅡⅢⅣⅤ]部[A-D]?-\d+|第[ⅠⅡⅢⅣⅤ]部[A-D](?!-\d)|第[ⅠⅡⅢⅣⅤ]部(?![A-D]?-?\d)(?![A-D])/g;
const ABBREV = /\[(第[ⅠⅡⅢⅣⅤ]部)([A-D])?-\d+\]\([a-z0-9_-]+\)(?:および|と|、|から|・)([A-D]?)-(\d+)(?![\d\]])/g;

/** config.yaml から章の一覧を読む(平坦な文字列配列のみ) */
function readChapters(text) {
  const out = [];
  let inChapters = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^chapters:/.test(line)) {
      inChapters = true;
      continue;
    }
    if (!inChapters) continue;
    const m = /^\s*-\s+(\S+)/.exec(line);
    if (m) out.push(m[1]);
    else if (line && !/^\s*#/.test(line)) break;
  }
  return out;
}

/** 検査の対象外の領域を伏せる(長さは保つ)。リンクは残す(初出かどうかの判定に使う) */
function mask(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`]*`/g, blank);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const bookDirs = args.length
  ? args
  : fs
      .readdirSync(BOOKS, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(BOOKS, e.name));

const problems = [];
let checked = 0;

for (const dir of bookDirs) {
  const configPath = path.join(dir, 'config.yaml');
  if (!fs.existsSync(configPath)) continue;
  const chapters = readChapters(fs.readFileSync(configPath, 'utf8'));

  // ラベル -> 章 slug
  const labelToSlug = new Map();
  for (const slug of chapters) {
    const p = path.join(dir, `${slug}.md`);
    if (!fs.existsSync(p)) continue;
    const t = /^title:\s*"(.*)"/m.exec(fs.readFileSync(p, 'utf8'));
    if (!t) continue;
    const m = /^(第[ⅠⅡⅢⅣⅤ]部[A-D]?-\d+|第0章|総括)/.exec(t[1]);
    if (m) labelToSlug.set(m[1], slug);
  }
  if (!labelToSlug.size) continue;

  for (const slug of chapters) {
    const p = path.join(dir, `${slug}.md`);
    if (!fs.existsSync(p)) continue;
    const rel = path.relative(ROOT, p);
    const text = fs.readFileSync(p, 'utf8');
    checked++;

    // L2: 省略形の継続参照
    for (const m of text.matchAll(ABBREV)) {
      const label = `${m[1]}${m[3] || m[2] || ''}-${m[4]}`;
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      problems.push(
        `${rel}:${line} [L2] 省略形の参照 "${m[0].slice(-6)}" があります。"${label}" と完全に書いてリンクにしてください(統合や順序変更で古い番号のまま取り残されます)`
      );
    }

    // L1: 裸のラベル。節ごとに、その節で最初に現れるものがリンクであることを求める
    // リンク済みの言及と裸の言及を出現順に並べ、先にリンクが来ていれば裸は許す
    const OCCURRENCE = new RegExp(`\\[(${LABEL.source})\\]\\([^)]*\\)|(${LABEL.source})`, 'g');
    const masked = mask(text);
    const sections = masked.split(/(?=^#{2,4} )/m);
    let offset = 0;
    for (const block of sections) {
      const seen = new Set();
      for (const m of block.matchAll(OCCURRENCE)) {
        const linked = m[1];
        const bare = m[2];
        const label = linked || bare;
        if (!labelToSlug.has(label)) continue; // 部だけの言及や、存在しないラベルは対象外
        if (labelToSlug.get(label) === slug) continue; // 自分自身
        if (linked) {
          seen.add(label);
          continue;
        }
        if (seen.has(label)) continue; // 節の中で、すでにリンクされているか2回目以降
        seen.add(label);
        const line = text.slice(0, offset + m.index).split(/\r?\n/).length;
        problems.push(`${rel}:${line} [L1] "${label}" がリンクになっていません。[${label}](${labelToSlug.get(label)}) と書いてください`);
      }
      offset += block.length;
    }
  }
}

console.log(`chapters: ${checked}, problems: ${problems.length}`);
for (const p of problems) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);

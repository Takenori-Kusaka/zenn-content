// 本の構成を検証する。
//
//   node scripts/check-books.mjs
//
// Zenn へ push すると自動でデプロイされます。壊れた構成をそのまま公開しないため、
// 公開前に機械で確認できることをここで確認します。
//
// とくに危険なのは、config.yaml の chapters から章が抜けることです。
// **記載のない章は zenn.dev 上から削除されます**。手が滑ったことに気づけません。
//
// 依存パッケージなし。YAML は本ファイルが扱う範囲(平坦なキーと文字列配列)だけを読みます。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS = path.join(ROOT, 'books');

/** Zenn の slug 規則(公式ドキュメント) */
const SLUG_CHARS = /^[a-z0-9_-]+$/;
const BOOK_SLUG_LEN = [12, 50];
const CHAPTER_SLUG_LEN = [1, 50];

/** Zenn の制限
 *
 * MAX_TOPICS と IMAGE_MAX_BYTES は、Zenn 公式のGitHub連携に関する記事で明記されている値。
 * 章数については、Zenn公式ドキュメント、および公開されているCLI/検証ライブラリ
 * (zenn-dev/zenn-editor の packages/zenn-model, packages/zenn-cli) のいずれにも
 * 章数の上限を定めた記述・実装が存在しない(2026-09-03 調査)。したがって
 * SOFT_CHAPTER_WARNING は実在するZennの制限ではなく、「章の水増しや設定ミスで
 * 際限なく増えていないか」を著者に知らせるための目安に過ぎない。ここを超えても
 * 公開を妨げない(注意として表示するのみ)。
 * HARD_CHAPTER_LIMIT は、config.yaml の生成ミスなど明白な事故を検出するための
 * 桁違いの安全弁であり、これも実在のZenn制限ではない。
 */
const MAX_TOPICS = 5;
const SOFT_CHAPTER_WARNING = 100;
const HARD_CHAPTER_LIMIT = 500;
const MERMAID_MAX_CHARS = 2000;
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const problems = [];
const notes = [];

/** config.yaml のうち、本ファイルが必要とする範囲だけを読む */
function parseConfig(text) {
  const out = { chapters: [], topics: [] };
  let list = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.trimStart().startsWith('#')) continue;

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && list) {
      out[list].push(unquote(item[1]));
      continue;
    }

    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();

    if (value === '') {
      list = key === 'chapters' || key === 'topics' ? key : null;
      continue;
    }
    list = null;

    const inline = value.match(/^\[(.*)\]$/);
    if (inline) {
      out[key] = inline[1]
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      continue;
    }
    if (value === 'true' || value === 'false') out[key] = value === 'true';
    else if (/^-?\d+$/.test(value)) out[key] = Number(value);
    else out[key] = unquote(value);
  }
  return out;
}

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

/** チャプターの frontmatter(title / free)を読む */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    fm[kv[1]] = v === 'true' ? true : v === 'false' ? false : unquote(v);
  }
  return fm;
}

function checkSlug(slug, [min, max], label) {
  if (!SLUG_CHARS.test(slug)) {
    problems.push(`${label}: slug "${slug}" に使えない文字があります(a-z 0-9 - _ のみ)`);
  }
  if (slug.length < min || slug.length > max) {
    problems.push(`${label}: slug "${slug}" の長さが ${slug.length} です(${min}〜${max}字)`);
  }
}

/** 本文の検査。Zenn 固有の制限に触れるものを見る */
function checkBody(text, label, bookDir) {
  // Mermaid の文字数
  for (const m of text.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
    if (m[1].length > MERMAID_MAX_CHARS) {
      problems.push(`${label}: mermaid ブロックが ${m[1].length} 文字です(上限 ${MERMAID_MAX_CHARS})`);
    }
  }

  // 画像の参照。相対パスは動かない
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    const url = m[1];
    if (/^https?:\/\//.test(url)) continue;
    if (!url.startsWith('/images/')) {
      problems.push(`${label}: 画像 "${url}" は /images/ から始まる絶対パスで書いてください`);
      continue;
    }
    const p = path.join(ROOT, url.replace(/^\//, ''));
    if (!fs.existsSync(p)) {
      problems.push(`${label}: 画像 "${url}" が見つかりません`);
      continue;
    }
    const ext = path.extname(p).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      problems.push(`${label}: 画像 "${url}" の拡張子 ${ext} は Zenn で扱えません`);
    }
    const size = fs.statSync(p).size;
    if (size > IMAGE_MAX_BYTES) {
      problems.push(`${label}: 画像 "${url}" が ${(size / 1024 / 1024).toFixed(1)}MB です(上限 3MB)`);
    }
  }

  // 章どうしのリンク。相対 slug でのみ辿れる
  for (const m of text.matchAll(/\]\(([a-z0-9_-]+)\)/g)) {
    const target = m[1];
    if (!fs.existsSync(path.join(bookDir, `${target}.md`))) {
      problems.push(`${label}: リンク先の章 "${target}" が見つかりません`);
    }
  }
}

// ---------------------------------------------------------------- 実行

if (!fs.existsSync(BOOKS)) {
  console.log('books/ がありません。検査するものがありません');
  process.exit(0);
}

const bookSlugs = fs.readdirSync(BOOKS).filter((d) => fs.statSync(path.join(BOOKS, d)).isDirectory());

for (const slug of bookSlugs) {
  const dir = path.join(BOOKS, slug);
  checkSlug(slug, BOOK_SLUG_LEN, `books/${slug}`);

  const configPath = path.join(dir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    problems.push(`books/${slug}: config.yaml がありません`);
    continue;
  }
  const config = parseConfig(fs.readFileSync(configPath, 'utf8'));

  if (!config.title) problems.push(`books/${slug}: title がありません`);
  if (!config.summary) problems.push(`books/${slug}: summary がありません`);
  if (!Array.isArray(config.topics) || !config.topics.length) {
    problems.push(`books/${slug}: topics がありません`);
  } else if (config.topics.length > MAX_TOPICS) {
    problems.push(`books/${slug}: topics が ${config.topics.length} 件です(上限 ${MAX_TOPICS})`);
  }
  if (typeof config.published !== 'boolean') {
    problems.push(`books/${slug}: published が真偽値ではありません`);
  }

  // カバー画像
  const cover = ['cover.png', 'cover.jpeg', 'cover.jpg'].map((f) => path.join(dir, f)).find(fs.existsSync);
  if (!cover) notes.push(`books/${slug}: カバー画像がありません(cover.png 推奨、500×700)`);

  // 章の突合。ここが本スクリプトの主目的
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));

  const listed = config.chapters ?? [];
  if (!listed.length) {
    problems.push(`books/${slug}: config.yaml に chapters がありません`);
  }
  if (listed.length > HARD_CHAPTER_LIMIT) {
    problems.push(`books/${slug}: 章が ${listed.length} 件です(安全弁 ${HARD_CHAPTER_LIMIT} 件を超過。config.yaml の生成ミスの可能性を確認してください)`);
  } else if (listed.length > SOFT_CHAPTER_WARNING) {
    notes.push(`books/${slug}: 章が ${listed.length} 件です(目安 ${SOFT_CHAPTER_WARNING} 件超。Zenn自体に確認済みの上限はありません。意図した章数か確認してください)`);
  }

  for (const f of files) {
    if (!listed.includes(f)) {
      problems.push(
        `books/${slug}: ${f}.md が config.yaml の chapters にありません。` +
          '記載のない章は zenn.dev 上から削除されます'
      );
    }
  }
  for (const c of listed) {
    if (!files.includes(c)) {
      problems.push(`books/${slug}: chapters の "${c}" に対応する ${c}.md がありません`);
    }
  }

  // 各章
  for (const c of listed) {
    const p = path.join(dir, `${c}.md`);
    if (!fs.existsSync(p)) continue;
    checkSlug(c, CHAPTER_SLUG_LEN, `books/${slug}/${c}`);

    const text = fs.readFileSync(p, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) {
      problems.push(`books/${slug}/${c}.md: frontmatter がありません`);
      continue;
    }
    if (!fm.title) problems.push(`books/${slug}/${c}.md: title がありません`);
    if (config.price > 0 && fm.free === undefined) {
      notes.push(`books/${slug}/${c}.md: 有料の本で free の指定がありません`);
    }
    checkBody(text, `books/${slug}/${c}.md`, dir);
  }

  console.log(`books/${slug}: ${listed.length} 章、published=${config.published}、topics=${config.topics.length}`);
}

for (const n of notes) console.log(`  注意: ${n}`);
for (const p of problems) console.error(`  エラー: ${p}`);

if (problems.length) {
  console.error('');
  console.error(`構成の検証: ${problems.length} 件の問題があります`);
  process.exit(1);
}
console.log(`構成の検証: 問題ありません(注意 ${notes.length} 件)`);

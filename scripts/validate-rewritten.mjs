#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const articleDir = "articles/sample-article";
const originalPath = path.join(articleDir, "original.html");
const rewrittenPath = path.join(articleDir, "rewritten.html");
const resultPath = path.join(articleDir, "validation-result.json");

const checks = [];
let hasError = false;

function addCheck(name, passed, message, details = {}) {
  checks.push({ name, passed, message, details });
  if (!passed) hasError = true;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, "")
    .trim();
}

function countHeadings(html, level) {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>`, "gi"))].length;
}

function collectHeadingIds(html, level) {
  const ids = [];
  const re = new RegExp(`<h${level}\\b([^>]*)>`, "gi");
  for (const match of html.matchAll(re)) {
    const idMatch = match[1].match(/\bid\s*=\s*["']([^"']+)["']/i);
    if (idMatch) ids.push(idMatch[1]);
  }
  return ids;
}

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function countOccurrences(text, phrase) {
  return (text.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

function hasSevereHtmlBreakage(html) {
  const stack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagRe = /<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*)?>/gi;

  for (const match of html.matchAll(tagRe)) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (voidTags.has(tag) || full.endsWith("/>")) continue;
    if (full.startsWith("</")) {
      const last = stack.pop();
      if (last !== tag) return true;
    } else {
      stack.push(tag);
    }
  }

  return stack.length > 0;
}

const original = await readOptional(originalPath);
const rewritten = await readOptional(rewrittenPath);

addCheck("original_exists", original !== null, `${originalPath} が存在する`);
addCheck("rewritten_exists", rewritten !== null, `${rewrittenPath} が存在する`);

if (rewritten !== null) {
  addCheck("rewritten_not_empty", rewritten.trim().length > 0, "rewritten.html が空ではない", {
    bytes: Buffer.byteLength(rewritten, "utf8"),
  });
}

if (original !== null && rewritten !== null) {
  const originalTextLength = stripHtml(original).length;
  const rewrittenTextLength = stripHtml(rewritten).length;
  const lengthRatio = originalTextLength === 0 ? 1 : rewrittenTextLength / originalTextLength;
  addCheck("text_length_not_greatly_reduced", lengthRatio >= 0.9, "元記事より文字数が大きく減っていない", {
    originalTextLength,
    rewrittenTextLength,
    lengthRatio: Number(lengthRatio.toFixed(3)),
  });

  for (const level of [2, 3]) {
    const originalCount = countHeadings(original, level);
    const rewrittenCount = countHeadings(rewritten, level);
    const minAllowed = Math.max(0, Math.floor(originalCount * 0.8));
    addCheck(`h${level}_count_not_greatly_reduced`, rewrittenCount >= minAllowed, `H${level}の数が大きく減っていない`, {
      originalCount,
      rewrittenCount,
      minAllowed,
    });
  }

  for (const level of [2, 3]) {
    const ids = collectHeadingIds(rewritten, level);
    const dupes = duplicates(ids);
    addCheck(`h${level}_ids_unique`, dupes.length === 0, `H${level}のidが重複していない`, {
      ids,
      duplicates: dupes,
    });
  }

  const wakarukotoCount = countOccurrences(stripHtml(rewritten), "この記事でわかること");
  addCheck("wakarukoto_once", wakarukotoCount === 1, "「この記事でわかること」リストが1回だけ設置されている", {
    count: wakarukotoCount,
  });

  addCheck("html_not_severely_broken", !hasSevereHtmlBreakage(rewritten), "WordPressに貼り付け可能なHTMLとして大きく崩れていない");
}

const result = {
  ok: !hasError,
  generatedAt: new Date().toISOString(),
  files: { originalPath, rewrittenPath },
  checks,
};

await mkdir(articleDir, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(`検証結果を保存しました: ${resultPath}`);
if (!result.ok) {
  console.error("検証に失敗した項目があります。");
  process.exit(1);
}

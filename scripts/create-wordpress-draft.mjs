#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const articleDir = "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const inputPath = path.join(articleDir, "input.md");
const metaPath = path.join(articleDir, "original.meta.json");
const outputPath = path.join(articleDir, "wordpress-draft.json");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} が設定されていません。Codex Cloudの環境変数に設定してください。`);
  }
  return value.trim();
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function normalizeRestRoot(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/wp-json")) return `${trimmed}/`;
  return `${trimmed}/wp-json/`;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function getTitle(rewrittenHtml) {
  const input = await readOptional(inputPath);
  const titleMatch = input.match(/^記事タイトル：\s*(.+)$/m);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();

  const metaText = await readOptional(metaPath);
  if (metaText.trim()) {
    try {
      const meta = JSON.parse(metaText);
      if (typeof meta.title === "string" && stripTags(meta.title)) return stripTags(meta.title);
    } catch {
      // タイトル取得に失敗した場合は次の候補を使う。
    }
  }

  const h1Match = rewrittenHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1] && stripTags(h1Match[1])) return stripTags(h1Match[1]);

  return "リライト記事 下書き";
}

function buildAuthHeader(username, applicationPassword) {
  const password = applicationPassword.replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function buildEditUrl(restRoot, post) {
  if (post.link) {
    try {
      const url = new URL(post.link);
      return `${url.origin}/wp-admin/post.php?post=${post.id}&action=edit`;
    } catch {
      // RESTルートから推定する。
    }
  }

  const root = new URL(restRoot);
  return `${root.origin}/wp-admin/post.php?post=${post.id}&action=edit`;
}

const content = await readFile(rewrittenPath, "utf8");
if (!content.trim()) throw new Error(`${rewrittenPath} が空です。`);

const username = requiredEnv("WP_USERNAME");
const applicationPassword = requiredEnv("WP_APPLICATION_PASSWORD");
const restRoot = normalizeRestRoot(requiredEnv("WP_REST_ROOT"));
const postType = (process.env.WP_POST_TYPE || "posts").trim() || "posts";
const status = (process.env.WP_DRAFT_STATUS || "draft").trim() || "draft";

if (!/^draft|pending|private$/i.test(status)) {
  throw new Error("WP_DRAFT_STATUS は draft / pending / private のいずれかを指定してください。公開ステータスでは投稿しません。");
}

const title = await getTitle(content);
const endpoint = new URL(`wp/v2/${postType}`, restRoot).toString();

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: buildAuthHeader(username, applicationPassword),
    "content-type": "application/json",
    accept: "application/json",
  },
  body: JSON.stringify({ title, content, status }),
});

const responseText = await response.text();
let responseJson;
try {
  responseJson = JSON.parse(responseText);
} catch {
  responseJson = { raw: responseText };
}

if (!response.ok) {
  await mkdir(articleDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ ok: false, status: response.status, statusText: response.statusText, error: responseJson }, null, 2)}\n`, "utf8");
  throw new Error(`WordPress下書き作成に失敗しました: ${response.status} ${response.statusText}`);
}

const draft = {
  ok: true,
  createdAt: new Date().toISOString(),
  postType,
  status: responseJson.status || status,
  id: responseJson.id,
  title,
  editUrl: buildEditUrl(restRoot, responseJson),
  link: responseJson.link || null,
  previewUrl: responseJson.preview_link || responseJson.guid?.rendered || responseJson.link || null,
};

await mkdir(articleDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(`WordPress下書き結果を保存しました: ${outputPath}`);
console.log(`下書きID: ${draft.id}`);
console.log(`編集URL: ${draft.editUrl}`);
if (draft.previewUrl) console.log(`プレビューURL: ${draft.previewUrl}`);

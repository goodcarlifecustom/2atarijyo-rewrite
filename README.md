# SEOリライト用ワークフロー

このフォルダは、CodexにSEO記事リライトを安全に依頼するためのテンプレートです。

## 使い方

1. `articles/sample-article/` をコピーして、記事名に変更する
2. `original.html` にWordPressの元記事HTMLを貼る
3. `input.md` に狙うKW・Search Consoleデータ・上位サイト情報を貼る
4. Codexに `prompt.md` の内容を貼って実行する
5. まず `rewrite-plan.md` を確認する
6. 問題なければ `rewritten.html` を作成させる
7. `change-log.md` を見てからWordPressに反映する

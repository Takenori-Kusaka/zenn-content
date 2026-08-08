# zenn-content

[Zenn](https://zenn.dev/) へ公開する記事と本の原稿です。GitHub 連携で自動デプロイされます。

## 公開しているもの

| 種別 | タイトル | パス |
| --- | --- | --- |
| 本 | AIが実装する時代の開発プロセス — ピットイン方式 | `books/pit-in-process/` |

## 構成

```
.
├── books/<book-slug>/
│   ├── config.yaml   タイトル・トピック・章の順序
│   ├── cover.png     500×700
│   └── *.md          各章
└── images/           画像。参照は /images/... の絶対パス
```

## 執筆

```bash
npm install
npm run preview   # http://localhost:8000
npm run lint      # textlint(日本語校正)
npm run new:book  # 新しい本の雛形
```

## 注意

- **`config.yaml` の `chapters` に書かれていない章は、zenn.dev 上から削除される**。章を増減したら必ず更新する
- **公開後に slug を変えると URL が変わる**。公開前に確定させる
- 画像は `/images/...` の**絶対パス**で参照する。相対パスは動かない
- Mermaid は1ブロック 2000 文字以内、Chain 10 以下

## 関連

| | |
| --- | --- |
| 標準本文とサイト | https://github.com/Takenori-Kusaka/process-compass |
| 準拠テンプレート | https://github.com/Takenori-Kusaka/pit-in-template |

## ライセンス

原稿は [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。

# My Pake build guide

このフォークでは、既成 Release バイナリを使わず、自分の GitHub Actions で Pake アプリをビルドできます。

## 使う workflow

Actions タブで次の workflow を使います。

```text
Build My Pake App
```

既存の `Build App With Pake CLI` も手動実行できますが、この個人用 workflow はよく使う入力を整理し、URL や icon の値をログへ直接 echo しないようにしています。

## 初回準備

1. `tw93/Pake` を自分の GitHub アカウントへ fork します。
2. fork 側の Actions タブを開きます。
3. GitHub から workflow の有効化を求められた場合は有効化します。
4. `Build My Pake App` を選び、`Run workflow` から実行します。

## 入力例

### macOS

```text
platform: macos-latest
url: https://example.com
name: MyPakeApp
width: 1200
height: 800
hide_title_bar: true
multi_arch: true
macos_target: universal
force_internal_navigation: false
```

期待する artifact:

```text
MyPakeApp-macOS
```

中に `.dmg` が入ります。`macos_target` を `app` にすると、ローカル確認用の `.app` を作れます。

AI 系や Google 系の Web アプリでクリック先が外部ブラウザに逃げる場合は、次の入力を `true` にします。

```text
force_internal_navigation: true
```

これは Pake CLI の `--force-internal-navigation` に対応します。クリックしたリンクをアプリ内に留めるため、NotebookLM のように入口ドメインと実アプリのドメインが違うサービスで有効です。ただし、外部ヘルプや利用規約ページもアプリ内で開くことがあるため、通常の Web サイトでは必要な時だけ有効化してください。

### Windows

```text
platform: windows-latest
url: https://example.com
name: MyPakeApp
width: 1200
height: 800
windows_target: x64
```

期待する artifact:

```text
MyPakeApp-Windows
```

中に `.msi` が入ります。

### Linux

```text
platform: ubuntu-24.04
url: https://example.com
name: mypakeapp
width: 1200
height: 800
linux_targets: appimage
```

期待する artifact:

```text
mypakeapp-Linux
```

中に `.AppImage` が入ります。`linux_targets` は `deb,appimage` のようにカンマ区切りで複数指定できます。

## Artifacts のダウンロード

1. Actions タブで完了した run を開きます。
2. Summary の Artifacts から対象 OS の artifact をダウンロードします。
3. zip を展開して `.dmg`, `.msi`, `.AppImage`, `.deb` などを取り出します。

## ローカルビルド

GitHub Actions を使わずにローカルで確認する場合:

```bash
corepack enable
pnpm install
pnpm run cli:build

node dist/cli.js https://example.com \
  --name MyPakeApp \
  --width 1200 \
  --height 800
```

macOS で `.app` だけを作る場合:

```bash
PAKE_CREATE_APP=1 node dist/cli.js https://example.com \
  --name MyPakeApp \
  --width 1200 \
  --height 800 \
  --hide-title-bar
```

## セキュリティ注意点

workflow の入力値は GitHub Actions 上で扱われます。次の値は入力しないでください。

- トークン付き URL
- セッション ID 付き URL
- 署名付き URL
- 社内の秘密 URL
- 個人情報を含む URL
- 一時認証 URL

悪い例:

```text
https://example.com/dashboard?token=xxxxx
```

良い例:

```text
https://example.com/dashboard
```

Pake で包む対象は、信頼できる Web サイトに限定してください。金融、医療、個人情報管理など高リスク用途や、規約で非公式クライアント化が禁止されているサービスには使わないでください。

JS/CSS 注入は最初は使わないでください。使う場合は自分で内容を確認したファイルだけを指定し、ログイン、決済、パスワード、トークンを扱うページでは使わないでください。

`--ignore-certificate-errors` は本番利用では使わないでください。自己署名証明書を使うローカル開発や社内テストに限定してください。

## よくある失敗

- Actions が表示されない: fork 側の Actions タブで workflow を有効化してください。
- Linux 名で失敗する: `name` は小文字の英数字中心にしてください。
- AppImage が失敗する: `linux_targets` を `deb` に変えて確認してください。
- Windows 初回ビルドが遅い: WiX や依存関係のセットアップに時間がかかります。初回は長めに待ってください。
- macOS で universal が遅い: Intel と Apple Silicon の両方をビルドするため、単一 architecture より時間がかかります。
- アプリ内のボタンを押すと外部ブラウザが開く: `force_internal_navigation: true` で作り直してください。入口 URL ではなく、実際に使うアプリ本体の URL を指定することも重要です。
- 置き換えたはずなのに挙動が古い: 対象の Pake アプリを完全に終了し、必要なら `/Applications` の `.app` が新しい version になっているか `Info.plist` で確認してください。

## AI 系アプリの実用メモ

AI 系 Web アプリは公式アプリと名前が衝突しやすいため、原則として `ChatGPT Pake` のように末尾へ `Pake` を付けます。これにより `/Applications/ChatGPT.app` や `/Applications/Gemini.app` などの公式アプリを上書きしません。

実際に作った例:

```text
ChatGPT Pake
url: https://chatgpt.com/
force_internal_navigation: false

Gemini Pake
url: https://gemini.google.com/app
force_internal_navigation: false

NotebookLM Pake
url: https://notebooklm.google.com/
force_internal_navigation: true
```

NotebookLM は `https://notebooklm.google/` で作ると概要ページは表示できますが、ノートブックを開く時に `notebooklm.google.com` 側へ遷移して外部ブラウザが開くことがあります。実用する場合は `https://notebooklm.google.com/` を起点にし、`force_internal_navigation: true` を付けてください。

次に作る候補:

```text
Claude Pake
url: https://claude.ai/

Perplexity Pake
url: https://www.perplexity.ai/

Google AI Studio Pake
url: https://aistudio.google.com/
force_internal_navigation: true

Poe Pake
url: https://poe.com/

Microsoft Copilot Pake
url: https://copilot.microsoft.com/
```

Google ログインや外部認証が絡むサービスは、Pake の設定だけでは WebView 内ログインを完走できない場合があります。その場合は Pake の問題ではなく、認証提供側の制限である可能性があります。

## 既存 workflow との違い

この workflow は Pake 本体の Rust/Tauri コードを変更しません。既存の `.github/actions/setup-env` と `pnpm run cli:build` を使い、手動入力から `node dist/cli.js` を実行します。

既存 workflow との差分は次の通りです。

- 個人利用向けの安全な default を置いています。
- `url` と `icon` をログに直接 echo しません。
- OS ごとの target 入力を分けています。
- 必要に応じて `force_internal_navigation` を指定できます。
- 成果物を `artifacts/` に集めてから upload します。

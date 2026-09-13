# ngmaze

[English](README.md) | 日本語

`ngmaze` は、大規模な Angular コードベースについての次の 4 つの疑問にすばやく答える CLI です。

```text
このコンポーネントの配下には何がある？
このコンポーネントはどこから使われている？
このコンポーネントへの変更はどこまで影響する？
この 2 つのコンポーネントはなぜつながっている？
```

ドキュメント生成ツールではありません。コードを読むための `tree` のようなツールです。

```bash
npx mergelog/ng-maze ProjectsPageComponent
```

```text
ProjectsPageComponent
├── ProjectsListComponent
│   ├── ProjectCardComponent (参照元: 2)
│   │   ├── CardComponent (参照元: 8)
│   │   └── ProjectCardMenuExtendedComponent
│   │       ├── MenuComponent (参照元: 17)
│   │       └── MenuItemComponent (参照元: 31) ×4
│   └── SearchResultsTableComponent
└── RouterTabNavBarComponent
```

`参照元` は、そのコンポーネントを使用する**重複のないコンポーネント数**です。`×4` は、この親コンポーネント内で使用されている回数を表します。

## GitHub から実行

```bash
npx mergelog/ng-maze --all --mdh -p .
```

このリポジトリは現在 npm には公開していないため、`npx mergelog/ng-maze` で直接実行します。`-p .` はカレントディレクトリを解析対象に指定します。

Node.js `^22.22.3 || ^24.15.0 || >=26` が必要です。

`ngmaze` は、まず解析対象プロジェクトから `typescript` と `@angular/compiler` を解決し、見つからない場合は自身に同梱されたものを使用します。どちらが使用されたかは `--verbose` で確認できます。

## 使い方

```bash
npx mergelog/ng-maze                                  # プロジェクトの概要
npx mergelog/ng-maze ProjectsPageComponent            # 子コンポーネント
npx mergelog/ng-maze MenuItemComponent --parents      # 変更の影響範囲
npx mergelog/ng-maze ProjectsPageComponent --depth 3  # 深さを制限
npx mergelog/ng-maze MenuItemComponent --parents --why
npx mergelog/ng-maze --all                            # すべてのルートツリー
npx mergelog/ng-maze --all --ignore-ambiguous         # 解決できない動的コンポーネントのプレースホルダーを隠す
npx mergelog/ng-maze ProjectsPageComponent -o tree.txt
npx mergelog/ng-maze --json -o component-graph.json
npx mergelog/ng-maze ProjectsPageComponent --md        # <project>/ng-maze-YYYYMMDD-HHMMSS.md にリンク付きMarkdown treeを保存
npx mergelog/ng-maze ProjectsPageComponent --mdc       # 非推奨: 罫線付きのコンパクトなMarkdown treeを保存
npx mergelog/ng-maze ProjectsPageComponent --mdh       # 非推奨: formatter耐性のあるHTML罫線ツリーを保存
npx mergelog/ng-maze ProjectsPageComponent -p /path/to/angular/project
```

コンポーネントは、クラス名、セレクター、または完全な ComponentId（`src/app/app.component.ts#AppComponent`）で指定できます。クラス名が曖昧な場合、`ngmaze` は候補を 1 つに決めず、すべて表示します。

### オプション

| オプション | 意味 |
| --- | --- |
| `-p, --project <path>` | 解析ルート（デフォルト: カレントディレクトリ） |
| `--parents` | 使用箇所を親方向へたどる |
| `--depth <number>` | ツリーの深さを制限（デフォルト: 1,000。後述のノード上限を参照） |
| `--why` | すべての関係について、種類、ファイル、行を表示 |
| `--ignore-ambiguous` | 解決できなかった動的コンポーネントのプレースホルダーを、ツリーと結果ビューから隠す |
| `--all` | すべてのルートツリーと到達不能なコンポーネントを表示 |
| `--json` | 機械可読形式で出力 |
| `--mdh` | HTML の `<pre>` 内へリンク付き罫線ツリーを保存。Markdown整形後も見やすい形式 |
| `--md` | (非推奨)解析ルート直下の `ng-maze-YYYYMMDD-HHMMSS.md` にリンク付きMarkdown treeを保存 |
| `--mdc` | (非推奨)リンク付き罫線ツリーを保存。Markdown整形前に見やすい形式 |
| `-o, --output <file>` | ファイルへ出力（ANSI カラーは常に無効） |
| `--angular-project <name>` | 指定した `angular.json` プロジェクトだけを解析 |
| `--tsconfig <path>` | compilerOptions の取得元として、この tsconfig を使用 |
| `--verbose` | 解決処理と所要時間の詳細を stderr に出力 |
| `--help`, `--version` | |

オプションの組み合わせは検証され、黙って無視されることはありません。`--all` とコンポーネント引数は同時に指定できません。`--parents` にはコンポーネントの指定が必要です。`--why` にはコンポーネントまたは `--all` の指定が必要です。`--depth` には 1 から 1,000 の整数が必要です。また、`--angular-project` と `--tsconfig`、`--md` / `--mdc` / `--mdh` 同士、`--md` / `--mdc` / `--mdh` と `--json` / `--output` は同時に指定できません。Markdown は解析ルート直下へ保存するため、各クラス名をソースファイルへの相対リンクにできます。生成した Markdown を上書きすることはありません。同じ秒に 2 回実行した場合、2 つ目は `…-2.md` になります。生成物は解析対象プロジェクト内に置かれるため、通常はそのプロジェクトの `.gitignore` に `ng-maze-*.md` を追加しておくとよいでしょう。

### ノード上限

既定の深さは 1,000 です。深い直線グラフで JavaScript の stack を使い切ることや、インデントによる無制限の出力を防ぎます。ツリーはグラフを展開したものでもあり、多くの親から共有されるコンポーネント（デザインシステムなど）があると、ノード数はコンポーネント数ではなく**経路数**に比例します。そのため展開は 200,000 ノードでも打ち切られます。どちらの打切りでも対象ノードには `[...]` が付き、stderr に警告が出ます。別の上限を必要とする場合は 1,000 以下の `--depth <n>` を指定してください。ツリー構築と全出力形式は反復走査です。

## このツリーは静的解析の結果であり、実行時の DOM ではありません

**`ngmaze` が表示するのは、ソースコードから静的に確定できるコンポーネント間の関係です。ブラウザーの DOM や、実行時のコンポーネントインスタンスのツリーではありません。**

`@if`、`@for`、`@switch`、`@defer`、ルート、`ng-content`、動的コンポーネントはすべて、実際に画面へ何が表示されるかを実行時に決定します。`@if` 内のコンポーネントが一覧に含まれるのは、そこで使用される可能性があるためであり、兄弟コンポーネントと同時に描画されるためではありません。

エッジは、次の 3 つすべてを満たす場合にだけ作成されます。

1. セレクターが一致した
2. 一致したコンポーネントが、所有元の Angular スコープ（スタンドアロンの `imports` または NgModule のコンパイルスコープ）から参照できる
3. プロジェクト内のコンポーネントを一意に特定できる

実際の Angular の動的コンポーネント API が見つかったものの、その対象を 1 つのコンポーネントに絞り込めない場合、ngmaze は `? Ambiguous component` という葉をツリーに追加します。候補を保守的に列挙できる場合はその候補を葉に表示し、列挙できない場合もソースの式と位置は表示され続けます。この葉はコンポーネントではないため、エッジ、`参照元`、ルート候補、到達可能性、影響範囲の計算には一切影響しません。

サービス・関数・ファイルが所有する曖昧な呼び出しは、親を捏造しないかぎりコンポーネントに紐づけられないため、`Unowned ambiguous component usages` セクションに表示します。`--ignore-ambiguous` はこの両方を隠します。ただし JSON の `global.detectionGaps` には、結果ビューのプレースホルダーを隠した場合でも完全な監査証跡が残ります。

概要（summary）には、これらの件数が `Ambiguous usages` 行として表示されます。

コンテンツプロジェクションもソース基準です。ラッパー要素の内側に書かれたコンポーネントは、テンプレートの所有者の子のままです。実行時の DOM を模倣してラッパーの下へ移動させることはありません。

## ngmaze が報告する関係

| 種類 | 発生元 |
| --- | --- |
| `template` | テンプレート内のセレクター一致（制御フローと遅延ブロックを含む） |
| `dialog` | `MatDialog.open(Component)`（プロパティ名ではなく、レシーバーの型で検証） |
| `create-component` | `ViewContainerRef.createComponent` および `@angular/core` の `createComponent` |
| `ng-component-outlet` | コンポーネントクラスとして静的に解決できる `[ngComponentOutlet]` |

ルートとコンポーネント以外の呼び出し元は、意図的にコンポーネントの親として扱いません。

* `Route entries` には、`component` / `loadComponent` の対象が表示されます。
* `External usages` には、コンポーネントを生成するサービス、エフェクト、通常の関数、トップレベルコードが表示されます。

どちらも独立したセクションに表示され、`参照元` の数には含まれません。

コンポーネントがプロジェクト内の別のコンポーネントを直接継承する場合、ツリーの表示には
`PipelineCardComponent [extends ProjectCardComponent]` のような注記が付きます。継承はエッジではないため、
コンポーネントツリー、`参照元`、ルート候補には影響しません。`--parents` では、直接の継承元と継承先を
独立した `Inheritance:` セクションに表示します。

## 警告は失敗ではありません

概要の末尾には `Warnings:` ブロックが表示されます。JSON では、同じ情報が `global` と `result` の `diagnostics` キーに格納されます。画面表示上の単語と JSON のキーは意図的に異なりますが、示すデータは同じです。

```text
Warnings:
  ambiguous selectors : 1
  unresolved dynamics : 2
```

警告は「静的に解決できなかった」ことを意味し、「解析に失敗した」ことを意味しません。終了コードは `0` のままです。ファイルと行を確認するには `--why` または `--json` を使用してください。

| コード | 意味 |
| --- | --- |
| `component-metadata` | メタデータのフィールドを静的に評価できなかった |
| `multiple-ngmodule-declarations` | 1 つのコンポーネントが複数の NgModule で宣言されている |
| `missing-template` | `templateUrl` が存在しないファイルを指している |
| `template-parse-error` | テンプレートを解析できなかった（エッジは推測で追加されない） |
| `unresolved-scope` | スコープ内にあるプロジェクトローカルの依存関係を解決できなかった |
| `ambiguous-selector` | 1 つの要素に対して、プロジェクト内の複数のコンポーネントが一致した |
| `selector-out-of-scope` | プロジェクト内のコンポーネントが一致したが、インポートされていない |
| `unresolved-route` | ルートの対象を静的に解決できなかった |
| `unresolved-dynamic` | 動的コンポーネントの対象を静的に解決できなかった |

## 終了コード

| コード | 意味 |
| --- | --- |
| `0` | 成功（警告がある場合を含む） |
| `1` | コンポーネントが見つからない |
| `2` | コンポーネント名が曖昧 |
| `3` | ユーザー側のエラー: CLI 入力、プロジェクトまたは tsconfig の解決、出力先パス |
| `4` | ngmaze の内部エラー |

`--json` は、終了コードが 1 または 2 の場合も含め、常に有効な JSON ドキュメントを生成します。その場合、`result` は空になり、`error` に候補が格納されます。

## ngmaze の解析対象

* 解析ルートと重なる `angular.json` 内のすべての `application` および `library` プロジェクト。1 つのグラフに統合されます（各コンポーネントはプロジェクト名を保持します）
* そのグラフに対して TypeScript の `Program` は 1 つだけ作成されます。`compilerOptions` は 1 つの主 tsconfig（最も浅いプロジェクト、同じ深さなら `library` より `application` を優先）から取得し、他プロジェクトの `paths` エイリアスはそこへマージします。これにより、別プロジェクトのエイリアス経由の import も解決できます。主 tsconfig、マージした tsconfig、参照したすべての tsconfig は `--verbose` で確認できます
* tsconfig のファイル一覧と各プロジェクトの `sourceRoot` の和集合。これにより、どのエントリーポイントからもインポートされないコンポーネントも検出されます
* spec、test、`testing/`、`e2e/` のソースは除外されます。除外されたファイル数は `--verbose` で確認できます

`@angular/core` を解決できない場合、`ngmaze` は「0 components」と報告せず、終了コード 3 で停止します。

## v1 で意図的に行わないこと

* Angular コンパイラーの再実装
* 外部 npm パッケージ内のコンポーネントの展開（`<mat-icon>` はプロジェクトグラフに含まれません）
* 任意の関数の実行や、実行時に決まるコンポーネントの解決
* 実行時のルーター設定の再現
* 実行時 DI の解析
* テンプレートの lint や未知の HTML 要素の検査
* セレクターを持たないテンプレート構文（`<MyComponent />`）の解決

静的に確定できない情報を、推測で補うことはありません。

## JSON 出力

`global.detectionGaps` には、静的に確定できなかった箇所（カタログに載せられなかった `@Component`、除外ファイル内のコンポーネント、解決できなかった動的コンポーネントやルート、静的エッジにできない実行時 API）が記録されます。「関係が存在しない」ことと「関係を検出できなかった」ことを、利用側が区別できるようにするためです。

[docs/JSON_SCHEMA.md](docs/JSON_SCHEMA.md) と、正式なスキーマである [docs/ngmaze.schema.json](docs/ngmaze.schema.json) を参照してください。繰り返し実行した結果の差分を取りやすくするため、ドキュメントには所要時間を含めていません。また、すべての配列は決定論的な順序で並びます。

## 開発

```bash
npm install
npm run build
npm test
```

`npm test` は、解決された `@angular/compiler` に対するコントラクトテスト、ユニットテスト、インテグレーションテスト、CLI テスト、エンドツーエンドテストを実行します。

## ライセンス

MIT

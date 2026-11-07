# Native Git Graph for Lapce — Rust-only implementation plan

**Status:** Architecture specification, not a working implementation.  
**Target branch:** `design/native-rust-git-graph`  
**Primary constraint:** Do **not** modify Lapce; no JavaScript, HTML, webview, external browser, Node.js, Electron, localhost server, or `xdg-open`.

## 1. Audit of existing project

- `src/lib.rs`: current WASI Volt logs initialization and invokes `PLUGIN_RPC.execute_process("xdg-open", ["http://127.0.0.1:6428"])` on notification. It does not provide an embedded graph, native UI, or automatic companion startup.
- `server.js`: ~23 KB Node HTTP companion, queries Git using child processes, offers repository info, refs, stashes, commits, details and actions via `/api/request`. Also generates HTML/VS Code API compatibility shim.
- `web/out.min.js` (~202 KB) and `web/out.min.css` (~37 KB): legacy VS Code webview assets, not usable in the Rust-only result.
- `Cargo.toml`: WASI-only Rust library with `lapce-plugin = "0.1.1"`; no Git model or graphics.
- `volt.toml`: advertises Git Graph and a server port; must remove obsolete port after migration.
- `scripts/install-local.sh`: installs server and web assets. Must switch to a native launcher and packaged binary.
- `README.md`: currently states the graph opens in browser; update truthful architecture and installation docs.

**Reference implementation:** `balogun14/SQLite-Viewer` uses native Rust WASI + PSP/LSP for autocomplete, hover, and `sqlite3` command execution, without JS. Its README explicitly acknowledges that the current Lapce plugin API cannot create native panels/webviews. It is an example of the **plugin runtime**, not custom native UI.

**Upstream limitation:** `lapce/lapce#3956` is an open request for plugin native UI/toolbar contributions: https://github.com/lapce/lapce/issues/3956 . Verify upstream again when implementing. As long as the API lacks such support, **a true embedded custom Git graph inside stock Lapce is not technically available as a standalone Volt**.

## 2. Selected approach WITHOUT modifying Lapce

Build a two-part, entirely Rust system:

1. **WASI Volt**: activates in Git workspace, discovers workspace context through supported initialize params, exposes supported commands/notifications only, then launches a **separate native executable** through `PLUGIN_RPC.execute_process` *if verified to work reliably and safely*. Do not assume that the VS Code-style command/menu contributions exist; investigate how a user can trigger the launcher on stock Lapce. If no reliable plugin command activation exists, provide a documented launcher from Lapce's integrated terminal as a functional fallback and report the activation limitation, not false integration.
2. **Native Git Graph executable**: full Rust process using Floem for GPU-rendered native OS window, Git engine in Rust, no browser or HTTP listener. It is not an embedded Lapce tab or dockable panel; document that distinction prominently. Launch in repository context; on repeated invocations, use a supported single-instance mechanism only if needed and safe. Avoid untrusted executable path overrides.

A later **optional** adapter for a native Lapce panel may be developed if Lapce adds extension UI APIs, but DO NOT fork or patch Lapce in this branch.

Proposed layout:
```text
crates/
  git-graph-core/      # typed Git operations, repo snapshot, errors
  git-graph-layout/    # pure graph layout, independent of UI
  git-graph-model/     # commands, selection, filters, pagination
  git-graph-native/    # Floem native desktop application
plugin/
  # optional WASI Volt launcher (after API/activation feasibility proof)
docs/
  NATIVE_RUST_IMPLEMENTATION.md
  RUNNING_WITH_LAPCE.md
tests/
  fixtures/
```

No need to migrate binary assets blindly; retain old implementation on `master` until feature parity. For the new branch, legacy files may initially remain for historical comparison but must not participate in the native build/runtime.

## 3. Critical first milestone: prove feasibility

Before implementing the full feature set, create an executable native Floem window with a placeholder graph; it must:
- Build and launch on Linux (first), then macOS and Windows when supported by dependencies.
- Open a Git repository from a CLI argument, detect bare/worktree/normal repos, render basic commit rows.
- Demonstrate a **real** trigger from an unmodified Lapce installation, if the current plugin protocol permits it. Verify plugin startup, registration, parameter parsing, process-launch behavior (synchronous wait vs asynchronous execution, wasm host permissions, working directory and executable packaging). **If launching a persistent graphical child process via execute_process blocks the WASI/plugin host, do not ship this design**; investigate a supported detached process route or document manual terminal launch.
- Never launch a browser. Never bind port 6428. Never require Node.
- Record exact pinned Lapce revision, OS, and command needed; do not fabricate successful tests.

If trigger integration fails, native standalone app is still a meaningful deliverable, but **do not claim it's a functional Lapce-integrated plugin**.

## 4. Rust modules and APIs

Choose `git2`/libgit2 for pragmatic Git data access initially; consider `gix` later behind a repository-backend trait after verifying compatibility, features, build sizes, performance, and license. Do not block event thread on repository I/O; use background worker tasks and cancellation/stale-result guards.

Example conceptual types (not asserted as compilable APIs):
```rust
struct CommitNode {
    oid: String,
    parents: Vec<String>,
    author: String,
    email: String,
    timestamp: i64,
    subject: String,
    decorations: Vec<RefDecoration>,
}
enum RefDecoration { Head, LocalBranch(String), RemoteBranch(String), Tag(String), Stash(String) }
struct GraphRow { commit: CommitNode, lane: usize, edges: Vec<GraphEdge> }
struct HistoryQuery { page_size: usize, cursor: Option<String>, first_parent: bool }
```

Implement deterministic lane assignment using ordered DAG and first-parent continuation, merge edges, lane reuse, shallow/missing parents, disconnected histories, octopus merges. Preserve lane continuity across incremental pages. Layout crate must not depend on Floem. Unit snapshot tests for explicit commit DAGs.

Default ~300 initial commits, ~75 additional page size, with viewport virtualization (10k–100k commit test fixtures), stable sorting semantics and duplicate-free pagination. Track ref changes and invalidate stale cursors. Use lazy commit detail and diff fetching.

## 5. Native UI features

A real visually drawn Git DAG with colored lanes, commit circles, merge connections, labels and selected-row highlight; header controls for repo, branch filters, remote refs, search, first-parent, refresh; commit columns for hash, subject, author, date. Details pane with body, parent links and changed file names, status and addition/deletion counts. Support keyboard focus/navigation, light/dark theme, DPI scaling, window sizing, and scroll virtualization.

Read-only feature sequence: repository detection -> history with graph -> refs/tags -> commit details -> file changes/diffs -> search/filter -> stash display. Integration with Lapce file opening must only use documented supported mechanisms; do not assert native editor-tab ability from an external process.

Action sequence: checkout branch/commit, create/delete branch, create/delete tag, cherry-pick. Put behind explicit confirmation for destructive operations and clear error handling. Worktree/uncommitted state and conflicts must be handled without data loss. Enable fetch only if explicitly requested and implemented with known remotes. Never shell-concatenate untrusted refs; validate repository scope.

Correctness fixes compared to `server.js`:
- Root-commit diff against empty tree, not empty `commit..commit`.
- Merge commits: explicitly choose parent for diff or display combined semantics.
- Preserve unusual filenames/commit messages (no newline or ad-hoc sentinel parsing).
- Normalize annotated tags and peeled targets; handle detached HEAD, empty repos, Git worktrees.
- Unsupported actions return an actual error, never false success.
- Never accept arbitrary untrusted path switch from a remote HTTP query (there should be no HTTP server).

## 6. Testing and release criteria

- CI: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace` (adjust excluded WASI targets explicitly), build Rust native executable, compile Volt if included.
- Deterministic Git fixtures: linear, fork, merge, octopus, root, tags (annotated/lightweight), remote tracking, stashes, detached HEAD, worktrees, empty repo, shallow history, filenames with whitespace and non-ASCII, huge history.
- Native smoke test on a known commit tree with screenshot or human-readable verification; check graph lines and click selection; verify **no browser, Node process, HTTP listener or JavaScript running**.
- Test launcher on stock Lapce (actual version/OS). Document that external native window is an **OS window**, not a Lapce panel.
- Build independent native application and optional Volt. Packaging must include executable per OS/architecture with explicit executable placement; WASI cannot execute an embedded native binary by magic.
- Update README with accurate install/launch instructions and stated limitations.
- Do not delete the old web implementation until the native replacement is tested.

## 7. Instructions to Codex

Read this entire file, inspect the repository and upstream Lapce extension APIs, and implement the selected **non-fork** architecture incrementally. First make the native Floem app display real Git commits and edges on Linux. Prove or disprove stock-Lapce plugin launch feasibility with tests, respecting that execute_process may wait for the spawned process. Do not build a browser/WebView/HTML/Tauri/Electron wrapper or claim stock Lapce supports custom native panels. Then finish core/UI/actions/tests/docs, with runnable commands. Commit coherent milestones on this branch. Report exactly which features work and which remain blocked by Lapce API.

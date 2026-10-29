# Git Graph for Lapce

[![Lapce Plugin](https://img.shields.io/badge/Lapce-Plugin-blue.svg)](https://plugins.lapce.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Git Graph for Lapce** brings an interactive, visual Git commit graph and history viewer directly to the [Lapce](https://lapce.dev) code editor. Inspired by the renowned VS Code Git Graph extension by Michael Hutchison (`mhutchie`), this plugin enables you to view commit trees, branches, tags, stashes, and commit details without leaving your lightweight, GPU-accelerated editor workflow.

![Git Graph Icon](icon.svg)

---

## ✨ Features

- **Interactive Git Graph:** View your repository's commit tree with color-coded branch lanes, merge points, and heads.
- **Branch & Remote Filtering:** Easily switch between active branches, all local branches, or include remote branches.
- **Commit Details View:** Inspect commit messages, author/committer information, date, parent hashes, and changed files with additions and deletions.
- **Quick Git Actions:**
  - Checkout branch or specific commit
  - Create new branch from any commit
  - Add and delete tags
  - Cherry-pick commits
  - Inspect stashes
- **Lapce Integration:** WASI-based Volt plugin compatible with Lapce's native extension architecture.
- **Blazing Fast:** Powered by native Git commands and lightweight companion streaming.

---

## 🚀 Getting Started

### 1. Installation from the Lapce Plugin Registry

1. Open **Lapce**.
2. Press `Ctrl + Shift + X` (or click on the Plugin icon in the activity bar).
3. Search for **Git Graph**.
4. Click **Install**.

### 2. Manual / Local Installation

To install and test locally on Linux:

```bash
# Clone the repository
git clone https://github.com/scherenhaenden/lapce-git-graph.git
cd lapce-git-graph

# Install to Lapce plugins directory
mkdir -p ~/.local/share/lapce-stable/plugins/scherenhaenden.git-graph
cp volt.toml lapce-git-graph.wasm icon.svg README.md server.js ~/.local/share/lapce-stable/plugins/scherenhaenden.git-graph/
cp -r web ~/.local/share/lapce-stable/plugins/scherenhaenden.git-graph/
```

Restart Lapce or open any Git repository.

---

## 🛠️ How It Works

Lapce is a native Rust code editor rendered using GPU acceleration (Floem/wgpu). Unlike Electron-based editors, Lapce plugins run in a secure **WASI WebAssembly sandbox**.

1. When you open a repository in Lapce, the **Git Graph WASI plugin** initializes.
2. It activates the local companion service (or launches `node server.js`).
3. The companion service queries `git log`, `git show-ref`, and `git diff` using optimal binary buffers and communicates seamlessly with the visual graph UI.
4. You can view the graph in your browser or embedded companion window at `http://127.0.0.1:6428`.

---

## ⚙️ Configuration (`volt.toml`)

You can customize Git Graph settings directly in Lapce:

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `git-graph.port` | `number` | `6428` | Port for the local Git Graph viewer server |

---

## 📦 Building from Source

Prerequisites:
- [Rust](https://rustup.rs/) (with `wasm32-wasip1` target)
- [Node.js](https://nodejs.org/) (v16+)

```bash
# Add WebAssembly target
rustup target add wasm32-wasip1

# Build release WebAssembly plugin
cargo build --target wasm32-wasip1 --release
cp target/wasm32-wasip1/release/lapce_git_graph.wasm lapce-git-graph.wasm

# Package into .volt archive for publishing
tar -cf - volt.toml lapce-git-graph.wasm README.md icon.svg | zstd > git-graph.volt
```

---

## 📜 License

MIT License. See [LICENSE](LICENSE) for details.

Original Git Graph webview interface assets by Michael Hutchison ([mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph)).

/**
 * Git Graph Companion Server for Lapce Editor
 * Handles Git repository queries and serves the interactive Git Graph UI.
 */

const http = require('http');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 6428;
let REPO_DIR = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

// Find actual git root
try {
    const gitRoot = cp.execSync('git rev-parse --show-toplevel', { cwd: REPO_DIR, encoding: 'utf8' }).trim();
    if (gitRoot) REPO_DIR = gitRoot;
} catch (e) {
    // Keep as is
}

const GIT_LOG_SEPARATOR = 'XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb';
const EOL_REGEX = /\r\n|\r|\n/g;

function execGit(args, cwd, callback) {
    cp.execFile('git', args, { cwd: cwd || REPO_DIR, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && !stdout) {
            callback(err.message || stderr || 'Git error', null);
        } else {
            callback(null, stdout || '');
        }
    });
}

function execGitPromise(args, cwd) {
    return new Promise((resolve, reject) => {
        execGit(args, cwd, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

async function getRepoInfo(repo) {
    try {
        const [branchesData, remotesData, stashesData] = await Promise.all([
            getBranches(repo),
            getRemotes(repo),
            getStashes(repo)
        ]);
        return {
            command: 'loadRepoInfo',
            branches: branchesData.branches,
            head: branchesData.head,
            remotes: remotesData,
            stashes: stashesData,
            isRepo: true,
            error: null
        };
    } catch (err) {
        return {
            command: 'loadRepoInfo',
            branches: [],
            head: null,
            remotes: [],
            stashes: [],
            isRepo: false,
            error: String(err)
        };
    }
}

async function getBranches(repo) {
    const stdout = await execGitPromise(['branch', '-a', '--no-color'], repo);
    const lines = stdout.split(EOL_REGEX);
    const branches = [];
    let head = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const isCurrent = line.startsWith('*');
        let name = trimmed.replace(/^\*\s*/, '');
        if (name.includes(' -> ')) {
            const parts = name.split(' -> ');
            name = parts[0];
        }
        if (isCurrent && !trimmed.startsWith('* (HEAD detached')) {
            head = name;
        }
        branches.push(name);
    }
    return { branches, head };
}

async function getRemotes(repo) {
    const stdout = await execGitPromise(['remote'], repo);
    return stdout.split(EOL_REGEX).map(s => s.trim()).filter(Boolean);
}

async function getStashes(repo) {
    try {
        const format = ['%H', '%P', '%gd', '%an', '%ae', '%at', '%s'].join(GIT_LOG_SEPARATOR);
        const stdout = await execGitPromise(['reflog', '--format=' + format, 'refs/stash', '--'], repo);
        const lines = stdout.split(EOL_REGEX);
        const stashes = [];
        for (const line of lines) {
            const parts = line.split(GIT_LOG_SEPARATOR);
            if (parts.length < 7 || !parts[1]) continue;
            const parentHashes = parts[1].split(' ');
            stashes.push({
                hash: parts[0],
                baseHash: parentHashes[0],
                untrackedFilesHash: parentHashes.length === 3 ? parentHashes[2] : null,
                selector: parts[2],
                author: parts[3],
                email: parts[4],
                date: parseInt(parts[5], 10),
                message: parts[6]
            });
        }
        return stashes;
    } catch (e) {
        return [];
    }
}

async function getRefs(repo) {
    const stdout = await execGitPromise(['show-ref', '-d', '--head'], repo);
    const refData = { head: null, heads: [], tags: [], remotes: [] };
    const lines = stdout.split(EOL_REGEX);
    for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts.length < 2) continue;
        const hash = parts[0];
        const ref = parts.slice(1).join(' ');

        if (ref.startsWith('refs/heads/')) {
            refData.heads.push({ hash, name: ref.substring(11) });
        } else if (ref.startsWith('refs/tags/')) {
            const annotated = ref.endsWith('^{}');
            refData.tags.push({
                hash,
                name: annotated ? ref.substring(10, ref.length - 3) : ref.substring(10),
                annotated
            });
        } else if (ref.startsWith('refs/remotes/')) {
            if (!ref.endsWith('/HEAD')) {
                refData.remotes.push({ hash, name: ref.substring(13) });
            }
        } else if (ref === 'HEAD') {
            refData.head = hash;
        }
    }
    return refData;
}

async function getCommits(msg) {
    const repo = msg.repo || REPO_DIR;
    const maxCommits = msg.maxCommits || 300;
    const format = ['%H', '%P', '%an', '%ae', '%at', '%s'].join(GIT_LOG_SEPARATOR);
    const args = ['-c', 'log.showSignature=false', 'log', '--max-count=' + (maxCommits + 1), '--format=' + format, '--date-order'];

    if (msg.onlyFollowFirstParent) {
        args.push('--first-parent');
    }
    if (msg.branches && msg.branches.length > 0) {
        args.push(...msg.branches);
    } else {
        args.push('--all');
    }

    try {
        const [logStdout, refData, stashes] = await Promise.all([
            execGitPromise(args, repo),
            getRefs(repo),
            getStashes(repo)
        ]);

        const rawCommits = logStdout.trim().split('\n').filter(Boolean).map(line => {
            const parts = line.split(GIT_LOG_SEPARATOR);
            return {
                hash: parts[0] || '',
                parents: parts[1] ? parts[1].split(' ').filter(Boolean) : [],
                author: parts[2] || '',
                email: parts[3] || '',
                date: parseInt(parts[4] || '0', 10),
                message: parts[5] || ''
            };
        });

        const moreCommitsAvailable = rawCommits.length > maxCommits;
        if (moreCommitsAvailable) rawCommits.pop();

        // Build commit lookup and assign heads, tags, remotes
        const commitLookup = {};
        const commitNodes = rawCommits.map((c, i) => {
            commitLookup[c.hash] = i;
            return {
                ...c,
                heads: [],
                tags: [],
                remotes: [],
                stash: null
            };
        });

        // Attach heads
        for (const h of refData.heads) {
            if (commitLookup[h.hash] !== undefined) {
                commitNodes[commitLookup[h.hash]].heads.push(h.name);
            }
        }
        // Attach tags
        for (const t of refData.tags) {
            if (commitLookup[t.hash] !== undefined) {
                commitNodes[commitLookup[t.hash]].tags.push({ name: t.name, annotated: t.annotated });
            }
        }
        // Attach remotes
        for (const r of refData.remotes) {
            if (commitLookup[r.hash] !== undefined) {
                commitNodes[commitLookup[r.hash]].remotes.push(r.name);
            }
        }
        // Attach stashes
        for (const s of stashes) {
            if (commitLookup[s.hash] !== undefined) {
                commitNodes[commitLookup[s.hash]].stash = {
                    selector: s.selector,
                    baseHash: s.baseHash,
                    untrackedFilesHash: s.untrackedFilesHash
                };
            }
        }

        return {
            command: 'loadCommits',
            refreshId: msg.refreshId || 0,
            onlyFollowFirstParent: Boolean(msg.onlyFollowFirstParent),
            commits: commitNodes,
            head: refData.head,
            moreCommitsAvailable,
            error: null
        };
    } catch (err) {
        return {
            command: 'loadCommits',
            refreshId: msg.refreshId || 0,
            onlyFollowFirstParent: false,
            commits: [],
            head: null,
            moreCommitsAvailable: false,
            error: String(err)
        };
    }
}

async function getCommitDetails(msg) {
    const repo = msg.repo || REPO_DIR;
    const commitHash = msg.commitHash;
    const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join(GIT_LOG_SEPARATOR);

    try {
        const stdout = await execGitPromise(['-c', 'log.showSignature=false', 'show', '--quiet', commitHash, '--format=' + format], repo);
        const parts = stdout.split(GIT_LOG_SEPARATOR);
        const fromCommit = commitHash + (msg.hasParents ? '^' : '');

        const [numstatStdout, nameStatusStdout] = await Promise.all([
            execGitPromise(['diff', '--numstat', fromCommit, commitHash], repo).catch(() => ''),
            execGitPromise(['diff', '--name-status', fromCommit, commitHash], repo).catch(() => '')
        ]);

        const fileChanges = [];
        const statusLines = nameStatusStdout.trim().split(EOL_REGEX);
        const numstatLines = numstatStdout.trim().split(EOL_REGEX);
        const stats = {};

        for (const nl of numstatLines) {
            const p = nl.split('\t');
            if (p.length >= 3) {
                stats[p[2]] = { additions: parseInt(p[0], 10) || 0, deletions: parseInt(p[1], 10) || 0 };
            }
        }

        for (const sl of statusLines) {
            if (!sl) continue;
            const p = sl.split('\t');
            const type = p[0][0] || 'M';
            const filePath = p.length > 2 ? p[2] : p[1];
            const oldFilePath = p.length > 2 ? p[1] : null;
            const stat = stats[filePath] || { additions: 0, deletions: 0 };

            fileChanges.push({
                path: filePath,
                oldFilePath: oldFilePath,
                type: type,
                additions: stat.additions,
                deletions: stat.deletions
            });
        }

        return {
            command: 'commitDetails',
            commitDetails: {
                hash: parts[0] || commitHash,
                parents: parts[1] ? parts[1].split(' ').filter(Boolean) : [],
                author: parts[2] || '',
                authorEmail: parts[3] || '',
                authorDate: parseInt(parts[4] || '0', 10),
                committer: parts[5] || '',
                committerEmail: parts[6] || '',
                committerDate: parseInt(parts[7] || '0', 10),
                signature: null,
                body: parts[8] || '',
                fileChanges
            },
            error: null
        };
    } catch (err) {
        return {
            command: 'commitDetails',
            commitDetails: null,
            error: String(err)
        };
    }
}

async function handleAction(msg) {
    const repo = msg.repo || REPO_DIR;
    switch (msg.command) {
        case 'checkoutBranch':
            try {
                await execGitPromise(['checkout', msg.branchName], repo);
                return { command: 'checkoutBranch', error: null };
            } catch (err) {
                return { command: 'checkoutBranch', error: String(err) };
            }
        case 'checkoutCommit':
            try {
                await execGitPromise(['checkout', msg.commitHash], repo);
                return { command: 'checkoutCommit', error: null };
            } catch (err) {
                return { command: 'checkoutCommit', error: String(err) };
            }
        case 'createBranch':
            try {
                await execGitPromise(['branch', msg.branchName, msg.commitHash], repo);
                return { command: 'createBranch', error: null };
            } catch (err) {
                return { command: 'createBranch', error: String(err) };
            }
        case 'deleteBranch':
            try {
                const flag = msg.forceDelete ? '-D' : '-d';
                await execGitPromise(['branch', flag, msg.branchName], repo);
                return { command: 'deleteBranch', error: null };
            } catch (err) {
                return { command: 'deleteBranch', error: String(err) };
            }
        case 'addTag':
            try {
                const args = ['tag'];
                if (msg.annotated && msg.message) {
                    args.push('-a', msg.tagName, '-m', msg.message, msg.commitHash);
                } else {
                    args.push(msg.tagName, msg.commitHash);
                }
                await execGitPromise(args, repo);
                return { command: 'addTag', error: null };
            } catch (err) {
                return { command: 'addTag', error: String(err) };
            }
        case 'deleteTag':
            try {
                await execGitPromise(['tag', '-d', msg.tagName], repo);
                return { command: 'deleteTag', error: null };
            } catch (err) {
                return { command: 'deleteTag', error: String(err) };
            }
        case 'cherrypickCommit':
            try {
                const args = ['cherry-pick'];
                if (msg.noCommit) args.push('-n');
                args.push(msg.commitHash);
                await execGitPromise(args, repo);
                return { command: 'cherrypickCommit', error: null };
            } catch (err) {
                return { command: 'cherrypickCommit', error: String(err) };
            }
        default:
            return { command: msg.command, error: null };
    }
}

function getHtmlPage(repo) {
    const repoName = path.basename(repo);
    const initialState = {
        config: {
            commitDetailsView: 0,
            commitOrdering: 'date',
            contextMenuActionsVisibility: {},
            customBranchGlobPatterns: [],
            customEmojiShortcodeMappings: [],
            customPullRequestProviders: [],
            dateFormat: 'Date & Time',
            defaultColumnVisibility: { date: true, author: true },
            dialogDefaults: {},
            enhancedAccessibility: false,
            fetchAndPrune: false,
            fetchAndPruneTags: false,
            fetchAvatars: false,
            graph: {
                colours: ["#0085d9", "#d9008f", "#00d90a", "#d98500", "#a300d9", "#ff0000", "#00d9d9", "#85d900"],
                style: 'rounded',
                grid: { x: 16, y: 24, offsetX: 8, offsetY: 12 },
                uncommittedChanges: true
            },
            includeCommitsMentionedByReflogs: false,
            initialLoadCommits: 300,
            keybindings: {},
            loadMoreCommits: 75,
            loadMoreCommitsAutomatically: true,
            markdown: true,
            mute: true,
            onlyFollowFirstParent: false,
            onRepoLoad: 0,
            referenceLabels: {},
            repoDropdownOrder: 'workspace',
            showRemoteBranches: true,
            showStashes: true,
            showTags: true
        },
        lastActiveRepo: repo,
        loadViewTo: null,
        repos: {
            [repo]: {
                columnWidths: null,
                cdvDivider: 0.5,
                cdvHeight: 250,
                commitOrdering: 'default',
                fileViewType: 'tree',
                hideRemotes: [],
                includeCommitsMentionedByReflogs: 'default',
                issueLinkingConfig: null,
                lastImportAt: 0,
                name: repoName,
                onlyFollowFirstParent: 'default',
                onRepoLoad: 'default',
                showRemoteBranches: true,
                showRemoteBranchesV2: 'default',
                showRemoteHeads: true,
                showTags: 'default',
                workspaceFolder: repo
            }
        },
        loadRepoInfoRefreshId: 0,
        loadCommitsRefreshId: 0
    };

    let colorVars = '', colorParams = '';
    for (let i = 0; i < initialState.config.graph.colours.length; i++) {
        colorVars += '--git-graph-color' + i + ':' + initialState.config.graph.colours[i] + '; ';
        colorParams += '[data-color="' + i + '"]{--git-graph-color:var(--git-graph-color' + i + ');} ';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Graph - ${repoName} (Lapce)</title>
    <link rel="stylesheet" href="/media/out.min.css">
    <style>
      :root {
        --vscode-font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --vscode-editor-font-size: 13px;
        --vscode-editor-background: #1e1e2e;
        --vscode-editor-foreground: #cdd6f4;
        --vscode-sideBar-background: #181825;
        --vscode-activityBar-background: #11111b;
        --vscode-button-background: #89b4fa;
        --vscode-button-foreground: #11111b;
        --vscode-button-hoverBackground: #b4befe;
        --vscode-badge-background: #45475a;
        --vscode-badge-foreground: #cdd6f4;
        --vscode-dropdown-background: #313244;
        --vscode-dropdown-border: #45475a;
        --vscode-dropdown-foreground: #cdd6f4;
        --vscode-input-background: #313244;
        --vscode-input-foreground: #cdd6f4;
        --vscode-input-border: transparent;
        --vscode-inputOption-activeBorder: #89b4fa;
        --vscode-inputValidation-infoBackground: #1e1e2e;
        --vscode-inputValidation-infoBorder: #89b4fa;
        --vscode-gitDecoration-modifiedResourceForeground: #f9e2af;
        --vscode-gitDecoration-untrackedResourceForeground: #a6e3a1;
        --vscode-gitDecoration-deletedResourceForeground: #f38ba8;
        ${colorVars}
      }
      ${colorParams}
      body {
        margin: 0;
        padding: 0;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        overflow: hidden;
      }
      #controls {
        background-color: var(--vscode-sideBar-background);
        border-bottom: 1px solid #313244;
      }
    </style>
</head>
<body>
    <div id="view" tabindex="-1">
        <div id="controls">
            <span id="repoControl"><span class="unselectable">Repo: </span><div id="repoDropdown" class="dropdown"></div></span>
            <span id="branchControl"><span class="unselectable">Branches: </span><div id="branchDropdown" class="dropdown"></div></span>
            <label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox" tabindex="-1"><span class="customCheckbox"></span>Show Remote Branches</label>
            <div id="findBtn" title="Find"></div>
            <div id="settingsBtn" title="Repository Settings"></div>
            <div id="fetchBtn" title="Fetch"></div>
            <div id="refreshBtn" title="Refresh"></div>
        </div>
        <div id="content">
            <div id="commitGraph"></div>
            <div id="commitTable"></div>
        </div>
        <div id="footer"></div>
    </div>
    <div id="scrollShadow"></div>
    <script>
      var initialState = ${JSON.stringify(initialState)};
      var globalState = {};
      var workspaceState = {};

      window.acquireVsCodeApi = function() {
        return {
          postMessage: function(msg) {
            fetch('/api/request', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg)
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
              if (data) {
                window.dispatchEvent(new MessageEvent('message', { data: data }));
              }
            })
            .catch(function(err) {
              console.error('Git Graph API Error:', err);
            });
          },
          getState: function() {
            try { return JSON.parse(localStorage.getItem('git-graph-state') || '{}'); } catch(e) { return {}; }
          },
          setState: function(state) {
            localStorage.setItem('git-graph-state', JSON.stringify(state));
          }
        };
      };
    </script>
    <script src="/media/out.min.js"></script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    if (pathname === '/' || pathname === '/index.html') {
        const repo = parsed.query.repo ? path.resolve(parsed.query.repo) : REPO_DIR;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHtmlPage(repo));
        return;
    }

    if (pathname === '/media/out.min.css') {
        const cssPath = path.join(__dirname, 'web', 'out.min.css');
        if (fs.existsSync(cssPath)) {
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(fs.readFileSync(cssPath));
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
        return;
    }

    if (pathname === '/media/out.min.js') {
        const jsPath = path.join(__dirname, 'web', 'out.min.js');
        if (fs.existsSync(jsPath)) {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end(fs.readFileSync(jsPath));
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
        return;
    }

    if (pathname === '/api/request' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const msg = JSON.parse(body);
                let response = null;

                if (msg.command === 'loadRepoInfo') {
                    response = await getRepoInfo(msg.repo || REPO_DIR);
                    response.refreshId = msg.refreshId;
                } else if (msg.command === 'loadCommits') {
                    response = await getCommits(msg);
                } else if (msg.command === 'commitDetails') {
                    response = await getCommitDetails(msg);
                } else if (['checkoutBranch', 'checkoutCommit', 'createBranch', 'deleteBranch', 'addTag', 'deleteTag', 'cherrypickCommit'].includes(msg.command)) {
                    response = await handleAction(msg);
                } else {
                    response = { command: msg.command, error: null };
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Git Graph companion server running at http://127.0.0.1:${PORT}`);
    console.log(`Managing repository at: ${REPO_DIR}`);
});

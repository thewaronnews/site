// Commits export files to the public GitHub data repository from the
// Worker (spec section 9, P0.5). Uses env.GITHUB_TOKEN (a Worker secret),
// env.GITHUB_ORG and env.GITHUB_REPO (plain worker vars). Tries the Git
// Data API first, making one commit for every file in a run; falls back to
// the Contents API per file if any Git Data API step fails.

function repoInfo(env) {
  return { owner: env.GITHUB_ORG, repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN };
}

async function gh(env, path, opts = {}) {
  const { token } = repoInfo(env);
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: Object.assign(
      {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rattlesnakesbymail-worker",
      },
      opts.headers || {}
    ),
  });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function fileExistsInRepo(env, path) {
  const { owner, repo } = repoInfo(env);
  const res = await gh(env, `/repos/${owner}/${repo}/contents/${path}`);
  return res.status === 200;
}

export async function getDefaultBranch(env) {
  const { owner, repo } = repoInfo(env);
  const res = await gh(env, `/repos/${owner}/${repo}`);
  if (!res.ok) throw new Error(`repo lookup failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.default_branch;
}

async function commitViaGitData(env, files, message) {
  const { owner, repo } = repoInfo(env);
  const branch = await getDefaultBranch(env);

  const refRes = await gh(env, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (!refRes.ok) throw new Error(`get ref failed: HTTP ${refRes.status}`);
  const refData = await refRes.json();
  const headSha = refData.object.sha;

  const headCommitRes = await gh(env, `/repos/${owner}/${repo}/git/commits/${headSha}`);
  if (!headCommitRes.ok) throw new Error(`get head commit failed: HTTP ${headCommitRes.status}`);
  const headCommitData = await headCommitRes.json();
  const baseTreeSha = headCommitData.tree.sha;

  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const blobRes = await gh(env, `/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: utf8ToBase64(content), encoding: "base64" }),
    });
    if (!blobRes.ok) throw new Error(`blob create failed for ${path}: HTTP ${blobRes.status}`);
    const blobData = await blobRes.json();
    entries.push({ path, mode: "100644", type: "blob", sha: blobData.sha });
  }

  const treeRes = await gh(env, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  if (!treeRes.ok) throw new Error(`tree create failed: HTTP ${treeRes.status}`);
  const treeData = await treeRes.json();

  const commitRes = await gh(env, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [headSha],
      author: { name: "Rattlesnakes By Mail", email: "noreply@rattlesnakesbymail.com", date: new Date().toISOString() },
    }),
  });
  if (!commitRes.ok) throw new Error(`commit create failed: HTTP ${commitRes.status}`);
  const commitData = await commitRes.json();

  const updateRefRes = await gh(env, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commitData.sha, force: false }),
  });
  if (!updateRefRes.ok) throw new Error(`ref update failed: HTTP ${updateRefRes.status}`);

  return commitData.sha;
}

async function commitViaContentsApi(env, files, message) {
  const { owner, repo } = repoInfo(env);
  const branch = await getDefaultBranch(env);
  let lastSha = null;
  for (const [path, content] of Object.entries(files)) {
    let existingSha = null;
    const getRes = await gh(env, `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    if (getRes.status === 200) {
      const data = await getRes.json();
      existingSha = data.sha;
    }
    const body = { message, content: utf8ToBase64(content), branch };
    if (existingSha) body.sha = existingSha;
    const putRes = await gh(env, `/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!putRes.ok) throw new Error(`contents PUT failed for ${path}: HTTP ${putRes.status}`);
    const putData = await putRes.json();
    if (putData.commit && putData.commit.sha) lastSha = putData.commit.sha;
  }
  return lastSha;
}

// Returns { sha, method: 'git-data'|'contents-api', error? }. error is set
// only when the Git Data API failed and the Contents API fallback ran.
export async function commitFilesToGithub(env, files, message) {
  try {
    const sha = await commitViaGitData(env, files, message);
    return { sha, method: "git-data" };
  } catch (gitDataErr) {
    try {
      const sha = await commitViaContentsApi(env, files, message);
      return { sha, method: "contents-api", error: String(gitDataErr && gitDataErr.message || gitDataErr) };
    } catch (contentsErr) {
      return {
        sha: null,
        method: "failed",
        error: `git-data: ${gitDataErr.message}; contents-api: ${contentsErr.message}`,
      };
    }
  }
}

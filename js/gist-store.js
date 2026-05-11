// 사용자 포트폴리오를 GitHub 비공개 Gist에 저장/불러오기
import { getToken } from "./auth.js";

const FILENAME    = "cfie_portfolio.json";
const DESCRIPTION = "CFIE 포트폴리오 (자동 관리)";
const LS_GIST_ID  = "cfie_gist_id";

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Authorization":        `Bearer ${getToken()}`,
      "Accept":               "application/vnd.github+json",
      "Content-Type":         "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API ${res.status}`);
  }
  return res.json();
}

/** CFIE Gist ID 조회 (없으면 null) */
async function findGistId() {
  const cached = localStorage.getItem(LS_GIST_ID);
  if (cached) return cached;
  // 사용자 Gist 목록에서 CFIE 파일 검색
  let page = 1;
  while (page <= 10) {
    const gists = await api("GET", `/gists?per_page=100&page=${page}`);
    if (!gists.length) break;
    const found = gists.find(g => FILENAME in g.files);
    if (found) { localStorage.setItem(LS_GIST_ID, found.id); return found.id; }
    if (gists.length < 100) break;
    page++;
  }
  return null;
}

/** 포트폴리오 불러오기 */
export async function loadPortfolio() {
  const gistId = await findGistId();
  if (!gistId) return {};
  const gist = await api("GET", `/gists/${gistId}`);
  try { return JSON.parse(gist.files[FILENAME]?.content || "{}"); }
  catch { return {}; }
}

/** 포트폴리오 저장 (Gist 없으면 새로 생성) */
export async function savePortfolio(data) {
  const content = JSON.stringify(data, null, 2);
  const gistId  = await findGistId();
  if (gistId) {
    await api("PATCH", `/gists/${gistId}`, {
      files: { [FILENAME]: { content } }
    });
  } else {
    const gist = await api("POST", "/gists", {
      description: DESCRIPTION,
      public: false,
      files: { [FILENAME]: { content } }
    });
    localStorage.setItem(LS_GIST_ID, gist.id);
  }
}

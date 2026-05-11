// GitHub Personal Access Token 기반 인증
// 포트폴리오는 사용자의 비공개 Gist에 저장 (gist 스코프 필요)

const LS_TOKEN = "cfie_gh_token";
const LS_USER  = "cfie_gh_user";

export function getToken()   { return localStorage.getItem(LS_TOKEN); }
export function getUser()    { try { return JSON.parse(localStorage.getItem(LS_USER)); } catch { return null; } }
export function isLoggedIn() { return !!getToken(); }

/** PAT로 로그인: GitHub API 인증 확인 후 사용자 정보 저장 */
export async function loginWithPAT(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("토큰이 유효하지 않습니다. 다시 확인해주세요.");
    throw new Error(`GitHub API 오류 (${res.status})`);
  }
  const user = await res.json();
  // gist 스코프 확인
  const scopes = res.headers.get("x-oauth-scopes") || "";
  if (!scopes.includes("gist")) {
    throw new Error("토큰에 'gist' 권한이 없습니다. 토큰 생성 시 gist 스코프를 체크해주세요.");
  }
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_USER, JSON.stringify({
    login:  user.login,
    name:   user.name || user.login,
    avatar: user.avatar_url
  }));
  return user;
}

/** 로그아웃: 로컬 캐시 전부 삭제 후 로그인 페이지로 */
export function logout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  localStorage.removeItem("cfie_gist_id");
  window.location.href = "login.html";
}

/** 인증 필요 페이지에서 호출 — 미로그인 시 login.html로 이동 */
export function requireAuth() {
  if (!isLoggedIn()) { window.location.replace("login.html"); return null; }
  return getUser();
}

/** 상단바 사용자 아바타/이름 업데이트 */
export function updateUserUI() {
  const user = getUser();
  if (!user) return;
  const avatar = document.getElementById("userAvatar");
  const name   = document.getElementById("userName");
  const logBtn = document.getElementById("logoutBtn");
  if (avatar) { avatar.src = user.avatar; avatar.style.display = "block"; }
  if (name)   name.textContent = user.name;
  if (logBtn) logBtn.onclick = logout;
}

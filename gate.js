/* =====================================================================
   게임 잠금 (gate.js)
   - 게임 폴더의 index.html에서 <script src="../gate.js" data-lock="1"></script>로 불러오면
     비밀번호를 입력해야 게임이 시작됩니다.
   - 관리자 화면(admin/)이 같은 규칙으로 게임별 비밀번호를 만들어 줍니다.
   ===================================================================== */
(function () {
  // ============ 설정 (필요하면 여기만 고치세요) ============
  const CONFIG = {
    // 사이트 비밀 열쇠: 아무 영어+숫자로 바꾸면 지금까지 만든 모든 비밀번호가 무효가 됩니다.
    SECRET: '75a2261192fafe02573190c1',

    // 관리자 비밀번호의 암호화 값 (기본 비밀번호: teacher1234)
    // 바꾸는 법: 관리자 화면 아래 "관리자 비밀번호 바꾸기"에서 새 값을 만들어 여기에 붙여넣기
    ADMIN_HASH: '2559216479994901',

    // 게임 목록: 폴더 이름과 화면에 보일 이름
    GAMES: [
      { folder: 'inca', name: '잉카 vs 스페인' },
      { folder: 'running', name: '잉카 vs 스페인 달리기' },
      { folder: 'touch', name: '손 터치 숫자 게임' },
      { folder: 'pump', name: '발로 밟기 게임' }
    ],

    // 선택 가능한 유효 시간 (분). 'day' = 오늘 자정까지
    DURATIONS: [30, 60, 120, 'day'],

    // 컴퓨터마다 시계가 조금씩 다를 수 있어서 허용하는 오차 (분)
    CLOCK_SKEW: 10
  };

  // ============ 공통 계산 ============
  function hash(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  const nowMinute = () => Math.floor(Date.now() / 60000);

  function midnightMinute(minute) {
    const d = new Date(minute * 60000);
    d.setHours(24, 0, 0, 0);
    return Math.floor(d.getTime() / 60000);
  }
  function dayStartMinute(minute) {
    const d = new Date(minute * 60000);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 60000);
  }

  // 게임 + 만든 시각(분) + 유효시간 → 6자리 숫자
  function makeCode(folder, issueMinute, duration) {
    const n = hash(CONFIG.SECRET + '|' + folder + '|' + issueMinute + '|' + duration) % 1000000;
    return String(n).padStart(6, '0');
  }

  function expiryOf(issueMinute, duration) {
    return duration === 'day' ? midnightMinute(issueMinute) : issueMinute + duration;
  }

  // 입력한 코드가 유효하면 만료 시각(분)을, 아니면 null
  function verify(folder, code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length !== 6) return null;
    const now = nowMinute();
    for (const dur of CONFIG.DURATIONS) {
      const from = dur === 'day' ? dayStartMinute(now) - CONFIG.CLOCK_SKEW : now - dur - CONFIG.CLOCK_SKEW;
      for (let m = now + CONFIG.CLOCK_SKEW; m >= from; m--) {
        if (makeCode(folder, m, dur) === code) {
          const exp = expiryOf(m, dur);
          if (exp + CONFIG.CLOCK_SKEW > now) return exp;
        }
      }
    }
    return null;
  }

  function adminHash(pw) { return String(hash('admin|' + pw)); }

  window.ClassGate = { CONFIG, makeCode, expiryOf, verify, nowMinute, adminHash };

  // ============ 게임 잠금 화면 ============
  const me = document.currentScript;
  if (!me || me.dataset.lock !== '1') return;

  // 주소에서 게임 폴더 이름 알아내기 (…/inca/ 또는 …/inca/index.html)
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length && /\.html?$/i.test(parts[parts.length - 1])) parts.pop();
  const folder = parts[parts.length - 1] || '';
  const game = CONFIG.GAMES.find(g => g.folder === folder);
  const gameName = game ? game.name : folder;
  const storeKey = 'classgate_' + folder;

  // 같은 창에서 이미 통과했고 아직 유효하면 잠금 생략
  try {
    const saved = JSON.parse(sessionStorage.getItem(storeKey) || 'null');
    if (saved && saved.exp > nowMinute()) return;
  } catch (e) { }

  // 잠금이 풀릴 때까지 카메라 요청을 보류 (비밀번호 전에 카메라 팝업이 뜨지 않게)
  let unlock;
  const unlocked = new Promise(res => { unlock = res; });
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = constraints => unlocked.then(() => orig(constraints));
  }

  const style = document.createElement('style');
  style.textContent = `
    #cg-overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 30% 20%, #2a2250, #0d0b1a 70%); font-family: 'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif; color: #f4f1ff; }
    #cg-box { width: min(420px, 90vw); background: #17142b; border: 2px solid #2c2750; border-radius: 20px; padding: 32px 28px; text-align: center; }
    #cg-box .lock { font-size: 48px; }
    #cg-box h2 { margin: 8px 0 4px; font-size: 26px; }
    #cg-box p { margin: 0 0 20px; color: #a9a3c7; font-size: 15px; }
    #cg-input { width: 100%; font-size: 34px; letter-spacing: 10px; text-align: center; padding: 12px; border-radius: 12px;
      border: 2px solid #3a3560; background: #0d0b1a; color: #fff; box-sizing: border-box; font-family: inherit; }
    #cg-input:focus { outline: none; border-color: #ffe066; }
    #cg-btn { margin-top: 14px; width: 100%; padding: 14px; font-size: 20px; font-weight: 700; border: none; border-radius: 12px;
      background: #ffe066; color: #140f24; cursor: pointer; font-family: inherit; }
    #cg-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    #cg-msg { min-height: 22px; margin-top: 12px; color: #ff8fa3; font-size: 15px; }
    #cg-back { display: inline-block; margin-top: 10px; color: #a9a3c7; font-size: 14px; }
  `;
  const overlay = document.createElement('div');
  overlay.id = 'cg-overlay';
  overlay.innerHTML = `
    <div id="cg-box">
      <div class="lock">🔒</div>
      <h2></h2>
      <p>선생님이 알려준 6자리 비밀번호를 입력하세요</p>
      <input id="cg-input" inputmode="numeric" autocomplete="off" maxlength="6" aria-label="비밀번호 6자리">
      <button id="cg-btn">입장하기</button>
      <div id="cg-msg" role="alert"></div>
      <a id="cg-back" href="../">← 게임 목록으로</a>
    </div>`;
  overlay.querySelector('h2').textContent = gameName;

  function mount() {
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(overlay);
    const input = overlay.querySelector('#cg-input');
    const msg = overlay.querySelector('#cg-msg');
    const tryEnter = () => {
      const exp = verify(folder, input.value);
      if (exp) {
        try { sessionStorage.setItem(storeKey, JSON.stringify({ exp })); } catch (e) { }
        overlay.remove(); style.remove();
        unlock();
      } else {
        msg.textContent = '비밀번호가 맞지 않거나 시간이 지났어요.';
        input.select();
      }
    };
    overlay.querySelector('#cg-btn').addEventListener('click', tryEnter);
    // 게임의 키보드 조작(ESC 등)이 잠금 화면 입력에 반응하지 않도록 차단
    ['keydown', 'keyup', 'keypress'].forEach(t => overlay.addEventListener(t, e => {
      e.stopPropagation();
      if (t === 'keydown' && e.key === 'Enter') tryEnter();
    }));
    setTimeout(() => input.focus(), 50);
  }
  mount();
})();

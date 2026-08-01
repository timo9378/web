import { describe, expect, it } from 'vitest';

import { shouldClearToken } from './auth';

/**
 * `/api/auth/me` 失敗時該不該把 token 洗掉。
 *
 * 這條是 e2e 逼出來的：後台在高負載下偶發被踢回首頁，追下去是 AuthContext
 * 原本「非 2xx 一律清掉 token」。5xx 與網路錯誤都不是憑證問題，而站上只有
 * OAuth 登入——被清掉就得重跑一次授權才回得來。
 */
describe('shouldClearToken', () => {
  it('只有伺服器明確說憑證不行才清', () => {
    expect(shouldClearToken(401), '401 = token 無效').toBe(true);
    expect(shouldClearToken(403), '403 = 權限不足').toBe(true);
  });

  it('伺服器出錯不代表憑證有問題', () => {
    for (const status of [500, 502, 503, 504, 0]) {
      expect(shouldClearToken(status), `${status} 不該把人登出`).toBe(false);
    }
  });

  it('4xx 裡只有 401/403 算數', () => {
    // 429（被限流）特別重要：那是「等一下再來」，不是「你沒有權限」
    for (const status of [400, 404, 408, 429]) {
      expect(shouldClearToken(status), `${status} 不該把人登出`).toBe(false);
    }
  });
});

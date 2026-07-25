#!/usr/bin/env node
// Spotify 重新授權 —— 拿一顆新的 refresh token。
//
// 什麼時候要跑：/api/spotify/* 回 `invalid_grant: Refresh token revoked`（音樂頁掛掉）。
// Spotify 會在你改密碼、在帳號設定移除 app 授權、或輪換 app 憑證時撤銷 refresh token。
//
// 用法（在專案根目錄）：
//   node scripts/spotify-reauth.mjs
// 它會：起一個本機小伺服器接 callback → 印出授權網址 → 你在瀏覽器點同意 →
// 自動換到 refresh token 並印出來 → 你貼進 .env.backend 後重啟後端。
//
// 前置：Spotify Developer Dashboard 的該 app 要把下面這個 redirect URI 加進白名單：
//   http://127.0.0.1:8888/callback
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const PORT = 8888;
// 對齊後端實際會用到的資料：最近播放、Top、正在播放。
const SCOPES = ['user-read-recently-played', 'user-top-read', 'user-read-currently-playing', 'user-read-playback-state'].join(' ');

/** 從 .env.backend 讀 client id/secret（沒有就從環境變數拿）。 */
function loadCreds() {
  let id = process.env.SPOTIFY_CLIENT_ID;
  let secret = process.env.SPOTIFY_CLIENT_SECRET;
  try {
    const env = readFileSync(new URL('../.env.backend', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = /^\s*(SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1] === 'SPOTIFY_CLIENT_ID') id ??= val;
      else secret ??= val;
    }
  } catch { /* 沒有 .env.backend 就只靠環境變數 */ }
  if (!id || !secret) {
    console.error('✗ 找不到 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
    console.error('  請確認 .env.backend 裡有這兩個值，或用環境變數傳進來。');
    process.exit(1);
  }
  return { id, secret };
}

const { id: CLIENT_ID, secret: CLIENT_SECRET } = loadCreds();
const state = randomBytes(8).toString('hex');

const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    show_dialog: 'true', // 強制重新同意，確保拿到新的 refresh token
  }).toString();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not found');
    return;
  }
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err || !code) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`授權失敗：${err ?? '沒有 code'}`);
    console.error('✗ 授權失敗：', err ?? '沒有 code');
    server.close();
    process.exit(1);
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('state mismatch');
    console.error('✗ state 不符（可能不是這次流程的回呼）');
    server.close();
    process.exit(1);
  }

  void (async () => {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('換 token 失敗，看終端機訊息');
      console.error('✗ 換 token 失敗：', JSON.stringify(data));
      server.close();
      process.exit(1);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
      '<meta charset="utf-8"><h2>✅ 授權完成</h2><p>refresh token 已印在終端機，可以關掉這頁了。</p>',
    );
    console.log('\n✅ 拿到新的 refresh token：\n');
    console.log(`SPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`);
    console.log('接著：');
    console.log('  1) 把上面那行貼進 .env.backend（取代舊的 SPOTIFY_REFRESH_TOKEN）');
    console.log('  2) 重啟後端：docker compose up -d backend-rs');
    console.log('  3) 驗證：curl -s https://koimsurai.com/api/spotify/recently-played | head -c 120\n');
    server.close();
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n① 在瀏覽器打開這個網址並按「同意」：\n');
  console.log(authUrl + '\n');
  console.log(`（本機在 ${REDIRECT_URI} 等回呼。若 Spotify 說 redirect URI 無效，`);
  console.log('  去 Developer Dashboard → 你的 app → Settings，把該 URI 加進白名單。）\n');
});

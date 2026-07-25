//! 站外抓取的 SSRF 防護（link-preview 與 image-proxy 共用）。
//!
//! 規則：
//!   1. 只允許 http/https
//!   2. 目的地是私網/迴環/link-local/CGNAT/IPv6-ULA → 拒絕
//!   3. 呼叫端在連線後還要用 `resp.remote_addr()` 對實際 peer IP 再驗一次
//!      （DNS rebinding／域名指向私網／redirect 進內網，最終都落在這層）

use std::net::IpAddr;

/// 私網/迴環/link-local/CGNAT → 一律拒絕（SSRF 防護）
pub fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                // CGNAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (64..=127).contains(&v4.octets()[1]))
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // fc00::/7 unique-local、fe80::/10 link-local
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// 驗證 URL 可安全抓取；回傳正規化後的 URL 與 host
pub fn validate_url(raw: &str) -> Option<(String, String)> {
    let u = reqwest::Url::parse(raw).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    let host = u.host_str()?.to_string();
    // 直接寫 IP 的先擋（走 DNS 的在 fetch 時由 resolve 再擋一次）。
    // IPv6 字面量 host_str() 帶方括號（"[::1]"），先剝掉才 parse 得出來——
    // 不剝的話 parse 失敗會靜默跳過檢查，變成 v6 繞過（整合測試抓到的真 bug）。
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = bare.parse::<IpAddr>()
        && is_blocked_ip(&ip)
    {
        return None;
    }
    if host.eq_ignore_ascii_case("localhost") {
        return None;
    }
    Some((u.to_string(), host))
}

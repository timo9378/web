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

#[cfg(test)]
mod tests {
    use super::*;

    /// 每個網段各給一個斷言——這裡刻意「一段一筆」而不是包成迴圈跑幾個代表值。
    ///
    /// 理由是 cargo-mutants 跑出來的結果：這支檔案原本 26 個變異只擋掉 9 個，漏掉的包括
    /// 把 `||` 換成 `&&`（等於「所有條件同時成立才擋」→ 私有網段幾乎全部放行）、
    /// 把 CIDR 遮罩的 `&` 換成 `|`/`^`、把 `==` 換成 `!=`。這些改動都不會讓程式崩潰，
    /// 只會讓 SSRF 守衛安靜地失效——正是最需要測試盯住的那種錯。
    /// 每段一筆斷言，任何一個條件被動到都會有具體的測試失敗指出是哪一段。
    #[test]
    fn blocks_every_private_range() {
        let blocked = [
            // IPv4
            ("10.0.0.1", "private 10/8"),
            ("172.16.0.1", "private 172.16/12 下界"),
            ("172.31.255.255", "private 172.16/12 上界"),
            ("192.168.1.1", "private 192.168/16"),
            ("127.0.0.1", "loopback"),
            ("169.254.169.254", "link-local（雲端 metadata 端點）"),
            ("255.255.255.255", "broadcast"),
            ("0.0.0.0", "unspecified"),
            ("192.0.2.1", "documentation TEST-NET-1"),
            ("198.51.100.1", "documentation TEST-NET-2"),
            ("203.0.113.1", "documentation TEST-NET-3"),
            ("100.64.0.1", "CGNAT 下界"),
            ("100.127.255.255", "CGNAT 上界"),
            // IPv6
            ("::1", "v6 loopback"),
            ("::", "v6 unspecified"),
            ("fc00::1", "v6 ULA fc00::/7 下界"),
            ("fd00::1", "v6 ULA（實務上最常見的 fd00::/8）"),
            ("fdff:ffff::1", "v6 ULA fc00::/7 上界"),
            ("fe80::1", "v6 link-local fe80::/10 下界"),
            ("febf:ffff::1", "v6 link-local fe80::/10 上界"),
        ];
        for (ip, why) in blocked {
            assert!(is_blocked_ip(&ip.parse().unwrap()), "{ip} 應被擋（{why}）");
        }
    }

    /// 邊界外的公開位址必須放行——只驗「有擋住」的話，把整個函式改成永遠回 true
    /// 也會全綠（實際上 cargo-mutants 就是這樣穿過去的）。
    /// 這裡的值都刻意貼著上面各網段的邊界，順便釘住遮罩與範圍比較的算法。
    #[test]
    fn allows_public_addresses_just_outside_the_ranges() {
        let allowed = [
            ("8.8.8.8", "一般公開位址"),
            ("93.184.216.34", "一般公開位址"),
            ("172.15.255.255", "貼著 private 172.16/12 下界之外"),
            ("172.32.0.1", "貼著 private 172.16/12 上界之外"),
            ("100.63.255.255", "貼著 CGNAT 下界之外"),
            ("100.128.0.1", "貼著 CGNAT 上界之外"),
            ("101.64.0.1", "第一段不是 100，第二段落在 CGNAT 區間內"),
            ("2001:4860:4860::8888", "公開 v6"),
            ("fbff:ffff::1", "貼著 ULA fc00::/7 之外"),
            ("fe00::1", "在 fc00::/7 與 fe80::/10 的縫隙"),
            ("fec0::1", "site-local（已廢棄，不在 fe80::/10）"),
        ];
        for (ip, why) in allowed {
            assert!(!is_blocked_ip(&ip.parse().unwrap()), "{ip} 不該被擋（{why}）");
        }
    }

    #[test]
    fn validate_url_rejects_unsafe_targets() {
        for (raw, why) in [
            ("http://127.0.0.1/x", "迴環字面量"),
            ("http://169.254.169.254/latest/meta-data/", "雲端 metadata"),
            ("http://10.1.2.3/x", "私網字面量"),
            ("http://[::1]/x", "v6 字面量帶方括號——剝不掉就會靜默跳過檢查"),
            ("http://[fd00::1]/x", "v6 ULA 字面量"),
            ("http://localhost/x", "localhost 主機名"),
            ("http://LOCALHOST/x", "localhost 大小寫不敏感"),
            ("ftp://example.com/x", "非 http(s) scheme"),
            ("file:///etc/passwd", "file scheme"),
            ("javascript:alert(1)", "javascript scheme"),
            ("не-url", "根本不是 URL"),
        ] {
            assert!(validate_url(raw).is_none(), "{raw} 應被拒（{why}）");
        }
    }

    #[test]
    fn validate_url_accepts_normal_targets() {
        let (url, host) = validate_url("https://example.com/a/b?c=d").expect("一般 https 應通過");
        assert_eq!(host, "example.com");
        assert!(url.starts_with("https://example.com/a/b"), "回傳正規化後的 URL：{url}");

        let (_, host) = validate_url("http://8.8.8.8/x").expect("公開 IP 字面量應通過");
        assert_eq!(host, "8.8.8.8");
    }
}

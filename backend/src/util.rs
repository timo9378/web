use serde_json::{Map, Value};
use sqlx::{sqlite::SqliteRow, Column, Row, TypeInfo, ValueRef};

/// 把一列 sqlite row 動態轉成 JSON object，**保留 DB 欄位順序**（serde_json preserve_order）。
/// 用於 Express 端 `SELECT *`/`p.*` 直接 spread 整列的端點（/admin/posts、/admin/comments），
/// 免枚舉欄位、不依賴記住的實體欄位順序。
pub fn row_to_json(row: &SqliteRow) -> Map<String, Value> {
    let mut map = Map::new();
    for col in row.columns() {
        map.insert(col.name().to_string(), column_to_value(row, col.ordinal()));
    }
    map
}

fn column_to_value(row: &SqliteRow, idx: usize) -> Value {
    let raw = match row.try_get_raw(idx) {
        Ok(r) => r,
        Err(_) => return Value::Null,
    };
    if raw.is_null() {
        return Value::Null;
    }
    // 依 value 的儲存類別取值。sqlite 只有 INTEGER/REAL/TEXT/BLOB/NULL。
    match raw.type_info().name() {
        "INTEGER" | "BOOLEAN" => row.try_get::<i64, _>(idx).map(Value::from).unwrap_or(Value::Null),
        // REAL：整值輸出成整數（JS JSON.stringify(4.0)="4"，serde 對 f64 會印 "4.0"）
        "REAL" => row.try_get::<f64, _>(idx).map(js_num_value).unwrap_or(Value::Null),
        // TEXT / 其它一律當字串（posts/comments 無 BLOB）
        _ => row.try_get::<String, _>(idx).map(Value::from).unwrap_or(Value::Null),
    }
}

/// f64 → JSON Value，整值輸出整數（對齊 JS number 序列化）。
pub fn js_num_value(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9.0e15 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}

/// JS `parseInt(s,10)` 的 Option 版：無合法前導整數 → None（NaN → SQL 綁 NULL）。
pub fn js_parse_int_opt(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let mut out = String::new();
    let mut it = t.chars().peekable();
    if let Some(&c) = it.peek()
        && (c == '+' || c == '-') {
            out.push(c);
            it.next();
        }
    while let Some(&c) = it.peek() {
        if c.is_ascii_digit() {
            out.push(c);
            it.next();
        } else {
            break;
        }
    }
    out.parse().ok()
}

/// 把任意 JSON value 綁進 SQL 參數（對齊 node-sqlite3 的動態綁定）：
/// null→NULL、字串→TEXT、整數→INTEGER、浮點→REAL、bool→0/1、其他→JSON 字串。
pub fn bind_val<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>,
    v: Option<&Value>,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
    match v {
        None | Some(Value::Null) => q.bind(Option::<String>::None),
        Some(Value::String(s)) => q.bind(s.clone()),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                q.bind(n.as_f64().unwrap_or(0.0))
            }
        }
        Some(Value::Bool(b)) => q.bind(*b as i64),
        Some(other) => q.bind(other.to_string()),
    }
}

/// JS `String.prototype.substring(0, n)` 等價：以 **UTF-16 code unit** 截前 n 個（非 byte/char）。
pub fn js_substring_prefix(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

/// 寬鬆 parseInt：trim 後嘗試解析整數，失敗用 default。
pub fn parse_int(s: Option<&str>, default: i64) -> i64 {
    s.and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(default)
}

/// JS truthy 判定：null/false/0/NaN/'' 為 falsy，物件/陣列恆 truthy。
pub fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// JS 模板插值的字串化（`${v}`）：字串原樣、整數無小數點。給 tmdbId 這類 id 用。
pub fn js_interp(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else {
                n.to_string()
            }
        }
        other => other.to_string(),
    }
}

/// sqlx 錯誤是否為 UNIQUE 約束違反（對齊 Express `err.message.includes('UNIQUE constraint failed')`）。
pub fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.message().contains("UNIQUE constraint failed"))
}

/// 生成 slug，逐字複製 Express：
/// `name.toLowerCase().replace(/\s+/g,'-').replace(/[^\w\-一-龥]+/g,'')`。
/// = 轉小寫 → 連續空白轉單一 '-' → 只留 [A-Za-z0-9_-] 與 CJK(U+4E00–U+9FA5)。
pub fn gen_slug(name: &str) -> String {
    let lower = name.to_lowercase();
    // \s+ → '-'（每段連續空白換成單一 '-'）
    let mut collapsed = String::with_capacity(lower.len());
    let mut prev_space = false;
    for ch in lower.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                collapsed.push('-');
                prev_space = true;
            }
        } else {
            collapsed.push(ch);
            prev_space = false;
        }
    }
    // 移除 [^\w\-一-龥]（JS 無 /u：\w 為 ASCII [A-Za-z0-9_]）
    collapsed
        .chars()
        .filter(|&c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || ('\u{4e00}'..='\u{9fa5}').contains(&c))
        .collect()
}

/// `GROUP_CONCAT(t.name)` 字串切成標籤陣列；null/空 → 空陣列（對齊 `row.tags ? split : []`）。
pub fn split_tags(tags: Option<&str>) -> Vec<String> {
    match tags {
        Some(s) if !s.is_empty() => s.split(',').map(|x| x.to_string()).collect(),
        _ => vec![],
    }
}

/// JS `encodeURIComponent` 等價：保留 A-Za-z0-9 - _ . ! ~ * ' ( )，其餘 %XX（UTF-8 bytes）。
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 遞迴把 JSON 裡的數字正規化成 JS 語意：整值 float → 整數（JSON.parse 全走 f64、
/// 序列化時整值不帶小數點）。>2^53 的精度丟失不模擬（實務 API 無此值）。
pub fn js_normalize_numbers(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64()
                && n.as_i64().is_none() && n.as_u64().is_none() && f.fract() == 0.0 && f.abs() < 9.0e15 {
                    *v = Value::from(f as i64);
                }
        }
        Value::Array(a) => a.iter_mut().for_each(js_normalize_numbers),
        Value::Object(o) => o.values_mut().for_each(js_normalize_numbers),
        _ => {}
    }
}

/// epoch ms → `YYYY-MM-DDTHH:MM:SS.mmmZ`（JS `new Date(ms).toISOString()`）。
pub fn iso_from_millis(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let (h, mi, s, mil) = (rem / 3_600_000, rem % 3_600_000 / 60_000, rem % 60_000 / 1000, rem % 1000);
    format!("{year:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{mil:03}Z")
}

/// XML/HTML escape 對齊 Express `/thoughts/rss` 的 `esc`：只轉 `& < >`（且 `&` 先，避免二次轉義）。
pub fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// `new Date(String(created_at).replace(' ','T')+'Z').toUTCString()` 等價。
/// 輸入為 SQLite datetime（`YYYY-MM-DD HH:MM:SS`，視為 UTC）；壞值回 `"Invalid Date"`（對齊 JS）。
pub fn js_date_to_utc_string(created_at: Option<&str>) -> String {
    // String(null) = "null"；只換第一個空白 + 補 Z
    let base = created_at.unwrap_or("null");
    let replaced = base.replacen(' ', "T", 1);
    let s = replaced.trim_end_matches('Z');
    let parse = || -> Option<(i64, u32, u32, u32, u32, u32)> {
        let (date, time) = s.split_once('T')?;
        let mut dp = date.split('-');
        let y: i64 = dp.next()?.parse().ok()?;
        let mo: u32 = dp.next()?.parse().ok()?;
        let d: u32 = dp.next()?.parse().ok()?;
        if dp.next().is_some() {
            return None;
        }
        let mut tp = time.split(':');
        let h: u32 = tp.next()?.parse().ok()?;
        let mi: u32 = tp.next()?.parse().ok()?;
        let se: u32 = tp.next()?.parse().ok()?;
        if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
            return None;
        }
        Some((y, mo, d, h, mi, se))
    };
    let Some((y, mo, d, h, mi, se)) = parse() else {
        return "Invalid Date".to_string();
    };
    // days_from_civil（Howard Hinnant）→ 距 1970-01-01 天數 → 星期
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = if yy >= 0 { yy } else { yy - 399 } / 400;
    let yoe = yy - era * 400;
    let mp = if mo > 2 { mo as i64 - 3 } else { mo as i64 + 9 };
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let dow = ((days % 7 + 4) % 7 + 7) % 7; // 1970-01-01 = Thu(4)；Sunday=0
    const DOW: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MON: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!(
        "{}, {:02} {} {:04} {:02}:{:02}:{:02} GMT",
        DOW[dow as usize], d, MON[(mo - 1) as usize], y, h, mi, se
    )
}

#[cfg(test)]
mod props {
    use super::*;

    // JS 相容層的不變量。這些函式要對齊 JS 的 UTF-16 語意，
    // 而 CJK／emoji／surrogate pair 的邊界靠手挑案例掃不完。
    proptest::proptest! {
        /// 截斷後的 UTF-16 長度不得超過 n（對齊 JS `s.substring(0, n)`）。
        #[test]
        fn js_substring_prefix_bounded(s in ".{0,200}", n in 0usize..80) {
            let out = js_substring_prefix(&s, n);
            proptest::prop_assert!(out.encode_utf16().count() <= n);
        }

        /// 原字串夠短時原樣返回。
        #[test]
        fn js_substring_prefix_identity_when_short(s in ".{0,60}") {
            let n = s.encode_utf16().count();
            proptest::prop_assert_eq!(js_substring_prefix(&s, n), s);
        }

        /// 冪等：截過一次再截同樣長度不變。
        #[test]
        fn js_substring_prefix_idempotent(s in ".{0,200}", n in 0usize..80) {
            let once = js_substring_prefix(&s, n);
            proptest::prop_assert_eq!(js_substring_prefix(&once, n), once.clone());
        }

        /// slug 只會留下 ASCII 英數、`_`、`-`、以及 CJK 區段（對齊 JS 的 `[^\w\-一-龥]` 過濾）。
        #[test]
        fn gen_slug_charset(name in ".{0,120}") {
            for c in gen_slug(&name).chars() {
                let ok = c.is_ascii_alphanumeric() || c == '_' || c == '-'
                    || ('\u{4e00}'..='\u{9fa5}').contains(&c);
                proptest::prop_assert!(ok, "unexpected char {c:?}");
            }
        }

        /// slug 不含大寫（實作先 to_lowercase）。
        #[test]
        fn gen_slug_is_lowercase(name in ".{0,120}") {
            let s = gen_slug(&name);
            proptest::prop_assert_eq!(s.to_lowercase(), s.clone());
        }
    }
}

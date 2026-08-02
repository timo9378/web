use serde_json::{Map, Value};
use sqlx::{Column, Row, TypeInfo, ValueRef, sqlite::SqliteRow};

/// TMDb API 的 base URL。正式一律是官方位址，`TMDB_BASE_URL` 只是為了讓測試指向 wiremock。
///
/// 這裡刻意做成共用而不是各檔一份：watch.rs（detail／search）、bahamut.rs（劇名搜尋）、
/// thoughts.rs（補圖）三處都打 TMDb，各自硬編就等於三個檔案都測不了外部呼叫。
pub fn tmdb_api() -> String {
    std::env::var("TMDB_BASE_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.themoviedb.org".into())
}

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
    if f.fract() == 0.0 && f.abs() < 9.0e15 { Value::from(f as i64) } else { Value::from(f) }
}

/// `#[serde(serialize_with = ...)]` 用的 JS number 語意序列化：整值輸出整數
/// （`123` 而非 `123.0`）。給那些「值是從既有 JSON 讀進來、又要原樣寫回去」的欄位用
/// ——manifest 檔案與 thoughts 的 ref_json 都是這種，型別化不該順手改掉數字寫法。
///
/// 非有限值直接讓序列化失敗：JSON 沒有 NaN/Inf，serde_json 會靜靜轉成 null，
/// 那正是 specta 把裸 f64 標成 `number | null` 的原因。在這裡擋掉，型別才敢寫 `number`。
pub fn ser_js_number<S: serde::Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
    use serde::Serialize;
    if !v.is_finite() {
        return Err(serde::ser::Error::custom(format!("數值不是有限值：{v}")));
    }
    js_num_value(*v).serialize(s)
}

pub fn ser_js_number_opt<S: serde::Serializer>(v: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(n) => ser_js_number(n, s),
        None => s.serialize_none(),
    }
}

/// JS `parseInt(s,10)` 的 Option 版：無合法前導整數 → None（NaN → SQL 綁 NULL）。
pub fn js_parse_int_opt(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let mut out = String::new();
    let mut it = t.chars().peekable();
    if let Some(&c) = it.peek()
        && (c == '+' || c == '-')
    {
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
        .filter(|&c| {
            c.is_ascii_alphanumeric() || c == '_' || c == '-' || ('\u{4e00}'..='\u{9fa5}').contains(&c)
        })
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
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(*b as char),
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
                && n.as_i64().is_none()
                && n.as_u64().is_none()
                && f.fract() == 0.0
                && f.abs() < 9.0e15
            {
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
    // 1970-01-01 = Thu(4)；Sunday=0。
    //
    // ⚠️ `cargo mutants` 會回報這兩行有三個「存活」的變異（`era * 146_097` → `/`、
    // 以及兩個 `%` → `+`）。那三個是**等價變異**，不是測試漏掉：
    //   - 146_097 = 20871 × 7，格里曆 400 年週期剛好是整數週，所以 `era * 146_097`
    //     對 dow 的貢獻恆為 0 mod 7；而 `days` 只被 dow 用到。
    //   - `(days % 7 + 4) % 7` 與 `(days + 11) % 7` 同餘且正規化區間相同。
    // 不必為了讓分數好看而去寫測試——寫不出能分辨的輸入。
    let dow = ((days % 7 + 4) % 7 + 7) % 7;
    const DOW: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MON: [&str; 12] =
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!(
        "{}, {:02} {} {:04} {:02}:{:02}:{:02} GMT",
        DOW[dow as usize],
        d,
        MON[(mo - 1) as usize],
        y,
        h,
        mi,
        se
    )
}

#[cfg(test)]
mod value_tests {
    use super::*;

    // 這三條都是 `cargo mutants` 指出來的：改掉之後測試全綠，因為既有的整合測試
    // 剛好都走在「兩種寫法結果相同」的輸入上。

    #[test]
    fn js_num_value_的整數化上限是九乘十的十五次方() {
        assert_eq!(js_num_value(4.0), Value::from(4i64));
        assert_eq!(js_num_value(4.5), Value::from(4.5f64));
        assert_eq!(js_num_value(-0.0), Value::from(0i64));
        // 邊界本身要留在浮點側（`<` 不是 `<=`）——超過 2^53 之後 i64 轉換已經不保真，
        // 硬轉會讓「原樣讀進來、原樣寫回去」的欄位悄悄變值。
        let boundary = js_num_value(9.0e15);
        assert!(boundary.is_f64(), "9.0e15 本身不該被整數化，得到 {boundary}");
        assert!(js_num_value(8.999e15).is_i64(), "剛好低於邊界的要整數化");
    }

    #[test]
    fn js_parse_int_opt_接受正負號前綴() {
        // `+5` 是唯一分得出 `c == '+'` 與 `c != '+'` 的輸入：其餘字元兩種寫法結果相同
        assert_eq!(js_parse_int_opt("+5"), Some(5));
        assert_eq!(js_parse_int_opt("-5"), Some(-5));
        assert_eq!(js_parse_int_opt("  +12xy"), Some(12), "JS 的 parseInt 會跳過前導空白");
        assert_eq!(js_parse_int_opt("+"), None, "只有正負號沒有數字");
        assert_eq!(js_parse_int_opt("-"), None);
        assert_eq!(js_parse_int_opt("++5"), None, "第二個符號不是數字，前綴到此為止");
        assert_eq!(js_parse_int_opt("5+"), Some(5));
        assert_eq!(js_parse_int_opt(""), None);
    }

    #[test]
    fn split_tags_把_group_concat_的字串切開_空值回空陣列() {
        // 這支整個沒有測試——六個變異（含「直接回 vec![]」）全數存活。
        // 症狀會是文章的標籤靜靜地全部消失或多出一個空標籤，不會有錯誤。
        assert_eq!(split_tags(Some("rust,axum,sqlite")), vec!["rust", "axum", "sqlite"]);
        assert_eq!(split_tags(Some("單一")), vec!["單一"]);
        assert_eq!(split_tags(None), Vec::<String>::new());
        assert_eq!(split_tags(Some("")), Vec::<String>::new(), "空字串是沒有標籤，不是一個空標籤");
        // GROUP_CONCAT 不會自己去空白，照抄 Express 的 split(',') 語意
        assert_eq!(split_tags(Some("a, b")), vec!["a", " b"]);
        assert_eq!(split_tags(Some("a,,b")), vec!["a", "", "b"]);
    }

    #[test]
    fn gen_slug_的實際對應關係() {
        // 檔案下面已經有 gen_slug 的 proptest，但那兩條性質（字元集、全小寫）**太弱**：
        // 「整支函式改成回傳 "xyzzy"」與「把三個 || 都換成 &&（結果恆為空字串）」
        // 兩種寫法都同時滿足，於是 cargo mutants 讓它們全部存活。
        // 性質測邊界、定樁測對應，兩者要一起才擋得住。
        assert_eq!(gen_slug("Hello World"), "hello-world");
        assert_eq!(gen_slug("Hello   World"), "hello-world", "連續空白折成單一 -");
        assert_eq!(gen_slug("Rust & Axum"), "rust--axum", "& 被濾掉但兩側的 - 都留著（照抄 JS）");
        assert_eq!(gen_slug("技術文章"), "技術文章", "CJK 保留");
        assert_eq!(gen_slug("日本語テスト"), "日本語", "片假名不在 一-龥 區段內，會被濾掉");
        assert_eq!(gen_slug("a_b-c"), "a_b-c", "底線與連字號是白名單內的");
        assert_eq!(gen_slug("Ünïcödé"), "ncd", "JS 的 \\w 沒有 /u 旗標，帶音標的拉丁字母不算字元");
        assert_eq!(gen_slug("!!!"), "", "全部被濾掉就是空字串");
        assert_eq!(gen_slug(""), "");
        assert_eq!(gen_slug("  前導空白"), "-前導空白", "開頭的空白也會生出一個 -");
    }

    #[test]
    fn js_normalize_numbers_把整值浮點折成整數且遞迴進容器() {
        use serde_json::json;
        // 直接對純量
        let mut v = json!(4.0);
        js_normalize_numbers(&mut v);
        assert_eq!(v, json!(4), "4.0 要變 4（JSON.stringify 的語意）");

        let mut v = json!(4.5);
        js_normalize_numbers(&mut v);
        assert_eq!(v, json!(4.5), "有小數的不動");

        // 陣列與物件都要遞迴進去——這兩條 match arm 刪掉之後原本沒有測試會紅
        let mut v = json!({ "a": [1.0, 2.5, { "b": 3.0 }], "c": { "d": [[7.0]] } });
        js_normalize_numbers(&mut v);
        assert_eq!(v, json!({ "a": [1, 2.5, { "b": 3 }], "c": { "d": [[7]] } }));

        // 邊界：超過 9e15 不折（i64 轉換已不保真）
        let mut v = json!(9.0e15);
        js_normalize_numbers(&mut v);
        assert!(v.is_f64(), "9.0e15 要留在浮點側，得到 {v}");
        let mut v = json!(8.999e15);
        js_normalize_numbers(&mut v);
        assert!(v.is_i64(), "剛好低於邊界的要折成整數");

        // 負的整值也要折
        let mut v = json!(-6.0);
        js_normalize_numbers(&mut v);
        assert_eq!(v, json!(-6));

        // 字串與 bool 不該被碰
        let mut v = json!({ "s": "4.0", "b": true, "n": null });
        js_normalize_numbers(&mut v);
        assert_eq!(v, json!({ "s": "4.0", "b": true, "n": null }));
    }
}

#[cfg(test)]
mod date_tests {
    use super::*;

    // `iso_from_millis` 與 `js_date_to_utc_string` 各自手刻了一份曆法換算
    // （Howard Hinnant 的 days_from_civil / civil_from_days）。這種程式錯了不會爆，
    // 只會讓 RSS 的 pubDate 差一天或星期寫錯——閱讀器多半照收，於是沒有人會發現。
    //
    // chrono 本來就是直接依賴，拿它當對照組比手挑案例可靠：下面兩條 property
    // 掃的是「兩百年份 × 每一天 × 每一秒」的空間，閏年、閏世紀、月末都在裡面。

    #[test]
    fn iso_from_millis_的_epoch_與負數邊界() {
        assert_eq!(iso_from_millis(0), "1970-01-01T00:00:00.000Z");
        // 這條是給 div_euclid 的：用一般的 `/` 與 `%`，-1 會算成 1970-01-01T00:00:00.-001Z
        assert_eq!(iso_from_millis(-1), "1969-12-31T23:59:59.999Z");
        assert_eq!(iso_from_millis(-86_400_000), "1969-12-31T00:00:00.000Z");
        assert_eq!(iso_from_millis(1_709_164_800_000), "2024-02-29T00:00:00.000Z", "閏日");
        assert_eq!(iso_from_millis(951_782_400_000), "2000-02-29T00:00:00.000Z", "整除 400 的閏年");
    }

    #[test]
    fn js_date_to_utc_string_的壞輸入一律回_invalid_date() {
        // 對齊 JS：`String(null)` 是 "null"，再怎麼 parse 都不會成功
        assert_eq!(js_date_to_utc_string(None), "Invalid Date");
        for bad in [
            "",
            "not a date",
            "2026-13-01 00:00:00",    // 月份越界
            "2026-01-32 00:00:00",    // 日越界
            "2026-01-01 24:00:00",    // 時越界
            "2026-01-01 00:60:00",    // 分越界
            "2026-01-01 00:00:61",    // 秒越界（60 是閏秒，允許；61 不行）
            "2026-01-01",             // 沒有時間
            "2026-01-01-01 00:00:00", // 多一段
            "2026-01 00:00:00",       // 少一段
        ] {
            assert_eq!(js_date_to_utc_string(Some(bad)), "Invalid Date", "輸入 {bad:?}");
        }
    }

    #[test]
    fn js_date_to_utc_string_算得出西元零年附近的星期() {
        // `era = if yy >= 0 { yy } else { yy - 399 } / 400` 的 else 分支只有 y <= 0 會走到
        // （Rust 的整數除法向零截斷，負數要先減 399 才等同向下取整）。
        // 正式資料不會有這種日期，但那個分支寫錯就是靜靜地算錯——留兩個定樁。
        // 對照組一樣是 chrono，不手寫預期值——下面的 property test 掃不到這裡，
        // 是因為它的年份範圍取 1900..2200（讓 uniform 取樣真的掃得到每一年）。
        // 西元前的年份只能經由 y=0 且 mo<=2 走到那條分支——負年份的**字串**（"-001-06-15"）
        // 解不出來是對的：開頭的 `-` 會被當成日期分隔符，回 Invalid Date。
        for (y, mo, d) in [(0, 1, 1), (0, 2, 29), (0, 3, 1), (0, 12, 31), (1, 1, 1)] {
            let input = format!("{y:04}-{mo:02}-{d:02} 00:00:00");
            let want = chrono::NaiveDate::from_ymd_opt(y, mo, d)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .format("%a, %d %b %Y %H:%M:%S GMT")
                .to_string();
            assert_eq!(js_date_to_utc_string(Some(&input)), want, "輸入 {input}");
        }
    }

    #[test]
    fn js_date_to_utc_string_接受閏秒與結尾的_z() {
        // 60 秒放行是刻意的（對齊 JS Date 對閏秒的寬容）
        assert_eq!(js_date_to_utc_string(Some("2016-12-31 23:59:60")), "Sat, 31 Dec 2016 23:59:60 GMT");
        // SQLite 的 datetime 不帶 Z，但外部塞進來的可能帶
        assert_eq!(
            js_date_to_utc_string(Some("2026-01-01 12:00:00Z")),
            js_date_to_utc_string(Some("2026-01-01 12:00:00")),
        );
    }

    #[test]
    fn xml_esc_先換_and_才不會二次轉義() {
        assert_eq!(xml_esc("a & b"), "a &amp; b");
        assert_eq!(xml_esc("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
        // 若順序反過來（先換 < 再換 &），這個結果會變成 &amp;lt;
        assert_eq!(xml_esc("<"), "&lt;");
        assert_eq!(xml_esc("&amp;"), "&amp;amp;", "輸入本來就是實體時照樣再轉一次（同 Express）");
        // 引號與撇號不轉——這是 Express 的 esc 行為，寫下來免得有人「順手補齊」
        assert_eq!(xml_esc("\"'"), "\"'");
    }

    /// 逐日走完 1900–2200，兩支換算都跟 chrono 對字。
    ///
    /// 為什麼不只靠下面的 proptest：`doe / 36_524`（世紀閏年修正）那一項改壞之後，
    /// 絕大多數日子的結果**不變**——只有世紀交界前後那幾天會發散。256 次均勻取樣
    /// 掃到的機率極低，實測 `cargo mutants` 就是這樣讓它活下來的。日期空間只有十萬個，
    /// 與其想辦法引導取樣，不如整個走完。
    #[test]
    fn 曆法換算逐日對齊_chrono() {
        let end = chrono::NaiveDate::from_ymd_opt(2200, 1, 1).unwrap();
        let mut day = chrono::NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
        while day < end {
            // 取一個非午夜的時間，順便讓時分秒的拆解也走過每一天
            let dt = day.and_hms_opt(13, 45, 30).unwrap();
            let ms = dt.and_utc().timestamp_millis();
            assert_eq!(iso_from_millis(ms), dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(), "{day}");
            let input = dt.format("%Y-%m-%d %H:%M:%S").to_string();
            assert_eq!(
                js_date_to_utc_string(Some(&input)),
                dt.format("%a, %d %b %Y %H:%M:%S GMT").to_string(),
                "{day}"
            );
            day = day.succ_opt().unwrap();
        }
    }

    proptest::proptest! {
        /// epoch ms → ISO 字串必須與 chrono 逐字相同。
        #[test]
        fn iso_from_millis_對齊_chrono(ms in -2_208_988_800_000i64..4_102_444_800_000i64) {
            let want = chrono::DateTime::from_timestamp_millis(ms)
                .unwrap()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string();
            proptest::prop_assert_eq!(iso_from_millis(ms), want);
        }

        /// SQLite datetime → RFC 1123（RSS 的 pubDate）必須與 chrono 逐字相同，星期在內。
        #[test]
        fn js_date_to_utc_string_對齊_chrono(
            y in 1900i32..2200i32,
            mo in 1u32..=12u32,
            d in 1u32..=31u32,
            h in 0u32..24u32,
            mi in 0u32..60u32,
            se in 0u32..60u32,
        ) {
            // 2 月 31 日這種組合本函式其實會照算（不驗月份天數），但正式資料一律來自
            // SQLite 的 datetime('now')，不可能生出來——所以這裡只比對真實存在的日期。
            let Some(date) = chrono::NaiveDate::from_ymd_opt(y, mo, d) else {
                return Ok(());
            };
            let input = format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{se:02}");
            let want = date.and_hms_opt(h, mi, se).unwrap().format("%a, %d %b %Y %H:%M:%S GMT").to_string();
            proptest::prop_assert_eq!(js_date_to_utc_string(Some(&input)), want);
        }
    }
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

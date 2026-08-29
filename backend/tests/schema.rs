//! migration replay + schema 快照 + 把每一句寫死的 SQL 拿去 prepare。
//!
//! ## 補的是哪個洞
//!
//! 這個後端有 153 次 `sqlx::query*`、**零個編譯期檢查巨集**（`query!`）、也沒有
//! `.sqlx/` 離線資料。意思是：migration 把欄位改名或刪掉時，**編譯器完全不會出聲**，
//! 要等到那條路徑在線上真的被走到才會炸。而覆蓋率只有兩成，多數路徑不會在測試裡被走到。
//!
//! ## 三層
//!
//! 1. `migrations_replay_on_an_empty_database` —— 11 支 migration 從空白重放得過。
//! 2. `schema_matches_snapshot` —— 重放後的 schema 對committed 快照。schema 一動就要
//!    有人明確更新快照，不會靜悄悄地改掉。
//! 3. `every_literal_sql_prepares_against_the_migrated_schema` —— 把原始碼裡每一句
//!    **寫死的** SQL 丟給 SQLite prepare。prepare 會驗表名與欄位名，這正是 `query!`
//!    巨集會做而我們現在沒做的事。
//!
//! 第 3 項抓不到動態拼出來的 SQL（`format!` / `AssertSqlSafe(sql.as_str())`）。
//! 目前是 **131 句寫死的有檢查、22 句動態的檢查不到**。那 22 句會被計數並逐條印出來
//! ——**不靜靜地跳過**，不然「131 句全過」看起來會像「全部都過」。

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use sqlx::Executor;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const SNAPSHOT: &str = "tests/schema.snapshot.sql";

/// 空白 DB + 跑完全部 migration。與正式啟動、與 tests/api.rs 走同一條 `sqlx::migrate!`。
async fn migrated_pool() -> sqlx::SqlitePool {
    let opts =
        SqliteConnectOptions::from_str("sqlite::memory:").expect("in-memory sqlite URL").foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .expect("connect in-memory sqlite");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migration 從空白重放失敗");
    pool
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[tokio::test]
async fn migrations_replay_on_an_empty_database() {
    let pool = migrated_pool().await;
    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("讀 _sqlx_migrations");
    let on_disk = std::fs::read_dir(manifest_dir().join("migrations"))
        .expect("讀 migrations 目錄")
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .count();
    let on_disk = i64::try_from(on_disk).expect("migration 檔數不可能超過 i64");
    assert_eq!(applied, on_disk, "跑掉的 migration 數與目錄裡的 .sql 數對不上");
    assert!(on_disk > 0, "一支 migration 都沒有，這個測試就沒有意義了");
}

// ── schema 快照 ───────────────────────────────────────────────────────────

/// `sqlite_master` 正規化成穩定的文字。空白壓成單一空格，讓「只是重排版」不算變更，
/// 但欄位增刪改名一定會顯示出來。
async fn schema_text(pool: &sqlx::SqlitePool) -> String {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT type, name, sql FROM sqlite_master \
         WHERE name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' \
         ORDER BY type, name",
    )
    .fetch_all(pool)
    .await
    .expect("讀 sqlite_master");

    let mut out = String::from(
        "-- 由 backend/tests/schema.rs 產生，不要手改。\n\
         -- 要更新：UPDATE_SCHEMA_SNAPSHOT=1 cargo test --test schema\n\
         -- 這份快照的用途是「schema 變了就要有人明說」——後端沒有編譯期 SQL 檢查，\n\
         -- 欄位靜悄悄改名的話只有線上會知道。\n\n",
    );
    for (kind, name, sql) in rows {
        let normalized = sql.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            continue; // 自動索引（sqlite_autoindex_*）沒有 sql，已被上面過濾掉
        }
        let _ = write!(out, "{kind} {name}\n  {normalized}\n\n");
    }
    out
}

#[tokio::test]
async fn schema_matches_snapshot() {
    let pool = migrated_pool().await;
    let actual = schema_text(&pool).await;
    let path = manifest_dir().join(SNAPSHOT);

    if std::env::var("UPDATE_SCHEMA_SNAPSHOT").is_ok() {
        std::fs::write(&path, &actual).expect("寫快照");
        eprintln!("已更新 {}", path.display());
        return;
    }

    let expected = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "讀不到 schema 快照 {}（{e}）。第一次建立請跑：\n  \
             UPDATE_SCHEMA_SNAPSHOT=1 cargo test --test schema",
            path.display()
        )
    });

    if actual != expected {
        // 印出差在哪一行，不然 assert_eq! 會吐兩大段文字要人自己對
        let a: Vec<&str> = actual.lines().collect();
        let b: Vec<&str> = expected.lines().collect();
        let mut diff = String::new();
        for i in 0..a.len().max(b.len()) {
            let (x, y) = (a.get(i).copied().unwrap_or(""), b.get(i).copied().unwrap_or(""));
            if x != y {
                let _ = write!(diff, "  第 {} 行\n    快照: {y}\n    實際: {x}\n", i + 1);
            }
        }
        panic!(
            "migration 改動了 schema，但快照沒跟上。\n{diff}\n\
             確認這是有意的改動之後，跑：\n  UPDATE_SCHEMA_SNAPSHOT=1 cargo test --test schema\n\
             並且**檢查所有查到這些欄位的 sqlx::query 有沒有一起改**——\
             這個後端沒有編譯期 SQL 檢查，改錯了編譯器不會說話。"
        );
    }
}

// ── 把寫死的 SQL 拿去 prepare ─────────────────────────────────────────────

/// 讀一個 Rust 字串字面值（`"..."`、`r"..."`、`r#"..."#`），回傳 (內容, 結束位置)。
/// 不是字面值就回 None——刻意不猜，猜錯會變成假紅。
fn read_rust_string(src: &str, start: usize) -> Option<(String, usize)> {
    let b = src.as_bytes();
    let mut i = start;

    // raw string：r"..." / r#"..."# / r##"..."##
    if b.get(i) == Some(&b'r') {
        let mut hashes = 0;
        let mut j = i + 1;
        while b.get(j) == Some(&b'#') {
            hashes += 1;
            j += 1;
        }
        if b.get(j) != Some(&b'"') {
            return None;
        }
        let close = format!("\"{}", "#".repeat(hashes));
        let body_start = j + 1;
        let end = src[body_start..].find(&close)? + body_start;
        return Some((src[body_start..end].to_string(), end + close.len()));
    }

    if b.get(i) != Some(&b'"') {
        return None;
    }
    i += 1;
    let mut out = String::new();
    while i < src.len() {
        match b[i] {
            b'"' => return Some((out, i + 1)),
            b'\\' => {
                i += 1;
                match b.get(i) {
                    // 行接續：吃掉換行與下一行的前導空白（Rust 的規則）
                    Some(b'\n') => {
                        i += 1;
                        while b.get(i).is_some_and(u8::is_ascii_whitespace) {
                            i += 1;
                        }
                        // 補一個分隔，不然 `SELECT a\<換行>FROM t` 會黏成 `aFROM`。
                        // 前面已經有空白就不再補——雙空格不影響 SQL，但會讓這個函式的
                        // 輸出不等於原始 SQL，之後拿它做比對或雜湊時會踩到。
                        if !out.ends_with(char::is_whitespace) {
                            out.push(' ');
                        }
                        continue;
                    }
                    Some(b'n') => out.push('\n'),
                    Some(b't') => out.push('\t'),
                    Some(b'r') => out.push('\r'),
                    Some(b'0') => out.push('\0'),
                    Some(&c) => out.push(c as char),
                    None => return None,
                }
                i += 1;
            }
            _ => {
                // 多位元組字元原樣搬過去
                let ch = src[i..].chars().next()?;
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    None
}

struct Extracted {
    literals: Vec<(String, String)>, // (檔名, SQL)
    dynamic: Vec<String>,            // 抓不動的，記下來回報
}

/// 掃 `sqlx::query` / `query_as` / `query_scalar`，只取第一個引數是字串字面值的。
/// 允許外面包一層 `sqlx::AssertSqlSafe(...)`。
fn extract(src: &str, file: &str) -> Extracted {
    let mut out = Extracted { literals: Vec::new(), dynamic: Vec::new() };
    let mut cursor = 0;
    while let Some(rel) = src[cursor..].find("sqlx::query") {
        let hit = cursor + rel;
        cursor = hit + "sqlx::query".len();
        let mut j = cursor;

        // 吃掉 `_as` / `_scalar`
        for suffix in ["_as", "_scalar"] {
            if src[j..].starts_with(suffix) {
                j += suffix.len();
                break;
            }
        }
        while src[j..].starts_with(char::is_whitespace) {
            j += 1;
        }

        // turbofish 要整段跳過，不能直接找第一個 '('——
        // `query_as::<_, (i64, Option<String>)>("SELECT …")` 的第一個 '(' 在型別裡面，
        // 直接找會抓到 tuple type，那句 SQL 就被誤判成「動態拼的」而漏檢。
        if src[j..].starts_with("::<") {
            j += 3;
            let mut depth = 1usize;
            for ch in src[j..].chars() {
                j += ch.len_utf8();
                match ch {
                    '<' => depth += 1,
                    '>' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            while src[j..].starts_with(char::is_whitespace) {
                j += 1;
            }
        }

        if !src[j..].starts_with('(') {
            continue;
        }
        j += 1;

        // 跳過空白，允許一層 AssertSqlSafe(
        while src[j..].starts_with(char::is_whitespace) {
            j += 1;
        }
        for wrapper in ["sqlx::AssertSqlSafe(", "AssertSqlSafe("] {
            if src[j..].starts_with(wrapper) {
                j += wrapper.len();
                while src[j..].starts_with(char::is_whitespace) {
                    j += 1;
                }
                break;
            }
        }

        if let Some((sql, _)) = read_rust_string(src, j) {
            out.literals.push((file.to_string(), sql));
        } else {
            let snippet = src[j..].chars().take(60).collect::<String>();
            out.dynamic.push(format!("{file}: {}", snippet.split_whitespace().collect::<Vec<_>>().join(" ")));
        }
    }
    out
}

fn rust_files(dir: &Path, into: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).expect("讀 src 目錄").filter_map(Result::ok) {
        let p = e.path();
        if p.is_dir() {
            rust_files(&p, into);
        } else if p.extension().is_some_and(|x| x == "rs") {
            into.push(p);
        }
    }
}

/// SQLite 的 prepare 會驗表名與欄位名——這就是 `sqlx::query!` 會做、而我們沒做的檢查。
///
/// 弄壞任何一支 migration 的欄位名（或改錯一句 SQL），這個測試會指名道姓地紅在
/// 那一句上，而不是等線上某條冷路徑被走到。
#[tokio::test]
async fn every_literal_sql_prepares_against_the_migrated_schema() {
    let pool = migrated_pool().await;

    let mut files = Vec::new();
    rust_files(&manifest_dir().join("src"), &mut files);
    files.sort();

    let mut literals = Vec::new();
    let mut dynamic = Vec::new();
    for f in &files {
        let src = std::fs::read_to_string(f).expect("讀原始碼");
        let name = f.strip_prefix(manifest_dir()).unwrap_or(f).display().to_string();
        let mut e = extract(&src, &name);
        literals.append(&mut e.literals);
        dynamic.append(&mut e.dynamic);
    }

    assert!(
        literals.len() >= 100,
        "只抽到 {} 句寫死的 SQL，比預期少太多——抽取邏輯大概壞了，\
         而一個抽不到東西的檢查會安靜地永遠是綠的",
        literals.len()
    );

    let mut conn = pool.acquire().await.expect("取連線");
    let mut failures = Vec::new();
    for (file, sql) in &literals {
        // PRAGMA 之類的非查詢語句 prepare 得過但沒有意義，一併跑無妨
        // sqlx 0.9 的 describe 收 SqlStr；SQL 來源是本 repo 的原始碼，不是外部輸入。
        let stmt = sqlx::SqlSafeStr::into_sql_str(sqlx::AssertSqlSafe(sql.as_str()));
        if let Err(e) = conn.describe(stmt).await {
            failures.push(format!(
                "  {file}\n    SQL: {}\n    錯誤: {e}",
                sql.split_whitespace().collect::<Vec<_>>().join(" ")
            ));
        }
    }

    // 沒有靜靜跳過：抓不動的動態 SQL 一律印出來，讓「檢查了幾句」是誠實的數字
    eprintln!(
        "prepare 檢查：{} 句寫死的 SQL 全數通過；另有 {} 句是動態拼的，這個測試涵蓋不到：",
        literals.len(),
        dynamic.len()
    );
    for d in &dynamic {
        eprintln!("  略過（動態）: {d}");
    }

    assert!(
        failures.is_empty(),
        "有 {} 句 SQL 對不上 migration 後的 schema（表或欄位不存在）：\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn rust_string_reader_handles_the_shapes_that_appear_in_this_codebase() {
    // 一般字串
    assert_eq!(read_rust_string(r#""SELECT 1""#, 0).unwrap().0, "SELECT 1");
    // 跳脫的引號
    assert_eq!(read_rust_string(r#""a\"b""#, 0).unwrap().0, "a\"b");
    // 行接續：換行與下一行前導空白都吃掉，補一個空格（不然 token 會黏起來）
    let cont = "\"SELECT a \\\n         FROM t\"";
    assert_eq!(read_rust_string(cont, 0).unwrap().0, "SELECT a FROM t");
    // raw string
    // ⚠️ clippy 的 needless_raw_string_hashes 會叫你把這裡的 `r##` 減成 `r#`——那是錯的。
    // 這串字面值的**內容**就是 `r#"SELECT "x""#`，裡面帶著 `"#`，少一層 hash 字串會在
    // 那裡提早結束（實測：unclosed delimiter，直接編不過）。
    #[allow(clippy::needless_raw_string_hashes, reason = "內容本身含 \"#，減 hash 會提早結束")]
    {
        assert_eq!(read_rust_string(r##"r#"SELECT "x""#"##, 0).unwrap().0, "SELECT \"x\"");
    }
    // 不是字面值 → None（呼叫端會計為動態，不會誤判成通過）
    assert!(read_rust_string("sql.as_str()", 0).is_none());
    assert!(read_rust_string("format!(\"x\")", 0).is_none());
}

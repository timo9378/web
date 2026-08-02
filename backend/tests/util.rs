//! `util.rs` 裡需要真的 DB 的那幾支。
//!
//! ⚠ 為什麼不放在 `src/util.rs` 的 `#[cfg(test)]` 裡：`tests/schema.rs` 會掃描 **src/**
//! 底下所有字面 SQL 並拿去對 migration 後的 schema `prepare`，掃描器認不得
//! `#[cfg(test)]`——測試用的 `CREATE TABLE t (...)` 會被當成正式程式碼裡對不上 schema 的
//! SQL，於是 baseline 直接紅。純函式的測試留在 src 裡沒問題，會碰 SQL 的一律搬到這裡。
//!
//! 這三支都是 `cargo mutants` 指出來的：改壞了原本沒有任何測試會紅。

use koimsurai_web_backend::util::{is_unique_violation, row_to_json};
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;

async fn mem_pool() -> sqlx::SqlitePool {
    SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap()
}

#[tokio::test]
async fn is_unique_violation_只認_unique_衝突() {
    let pool = mem_pool().await;
    sqlx::query("CREATE TABLE t (name TEXT UNIQUE)").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO t (name) VALUES ('a')").execute(&pool).await.unwrap();

    // 這支決定「重複的標籤名」回 409 還是 500。恆真恆假兩種寫法原本都測不出來。
    let dup = sqlx::query("INSERT INTO t (name) VALUES ('a')").execute(&pool).await.unwrap_err();
    assert!(is_unique_violation(&dup), "重複插入要認得出來：{dup}");

    let other = sqlx::query("SELECT * FROM 不存在的表").execute(&pool).await.unwrap_err();
    assert!(!is_unique_violation(&other), "其他 DB 錯誤不該被當成 UNIQUE 衝突：{other}");

    // NOT NULL 也是約束違反，但不是 UNIQUE——這兩者在 API 層的處置不同
    sqlx::query("CREATE TABLE u (x TEXT NOT NULL)").execute(&pool).await.unwrap();
    let not_null = sqlx::query("INSERT INTO u (x) VALUES (NULL)").execute(&pool).await.unwrap_err();
    assert!(!is_unique_violation(&not_null), "NOT NULL 違反不是 UNIQUE 違反：{not_null}");
}

#[tokio::test]
async fn row_to_json_依儲存類別取值_real_欄位不會掉成_null() {
    let pool = mem_pool().await;
    // 四種儲存類別各一：REAL 那條若被當成 TEXT 讀，會解碼失敗變成 null
    let row = sqlx::query("SELECT 42 AS i, 4.0 AS r_int, 4.5 AS r_frac, 'hi' AS t, NULL AS n, 1 = 1 AS b")
        .fetch_one(&pool)
        .await
        .unwrap();
    let m = row_to_json(&row);
    assert_eq!(m["i"], Value::from(42i64));
    assert_eq!(m["r_int"], Value::from(4i64), "整值 REAL 要輸出成 4 而不是 4.0（對齊 JS）");
    assert_eq!(m["r_frac"], Value::from(4.5f64));
    assert_eq!(m["t"], Value::from("hi"));
    assert_eq!(m["n"], Value::Null);
    assert_eq!(m["b"], Value::from(1i64), "SQLite 的布林就是 0/1");
    // 欄位順序要保留（serde_json preserve_order）——row_to_json 的存在理由之一
    assert_eq!(m.keys().collect::<Vec<_>>(), vec!["i", "r_int", "r_frac", "t", "n", "b"]);
}

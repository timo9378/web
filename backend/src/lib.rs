//! lib target：給 `bin/export_types.rs`（specta 型別匯出）取用 handlers 的 struct。
//! 服務入口仍在 main.rs。

// ⚠️ 這條刻意寫在 crate root 而不是 Cargo.toml 的 `[workspace.lints]`。
//
// `[lints]` 是 **package** 層級的，會連 `tests/` 底下的整合測試一起管，而那不是這條
// 規則的意圖——測試裡 `.unwrap()` 是慣例，壞了就是測試紅，沒有線上影響。
// clippy.toml 的 `allow-unwrap-in-tests` 救不了那些：它認的是 `#[cfg(test)]` 與
// `#[test]`，而 `tests/common/mod.rs` 那種**非 `#[test]` 的 setup helper** 兩者都不是
// （實測剩 20 個擋在那裡）。寫在 crate root 就精確地只涵蓋正式碼。
//
// 為什麼只擋 unwrap 不擋 expect：
//   `.unwrap()`   = 「我沒想過這裡會不會失敗」
//   `.expect(m)`  = 「我斷言它不會失敗，理由是 m」
// 後者留著當**有文件的**逃生口。正式碼原有的 10 個 unwrap 全是 LazyLock 裡的
// `Regex::new(字面值)`，已逐一換成帶訊息的 expect。
#![deny(clippy::unwrap_used)]

pub mod auth;
pub mod error;
pub mod handlers;
pub mod net_guard;
pub mod openapi;
pub mod revalidate;
pub mod router;
pub mod state;
pub mod util;

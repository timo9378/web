//! 只做一件事：新增／修改 migration 時強迫重新編譯。
//!
//! `sqlx::migrate!("./migrations")` 是在**編譯期**把整個目錄嵌進 binary 的。cargo 預設
//! 只追蹤 .rs 檔，所以「新增一支 .sql 但沒動任何 Rust 原始碼」時不會重編，binary 裡還是
//! 舊的那一組。
//!
//! 症狀非常難認：`tests/schema.rs` 的 migrations_replay_on_an_empty_database 會紅在
//!   assertion `left == right` failed: 跑掉的 migration 數與目錄裡的 .sql 數對不上
//!     left: 16
//!    right: 17
//! ——`left` 是嵌進 binary 的（舊的），`right` 是測試在執行期 read_dir 數的（新的）。
//! 檔案明明就在，數字卻對不上，看起來像 migration 壞掉，實際上只是建置陳舊；隨便 touch
//! 一個 .rs 就會突然變綠，更容易被誤判成「測試會抖」。我本人就先誤判了一輪。
//!
//! 註：這裡不需要重新宣告 `build.rs` 自己——cargo 對 build script 一律會追蹤。
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}

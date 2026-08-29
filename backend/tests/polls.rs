//! 文章內嵌投票（MDX `<Poll>`）。
//!
//! 這支原本只有 25% —— 只有快照測試順手掃過 `GET`，寫入那一半完全沒人碰。
//! 而它是站上**唯一一個不需要任何身分就能改資料庫**的公開端點，兩道防灌的閘門
//! （鍵長上限、選項數上限）壞掉都不會有人發現：投票照樣成功、畫面照樣正常，
//! 只有 `poll_votes` 表會慢慢長出幾萬列亂數選項。

mod common;

use common::{get, post_json, test_app};
use serde_json::json;

/// 選項鍵與 poll id 的長度上限（對齊 handlers/polls.rs 的 MAX_KEY_LEN）。
const MAX_KEY_LEN: usize = 64;
/// 單一投票的選項數上限（對齊 MAX_OPTIONS_PER_POLL）。
const MAX_OPTIONS: usize = 20;

#[tokio::test]
async fn 沒人投過的投票回空清單而不是_404() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/polls/nobody-voted-yet").await;
    // 回 404 的話前端得為「還沒有人投」寫一條特例；空清單讓它跟「有票」同一條路徑
    assert_eq!(status, 200);
    assert_eq!(body["options"].as_array().unwrap().len(), 0);
    assert_eq!(body["total"], 0);
}

#[tokio::test]
async fn 票數依高到低排_同票數再依選項鍵排() {
    let (app, pool) = test_app().await;
    for (opt, n) in [("b", 5), ("a", 5), ("c", 9)] {
        sqlx::query("INSERT INTO poll_votes (poll_id, option_key, count) VALUES ('p', ?, ?)")
            .bind(opt)
            .bind(n)
            .execute(&pool)
            .await
            .unwrap();
    }

    let (status, body) = get(&app, "/api/polls/p").await;
    assert_eq!(status, 200);
    let keys: Vec<&str> =
        body["options"].as_array().unwrap().iter().map(|o| o["option_key"].as_str().unwrap()).collect();
    // c(9) 最前；a 與 b 同為 5，用選項鍵決勝 —— 沒有這個決勝規則的話同票時順序會飄，
    // 讀者每次重新整理看到的排序都不一樣
    assert_eq!(keys, ["c", "a", "b"]);
    assert_eq!(body["total"], 19);
}

#[tokio::test]
async fn 投票會累加而且回的是更新後的票數() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO poll_votes (poll_id, option_key, count) VALUES ('p', 'a', 3)")
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = post_json(&app, "/api/polls/p/vote", json!({ "option": "a" })).await;
    assert_eq!(status, 200);
    // 回應要直接帶新票數，不然前端得再打一次 GET 才知道結果
    assert_eq!(body["options"][0]["option_key"], "a");
    assert_eq!(body["options"][0]["count"], 4);
    assert_eq!(body["total"], 4);

    let n: i64 = sqlx::query_scalar("SELECT count FROM poll_votes WHERE poll_id='p' AND option_key='a'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 4, "回應說 4 但 DB 不是 4");
}

#[tokio::test]
async fn 第一次投的選項會被建出來() {
    let (app, _pool) = test_app().await;
    let (status, body) = post_json(&app, "/api/polls/brand-new/vote", json!({ "option": "x" })).await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], 1);
    assert_eq!(body["options"][0]["option_key"], "x");
}

#[tokio::test]
async fn 選項空白或只有空白字元一律拒絕() {
    let (app, pool) = test_app().await;
    for body in [json!({ "option": "" }), json!({ "option": "   " }), json!({})] {
        let (status, resp) = post_json(&app, "/api/polls/p/vote", body.clone()).await;
        assert_eq!(status, 400, "{body} 應該被拒絕");
        assert_eq!(resp["error"], "invalid poll id or option");
    }
    // 被拒絕的請求不能留下痕跡——擋住了卻已經寫進去等於沒擋
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM poll_votes").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn 過長的選項鍵與_poll_id_都擋得住() {
    let (app, _pool) = test_app().await;

    let long = "x".repeat(MAX_KEY_LEN + 1);
    let (status, _) = post_json(&app, "/api/polls/p/vote", json!({ "option": long })).await;
    assert_eq!(status, 400, "過長的選項鍵應該被擋");

    // 剛好在上限上要放行——差一格的邊界寫錯的話合法投票會被誤殺，而那沒有人會回報
    let ok = "x".repeat(MAX_KEY_LEN);
    let (status, _) = post_json(&app, "/api/polls/p/vote", json!({ "option": ok })).await;
    assert_eq!(status, 200, "剛好等於上限的選項鍵不該被擋");

    let long_id = "p".repeat(MAX_KEY_LEN + 1);
    let (status, _) = post_json(&app, &format!("/api/polls/{long_id}/vote"), json!({ "option": "a" })).await;
    assert_eq!(status, 400, "過長的 poll id 應該被擋");
}

#[tokio::test]
async fn 選項數到上限之後只擋新選項_既有的照樣投得下去() {
    let (app, pool) = test_app().await;
    // 先塞滿上限
    for i in 0..MAX_OPTIONS {
        sqlx::query("INSERT INTO poll_votes (poll_id, option_key, count) VALUES ('p', ?, 1)")
            .bind(format!("opt{i}"))
            .execute(&pool)
            .await
            .unwrap();
    }

    let (status, resp) = post_json(&app, "/api/polls/p/vote", json!({ "option": "第二十一個" })).await;
    assert_eq!(status, 400, "滿了之後不該再開新選項");
    assert_eq!(resp["error"], "too many options");

    // ⚠ 這一半才是重點：上限是用來擋灌列的，不是用來停掉這個投票。
    //   寫成「滿了就全部拒絕」的話，正常讀者投正常選項也會被擋，而錯誤訊息
    //   會說「選項太多」——沒有人看得懂那跟自己有什麼關係。
    let (status, body) = post_json(&app, "/api/polls/p/vote", json!({ "option": "opt0" })).await;
    assert_eq!(status, 200, "既有選項不該受選項數上限影響");
    let opt0 = body["options"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["option_key"] == "opt0")
        .expect("opt0 應該還在");
    assert_eq!(opt0["count"], 2);

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM poll_votes WHERE poll_id='p'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, i64::try_from(MAX_OPTIONS).unwrap(), "被擋下的新選項不該留下列");
}

#[tokio::test]
async fn 不同投票之間互不干擾() {
    let (app, _pool) = test_app().await;
    post_json(&app, "/api/polls/one/vote", json!({ "option": "a" })).await;
    post_json(&app, "/api/polls/two/vote", json!({ "option": "a" })).await;
    post_json(&app, "/api/polls/two/vote", json!({ "option": "a" })).await;

    // poll_id 沒進 WHERE 的話兩個投票會共用票數，而畫面上只是「數字偏大」
    let (_, one) = get(&app, "/api/polls/one").await;
    let (_, two) = get(&app, "/api/polls/two").await;
    assert_eq!(one["total"], 1);
    assert_eq!(two["total"], 2);
}

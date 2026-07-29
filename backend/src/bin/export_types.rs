//! Rust struct → TypeScript 型別（packages/api-types）。
//! 用法：`cargo run --bin export_types`（backend/ 下）。
//! P4 起手：先收已 typed 的端點 struct；動態 JSON 端點待 typed 化後逐步 register。

use koimsurai_web_backend::handlers::admin::{
    AdminCategoryRow, AdminCommentRow, AdminCommentsResponse, AdminPostDetailResponse, AdminPostFull,
    AdminPostsResponse, AdminTagRow, AdminUserRow, AdminUsersResponse, BlacklistResponse, BlacklistRow,
    CommentCounts, KeywordFilterRow, KeywordFiltersResponse,
};
use koimsurai_web_backend::handlers::auth::{AuthProvidersResponse, OAuthProviderInfo};
use koimsurai_web_backend::handlers::books::{BookDetailResponse, BookRow, BooksListResponse};
use koimsurai_web_backend::handlers::categories::{CategoriesResponse, CategoryRow};
use koimsurai_web_backend::handlers::home::{
    DigestComment, DigestPost, DigestResponse, DigestThought, DigestTimeline,
};
use koimsurai_web_backend::handlers::link_preview::LinkPreviewResponse;
use koimsurai_web_backend::handlers::newsletter::{SubscriberByToken, SubscriberRow, SubscribersResponse};
use koimsurai_web_backend::handlers::polls::{PollOptionRow, PollResponse};
use koimsurai_web_backend::handlers::posts::{
    CommentRow, CommentsResponse, Pagination, PostDetailResponse, PostListItem, PostsListResponse,
    ReactionRow, ReactionsResponse,
};
use koimsurai_web_backend::handlers::series::{
    SeriesDetailResponse, SeriesListResponse, SeriesPostRow, SeriesRow,
};
use koimsurai_web_backend::handlers::site::CountResponse;
use koimsurai_web_backend::handlers::spotify::{
    AudioFeature, AudioFeaturesResponse, NowPlayingResponse, RecentPlayItem, RecentlyPlayedResponse,
    SpotifyAlbum, SpotifyArtist, SpotifyExternalUrls, SpotifyImage, SpotifyTrack, TopGenre,
    TopGenresResponse, TopTracksResponse,
};
use koimsurai_web_backend::handlers::stats::StatsResponse;
use koimsurai_web_backend::handlers::tags::{TagRow, TagsResponse};
use koimsurai_web_backend::handlers::vitals::MetricStat;
use koimsurai_web_backend::handlers::watch::{
    AnimeHistoryResponse, AnimeRow, FilmRow, FilmsResponse, NowWatching, TvResponse, TvRow, WatchFavoriteRow,
    WatchFavoritesResponse, WatchNowResponse, WatchStatsResponse,
};
use specta_typescript::Typescript;

fn main() {
    let types = specta::Types::default()
        // spotify（第三方回應重新塑形成自己的形狀，前端不再手寫）
        .register::<SpotifyExternalUrls>()
        .register::<SpotifyImage>()
        .register::<SpotifyArtist>()
        .register::<SpotifyAlbum>()
        .register::<SpotifyTrack>()
        .register::<NowPlayingResponse>()
        .register::<RecentPlayItem>()
        .register::<RecentlyPlayedResponse>()
        .register::<TopTracksResponse>()
        .register::<TopGenre>()
        .register::<TopGenresResponse>()
        .register::<AudioFeature>()
        .register::<AudioFeaturesResponse>()
        .register::<OAuthProviderInfo>()
        .register::<AuthProvidersResponse>()
        // 公開的分類 / 標籤 / vitals / 連結預覽：struct 本來就有，只是沒 register
        .register::<LinkPreviewResponse>()
        .register::<CategoryRow>()
        .register::<CategoriesResponse>()
        .register::<TagRow>()
        .register::<TagsResponse>()
        .register::<MetricStat>()
        .register::<AdminTagRow>()
        .register::<AdminCategoryRow>()
        .register::<AdminUserRow>()
        .register::<AdminUsersResponse>()
        // posts（公開）
        .register::<PostListItem>()
        .register::<Pagination>()
        .register::<PostsListResponse>()
        .register::<PostDetailResponse>()
        .register::<CommentRow>()
        .register::<CommentsResponse>()
        .register::<ReactionRow>()
        .register::<ReactionsResponse>()
        .register::<PollOptionRow>()
        .register::<PollResponse>()
        .register::<CountResponse>()
        // posts（admin）
        .register::<AdminPostFull>()
        .register::<AdminPostsResponse>()
        .register::<AdminPostDetailResponse>()
        // comments / blacklist / keyword-filters（admin）
        .register::<AdminCommentRow>()
        .register::<CommentCounts>()
        .register::<AdminCommentsResponse>()
        .register::<BlacklistRow>()
        .register::<BlacklistResponse>()
        .register::<KeywordFilterRow>()
        .register::<KeywordFiltersResponse>()
        // books
        .register::<BookRow>()
        .register::<BooksListResponse>()
        .register::<BookDetailResponse>()
        // newsletter
        .register::<SubscriberRow>()
        .register::<SubscribersResponse>()
        .register::<SubscriberByToken>()
        // watch（anime/films/tv/stats）
        .register::<AnimeRow>()
        .register::<AnimeHistoryResponse>()
        .register::<FilmRow>()
        .register::<FilmsResponse>()
        .register::<TvRow>()
        .register::<TvResponse>()
        .register::<WatchStatsResponse>()
        // watch/now：原本是 in-memory 的 serde_json::Value，改成 struct 後才生得出型別
        .register::<NowWatching>()
        .register::<WatchNowResponse>()
        // watch/favorites：DB 列 + TMDb 在地化，原本是 json! 手捏
        .register::<WatchFavoriteRow>()
        .register::<WatchFavoritesResponse>()
        // home digest（首頁動態帶）
        .register::<DigestPost>()
        .register::<DigestThought>()
        .register::<DigestComment>()
        .register::<DigestTimeline>()
        .register::<DigestResponse>()
        // site stats（Footer / mega-menu）
        .register::<StatsResponse>()
        // series（系列文導覽）
        .register::<SeriesRow>()
        .register::<SeriesListResponse>()
        .register::<SeriesPostRow>()
        .register::<SeriesDetailResponse>();
    Typescript::default()
        .header("// 由 backend `cargo run --bin export_types` 產生 — 勿手改\n")
        .export_to("../packages/api-types/index.ts", &types, specta_serde::Format)
        .expect("export types");
    println!("exported → packages/api-types/index.ts");
}

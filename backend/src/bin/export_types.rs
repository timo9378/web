//! Rust struct → TypeScript 型別（packages/api-types）。
//! 用法：`cargo run --bin export_types`（backend/ 下）。
//! P4 起手：先收已 typed 的端點 struct；動態 JSON 端點待 typed 化後逐步 register。

// 這支是 codegen CLI 不是 server：它的輸出對象是跑指令的人，不是結構化 log，
// 所以 println! 就是對的做法。全 workspace 的 print_stdout = deny 在這裡放行。
#![allow(clippy::print_stdout, reason = "codegen CLI，輸出對象是終端機不是 log")]

use koimsurai_web_backend::handlers::admin::{
    AdminCategoryRow, AdminCommentRow, AdminCommentsResponse, AdminPostDetailResponse, AdminPostFull,
    AdminPostsResponse, AdminTagRow, AdminUserRow, AdminUsersResponse, BlacklistResponse, BlacklistRow,
    CategoryCreated, CategoryDeleted, CategoryUpdated, CommentCounts, CreatedResponse, ErrorResponse,
    KeywordFilterRow, KeywordFiltersResponse, MessageResponse, TagCreated, TagUpdated,
};
use koimsurai_web_backend::handlers::auth::{AuthProvidersResponse, OAuthProviderInfo};
use koimsurai_web_backend::handlers::books::{BookDetailResponse, BookRow, BooksListResponse};
use koimsurai_web_backend::handlers::categories::{CategoriesResponse, CategoryRow};
use koimsurai_web_backend::handlers::gallery::{
    ExifValue, GalleryPhoto, PhotoExif, PhotoGps, PhotoUrls, PhotosManifest,
};
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
use koimsurai_web_backend::handlers::quote::{DailyQuote, DailyQuoteResponse};
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
use koimsurai_web_backend::handlers::thirdparty::{
    GithubCommit, GithubCommitAuthor, GithubContributionDay, GithubContributionsResponse, GithubEvent,
    GithubEventPayload, GithubEventRepo, GithubEventsResponse, GithubRepo, GithubReposResponse,
    GithubUserResponse, SteamCustomization, SteamFeaturedBadge, SteamGame, SteamGamesResponse, SteamPlayer,
    SteamPlayerResponse, SteamProfile, SteamProfileResponse, WakatimeActualCodingTime, WakatimeGrandTotal,
    WakatimeStat, WakatimeStatsResponse, WakatimeTodayResponse,
};
use koimsurai_web_backend::handlers::thoughts::{
    ThoughtDetailResponse, ThoughtOut, ThoughtReactResponse, ThoughtRef, ThoughtRefScalar,
    ThoughtsListResponse,
};
use koimsurai_web_backend::handlers::vitals::MetricStat;
use koimsurai_web_backend::handlers::watch::{
    AnimeHistoryResponse, AnimeRow, FilmRow, FilmsResponse, NowWatching, TmdbSearchResponse,
    TmdbSearchResult, TvResponse, TvRow, WatchFavoriteRow, WatchFavoritesResponse, WatchNowResponse,
    WatchStatsResponse,
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
        // 每日名言（原本 json! 手捏 + 快取存 Value）
        .register::<DailyQuote>()
        .register::<DailyQuoteResponse>()
        // gallery manifest：檔案是我們自己寫的，所以型別放在寫的那一端
        .register::<ExifValue>()
        .register::<PhotoUrls>()
        .register::<PhotoExif>()
        .register::<PhotoGps>()
        .register::<GalleryPhoto>()
        .register::<PhotosManifest>()
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
        // admin CRUD 的寫入回應（typed 之後 OpenAPI 才有 response schema，
        // Schemathesis 的 stateful 階段才推得出 create→update→delete 的串接）
        .register::<MessageResponse>()
        .register::<ErrorResponse>()
        .register::<CreatedResponse>()
        .register::<TagCreated>()
        .register::<TagUpdated>()
        .register::<CategoryCreated>()
        .register::<CategoryUpdated>()
        .register::<CategoryDeleted>()
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
        // watch/tmdb-search：TMDb 回應重新塑形（不是原樣轉發）
        .register::<TmdbSearchResult>()
        .register::<TmdbSearchResponse>()
        // thoughts（碎念；ref 原本是自由格式的 serde_json::Value）
        .register::<ThoughtRefScalar>()
        .register::<ThoughtRef>()
        .register::<ThoughtOut>()
        .register::<ThoughtsListResponse>()
        .register::<ThoughtDetailResponse>()
        .register::<ThoughtReactResponse>()
        // 活動儀表板的第三方代理（github / steam / wakatime）：原本原樣轉發上游 JSON，
        // 型別只存在前端手寫的 Activity.tsx；改成回我們自己塑形過的欄位
        .register::<GithubUserResponse>()
        .register::<GithubCommitAuthor>()
        .register::<GithubCommit>()
        .register::<GithubEventRepo>()
        .register::<GithubEventPayload>()
        .register::<GithubEvent>()
        .register::<GithubEventsResponse>()
        // repos / contributions：原本瀏覽器直接打第三方，沒有型別來源可言
        .register::<GithubRepo>()
        .register::<GithubReposResponse>()
        .register::<GithubContributionDay>()
        .register::<GithubContributionsResponse>()
        .register::<SteamPlayer>()
        .register::<SteamPlayerResponse>()
        .register::<SteamGame>()
        .register::<SteamGamesResponse>()
        .register::<SteamFeaturedBadge>()
        .register::<SteamCustomization>()
        .register::<SteamProfile>()
        .register::<SteamProfileResponse>()
        .register::<WakatimeGrandTotal>()
        .register::<WakatimeActualCodingTime>()
        .register::<WakatimeTodayResponse>()
        .register::<WakatimeStat>()
        .register::<WakatimeStatsResponse>()
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

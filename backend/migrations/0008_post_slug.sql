-- 文章網址改用英文 slug（純文字網址，辨識度高）。
-- `slug` 是 UNIQUE：路由與 canonical 都用它；舊的 /blog/<id> 仍可進站，由前端 301 導到 slug 網址。
ALTER TABLE posts ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug) WHERE slug IS NOT NULL;

-- 改過的舊 slug 留一份，讓舊網址永遠不會斷（寫入時自動記錄，見 admin handler）。
CREATE TABLE IF NOT EXISTS post_slug_history (
  old_slug TEXT PRIMARY KEY,
  post_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 既有文章回填（有英文標題的由標題轉；沒有的依內容擬，之後可在後台改）。
UPDATE posts SET slug = 'from-guitar-to-nas' WHERE id = 5 AND slug IS NULL;
UPDATE posts SET slug = 'birthday-yakiniku-and-the-joy-of-building' WHERE id = 16 AND slug IS NULL;
UPDATE posts SET slug = 'february-fragments-birthday-reunion-and-tinkering' WHERE id = 17 AND slug IS NULL;
UPDATE posts SET slug = 'building-a-markdown-editor-that-manages-its-own' WHERE id = 21 AND slug IS NULL;
UPDATE posts SET slug = 'yorushika-the-old-man-and-the-sea' WHERE id = 23 AND slug IS NULL;
UPDATE posts SET slug = 'deploying-a-posthog-data-pipeline-locally' WHERE id = 24 AND slug IS NULL;
UPDATE posts SET slug = 'order-within-the-chaos' WHERE id = 29 AND slug IS NULL;
UPDATE posts SET slug = 'building-at-the-edge-of-weightlessness' WHERE id = 32 AND slug IS NULL;
UPDATE posts SET slug = 'wiring-blocknotes-ai-to-a-local-gemma' WHERE id = 33 AND slug IS NULL;
UPDATE posts SET slug = 'i-wanted-to-build-a-tool-calling-repair' WHERE id = 39 AND slug IS NULL;
UPDATE posts SET slug = 'a-locked-window-for-my-scattered-databases' WHERE id = 40 AND slug IS NULL;
UPDATE posts SET slug = 'wiring-nllb-translation-into-rust-and-breaking-through' WHERE id = 43 AND slug IS NULL;
UPDATE posts SET slug = 'building-a-self-updating-what-am-i-watching' WHERE id = 44 AND slug IS NULL;
UPDATE posts SET slug = 'writing-the-anigamer-sdk-nobody-made' WHERE id = 45 AND slug IS NULL;
UPDATE posts SET slug = 'the-3d-starfield-performance-march' WHERE id = 46 AND slug IS NULL;
UPDATE posts SET slug = 'blog-post-rendering-strategy' WHERE id = 47 AND slug IS NULL;
UPDATE posts SET slug = 'replacing-the-express-backend-with-rust' WHERE id = 48 AND slug IS NULL;

import React from 'react';
import './SearchAndFilter.css';

interface CategoryItem { category: string; post_count: number }
interface TagObject { name: string; post_count?: number }
type TagItem = string | TagObject;

interface SearchAndFilterProps {
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  selectedTag: string;
  setSelectedTag: (v: string) => void;
  selectedCategory: string;
  setSelectedCategory?: (v: string) => void;
  sortBy?: string;
  setSortBy?: (v: string) => void;
  viewMode?: string;
  setViewMode?: (v: string) => void;
  allTags?: TagItem[];
  allCategories?: CategoryItem[];
}

const SearchAndFilter = ({
  searchTerm,
  setSearchTerm,
  selectedTag,
  setSelectedTag,
  selectedCategory,
  setSelectedCategory,
  sortBy,
  setSortBy,
  viewMode,
  setViewMode,
  allTags,
  allCategories
}: SearchAndFilterProps) => {
  return (
    <div className="search-filter-container">
      {/* Search input with modern design */}
      <div className="modern-search-wrapper">
        <div className="search-input-container">
          <svg className="search-icon-modern" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="探索文章..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="modern-search-input"
          />
          {searchTerm && (
            <button
              className="clear-search-btn"
              aria-label="清除搜尋"
              onClick={() => setSearchTerm('')}
            >
              <svg viewBox="0 0 24 24" fill="none">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="search-suggestions">
          {searchTerm && (
            <div className="search-suggestion">
              搜索 "{searchTerm}" 相關文章
            </div>
          )}
        </div>
      </div>

      {/* Sort and View Mode Controls */}
      <div className="controls-row">
        {/* Sort By */}
        <div className="sort-control">
          <label className="control-label">
            <svg className="control-icon" viewBox="0 0 24 24" fill="none">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="16" y2="12" />
              <line x1="4" y1="18" x2="12" y2="18" />
            </svg>
            排序方式
          </label>
          <select
            className="modern-select"
            value={sortBy ?? 'newest'}
            onChange={(e) => setSortBy?.(e.target.value)}
          >
            <option value="newest">最新發佈</option>
            <option value="oldest">最舊發佈</option>
            <option value="popular">最多人氣</option>
          </select>
        </div>

        {/* View Mode Toggle */}
        <div className="view-mode-control">
          <label className="control-label">
            <svg className="control-icon" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            檢視模式
          </label>
          <div className="view-mode-buttons">
            <button
              className={`view-mode-btn ${(viewMode ?? 'card') === 'card' ? 'active' : ''}`}
              onClick={() => setViewMode?.('card')}
              aria-label="卡片模式"
              title="卡片模式"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode?.('list')}
              aria-label="列表模式"
              title="列表模式"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3" y2="6" />
                <line x1="3" y1="12" x2="3" y2="12" />
                <line x1="3" y1="18" x2="3" y2="18" />
              </svg>
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => setViewMode?.('timeline')}
              aria-label="時間軸模式"
              title="時間軸模式"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="2" />
                <circle cx="12" cy="16" r="2" />
                <line x1="12" y1="10" x2="12" y2="14" />
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Category Filter */}
      {allCategories && allCategories.length > 0 && (
        <div className="modern-filter-section">
          <div className="filter-header">
            <svg className="filter-icon-modern" viewBox="0 0 24 24" fill="none">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </svg>
            <span>分類篩選</span>
          </div>
          <div className="modern-tags-filter">
            <button
              className={`filter-tag ${selectedCategory === '' ? 'active' : ''}`}
              onClick={() => setSelectedCategory?.('')}
            >
              <span className="tag-icon">📁</span>
              全部分類
            </button>
            {allCategories.map(cat => (
              <button
                key={cat.category}
                className={`filter-tag ${selectedCategory === cat.category ? 'active' : ''}`}
                onClick={() => setSelectedCategory?.(cat.category)}
              >
                <span className="tag-icon">📂</span>
                {cat.category}
                <span className="tag-count">({cat.post_count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modern tag filter with collapse/expand */}
      <div className="modern-filter-section">
        <div className="filter-header">
          <svg className="filter-icon-modern" viewBox="0 0 24 24" fill="none">
            <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46" />
          </svg>
          <span>標籤篩選</span>
        </div>
        <TagFilter
          allTags={allTags}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
        />
      </div>
    </div>
  );
};

interface TagFilterProps {
  allTags?: TagItem[];
  selectedTag: string;
  setSelectedTag: (v: string) => void;
}

/** 摺疊式標籤篩選元件 */
const TagFilter = ({ allTags, selectedTag, setSelectedTag }: TagFilterProps) => {
  const [expanded, setExpanded] = React.useState(false);
  const maxShow = 10;
  const tagsToShow = expanded ? allTags : allTags?.slice(0, maxShow);

  return (
    <div className="modern-tags-filter">
      <button
        className={`filter-tag ${selectedTag === '' ? 'active' : ''}`}
        onClick={() => setSelectedTag('')}
      >
        <span className="tag-icon">🌟</span>
        全部標籤
      </button>
      {tagsToShow?.map(tag => {
        const name = typeof tag === 'object' ? tag.name : tag;
        const count = typeof tag === 'object' ? tag.post_count : undefined;
        return (
          <button
            key={name}
            className={`filter-tag ${selectedTag === name ? 'active' : ''}`}
            onClick={() => setSelectedTag(name)}
          >
            <span className="tag-icon">#</span>
            {name}
            {count && (
              <span className="tag-count">({count})</span>
            )}
          </button>
        );
      })}
      {allTags && allTags.length > maxShow && (
        <button
          className="filter-tag expand-tag"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收合' : `展開全部 (${allTags.length})`}
        </button>
      )}
    </div>
  );
};

export default SearchAndFilter;

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes, FaSearch, FaImage } from 'react-icons/fa';
import { loadPhotosManifest } from '@/lib/manifestLoader';
import { exifYmd } from '../../lib/exifDate';
import type { PhotoManifest } from '../../types/photo';
import { toast } from 'sonner';

interface PhotoSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (photo: PhotoManifest) => void;
}

const PhotoSelectorModal = ({ isOpen, onClose, onSelect }: PhotoSelectorModalProps) => {
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 照片 manifest 改由 TanStack Query 讀（開啟才抓）；同步後 refetch。
  const {
    data: photos = [],
    isFetching: loading,
    refetch,
  } = useQuery({
    queryKey: ['photos', 'manifest'],
    queryFn: loadPhotosManifest,
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  const handleSync = async () => {
    if (syncing) return;

    const token = localStorage.getItem('koimsurai_user_token');
    if (!token) {
      toast.error('請先登入後台再同步');
      return;
    }

    setSyncing(true);
    try {
      const response = await fetch('/api/admin/gallery/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        processed?: number;
        skipped?: number;
      };
      if (!response.ok) {
        throw new Error(data.error ?? '同步失敗');
      }

      toast.success(`同步完成：新增 ${data.processed ?? 0}，略過 ${data.skipped ?? 0}`);
      await refetch();
    } catch (err) {
      console.error('NAS sync failed:', err);
      toast.error(`同步失敗：${err instanceof Error ? err.message : '未知錯誤'}`);
    } finally {
      setSyncing(false);
    }
  };

  const filteredPhotos = useMemo(() => {
    if (!searchTerm) return photos;
    const lower = searchTerm.toLowerCase();
    return photos.filter(
      (p) =>
        p.title.toLowerCase().includes(lower) ||
        (p.description?.toLowerCase().includes(lower) ?? false) ||
        (p.tags?.some((t) => t.toLowerCase().includes(lower)) ?? false),
    );
  }, [photos, searchTerm]);

  // Handle click outside to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-9999 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
        onClick={handleBackdropClick}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-[rgba(24,24,27,0.92)] backdrop-blur-2xl border border-border/50 w-full max-w-6xl h-[85vh] rounded-xl flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
            <h3 className="text-sm font-medium text-foreground/90 flex items-center gap-2.5">
              <span className="p-1.5 bg-accent/50 rounded-md text-muted-foreground">
                <FaImage className="size-3.5" />
              </span>
              選擇 NAS 照片
              <span className="text-[11px] font-normal text-muted-foreground ml-1">{photos.length} 張</span>
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  void handleSync();
                }}
                disabled={syncing || loading}
                className="h-7 px-2.5 text-[11px] rounded-md border border-border/40 text-muted-foreground hover:text-foreground/90 hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncing ? '同步中...' : '同步 NAS'}
              </button>
              <button
                onClick={onClose}
                className="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground/80 hover:bg-accent/50 transition-colors"
              >
                <FaTimes size={14} />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="px-5 py-3 border-b border-border/30">
            <div className="relative max-w-md">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 size-3" />
              <input
                type="text"
                placeholder="搜尋照片標題、描述或標籤..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-accent/30 border border-border/40 text-foreground/90 pl-9 pr-4 py-2 text-sm rounded-lg focus:outline-hidden focus:border-border/60 transition-colors placeholder:text-muted-foreground/50"
                // 同上：modal 打開就是為了搜尋照片，焦點直接進搜尋框
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
          </div>

          {/* Grid Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-border"></div>
                <p className="text-sm">正在從 NAS 讀取照片...</p>
              </div>
            ) : filteredPhotos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground/50 gap-2">
                <FaImage size={32} className="opacity-30" />
                <p className="text-sm">沒有找到符合的照片</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-3">
                {filteredPhotos.map((photo) => {
                  const dateStr = exifYmd(photo.exif?.DateTimeOriginal);

                  return (
                    <button
                      type="button"
                      key={photo.id}
                      onClick={() => onSelect(photo)}
                      className="w-full text-left group relative aspect-4/3 rounded-lg overflow-hidden cursor-pointer border border-border/30 hover:border-border/60 transition-all duration-300 bg-accent/20"
                    >
                      {/* Image */}
                      <img
                        src={photo.thumbnailUrl}
                        alt={photo.title}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        loading="lazy"
                        decoding="async"
                      />

                      {/* Overlay */}
                      <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3 transform translate-y-2 group-hover:translate-y-0">
                        <p className="text-white text-xs font-medium truncate leading-tight">{photo.title}</p>
                        {dateStr && <p className="text-white/60 text-[10px] mt-1 font-mono tracking-wide">{dateStr}</p>}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {photo.tags?.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="text-[9px] bg-white/15 px-1.5 py-0.5 rounded text-white/80 backdrop-blur-xs"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Selection Indicator */}
                      <div className="absolute top-2 right-2 bg-foreground/80 text-background p-1 rounded-md opacity-0 group-hover:opacity-100 transform scale-50 group-hover:scale-100 transition-all">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t border-border/30 text-[11px] text-muted-foreground/50 flex justify-between">
            <span>NAS Storage · {filteredPhotos.length} 張照片</span>
            <span>點擊照片以插入文章</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PhotoSelectorModal;

/**
 * EXIFPanel - EXIF 資訊面板
 * 顯示詳細的照片 EXIF 資訊和元數據
 */

import { memo } from 'react';
import { motion } from 'framer-motion';
import type { PhotoManifest } from '../types/photo';
import './EXIFPanel.css';

interface EXIFPanelProps {
  photo: PhotoManifest;
}

const EXIFPanel = memo(({ photo }: EXIFPanelProps) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const formatExposureTime = (time?: string): string => {
    if (!time) return 'N/A';
    const num = parseFloat(time);
    if (num >= 1) return `${num}s`;
    return `1/${Math.round(1 / num)}s`;
  };

  const formatAperture = (aperture?: string): string => {
    if (!aperture) return 'N/A';
    return `f/${aperture}`;
  };

  return (
    <motion.div
      className="exif-panel"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
    >
      <div className="exif-panel-content">
        {/* 標題 */}
        <div className="exif-section">
          <h3 className="exif-section-title">照片資訊</h3>
          {photo.title && (
            <div className="exif-row">
              <span className="exif-label">標題</span>
              <span className="exif-value">{photo.title}</span>
            </div>
          )}
          {photo.description && (
            <div className="exif-row">
              <span className="exif-label">描述</span>
              <span className="exif-value">{photo.description}</span>
            </div>
          )}
        </div>

        {/* 基本資訊 */}
        <div className="exif-section">
          <h3 className="exif-section-title">基本資訊</h3>
          <div className="exif-row">
            <span className="exif-label">尺寸</span>
            <span className="exif-value">
              {photo.width} × {photo.height}
            </span>
          </div>
          <div className="exif-row">
            <span className="exif-label">檔案大小</span>
            <span className="exif-value">{formatFileSize(photo.size)}</span>
          </div>
          {photo.format && (
            <div className="exif-row">
              <span className="exif-label">格式</span>
              <span className="exif-value">{photo.format.toUpperCase()}</span>
            </div>
          )}
          <div className="exif-row">
            <span className="exif-label">比例</span>
            <span className="exif-value">{photo.aspectRatio.toFixed(2)}</span>
          </div>
        </div>

        {/* 相機資訊 */}
        {photo.exif && (
          <div className="exif-section">
            <h3 className="exif-section-title">相機資訊</h3>
            {photo.exif.make && (
              <div className="exif-row">
                <span className="exif-label">製造商</span>
                <span className="exif-value">{photo.exif.make}</span>
              </div>
            )}
            {photo.exif.model && (
              <div className="exif-row">
                <span className="exif-label">型號</span>
                <span className="exif-value">{photo.exif.model}</span>
              </div>
            )}
            {photo.exif.LensModel && (
              <div className="exif-row">
                <span className="exif-label">鏡頭</span>
                <span className="exif-value">{photo.exif.LensModel}</span>
              </div>
            )}
          </div>
        )}

        {/* 拍攝參數 */}
        {photo.exif && (
          <div className="exif-section">
            <h3 className="exif-section-title">拍攝參數</h3>
            {photo.exif.FocalLength && (
              <div className="exif-row">
                <span className="exif-label">焦距</span>
                <span className="exif-value">
                  {photo.exif.FocalLength}mm
                  {photo.exif.FocalLengthIn35mmFormat &&
                    ` (${photo.exif.FocalLengthIn35mmFormat}mm)`}
                </span>
              </div>
            )}
            {photo.exif.FNumber && (
              <div className="exif-row">
                <span className="exif-label">光圈</span>
                <span className="exif-value">{formatAperture(photo.exif.FNumber)}</span>
              </div>
            )}
            {photo.exif.ExposureTime && (
              <div className="exif-row">
                <span className="exif-label">快門</span>
                <span className="exif-value">{formatExposureTime(photo.exif.ExposureTime)}</span>
              </div>
            )}
            {photo.exif.ISO && (
              <div className="exif-row">
                <span className="exif-label">ISO</span>
                <span className="exif-value">ISO {photo.exif.ISO}</span>
              </div>
            )}
            {photo.exif.Flash && (
              <div className="exif-row">
                <span className="exif-label">閃光燈</span>
                <span className="exif-value">{photo.exif.Flash}</span>
              </div>
            )}
            {photo.exif.WhiteBalance && (
              <div className="exif-row">
                <span className="exif-label">白平衡</span>
                <span className="exif-value">{photo.exif.WhiteBalance}</span>
              </div>
            )}
            {photo.exif.DateTimeOriginal && (
              <div className="exif-row">
                <span className="exif-label">拍攝時間</span>
                <span className="exif-value">{formatDate(photo.exif.DateTimeOriginal)}</span>
              </div>
            )}
          </div>
        )}

        {/* GPS 資訊 */}
        {photo.gps && (
          <div className="exif-section">
            <h3 className="exif-section-title">位置資訊</h3>
            <div className="exif-row">
              <span className="exif-label">緯度</span>
              <span className="exif-value">{photo.gps.latitude.toFixed(6)}°</span>
            </div>
            <div className="exif-row">
              <span className="exif-label">經度</span>
              <span className="exif-value">{photo.gps.longitude.toFixed(6)}°</span>
            </div>
            {photo.gps.altitude && (
              <div className="exif-row">
                <span className="exif-label">海拔</span>
                <span className="exif-value">{photo.gps.altitude.toFixed(0)}m</span>
              </div>
            )}
            {photo.location && (
              <div className="exif-row">
                <span className="exif-label">地點</span>
                <span className="exif-value">{photo.location}</span>
              </div>
            )}
          </div>
        )}

        {/* 標籤 */}
        {photo.tags && photo.tags.length > 0 && (
          <div className="exif-section">
            <h3 className="exif-section-title">標籤</h3>
            <div className="exif-tags">
              {photo.tags.map((tag) => (
                <span key={tag} className="exif-tag">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Live Photo */}
        {photo.isLivePhoto && (
          <div className="exif-section">
            <div className="exif-row">
              <span className="exif-label">類型</span>
              <span className="exif-value exif-live-photo">📹 Live Photo</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
});

EXIFPanel.displayName = 'EXIFPanel';

export default EXIFPanel;

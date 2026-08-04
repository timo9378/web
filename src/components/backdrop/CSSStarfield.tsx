// 手機後備星空 —— 純 CSS（兩層 box-shadow 星點 + 緩慢漂移），零 JS 渲染迴圈。
// 取代桌面的 Three.js Canvas，讓手機不必載入 vendor-three。
import './CSSStarfield.css';

export default function CSSStarfield() {
  return (
    <div className="css-starfield" aria-hidden="true">
      <div className="css-stars css-stars--far" />
      <div className="css-stars css-stars--near" />
    </div>
  );
}

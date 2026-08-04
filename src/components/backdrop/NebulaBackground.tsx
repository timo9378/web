import './NebulaBackground.css';

function NebulaBackground() {
  return (
    <>
      {/* 深空暗幕 */}
      <div className="nebula-dim-overlay" />

      {/* 星雲背景 */}
      <div className="nebula-bg">
        <div className="nebula-layer nebula-1" />
        <div className="nebula-layer nebula-2" />
        <div className="nebula-layer nebula-3" />
        <div className="nebula-dust" />
      </div>
    </>
  );
}

export default NebulaBackground;

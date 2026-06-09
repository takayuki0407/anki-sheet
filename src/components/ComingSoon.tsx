// Shown instead of the whole app when the build sets VITE_PRIVATE=true — so the public production
// URL isn't a freely-usable app before web billing exists. Preview builds (no flag) keep the app.
export function ComingSoon() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
        fontFamily: "-apple-system, system-ui, sans-serif",
        color: "#333",
        background: "#fffdf7",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Kiokumate</h1>
      <p style={{ margin: 0, fontSize: 16, color: "#666" }}>ただいま準備中です。</p>
      <p style={{ margin: 0, fontSize: 14, color: "#999" }}>
        公開までもうしばらくお待ちください。
      </p>
    </div>
  );
}

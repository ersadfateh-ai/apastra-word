import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("Apastra Word UI error:", error); }
  render() {
    if (this.state.failed) return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#20222e",color:"#f4f5fa",fontFamily:"sans-serif",padding:24}}><section style={{maxWidth:420,textAlign:"center"}}><h2>Apastra Word could not load this screen.</h2><p style={{opacity:.75}}>Your saved words are stored separately. Refresh the page to try again.</p><button onClick={()=>location.reload()} style={{padding:"11px 18px",borderRadius:9,border:0,cursor:"pointer"}}>Refresh page</button></section></main>;
    return this.props.children;
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {}));
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>
);

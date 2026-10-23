// React integration: <ShravelleErrorBoundary fallback={<p>Something went wrong</p>}>...</ShravelleErrorBoundary>
// Route changes are captured automatically (history API), so React Router needs no setup.
import React from "react";
import Shravelle from "./shravelle-browser.js";

export class ShravelleErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { Shravelle.error(error, { componentStack: (info && info.componentStack) || "" }); }
  render() { return this.state.hasError ? (this.props.fallback || null) : this.props.children; }
}
export default Shravelle;

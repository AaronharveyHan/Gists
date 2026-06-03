import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureError } from "../lib/errorReporting";
import { getT } from "../store/useI18nStore";

interface Props { children: ReactNode; }
interface State { hasError: boolean; message: string; }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    captureError(err, { componentStack: info.componentStack ?? "" });
  }

  render() {
    if (this.state.hasError) {
      const t = getT();
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace" }}>
          <h2>{t.errorBoundary.title}</h2>
          <pre style={{ color: "#e06c75", whiteSpace: "pre-wrap" }}>{this.state.message}</pre>
          <button onClick={() => this.setState({ hasError: false, message: "" })}>
            {t.errorBoundary.tryAgain}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

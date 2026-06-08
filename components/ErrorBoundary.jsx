import React from 'react';
import { AlertTriangle, Copy, Check, RotateCcw } from 'lucide-react';
import { logError, MODULES } from '../utils/errorLogger.js';

/**
 * ErrorBoundary — catches render crashes in the subtree, logs them with an
 * Error ID, and shows a friendly fallback with a copyable ID.
 *
 * Usage (one per module so a crash in Reports doesn't kill Lead Search):
 *   <ErrorBoundary module={MODULES.RPT} componentName="ReportGenerator" user={userEmail}>
 *     <ReportGenerator ... />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errorId: null, copied: false };
  }

  static getDerivedStateFromError() {
    return {}; // errorId is set in componentDidCatch
  }

  componentDidCatch(error, info) {
    const errorId = logError(this.props.module || MODULES.GEN, error, {
      user: this.props.user || 'anonymous',
      component: this.props.componentName || 'ErrorBoundary',
      action: 'render-crash',
      context: { componentStack: (info?.componentStack || '').slice(0, 1024) },
    });
    this.setState({ errorId });
  }

  handleCopy = () => {
    const { errorId } = this.state;
    const done = () => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(errorId).then(done).catch(done);
    } else {
      done();
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.errorId) return this.props.children;

    const { errorId, copied } = this.state;
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="border border-base-300 rounded bg-base-100 max-w-md w-full p-6 text-center space-y-4">
          <AlertTriangle size={36} className="text-warning mx-auto" />
          <div>
            <h2 className="text-lg font-semibold text-base-content">Something went wrong</h2>
            <p className="text-sm text-base-content/70 mt-1">
              If you contact support, please share this Error ID:
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <code className="px-3 py-2 rounded bg-base-200 text-sm font-mono select-all">
              {errorId}
            </code>
            <button
              onClick={this.handleCopy}
              className="btn btn-sm btn-ghost"
              title="Copy Error ID"
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>
          <button onClick={this.handleReload} className="btn btn-sm btn-primary gap-2">
            <RotateCcw size={14} /> Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

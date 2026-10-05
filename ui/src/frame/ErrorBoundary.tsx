import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/** Per-card containment: a throwing type component never takes down the app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Card render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="card-render-error" role="alert">
          Render error
        </p>
      );
    }
    return this.props.children;
  }
}

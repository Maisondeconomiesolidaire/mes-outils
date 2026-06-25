import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError =
      /chunk|dynamically imported module|failed to fetch/i.test(error.message);

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <div>
          <p className="text-lg font-semibold text-[var(--foreground)]">Une erreur est survenue</p>
          <p className="mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
            {isChunkError
              ? "L'application a ete mise a jour. Recharge la page pour recuperer les derniers fichiers."
              : "Cette section n'a pas pu s'afficher correctement."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Recharger
          </button>
          {!isChunkError ? (
            <button
              type="button"
              onClick={this.reset}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
            >
              Reessayer
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

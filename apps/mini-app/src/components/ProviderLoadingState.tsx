import styles from './ProviderLoadingState.module.css';

/** Presentation only: wallet initialization must not be needed to paint the shell. */
export function ProviderLoadingState() {
  return <div data-product-ui="v2" className="app-shell app-shell-tabs" role="status" aria-label="Loading FxAeon" aria-busy="true">
    <span className="sr-only">Loading FxAeon</span>
    <div className="app-workspace" aria-hidden="true">
      <div className="app-topbar">
        <span className="brand-wordmark">FxAeon</span>
        <div className={styles.controls}><span /><span /></div>
      </div>
      <div className={`app-content ${styles.content}`}>
        <div className={styles.heading} />
        <div className={styles.workspace}>
          <div className={styles.overview}><span /><span /><span /></div>
          <div className={styles.form}><span /><div /><div /><span /></div>
        </div>
      </div>
    </div>
  </div>;
}

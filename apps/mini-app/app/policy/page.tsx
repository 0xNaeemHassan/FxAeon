'use client';
// NOTE: Consider dynamic() for heavy components in production

export default function Policy() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Risk Policy page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Risk Policy</h1>
      
      <section aria-label="Risk parameters" className="space-y-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
            <button type="button" type="button"
              onClick={() => setError(null)}
              className="mt-2 text-red-600 text-sm hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

          <h2 className="font-semibold mb-2">Maximum Leverage</h2>
          <p className="text-gray-600 dark:text-gray-300">31x for xETH, 10x for xUSD</p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <h2 className="font-semibold mb-2">Liquidation Threshold</h2>
          <p className="text-gray-600 dark:text-gray-300">80% LTV</p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <h2 className="font-semibold mb-2">Cooldown Period</h2>
          <p className="text-gray-600 dark:text-gray-300">1 hour between large trades</p>
        </div>
      </section>

      <a 
        href="/" 
        className="mt-6 inline-block text-blue-600 underline btn-touch p-2"
        aria-label="Back to dashboard"
      >
        Back to Dashboard
      </a>
    </main>
  );
}

import AssetCard from '../components/dashboard/AssetCard'
import AIBriefingCard from '../components/dashboard/AIBriefingCard'
import TransactionTable from '../components/dashboard/TransactionTable'
import { useUIStore } from '../stores/uiStore'

export default function DashboardPage() {
  const isLeftExpanded = useUIStore((s) => s.isLeftExpanded)
  const isChartMode = useUIStore((s) => s.isChartMode)

  return (
    <>
      {/* Top: Smart Pane Shifting layout */}
      <div className="mt-2 flex flex-col lg:flex-row gap-6">
        <div
          className={`transition-all duration-500 ease-in-out shrink-0 ${
            isChartMode ? 'lg:w-0 lg:opacity-0 lg:overflow-hidden pointer-events-none' : isLeftExpanded ? 'lg:w-1/2' : 'lg:w-[78px]'
          }`}
        >
          {!isChartMode ? <AssetCard isExpanded={isLeftExpanded} /> : null}
        </div>

        <div
          className={`transition-all duration-500 ease-in-out min-w-0 ${
            isChartMode ? 'lg:w-full' : isLeftExpanded ? 'lg:w-1/2' : 'flex-1'
          }`}
        >
          <AIBriefingCard />
        </div>
      </div>

      {/* Bottom: Transaction ledger */}
      <TransactionTable />
    </>
  )
}

import AssetCard from '../components/dashboard/AssetCard'
import AIBriefingCard from '../components/dashboard/AIBriefingCard'
import TransactionTable from '../components/dashboard/TransactionTable'
import { useUIStore } from '../stores/uiStore'

export default function DashboardPage() {
  const isLeftExpanded = useUIStore((s) => s.isLeftExpanded)

  return (
    <>
      {/* Top: Smart Pane Shifting layout */}
      <div className="mt-1 flex flex-col lg:flex-row gap-6">
        <div
          className={`transition-all duration-500 ease-in-out shrink-0 ${
            isLeftExpanded ? 'lg:w-1/2' : 'lg:w-[78px]'
          }`}
        >
          <AssetCard isExpanded={isLeftExpanded} />
        </div>

        <div
          className={`transition-all duration-500 ease-in-out min-w-0 ${
            isLeftExpanded ? 'lg:w-1/2' : 'flex-1'
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

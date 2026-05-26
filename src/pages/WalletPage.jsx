import React from 'react'
import { HubPurchaseWidget } from '../services/merlin-hub-sdk/react'

export default function WalletPage() {
  return (
    <div className="w-full min-h-full py-2">
      <HubPurchaseWidget 
        appName="금고지기" 
        redirectUrl="/p-wallet" 
      />
    </div>
  )
}
